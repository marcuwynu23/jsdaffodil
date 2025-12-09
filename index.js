import chalk from "chalk";
import {execSync} from "child_process";
import cliProgress from "cli-progress";
import fs from "fs-extra";
import {NodeSSH} from "node-ssh";
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

export class Daffodil {
  constructor({
    remoteUser,
    remoteHost,
    remotePath = ".",
    port = 22,
    ignoreFile = ".scpignore",
  }) {
    this.remoteUser = remoteUser;
    this.remoteHost = remoteHost;
    this.remotePath = remotePath;
    this.port = port;
    this.ssh = new NodeSSH();
    this.ignoreFile = ignoreFile;
    this.excludeList = this.loadIgnoreList();
  }

  async connect() {
    const spinner = ora(`Connecting to ${this.remoteHost}`).start();
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    const keyFiles = ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"];
    const failures = [];

    for (const keyFile of keyFiles) {
      const keyPath = path.join(homeDir, ".ssh", keyFile);
      if (fs.existsSync(keyPath)) {
        try {
          await this.ssh.connect({
            host: this.remoteHost,
            username: this.remoteUser,
            port: this.port,
            privateKey: fs.readFileSync(keyPath, "utf8"),
          });
          spinner.succeed(chalk.green(`SSH Connected using key: ${keyFile}`));

          const ensurePath = path.posix.resolve(this.remotePath);
          await this.ssh.execCommand(`mkdir -p ${ensurePath}`);
          console.log(
            chalk.blue(`Verified or created remote path: ${ensurePath}`)
          );
          return; // ✅ Success, skip remaining
        } catch (err) {
          failures.push({key: keyFile, error: err.message});
        }
      }
    }

    // ❌ All keys failed
    spinner.fail(chalk.red("Connection failed: No valid SSH keys worked."));
    console.error(chalk.red("Tried the following keys:"));
    failures.forEach((f) => console.error(chalk.red(`- ${f.key}: ${f.error}`)));
    process.exit(1);
  }

