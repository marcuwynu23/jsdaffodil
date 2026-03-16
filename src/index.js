import chalk from "chalk";
import { execSync } from "child_process";
import cliProgress from "cli-progress";
import fs from "fs-extra";
import { NodeSSH } from "node-ssh";
import ora from "ora";
import path from "path";
import * as tar from "tar";

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

export class Daffodil {
  constructor({
    remoteUser,
    remoteHost,
    remotePath = ".",
    port = 22,
    ignoreFile = ".scpignore",
    verbose = false,
  }) {
    // Validate required parameters
    if (!remoteUser || typeof remoteUser !== "string") {
      throw new Error("remoteUser is required and must be a string");
    }
    if (!remoteHost || typeof remoteHost !== "string") {
      throw new Error("remoteHost is required and must be a string");
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
  }

  /**
   * Set options for the deployer
   * @param {Object} options - Options object
   * @param {boolean} options.verbose - Enable verbose logging (default: false)
   */
  setOption({ verbose = false }) {
    this.verbose = verbose;
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
    const keyFiles = ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"];
    const failures = [];

    if (this.verbose) {
      this.log(
        `Attempting SSH connection to ${this.remoteHost}:${this.port}`,
        "blue"
      );
      this.log(`Trying SSH keys from: ${homeDir}\\.ssh`, "blue");
    }

    for (const keyFile of keyFiles) {
      const keyPath = path.join(homeDir, ".ssh", keyFile);
      if (fs.existsSync(keyPath)) {
        try {
          if (this.verbose) {
            this.log(`Trying SSH key: ${keyFile}`, "blue");
          }
          await this.ssh.connect({
            host: this.remoteHost,
            username: this.remoteUser,
            port: this.port,
            privateKey: fs.readFileSync(keyPath, "utf8"),
          });
          spinner.succeed(chalk.green(`SSH Connected using key: ${keyFile}`));
          this.logTimeConsumption("SSH Connection", startTime);

          const ensurePath = path.posix.resolve(this.remotePath);
          await this.ssh.execCommand(
            `mkdir -p ${this.escapeShellArg(ensurePath)}`
          );
          this.log(`Verified or created remote path: ${ensurePath}`, "blue");
          return; // ✅ Success, skip remaining
        } catch (err) {
          const errorMsg = this.verbose
            ? err.message
            : this.getHumanReadableError(err);
          failures.push({ key: keyFile, error: errorMsg });
          if (this.verbose) {
            this.logError(`Failed to connect with key ${keyFile}`, err);
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
    const fullPath = path.posix.join(this.remotePath, dirName);
    this.log(`Creating remote directory: ${fullPath}`, "blue");
    await this.sshCommand(`mkdir -p ${this.escapeShellArg(fullPath)}`);
    this.logTimeConsumption(`Create directory: ${fullPath}`, startTime);
  }

  async transferFiles(localPath, destinationPath = this.remotePath) {
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
          ? (filePath) => {
              // tar filter receives path relative to cwd
              // Normalize path separators for cross-platform compatibility
              const normalizedPath = filePath.replace(/\\/g, "/");
              const fileName = path.basename(filePath);

              // Check if any exclude pattern matches
              return !this.excludeList.some((pattern) => {
                const normalizedPattern = pattern.replace(/\\/g, "/");

                // Check filename match
                if (fileName === pattern || fileName === normalizedPattern) {
                  return true;
                }

                // Check path match
                if (
                  normalizedPath.includes(normalizedPattern) ||
                  normalizedPath.endsWith(normalizedPattern)
                ) {
                  return true;
                }

                // Support glob-like patterns
                if (normalizedPattern.includes("*")) {
                  const regex = new RegExp(
                    "^" +
                      normalizedPattern
                        .replace(/\*/g, ".*")
                        .replace(/\//g, "[\\\\/]") +
                      "$"
                  );
                  return regex.test(normalizedPath);
                }

                return false;
              });
            }
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

      // Step 4: Clean up local archive
      if (await fs.pathExists(archivePath)) {
        await fs.remove(archivePath);
        this.log(`Cleaned up local archive: ${archiveName}`, "blue");
      }

      spinner.succeed(chalk.green("Transfer complete (archive method)"));
      this.logTimeConsumption("Total file transfer", transferStartTime);
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

  async deploy(steps) {
    const deployStartTime = Date.now();
    if (this.verbose) {
      this.log(`Starting deployment with ${steps.length} step(s)`, "blue");
    }

    await this.connect();

    let failedStep = null;
    let failedError = null;

    for (let i = 0; i < steps.length; i++) {
      const stepStartTime = Date.now();
      const { step, command } = steps[i];
      console.log(chalk.yellow(`Step ${i + 1}: ${step}`));

      if (this.verbose) {
        this.log(`Executing step ${i + 1}: ${step}`, "yellow");
      }

      try {
        await command();
        this.logTimeConsumption(`Step ${i + 1}: ${step}`, stepStartTime);
      } catch (err) {
        failedStep = step;
        failedError = err;
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
        throw deploymentError;
      }
    }

    // Only show success if all steps completed
    console.log(chalk.green("? Deployment finished."));
    this.logTimeConsumption("Total deployment", deployStartTime);
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
