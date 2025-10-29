import chalk from "chalk";
import {execSync} from "child_process";
import cliProgress from "cli-progress";
import fs from "fs-extra";
import {NodeSSH} from "node-ssh";
import ora from "ora";
import path from "path";

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

  import path from "path";
import fs from "fs-extra";
import ora from "ora";
import cliProgress from "cli-progress";
import chalk from "chalk";

export class Daffodil {
  constructor({ ssh, remotePath = ".", excludeList = [] }) {
    this.ssh = ssh;
    this.remotePath = remotePath;
    this.excludeList = excludeList;
  }

  async transferFiles(localPath, destinationPath = this.remotePath) {
    const spinner = ora(`Transferring files from ${localPath} to ${destinationPath}`).start();

    try {
      const allFiles = [];

      // Recursive directory walk
      const walk = async (dir) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (this.excludeList.includes(entry.name)) continue;

          const fullLocalPath = path.join(dir, entry.name);
          const relativePath = path.relative(localPath, fullLocalPath);
          const remoteFullPath = path.posix.join(destinationPath, relativePath).replace(/\\/g, "/");

          if (entry.isDirectory()) {
            // Safe mkdir: ignore if already exists
            await this.ssh.execCommand(`mkdir -p "${remoteFullPath}" || true`);
            await walk(fullLocalPath);
          } else if (entry.isFile()) {
            allFiles.push({ local: fullLocalPath, remote: remoteFullPath });
          }
        }
      };

      await walk(localPath);

      // Upload all files (overwrite existing)
      const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
      bar.start(allFiles.length, 0);

      for (const { local, remote } of allFiles) {
        // Explicitly remove file before upload to ensure overwrite
        await this.ssh.execCommand(`rm -f "${remote}" || true`);
        await this.ssh.putFile(local, remote);
        bar.increment();
      }

      bar.stop();
      spinner.succeed(chalk.green("Transfer complete (subfolders + overwrite)"));
    } catch (err) {
      spinner.fail(chalk.red(`Transfer failed: ${err.message}`));
    }
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
