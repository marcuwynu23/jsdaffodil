import chalk from "chalk";
import { execSync } from "child_process";
import cliProgress from "cli-progress";
import fs from "fs-extra";
import { NodeSSH } from "node-ssh";
import ora from "ora";
import path from "path";

export class Daffodil {
  constructor({ remoteUser, remoteHost, remotePath = ".", port = 22, ignoreFile = ".scpignore" }) {
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
          return; // ✅ Success, skip remaining
        } catch (err) {
          failures.push({ key: keyFile, error: err.message });
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
      const output = execSync(cmd, { stdio: "pipe" }); // changed from 'inherit' to 'pipe'
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
    const spinner = ora(`Transferring files from ${localPath} to ${destinationPath}`).start();
    try {
      const files = await fs.readdir(localPath);
      const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
      bar.start(files.length, 0);

      for (const file of files) {
        if (this.excludeList.includes(file)) continue;

        const filePath = path.join(localPath, file);
        await this.ssh.putFile(filePath, path.posix.join(destinationPath, file));
        bar.increment();
      }

      bar.stop();
      spinner.succeed(chalk.green("Transfer complete"));
    } catch (err) {
      spinner.fail(chalk.red(`Transfer failed: ${err.message}`));
    }
  }

  async deploy(steps) {
    await this.connect();
    for (let i = 0; i < steps.length; i++) {
      const { step, command } = steps[i];
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
