import chalk from "chalk";
import { execSync } from "child_process";
import cliProgress from "cli-progress";
import crypto from "crypto";
import fs from "fs-extra";
import { NodeSSH } from "node-ssh";
import ora from "ora";
import os from "os";
import path from "path";
import * as tar from "tar";

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hashFileContents(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function appendLineOnce(content, line) {
  const lines = content.split("\n");
  if (lines.some((existing) => existing.replace(/\r$/, "") === line)) {
    return content;
  }
  if (content === "") return `${line}\n`;
  return content.endsWith("\n")
    ? `${content}${line}\n`
    : `${content}\n${line}\n`;
}

function applyManagedBlock(content, marker, line) {
  const begin = marker.includes("{mark}")
    ? marker.replace("{mark}", "BEGIN")
    : `${marker} BEGIN`;
  const end = marker.includes("{mark}")
    ? marker.replace("{mark}", "END")
    : `${marker} END`;
  const block = `${begin}\n${line}\n${end}`;
  const lines = content.split("\n");
  const beginIdx = lines.findIndex(
    (existing) => existing.replace(/\r$/, "") === begin
  );
  if (beginIdx !== -1) {
    let endIdx = -1;
    for (let i = beginIdx + 1; i < lines.length; i++) {
      if (lines[i].replace(/\r$/, "") === end) {
        endIdx = i;
        break;
      }
    }
    const tail = endIdx !== -1 ? lines.slice(endIdx + 1) : [];
    return [...lines.slice(0, beginIdx), ...block.split("\n"), ...tail].join(
      "\n"
    );
  }
  if (content === "") return `${block}\n`;
  const prefix = content.endsWith("\n") ? content : `${content}\n`;
  return `${prefix}${block}\n`;
}

/**
 * Custom error class for file/directory not found errors
 */
export class PathNotFoundError extends Error {
  constructor(path, type = "path") {
    const message = `The ${type} does not exist: ${path}\nPlease ensure the ${type} exists before attempting to transfer.`;
    super(message);
    this.name = "PathNotFoundError";
    this.path = path;
    this.type = type;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Custom error class for transfer-related errors
 */
export class TransferError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = "TransferError";
    this.originalError = originalError;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Custom error class for deployment failures
 * Can suppress stack trace when verbose is false
 */
export class DeploymentError extends Error {
  constructor(message, suppressStackTrace = false) {
    super(message);
    this.name = "DeploymentError";
    if (!suppressStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    } else {
      // Suppress stack trace completely
      this.stack = this.message;
      // Override toString to return just the message
      this.toString = () => this.message;
    }
  }
}

/**
 * Parse a simple inventory.ini file to support multi-host deployments.
 * Expected format:
 *   [groupName]
 *   server1 host=1.2.3.4 user=deployer port=22
 *   server2 host=1.2.3.5 user=ubuntu
 */
export function parseInventoryFile(inventoryPath, group) {
  const content = fs.readFileSync(inventoryPath, "utf8");
  const lines = content.split(/\r?\n/);
  let currentGroup = null;
  const groups = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const groupMatch = line.match(/^\[(.+?)\]$/);
    if (groupMatch) {
      currentGroup = groupMatch[1].trim();
      if (!groups[currentGroup]) groups[currentGroup] = [];
      continue;
    }

    if (!currentGroup) continue;

    const parts = line.split(/\s+/);
    if (parts.length === 0) continue;

    const name = parts[0];
    const hostConfig = { name, group: currentGroup };

    for (let i = 1; i < parts.length; i++) {
      const [key, value] = parts[i].split("=");
      if (!key || typeof value === "undefined") continue;
      const k = key.trim();
      const v = value.trim();
      if (!v) continue;
      if (k === "host") hostConfig.host = v;
      else if (k === "user") hostConfig.user = v;
      else if (k === "port") hostConfig.port = Number.parseInt(v, 10) || 22;
      else hostConfig[k] = v;
    }

    if (hostConfig.host && hostConfig.user) {
      groups[currentGroup].push(hostConfig);
    }
  }

  if (group) {
    return groups[group] || [];
  }

  // If no specific group provided, flatten all groups
  return Object.values(groups).flat();
}

export class Daffodil {
  constructor({
    remoteUser,
    remoteHost,
    remotePath = ".",
    port = 22,
    ignoreFile = ".scpignore",
    verbose = false,
    inventory,
    group,
    check = false,
    sshKeyPath = null,
  }) {
    const usingInventory = Boolean(inventory);
    // Validate required parameters
    if (!usingInventory) {
      if (!remoteUser || typeof remoteUser !== "string") {
        throw new Error("remoteUser is required and must be a string");
      }
      if (!remoteHost || typeof remoteHost !== "string") {
        throw new Error("remoteHost is required and must be a string");
      }
    }
    if (port && (typeof port !== "number" || port < 1 || port > 65535)) {
      throw new Error("port must be a number between 1 and 65535");
    }

    this.remoteUser = remoteUser;
    this.remoteHost = remoteHost;
    this.remotePath = remotePath;
    this.port = port;
    this.ssh = new NodeSSH();
    this.ignoreFile = ignoreFile;
    this.excludeList = this.loadIgnoreList();
    this.verbose = verbose;
    this.check = Boolean(check);
    this.sshKeyPath = sshKeyPath || null;
    this._remoteHome = null;
    this._remoteHomeKey = null;

    // Multi-host inventory support
    this.inventory = inventory || null;
    this.inventoryGroup = group || null;
    this.inventoryTargets = null;

    if (usingInventory) {
      const inventoryPath = path.resolve(inventory);
      if (!fs.existsSync(inventoryPath)) {
        throw new Error(
          `Inventory file not found: ${inventoryPath}. Please provide a valid inventory.ini path.`
        );
      }
      const targets = parseInventoryFile(inventoryPath, group);
      if (!targets.length) {
        throw new Error(
          group
            ? `No hosts found in inventory group "${group}".`
            : "No hosts found in inventory file."
        );
      }
      this.inventoryTargets = targets;
      if (this.verbose) {
        this.log(
          `Loaded ${targets.length} host(s) from inventory${
            group ? ` group "${group}"` : ""
          }`,
          "blue"
        );
      }
    }
  }

  /**
   * Set options for the deployer
   * @param {Object} options - Options object
   * @param {boolean} options.verbose - Enable verbose logging (default: false)
   * @param {boolean} options.check - Enable check (dry-run) mode (no remote mutations)
   */
  setOption(options = {}) {
    if (typeof options.verbose === "boolean") {
      this.verbose = options.verbose;
    }
    if (typeof options.check === "boolean") {
      this.check = options.check;
    }
  }

  /**
   * Get formatted timestamp
   * @returns {string} Formatted timestamp
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Escape shell arguments to prevent command injection
   * @param {string} arg - Argument to escape
   * @returns {string} Escaped argument
   * @private
   */
  escapeShellArg(arg) {
    // Replace single quotes with '\'' and wrap in single quotes
    return `'${String(arg).replace(/'/g, "'\\''")}'`;
  }

  /**
   * Log message with timestamp if verbose is enabled
   * @param {string} message - Message to log
   * @param {string} color - Chalk color function name
   */
  log(message, color = "blue") {
    if (this.verbose) {
      const timestamp = this.getTimestamp();
      console.log(chalk[color](`[${timestamp}] ${message}`));
    } else {
      console.log(chalk[color](message));
    }
  }

  /**
   * Get human-readable error message
   * @param {Error} error - Error object
   * @returns {string} Human-readable error message
   */
  getHumanReadableError(error) {
    if (!error) return "Unknown error occurred";

    // Handle specific error types
    if (error instanceof PathNotFoundError) {
      return `The ${error.type} does not exist: ${error.path}`;
    }

    if (error instanceof TransferError) {
      return error.message;
    }

    // Handle SSH authentication errors
    if (
      error.message &&
      error.message.includes("All configured authentication methods failed")
    ) {
      return "SSH connection failed: Authentication failed. Please check your SSH keys and credentials.";
    }

    if (error.message && error.message.includes("ECONNREFUSED")) {
      return `SSH connection failed: Could not connect to ${this.remoteHost}:${this.port}. The server may be down or the port may be incorrect.`;
    }

    if (error.message && error.message.includes("ETIMEDOUT")) {
      return `SSH connection failed: Connection timeout to ${this.remoteHost}:${this.port}. Please check your network connection.`;
    }

    if (error.message && error.message.includes("ENOTFOUND")) {
      return `SSH connection failed: Host ${this.remoteHost} not found. Please check the hostname.`;
    }

    // Handle file system errors
    if (error.code === "ENOENT") {
      return "File or directory not found.";
    }

    if (error.code === "EACCES") {
      return "Permission denied. Please check file permissions.";
    }

    // Return the error message if available, otherwise a generic message
    return error.message || "An unexpected error occurred";
  }

  /**
   * Log error with verbose details if verbose is enabled
   * @param {string} message - Error message
   * @param {Error} error - Error object
   */
  logError(message, error = null) {
    if (this.verbose) {
      const timestamp = this.getTimestamp();
      console.error(chalk.red(`[${timestamp}] ${message}`));
      if (error) {
        console.error(chalk.red(`  Error Name: ${error.name || "Unknown"}`));
        console.error(
          chalk.red(`  Error Message: ${error.message || "No message"}`)
        );
        if (error.code) {
          console.error(chalk.red(`  Error Code: ${error.code}`));
        }
        if (error.stack) {
          console.error(chalk.red(`  Stack Trace:\n${error.stack}`));
        }
        if (error.originalError) {
          console.error(
            chalk.red(
              `  Original Error: ${error.originalError.message || error.originalError}`
            )
          );
        }
      }
    } else {
      // Show human-readable error message when not verbose
      const humanReadableMsg = error
        ? this.getHumanReadableError(error)
        : message;
      console.error(chalk.red(message));
      console.error(chalk.red(`  ${humanReadableMsg}`));
    }
  }

  /**
   * Log time consumption for an operation
   * @param {string} operation - Operation name
   * @param {number} startTime - Start time in milliseconds
   */
  logTimeConsumption(operation, startTime) {
    if (this.verbose) {
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      const timestamp = this.getTimestamp();
      console.log(
        chalk.cyan(`[${timestamp}] ${operation} completed in ${duration}s`)
      );
    }
  }

  async connect() {
    const startTime = Date.now();
    const spinner = ora(`Connecting to ${this.remoteHost}`).start();
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    const defaultKeyFiles = ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"];
    const failures = [];

    const candidates = [];
    if (this.sshKeyPath) {
      candidates.push({
        label: this.sshKeyPath,
        keyPath: path.resolve(this.sshKeyPath),
      });
    } else {
      for (const keyFile of defaultKeyFiles) {
        candidates.push({
          label: keyFile,
          keyPath: path.join(homeDir, ".ssh", keyFile),
        });
      }
    }

    if (this.verbose) {
      this.log(
        `Attempting SSH connection to ${this.remoteHost}:${this.port}`,
        "blue"
      );
      this.log(`Trying SSH keys from: ${homeDir}\\.ssh`, "blue");
    }

    for (const candidate of candidates) {
      const keyPath = candidate.keyPath;
      if (fs.existsSync(keyPath)) {
        try {
          if (this.verbose) {
            this.log(`Trying SSH key: ${candidate.label}`, "blue");
          }
          await this.ssh.connect({
            host: this.remoteHost,
            username: this.remoteUser,
            port: this.port,
            privateKey: fs.readFileSync(keyPath, "utf8"),
          });
          spinner.succeed(
            chalk.green(`SSH Connected using key: ${candidate.label}`)
          );
          this.logTimeConsumption("SSH Connection", startTime);

          const ensurePath = path.posix.resolve(this.remotePath);
          if (!this.check) {
            await this.ssh.execCommand(
              `mkdir -p ${this.escapeShellArg(ensurePath)}`
            );
            this.log(`Verified or created remote path: ${ensurePath}`, "blue");
          } else {
            this.log(
              `Check mode: skipped verifying remote path: ${ensurePath}`,
              "blue"
            );
          }
          return; // ✅ Success, skip remaining
        } catch (err) {
          const errorMsg = this.verbose
            ? err.message
            : this.getHumanReadableError(err);
          failures.push({ key: candidate.label, error: errorMsg });
          if (this.verbose) {
            this.logError(`Failed to connect with key ${candidate.label}`, err);
          }
        }
      }
    }

    // ❌ All keys failed
    spinner.fail(chalk.red("Connection failed: No valid SSH keys worked."));

    if (this.verbose) {
      this.logError("Connection failed: No valid SSH keys worked.");
      console.error(chalk.red("Tried the following keys:"));
      failures.forEach((f) => {
        this.logError(`- ${f.key}: ${f.error}`);
      });
    } else {
      console.error(chalk.red("SSH connection failed: Authentication failed."));
      console.error(
        chalk.red("Please ensure your SSH keys are properly configured.")
      );
    }

    // Throw error instead of process.exit for library code
    throw new Error(
      "SSH connection failed: No valid SSH keys worked. Please ensure your SSH keys are properly configured."
    );
  }

  loadIgnoreList() {
    if (!fs.existsSync(this.ignoreFile)) {
      fs.writeFileSync(this.ignoreFile, "# Add ignore patterns\n");
      this.log(`Created ${this.ignoreFile}`, "yellow");
    }
    const excludeList = fs
      .readFileSync(this.ignoreFile, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    if (this.verbose && excludeList.length > 0) {
      this.log(
        `Loaded ${excludeList.length} exclude pattern(s) from ${this.ignoreFile}`,
        "blue"
      );
    }

    return excludeList;
  }

  async runCommand(cmd) {
    const startTime = Date.now();
    if (this.verbose) {
      this.log(`Executing local command: ${cmd}`, "blue");
    }
    try {
      const output = execSync(cmd, { stdio: "pipe" }); // changed from 'inherit' to 'pipe'
      const result = output?.toString() || "";
      console.log(result);
      this.logTimeConsumption(`Local command: ${cmd}`, startTime);
      return result;
    } catch (e) {
      const errorMsg = e.stderr?.toString() || e.message;
      this.logError(`Local command failed: ${errorMsg}`, e);
      return null;
    }
  }

  /**
   * Convenience alias for local shell execution.
   * @param {string} cmd
   */
  async local(cmd) {
    return this.runCommand(cmd);
  }

  async sshCommand(cmd) {
    const startTime = Date.now();
    if (this.check) {
      // Check mode must never mutate the remote host: raw commands are skipped.
      this.log(`Check mode: skipped remote command: ${cmd}`, "yellow");
      return { status: "skipped", changed: false };
    }
    if (this.verbose) {
      this.log(`Executing SSH command: ${cmd}`, "blue");
    }
    const result = await this.ssh.execCommand(cmd);
    if (result.stdout) {
      if (this.verbose) {
        this.log(`SSH stdout: ${result.stdout}`, "green");
      } else {
        console.log(chalk.green(result.stdout));
      }
    }
    if (result.stderr) {
      if (this.verbose) {
        this.logError(`SSH stderr: ${result.stderr}`);
      } else {
        console.error(chalk.red(result.stderr));
      }
    }
    this.logTimeConsumption(`SSH command: ${cmd}`, startTime);
    return { status: "ok", changed: false };
  }

  /**
   * Convenience alias for running a remote SSH command.
   * @param {string} cmd
   */
  async ssh(cmd) {
    return this.sshCommand(cmd);
  }

  async makeDirectory(dirName) {
    const startTime = Date.now();
    this.log(`Ensuring remote directory: ${dirName}`, "blue");
    const result = await this.ensureDirectory(dirName);
    this.logTimeConsumption(`Create directory: ${dirName}`, startTime);
    return result;
  }

  /**
   * Run a command on the remote host and capture its output.
   * @param {string} command
   * @returns {Promise<{code: number, stdout: string, stderr: string}>}
   */
  async _exec(command) {
    const result = await this.ssh.execCommand(command);
    return {
      code: typeof result.code === "number" ? result.code : 0,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
    };
  }

  /**
   * Resolve a remote path: expands `~`, keeps absolute paths, and joins
   * relative paths to the configured remote path.
   */
  async _resolveRemotePath(targetPath) {
    const raw = String(targetPath ?? "").trim();
    if (!raw) throw new Error("path is required");
    if (raw === "~" || raw.startsWith("~/")) {
      const home = await this._getRemoteHome();
      return raw === "~" ? home : `${home}/${raw.slice(2)}`;
    }
    if (raw.startsWith("/")) return raw;
    return path.posix.join(this.remotePath, raw);
  }

  async _getRemoteHome() {
    const key = `${this.remoteUser}@${this.remoteHost}:${this.port}`;
    if (this._remoteHome && this._remoteHomeKey === key) {
      return this._remoteHome;
    }
    const result = await this._exec(`printf '%s' "$HOME"`);
    const home = result.stdout.trim();
    if (!home) {
      throw new Error("Unable to determine remote home directory");
    }
    this._remoteHome = home;
    this._remoteHomeKey = key;
    return home;
  }

  async _readRemoteFile(targetPath) {
    const esc = this.escapeShellArg(targetPath);
    const result = await this._exec(
      `if [ -f ${esc} ]; then cat ${esc}; else exit 3; fi`
    );
    if (result.code === 3) return { exists: false, content: "" };
    if (result.code !== 0) {
      throw new Error(
        `Failed to read remote file ${targetPath}: ${
          result.stderr || result.stdout || `exit ${result.code}`
        }`
      );
    }
    return { exists: true, content: result.stdout };
  }

  async _writeRemoteFile(targetPath, content) {
    const dir = path.posix.dirname(targetPath);
    if (dir && dir !== ".") {
      const mkdirResult = await this._exec(
        `mkdir -p ${this.escapeShellArg(dir)}`
      );
      if (mkdirResult.code !== 0) {
        throw new Error(
          `Failed to create remote directory ${dir}: ${mkdirResult.stderr}`
        );
      }
    }
    const tmpPath = path.join(
      os.tmpdir(),
      `daffodil-${process.pid}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`
    );
    await fs.writeFile(tmpPath, content, "utf8");
    try {
      await this.ssh.putFile(tmpPath, targetPath);
    } finally {
      await fs.remove(tmpPath).catch(() => {});
    }
  }

  async _remoteFileHash(targetPath) {
    const esc = this.escapeShellArg(targetPath);
    const result = await this._exec(
      `if [ -f ${esc} ]; then (sha256sum ${esc} 2>/dev/null || shasum -a 256 ${esc} 2>/dev/null || openssl dgst -sha256 ${esc} 2>/dev/null) | awk '{print $NF}'; else exit 3; fi`
    );
    if (result.code !== 0) return null;
    const hash = result.stdout.trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
  }

  async _remoteFileMatches(targetPath, content) {
    const expected = sha256Hex(content);
    const actual = await this._remoteFileHash(targetPath);
    if (actual) return actual === expected;
    const remote = await this._readRemoteFile(targetPath);
    if (!remote.exists) return false;
    return remote.content === content;
  }

  async _remoteFileStat(targetPath) {
    const esc = this.escapeShellArg(targetPath);
    const result = await this._exec(
      `if [ -f ${esc} ]; then (stat -c '%a %U:%G' ${esc} 2>/dev/null || stat -f '%Lp %Su:%Sg' ${esc} 2>/dev/null); else exit 3; fi`
    );
    if (result.code !== 0) return null;
    const parts = result.stdout.trim().split(/\s+/);
    return { mode: parts[0] || null, owner: parts[1] || null };
  }

  /**
   * Append `line` to a remote file only when it is absent. When a managed
   * `marker` block is provided the block content is replaced in place.
   * @returns {Promise<{changed: boolean, status: string}>}
   */
  async ensureLineInFile(filePath, line, { marker } = {}) {
    if (typeof line !== "string" || line.length === 0) {
      throw new Error("ensureLineInFile requires a non-empty line");
    }
    const target = await this._resolveRemotePath(filePath);
    const { content: current } = await this._readRemoteFile(target);
    const next = marker
      ? applyManagedBlock(current, String(marker), line)
      : appendLineOnce(current, line);
    if (next === current) return { changed: false, status: "ok" };
    if (this.check) return { changed: true, status: "would-change" };
    await this._writeRemoteFile(target, next);
    return { changed: true, status: "changed" };
  }

  /**
   * Write `content` to a remote file only when content/mode/owner differ.
   * @returns {Promise<{changed: boolean, status: string}>}
   */
  async writeFileIfChanged(filePath, content, { mode, owner } = {}) {
    const body = typeof content === "string" ? content : String(content ?? "");
    const target = await this._resolveRemotePath(filePath);
    const matches = await this._remoteFileMatches(target, body);
    // YAML parses `mode: 0644` as the integer 420; normalize back to octal text.
    const modeArg =
      mode == null
        ? null
        : typeof mode === "number"
          ? mode.toString(8)
          : String(mode);
    const desiredMode = modeArg != null ? parseInt(modeArg, 8) : null;
    const desiredOwner = owner ? String(owner) : null;

    let modeOk = true;
    let ownerOk = true;
    if (desiredMode != null || desiredOwner) {
      const remoteStat = await this._remoteFileStat(target);
      if (!remoteStat) {
        modeOk = false;
        ownerOk = false;
      } else {
        if (desiredMode != null) {
          modeOk =
            remoteStat.mode != null &&
            parseInt(remoteStat.mode, 8) === desiredMode;
        }
        if (desiredOwner) {
          const [wantUser, wantGroup] = desiredOwner.split(":");
          const [haveUser] = (remoteStat.owner || "").split(":");
          ownerOk = wantGroup
            ? remoteStat.owner === desiredOwner
            : haveUser === wantUser;
        }
      }
    }

    if (matches && modeOk && ownerOk) return { changed: false, status: "ok" };
    if (this.check) return { changed: true, status: "would-change" };

    if (!matches) {
      await this._writeRemoteFile(target, body);
    }
    if (desiredMode != null && !modeOk) {
      const result = await this._exec(
        `chmod ${this.escapeShellArg(modeArg)} ${this.escapeShellArg(target)}`
      );
      if (result.code !== 0) {
        throw new Error(
          `Failed to set mode on ${target}: ${result.stderr || result.stdout}`
        );
      }
    }
    if (desiredOwner && !ownerOk) {
      const result = await this._exec(
        `chown ${this.escapeShellArg(desiredOwner)} ${this.escapeShellArg(target)}`
      );
      if (result.code !== 0) {
        throw new Error(
          `Failed to set owner on ${target}: ${result.stderr || result.stdout}`
        );
      }
    }
    return { changed: true, status: "changed" };
  }

  async _detectPackageManager() {
    const result = await this._exec(
      "if command -v dpkg-query >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then echo apt; " +
        "elif command -v rpm >/dev/null 2>&1; then echo rpm; " +
        "elif command -v apk >/dev/null 2>&1; then echo apk; " +
        "elif command -v brew >/dev/null 2>&1; then echo brew; fi"
    );
    return result.stdout.trim() || null;
  }

  async _packageInstalled(manager, name) {
    const esc = this.escapeShellArg(name);
    let command;
    if (manager === "apt") {
      command = `dpkg-query -W -f='\${Status}' -- ${esc} 2>/dev/null | grep -q 'install ok installed'`;
    } else if (manager === "rpm") {
      command = `rpm -q -- ${esc} >/dev/null 2>&1`;
    } else if (manager === "apk") {
      command = `apk info -e -- ${esc} >/dev/null 2>&1`;
    } else {
      command = `brew list --formula ${esc} >/dev/null 2>&1 || brew list --cask ${esc} >/dev/null 2>&1`;
    }
    const result = await this._exec(command);
    return result.code === 0;
  }

  /**
   * Ensure a system package is installed.
   * @returns {Promise<{changed: boolean, status: string}>}
   */
  async ensurePackage(packageName) {
    const name = String(packageName || "").trim();
    if (!name) throw new Error("ensurePackage requires a package name");
    const manager = await this._detectPackageManager();
    if (!manager) {
      throw new Error("No supported package manager found on the remote host");
    }
    if (await this._packageInstalled(manager, name)) {
      return { changed: false, status: "ok" };
    }
    if (this.check) return { changed: true, status: "would-change" };

    const esc = this.escapeShellArg(name);
    let command;
    if (manager === "apt") {
      command = `export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/dev/null 2>&1 || true; apt-get install -y -q -- ${esc}`;
    } else if (manager === "rpm") {
      command = `if command -v dnf >/dev/null 2>&1; then dnf install -y ${esc}; else yum install -y ${esc}; fi`;
    } else if (manager === "apk") {
      command = `apk add --no-cache ${esc}`;
    } else {
      command = `brew install ${esc}`;
    }
    const result = await this._exec(command);
    if (result.code !== 0) {
      throw new Error(
        `Failed to install package ${name}: ${
          result.stderr || result.stdout || `exit ${result.code}`
        }`
      );
    }
    return { changed: true, status: "changed" };
  }

  /**
   * Ensure a system user exists.
   * @returns {Promise<{changed: boolean, status: string}>}
   */
  async ensureUser(userName, { system = false } = {}) {
    const name = String(userName || "").trim();
    if (!name) throw new Error("ensureUser requires a user name");
    const esc = this.escapeShellArg(name);
    const exists = await this._exec(`id -u ${esc} >/dev/null 2>&1`);
    if (exists.code === 0) return { changed: false, status: "ok" };
    if (this.check) return { changed: true, status: "would-change" };

    const systemFlag = system ? " --system" : "";
    const command =
      `if command -v useradd >/dev/null 2>&1; then useradd${systemFlag} -m ${esc} || useradd${systemFlag} ${esc}; ` +
      `elif command -v adduser >/dev/null 2>&1; then adduser -D ${esc} 2>/dev/null || adduser --disabled-password --gecos '' ${esc}; ` +
      `else echo 'no user management tool available' >&2; exit 1; fi`;
    const result = await this._exec(command);
    if (result.code !== 0) {
      throw new Error(
        `Failed to create user ${name}: ${
          result.stderr || result.stdout || `exit ${result.code}`
        }`
      );
    }
    return { changed: true, status: "changed" };
  }

  /**
   * Ensure a service is enabled (or disabled) in the remote service manager.
   * @returns {Promise<{changed: boolean, status: string}>}
   */
  async ensureServiceEnabled(serviceName, { enabled = true } = {}) {
    const name = String(serviceName || "").trim();
    if (!name) throw new Error("ensureServiceEnabled requires a service name");
    const esc = this.escapeShellArg(name);
    const managerResult = await this._exec(
      "if command -v systemctl >/dev/null 2>&1; then echo systemctl; " +
        "elif command -v rc-update >/dev/null 2>&1; then echo openrc; fi"
    );
    const manager = managerResult.stdout.trim();
    if (!manager) {
      throw new Error("No supported service manager found on the remote host");
    }

    let currently;
    if (manager === "systemctl") {
      const result = await this._exec(
        `systemctl is-enabled ${esc} 2>/dev/null`
      );
      currently = result.code === 0 && /^enabled/.test(result.stdout.trim());
    } else {
      const result = await this._exec(
        `rc-update show 2>/dev/null | grep -qw -- ${esc}`
      );
      currently = result.code === 0;
    }

    if (currently === Boolean(enabled)) return { changed: false, status: "ok" };
    if (this.check) return { changed: true, status: "would-change" };

    const command =
      manager === "systemctl"
        ? `systemctl ${enabled ? "enable" : "disable"} ${esc}`
        : `rc-update ${enabled ? "add" : "del"} ${esc}`;
    const result = await this._exec(command);
    if (result.code !== 0) {
      throw new Error(
        `Failed to ${enabled ? "enable" : "disable"} service ${name}: ${
          result.stderr || result.stdout || `exit ${result.code}`
        }`
      );
    }
    return { changed: true, status: "changed" };
  }

  /**
   * Ensure a remote directory exists (mkdir -p semantics with change detection).
   * @returns {Promise<{changed: boolean, status: string}>}
   */
  async ensureDirectory(dirPath) {
    const target = await this._resolveRemotePath(dirPath);
    const exists = await this._exec(`[ -d ${this.escapeShellArg(target)} ]`);
    if (exists.code === 0) return { changed: false, status: "ok" };
    if (this.check) return { changed: true, status: "would-change" };
    const result = await this._exec(`mkdir -p ${this.escapeShellArg(target)}`);
    if (result.code !== 0) {
      throw new Error(
        `Failed to create directory ${target}: ${
          result.stderr || result.stdout
        }`
      );
    }
    return { changed: true, status: "changed" };
  }

  _isExcluded(relPath) {
    if (!this.excludeList || this.excludeList.length === 0) return false;
    const normalizedPath = String(relPath).replace(/\\/g, "/");
    const fileName = normalizedPath.split("/").pop();
    return this.excludeList.some((pattern) => {
      const normalizedPattern = pattern.replace(/\\/g, "/");
      if (fileName === pattern || fileName === normalizedPattern) return true;
      if (
        normalizedPath.includes(normalizedPattern) ||
        normalizedPath.endsWith(normalizedPattern)
      ) {
        return true;
      }
      if (normalizedPattern.includes("*")) {
        const regex = new RegExp(
          "^" +
            normalizedPattern.replace(/\*/g, ".*").replace(/\//g, "[\\\\/]") +
            "$"
        );
        return regex.test(normalizedPath);
      }
      return false;
    });
  }

  async _buildLocalManifest(localPath, isDirectory) {
    const entries = [];
    const walk = async (dir, rel) => {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const relPath = rel ? `${rel}/${item.name}` : item.name;
        if (this._isExcluded(relPath)) continue;
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          await walk(fullPath, relPath);
        } else if (item.isFile()) {
          entries.push(`${await hashFileContents(fullPath)}  ${relPath}`);
        }
      }
    };
    if (isDirectory) {
      await walk(localPath, "");
    } else {
      const baseName = path.basename(localPath);
      if (!this._isExcluded(baseName)) {
        entries.push(`${await hashFileContents(localPath)}  ${baseName}`);
      }
    }
    entries.sort();
    const body = entries.length ? `${entries.join("\n")}\n` : "";
    return { body, hash: sha256Hex(body), files: entries.length };
  }

  async _readStoredManifest(remoteManifestPath) {
    const esc = this.escapeShellArg(remoteManifestPath);
    const result = await this._exec(`if [ -f ${esc} ]; then cat ${esc}; fi`);
    if (result.code !== 0) return null;
    const lines = result.stdout.split("\n");
    if (lines[0] !== "daffodil-manifest-v1") return null;
    const hash = (lines[1] || "").trim();
    return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
  }

  async _writeStoredManifest(remoteManifestPath, manifest) {
    await this._writeRemoteFile(
      remoteManifestPath,
      `daffodil-manifest-v1\n${manifest.hash}\n${manifest.files}\n${manifest.body}`
    );
  }

  async transferFiles(
    localPath,
    destinationPath = this.remotePath,
    { force = false } = {}
  ) {
    const transferStartTime = Date.now();
    const spinner = ora(
      `Transferring files from ${localPath} to ${destinationPath}`
    ).start();

    if (this.verbose) {
      this.log(
        `Starting file transfer from ${localPath} to ${destinationPath}`,
        "blue"
      );
    }

    // Validate local path exists before proceeding
    if (!(await fs.pathExists(localPath))) {
      // Stop spinner but avoid marking as a generic "failure" banner,
      // since a missing path is already surfaced via the thrown error.
      spinner.stop();
      const isDirectory =
        localPath.endsWith(path.sep) || localPath.endsWith("/");
      const error = new PathNotFoundError(
        localPath,
        isDirectory ? "directory" : "file or directory"
      );
      // Always log a clear message, more detailed when verbose.
      this.logError("Transfer failed: Path does not exist", error);
      throw error;
    }

    // Check if path is a directory or file
    const stats = await fs.stat(localPath);
    const isDirectory = stats.isDirectory();
    if (this.verbose) {
      this.log(`Path type: ${isDirectory ? "directory" : "file"}`, "blue");
      this.log(
        `Path size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`,
        "blue"
      );
    }
    if (!isDirectory && !stats.isFile()) {
      spinner.fail(
        chalk.red("Transfer failed: Path is not a file or directory")
      );
      const error = new PathNotFoundError(localPath, "file or directory");
      // Only log detailed error in verbose mode
      if (this.verbose) {
        this.logError(
          "Transfer failed: Path is not a file or directory",
          error
        );
      }
      throw error;
    }

    // Change detection: compare a local checksum manifest with the remote
    // before archiving so unchanged content never touches the host.
    const manifest = await this._buildLocalManifest(localPath, isDirectory);
    const remoteManifestPath = path.posix
      .join(destinationPath, ".daffodil-manifest")
      .replace(/\\/g, "/");
    const storedHash = await this._readStoredManifest(remoteManifestPath);
    if (!force && storedHash !== null && storedHash === manifest.hash) {
      spinner.succeed(chalk.green("Transfer skipped (no changes detected)"));
      this.logTimeConsumption("Total file transfer", transferStartTime);
      return { changed: false, status: "ok" };
    }
    if (this.check) {
      spinner.succeed(
        chalk.yellow("Check mode: transfer would run (content changed)")
      );
      this.logTimeConsumption("Total file transfer", transferStartTime);
      return { changed: true, status: "would-change" };
    }

    // Generate unique archive filename
    const archiveName = `daffodil_${Date.now()}.tar.gz`;
    const archivePath = path.join(process.cwd(), archiveName);
    const remoteArchivePath = path.posix
      .join(destinationPath, archiveName)
      .replace(/\\/g, "/");

    try {
      // Step 1: Create archive locally (cross-platform using tar npm package)
      const archiveStartTime = Date.now();
      spinner.text = chalk.blue("Creating archive...");

      // Prepare archive configuration
      // For directories: archive contents directly (not the directory itself)
      // For files: archive the file itself
      const baseDir = isDirectory ? localPath : path.dirname(localPath);
      const baseName = path.basename(localPath);

      if (this.verbose) {
        this.log("Step 1: Creating archive locally", "blue");
        this.log(`Base directory: ${baseDir}`, "blue");
        if (this.excludeList.length > 0) {
          this.log(`Exclude patterns: ${this.excludeList.join(", ")}`, "blue");
        }
      }

      // Build filter function for exclude patterns
      const filterFn =
        this.excludeList.length > 0
          ? (filePath) => !this._isExcluded(filePath)
          : undefined;

      // Determine what to archive
      // For directories: read directory contents and archive them directly
      // For files: archive the file itself
      let archiveEntries;
      if (isDirectory) {
        // Read directory contents to archive them directly (not the directory itself)
        const entries = await fs.readdir(localPath);
        archiveEntries = entries;
      } else {
        archiveEntries = [baseName];
      }

      if (this.verbose) {
        this.log(`Archive entries: ${archiveEntries.length}`, "blue");
      }

      // Create tar.gz archive using cross-platform tar package
      try {
        await tar.create(
          {
            gzip: true,
            file: archivePath,
            cwd: baseDir,
            filter: filterFn,
          },
          archiveEntries
        );
      } catch (tarErr) {
        // If exclude filter fails, try without it
        if (filterFn) {
          console.log(
            chalk.yellow(
              "Retrying archive creation without exclude patterns..."
            )
          );
          await tar.create(
            {
              gzip: true,
              file: archivePath,
              cwd: baseDir,
            },
            archiveEntries
          );
        } else {
          throw tarErr;
        }
      }

      if (!(await fs.pathExists(archivePath))) {
        throw new Error("Archive file was not created");
      }

      const archiveStats = await fs.stat(archivePath);
      const archiveSizeMB = (archiveStats.size / (1024 * 1024)).toFixed(2);
      this.log(`Archive created: ${archiveName} (${archiveSizeMB} MB)`, "blue");
      this.logTimeConsumption("Archive creation", archiveStartTime);

      // Step 2: Transfer archive
      const fileTransferStartTime = Date.now();
      spinner.text = chalk.blue("Transferring archive...");

      if (this.verbose) {
        this.log("Step 2: Transferring archive to remote server", "blue");
        this.log(`Local archive: ${archivePath}`, "blue");
        this.log(`Remote archive: ${remoteArchivePath}`, "blue");
      }

      const transferBar = new cliProgress.SingleBar(
        {},
        cliProgress.Presets.shades_classic
      );
      transferBar.start(100, 0);

      // Remove old archive if exists on remote
      if (this.verbose) {
        this.log("Removing old archive from remote if exists", "blue");
      }
      await this.ssh.execCommand(
        `rm -f ${this.escapeShellArg(remoteArchivePath)} || true`
      );

      // Transfer the archive file
      await this.ssh.putFile(archivePath, remoteArchivePath);
      transferBar.update(100);
      transferBar.stop();

      this.log(`Archive transferred to: ${remoteArchivePath}`, "blue");
      this.logTimeConsumption("File transfer", fileTransferStartTime);

      // Step 3: Extract archive on remote server
      const extractStartTime = Date.now();
      spinner.text = chalk.blue("Extracting archive on remote server...");

      if (this.verbose) {
        this.log("Step 3: Extracting archive on remote server", "blue");
        this.log(`Destination path: ${destinationPath}`, "blue");
      }

      // Ensure destination directory exists
      await this.ssh.execCommand(
        `mkdir -p ${this.escapeShellArg(destinationPath)} || true`
      );

      // Extract archive (overwrite existing files)
      const extractResult = await this.ssh.execCommand(
        `cd ${this.escapeShellArg(destinationPath)} && tar -xzf ${this.escapeShellArg(remoteArchivePath)} && rm -f ${this.escapeShellArg(remoteArchivePath)}`
      );

      if (extractResult.code !== 0) {
        const error = new Error(
          `Failed to extract archive: ${extractResult.stderr || extractResult.stdout}`
        );
        this.logError("Archive extraction failed", error);
        if (this.verbose) {
          this.log(`Extract exit code: ${extractResult.code}`, "red");
          if (extractResult.stdout) {
            this.log(`Extract stdout: ${extractResult.stdout}`, "red");
          }
          if (extractResult.stderr) {
            this.logError(`Extract stderr: ${extractResult.stderr}`);
          }
        }
        throw error;
      }

      this.logTimeConsumption("Archive extraction", extractStartTime);

      // Record the applied content so the next transfer can skip unchanged work.
      await this._writeStoredManifest(remoteManifestPath, manifest);

      // Step 4: Clean up local archive
      if (await fs.pathExists(archivePath)) {
        await fs.remove(archivePath);
        this.log(`Cleaned up local archive: ${archiveName}`, "blue");
      }

      spinner.succeed(chalk.green("Transfer complete (archive method)"));
      this.logTimeConsumption("Total file transfer", transferStartTime);
      return { changed: true, status: "changed" };
    } catch (err) {
      // Clean up local archive on error
      if (await fs.pathExists(archivePath)) {
        await fs.remove(archivePath);
        this.log(`Cleaned up local archive after error`, "yellow");
      }

      // Clean up remote archive on error
      try {
        if (this.verbose) {
          this.log("Cleaning up remote archive after error", "yellow");
        }
        await this.ssh.execCommand(
          `rm -f ${this.escapeShellArg(remoteArchivePath)} || true`
        );
      } catch (cleanupErr) {
        // Ignore cleanup errors
        if (this.verbose) {
          this.logError("Failed to cleanup remote archive", cleanupErr);
        }
      }

      // Handle specific error types
      if (err instanceof PathNotFoundError) {
        spinner.fail(chalk.red(`Transfer failed: ${err.message}`));
        // Only log detailed error in verbose mode
        if (this.verbose) {
          this.logError("Transfer failed: PathNotFoundError", err);
        }
        throw err;
      }

      // Handle ENOENT errors (file/directory not found)
      if (err.code === "ENOENT" || err.message?.includes("ENOENT")) {
        const pathMatch = err.message?.match(/lstat ['"](.+?)['"]/);
        const missingPath = pathMatch ? pathMatch[1] : localPath;
        const pathNotFoundError = new PathNotFoundError(
          missingPath,
          "file or directory"
        );
        spinner.fail(
          chalk.red(`Transfer failed: ${pathNotFoundError.message}`)
        );
        // Only log detailed error in verbose mode
        if (this.verbose) {
          this.logError("Transfer failed: ENOENT error", pathNotFoundError);
        }
        throw pathNotFoundError;
      }

      // Handle other transfer errors
      const transferError = new TransferError(
        `Transfer failed: ${err.message}`,
        err
      );
      spinner.fail(chalk.red(transferError.message));
      // Only log detailed error in verbose mode
      if (this.verbose) {
        this.logError("Transfer failed: TransferError", transferError);
      }
      throw transferError;
    }
  }

  /**
   * Normalize a step command return value into a structured step result.
   * @param {string} name
   * @param {*} value
   * @returns {{name: string, status: string, changed: boolean}}
   */
  _normalizeStepResult(name, value) {
    if (
      value &&
      typeof value === "object" &&
      typeof value.status === "string"
    ) {
      return { name, status: value.status, changed: Boolean(value.changed) };
    }
    if (
      value &&
      typeof value === "object" &&
      typeof value.changed === "boolean"
    ) {
      const changed = value.changed;
      return {
        name,
        status: changed ? (this.check ? "would-change" : "changed") : "ok",
        changed,
      };
    }
    return { name, status: "ok", changed: false };
  }

  _validateSteps(steps) {
    for (const step of steps) {
      const when = step && step.when;
      if (when && when !== "changed" && when !== "always") {
        throw new DeploymentError(`Unsupported when condition: ${when}`, true);
      }
    }
  }

  async _deploySingle(steps) {
    const deployStartTime = Date.now();
    if (this.verbose) {
      this.log(`Starting deployment with ${steps.length} step(s)`, "blue");
    }

    this._validateSteps(steps);
    await this.connect();

    const results = [];
    let anyChanged = false;
    let failedStep = null;
    let failedError = null;

    for (let i = 0; i < steps.length; i++) {
      const stepStartTime = Date.now();
      const { step, command, when } = steps[i];
      console.log(chalk.yellow(`Step ${i + 1}: ${step}`));

      if (when === "changed" && !anyChanged) {
        console.log(chalk.cyan(`Step ${i + 1}: ${step} [skipped]`));
        results.push({ name: step, status: "skipped", changed: false });
        continue;
      }

      if (this.verbose) {
        this.log(`Executing step ${i + 1}: ${step}`, "yellow");
      }

      try {
        const value = await command();
        const result = this._normalizeStepResult(step, value);
        results.push(result);
        if (result.changed) anyChanged = true;
        console.log(
          chalk.yellow(`Step ${i + 1}: ${step} `) +
            chalk.cyan(`[${result.status}]`)
        );
        this.logTimeConsumption(`Step ${i + 1}: ${step}`, stepStartTime);
      } catch (err) {
        failedStep = step;
        failedError = err;
        results.push({ name: step, status: "failed", changed: false });
        // Show error message - only detailed in verbose mode
        if (this.verbose) {
          this.logError(`Failed step: ${step}`, err);
          console.error(chalk.red(`Failed step: ${step} - ${err.message}`));
        } else {
          const humanReadableMsg = this.getHumanReadableError(err);
          console.error(chalk.red(`Failed step: ${step}`));
          console.error(chalk.red(`  ${humanReadableMsg}`));
        }
        break; // Stop execution on first failure
      }
    }

    // Always dispose SSH connection
    this.ssh.dispose();

    // If a step failed, throw error to abort deployment
    if (failedStep) {
      this.logTimeConsumption("Total deployment (FAILED)", deployStartTime);
      console.error(chalk.red("✖ Deployment aborted due to step failure."));

      // When verbose is false, suppress stack trace and use simple message
      if (this.verbose) {
        const errorMsg = failedError.message;
        const deploymentError = new DeploymentError(
          `Deployment failed at step: ${failedStep}. ${errorMsg}`,
          false // Include stack trace
        );
        deploymentError.results = results;
        throw deploymentError;
      } else {
        // Simple error message for non-verbose mode
        const deploymentError = new DeploymentError(
          "Deployment failed",
          true // Suppress stack trace
        );
        // Override stack to prevent Node.js from printing it
        Object.defineProperty(deploymentError, "stack", {
          get: () => deploymentError.message,
          configurable: true,
        });
        deploymentError.results = results;
        throw deploymentError;
      }
    }

    // Only show success if all steps completed
    console.log(chalk.green("? Deployment finished."));
    this.logTimeConsumption("Total deployment", deployStartTime);
    return results;
  }

  /**
   * High-level deploy entrypoint. In single-host mode it runs once, in
   * multi-host mode (inventory) it runs sequentially for each host.
   * @returns {Promise<Array|Object>} Structured step results:
   *   single-host → Array<{name, status, changed}>,
   *   inventory → Array<{host, results: Array<{name, status, changed}>}>.
   */
  async deploy(steps) {
    // Multi-host deployment via inventory
    if (this.inventoryTargets && this.inventoryTargets.length > 0) {
      const report = [];
      for (const target of this.inventoryTargets) {
        const hostLabel = target.name || target.host;
        console.log("");
        console.log(
          chalk.cyan(
            `==== Starting deployment for [${hostLabel}] (${target.host}) ====`
          )
        );

        // Reuse this instance for each host so user-defined step
        // callbacks that reference the deployer (e.g. deployer.ssh)
        // continue to work as expected.
        this.remoteUser = target.user;
        this.remoteHost = target.host;
        this.port = target.port || this.port || 22;
        this.ssh = new NodeSSH();
        this._remoteHome = null;
        this._remoteHomeKey = null;

        const results = await this._deploySingle(steps);
        report.push({ host: hostLabel, results });

        console.log(
          chalk.cyan(
            `==== Finished deployment for [${hostLabel}] (${target.host}) ====`
          )
        );
      }
      return report;
    }

    // Single-host behavior (existing behavior)
    return this._deploySingle(steps);
  }

  /**
   * Create a watcher that triggers deployments based on file system or Git changes.
   * @param {Object} options
   * @param {string[]} [options.paths] - Files/folders to watch for changes.
   * @param {number} [options.debounce] - Debounce time in ms before triggering a deployment.
   * @param {string} [options.repoPath] - Local Git repository path to monitor.
   * @param {string} [options.branch] - Single branch to watch (alias for branches).
   * @param {string[]} [options.branches] - Multiple branches to watch.
   * @param {boolean} [options.tags] - Whether to watch Git tags.
   * @param {RegExp} [options.tagPattern] - Optional pattern to filter tags.
   * @param {("commit"|"merge"|"tag")[]} [options.events] - Git events to watch.
   * @param {number} [options.interval] - Polling interval in ms for Git checks.
   * @returns {DaffodilWatcher}
   */
  watch(options = {}) {
    return new DaffodilWatcher(this, options);
  }
}

class DaffodilWatcher {
  constructor(deployer, options) {
    this.deployer = deployer;
    this.options = {
      debounce: typeof options.debounce === "number" ? options.debounce : 2000,
      interval: typeof options.interval === "number" ? options.interval : 5000,
      events: Array.isArray(options.events)
        ? options.events
        : ["commit", "merge", "tag"],
      ...options,
    };

    if (!this.options.branches && this.options.branch) {
      this.options.branches = [this.options.branch];
    }

    this.debounceTimer = null;
    this.gitInterval = null;
    this.fsWatchers = [];
    this.isDeploying = false;
    this.pendingTrigger = false;
    this.stopped = false;
    this.steps = [];
    this.lastGitState = null;
  }

  async deploy(steps) {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error("watch().deploy() requires a non-empty steps array");
    }
    this.steps = steps;
    this.startFileWatchers();
    this.startGitWatcher();
  }

  stop() {
    this.stopped = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.gitInterval) {
      clearInterval(this.gitInterval);
      this.gitInterval = null;
    }
    for (const w of this.fsWatchers) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    this.fsWatchers = [];
  }

  scheduleDeploy() {
    if (this.stopped || !this.steps.length) return;
    this.pendingTrigger = true;
    const delay = this.options.debounce || 0;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.runDeployIfNeeded();
    }, delay);
  }

  async runDeployIfNeeded() {
    if (this.stopped || this.isDeploying || !this.pendingTrigger) return;
    this.pendingTrigger = false;
    this.isDeploying = true;

    this.deployer.log("Change detected, starting deployment...", "yellow");

    try {
      await this.deployer.deploy(this.steps);
    } catch (err) {
      this.deployer.logError("Deployment triggered by watcher failed", err);
    } finally {
      this.isDeploying = false;
      if (this.pendingTrigger && !this.stopped) {
        this.runDeployIfNeeded();
      }
    }
  }

  startFileWatchers() {
    const { paths } = this.options;
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return;
    }

    for (const p of paths) {
      try {
        const watcher = fs.watch(
          p,
          {
            recursive: true,
          },
          () => {
            this.deployer.log(`File change detected in: ${p}`, "blue");
            this.scheduleDeploy();
          }
        );
        this.fsWatchers.push(watcher);
        this.deployer.log(`Watching path: ${p}`, "blue");
      } catch (err) {
        this.deployer.logError(`Failed to watch path: ${p}`, err);
      }
    }
  }

  startGitWatcher() {
    const { repoPath, branches, tags, events, interval, tagPattern } =
      this.options;
    if (!repoPath) {
      return;
    }

    const watchedBranches = Array.isArray(branches) ? branches : [];
    const watchCommits = events.includes("commit") || events.includes("merge");
    const watchMerges = events.includes("merge");
    const watchTags = tags || events.includes("tag");
    const cwd = repoPath;

    const safeGit = (args) => {
      try {
        const output = execSync(`git ${args}`, {
          cwd,
          stdio: "pipe",
        });
        return output.toString().trim();
      } catch (err) {
        this.deployer.logError(`Git command failed: git ${args}`, err);
        return null;
      }
    };

    const readGitState = () => {
      const state = {
        branches: {},
        merges: {},
        tags: [],
      };

      if (watchCommits && watchedBranches.length > 0) {
        for (const br of watchedBranches) {
          const hash = safeGit(`rev-parse ${br}`);
          if (hash) {
            state.branches[br] = hash;
          }
        }
      }

      if (watchMerges && watchedBranches.length > 0) {
        for (const br of watchedBranches) {
          const mergeHash = safeGit(
            `log --merges -1 --format=%H ${br} || echo ""`
          );
          state.merges[br] = mergeHash || "";
        }
      }

      if (watchTags) {
        const rawTags = safeGit("tag --list") || "";
        const list = rawTags
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean);
        const filtered = tagPattern
          ? list.filter((t) => {
              try {
                return tagPattern.test(t);
              } catch {
                return false;
              }
            })
          : list;
        state.tags = filtered;
      }

      return state;
    };

    const hasGitStateChanged = (prev, next) => {
      if (!prev) return true;

      for (const br of Object.keys(next.branches)) {
        if (next.branches[br] !== prev.branches[br]) {
          return true;
        }
      }

      for (const br of Object.keys(next.merges)) {
        if (next.merges[br] !== prev.merges[br]) {
          return true;
        }
      }

      if (next.tags.length !== prev.tags.length) return true;
      const prevSet = new Set(prev.tags);
      for (const tag of next.tags) {
        if (!prevSet.has(tag)) return true;
      }

      return false;
    };

    this.lastGitState = readGitState();
    this.deployer.log("Initial Git state captured for watcher", "blue");

    this.gitInterval = setInterval(() => {
      if (this.stopped) return;
      const nextState = readGitState();
      if (hasGitStateChanged(this.lastGitState, nextState)) {
        this.deployer.log("Git change detected", "blue");
        this.lastGitState = nextState;
        this.scheduleDeploy();
      }
    }, interval);
  }
}