  loadIgnoreList() {
    if (!fs.existsSync(this.ignoreFile)) {
      fs.writeFileSync(this.ignoreFile, "# Add ignore patterns\n");
      console.log(chalk.yellow(`Created ${this.ignoreFile}`));
    }
    return fs
      .readFileSync(this.ignoreFile, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  }

  async runCommand(cmd) {
    try {
      const output = execSync(cmd, {stdio: "pipe"}); // changed from 'inherit' to 'pipe'
      const result = output?.toString() || "";
      console.log(result);
      return result;
    } catch (e) {
      const errorMsg = e.stderr?.toString() || e.message;
      console.error(chalk.red(`Local command failed: ${errorMsg}`));
      return null;
    }
  }

  async sshCommand(cmd) {
    const result = await this.ssh.execCommand(cmd);
    if (result.stdout) console.log(chalk.green(result.stdout));
    if (result.stderr) console.error(chalk.red(result.stderr));
  }

  async makeDirectory(dirName) {
    const fullPath = path.posix.join(this.remotePath, dirName);
    console.log(chalk.blue(`Creating remote directory: ${fullPath}`));
    await this.sshCommand(`mkdir -p ${fullPath}`);
  }

  async transferFiles(localPath, destinationPath = this.remotePath) {
    const spinner = ora(
      `Transferring files from ${localPath} to ${destinationPath}`
    ).start();

    // Validate local path exists before proceeding
    if (!(await fs.pathExists(localPath))) {
      spinner.fail(chalk.red("Transfer failed: Path does not exist"));
      const isDirectory = localPath.endsWith(path.sep) || localPath.endsWith("/");
      throw new PathNotFoundError(
        localPath,
        isDirectory ? "directory" : "file or directory"
      );
    }

    // Check if path is a directory or file
    const stats = await fs.stat(localPath);
    const isDirectory = stats.isDirectory();
    if (!isDirectory && !stats.isFile()) {
      spinner.fail(chalk.red("Transfer failed: Path is not a file or directory"));
      throw new PathNotFoundError(localPath, "file or directory");
    }

    // Generate unique archive filename
    const archiveName = `daffodil_${Date.now()}.tar.gz`;
    const archivePath = path.join(process.cwd(), archiveName);
    const remoteArchivePath = path.posix.join(
      destinationPath,
      archiveName
    ).replace(/\\/g, "/");

    try {
      // Step 1: Create archive locally (cross-platform using tar npm package)
      spinner.text = chalk.blue("Creating archive...");
      
      // Prepare archive configuration
      // For directories: archive contents directly (not the directory itself)
      // For files: archive the file itself
      const baseDir = isDirectory ? localPath : path.dirname(localPath);
      const baseName = path.basename(localPath);
      
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
      console.log(
        chalk.blue(`Archive created: ${archiveName} (${archiveSizeMB} MB)`)
      );

      // Step 2: Transfer archive
      spinner.text = chalk.blue("Transferring archive...");
      const transferBar = new cliProgress.SingleBar(
        {},
        cliProgress.Presets.shades_classic
      );
      transferBar.start(100, 0);

      // Remove old archive if exists on remote
      await this.ssh.execCommand(`rm -f "${remoteArchivePath}" || true`);

      // Transfer the archive file
      await this.ssh.putFile(archivePath, remoteArchivePath);
      transferBar.update(100);
      transferBar.stop();

      console.log(chalk.blue(`Archive transferred to: ${remoteArchivePath}`));

      // Step 3: Extract archive on remote server
      spinner.text = chalk.blue("Extracting archive on remote server...");
      
      // Ensure destination directory exists
      await this.ssh.execCommand(`mkdir -p "${destinationPath}" || true`);

      // Extract archive (overwrite existing files)
      const extractResult = await this.ssh.execCommand(
        `cd "${destinationPath}" && tar -xzf "${remoteArchivePath}" && rm -f "${remoteArchivePath}"`
      );

      if (extractResult.code !== 0) {
        throw new Error(
          `Failed to extract archive: ${extractResult.stderr || extractResult.stdout}`
        );
      }

      // Step 4: Clean up local archive
      if (await fs.pathExists(archivePath)) {
        await fs.remove(archivePath);
        console.log(chalk.blue(`Cleaned up local archive: ${archiveName}`));
      }

      spinner.succeed(
        chalk.green("Transfer complete (archive method)")
      );
    } catch (err) {
      // Clean up local archive on error
      if (await fs.pathExists(archivePath)) {
        await fs.remove(archivePath);
        console.log(chalk.yellow(`Cleaned up local archive after error`));
      }

      // Clean up remote archive on error
      try {
        await this.ssh.execCommand(`rm -f "${remoteArchivePath}" || true`);
      } catch (cleanupErr) {
        // Ignore cleanup errors
      }

      // Handle specific error types
      if (err instanceof PathNotFoundError) {
        spinner.fail(chalk.red(`Transfer failed: ${err.message}`));
        throw err;
      }

      // Handle ENOENT errors (file/directory not found)
      if (err.code === "ENOENT" || err.message?.includes("ENOENT")) {
        const pathMatch = err.message?.match(/lstat ['"](.+?)['"]/);
        const missingPath = pathMatch ? pathMatch[1] : localPath;
        const pathNotFoundError = new PathNotFoundError(missingPath, "file or directory");
        spinner.fail(chalk.red(`Transfer failed: ${pathNotFoundError.message}`));
        throw pathNotFoundError;
      }

      // Handle other transfer errors
      const transferError = new TransferError(
        `Transfer failed: ${err.message}`,
        err
      );
      spinner.fail(chalk.red(transferError.message));
      throw transferError;
    }
  }

  async deploy(steps) {
    await this.connect();
    for (let i = 0; i < steps.length; i++) {
      const {step, command} = steps[i];
      console.log(chalk.yellow(`Step ${i + 1}: ${step}`));
      try {
        await command();
      } catch (err) {
        console.error(chalk.red(`Failed step: ${step} - ${err.message}`));
        break;
      }
    }
    this.ssh.dispose();
    console.log(chalk.green("? Deployment finished."));
  }
}
