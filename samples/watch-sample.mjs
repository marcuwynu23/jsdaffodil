// watch-sample.mjs - ESM watch() example
import { Daffodil } from "../src/index.js";
import dotenv from "dotenv";

dotenv.config();

// Read remote configuration from .env with defaults
const remoteUser = process.env.REMOTE_USER || "user";
const remoteHost = process.env.REMOTE_HOST || "ssh.server.com";
const remotePath = process.env.REMOTE_PATH || "/user/test";

const deployer = new Daffodil({
  remoteUser, // from .env
  remoteHost, // from .env
  remotePath, // from .env
});

// Enable verbose logging if you want detailed timestamps/output
deployer.setOption({
  verbose: false,
});

// Example: watch local dist folder and a git repo, then run a simple pipeline
const steps = [
  {
    step: "Build project",
    command: () => deployer.local("npm run build"),
  },
  {
    step: "Upload build",
    command: () => deployer.transferFiles("./dist", remotePath),
  },
  {
    step: "Restart app",
    command: () => deployer.sshCommand(`pm2 restart myapp`),
  },
];

// Wrap top-level await in an async IIFE
(async () => {
  try {
    await deployer
      .watch({
        // Watch build output and source
        paths: ["./dist", "./src"],
        debounce: 2000,
        // Optional git-based trigger (repo must exist locally)
        repoPath: process.env.REPO_PATH || process.cwd(),
        branch: process.env.WATCH_BRANCH || "main",
        tags: true,
        tagPattern: /^v\d+\.\d+\.\d+$/,
        events: ["commit", "merge", "tag"],
        interval: 5000,
      })
      .deploy(steps);

    console.log(
      "watch() is now active. Edit files or push commits to trigger deployments."
    );
  } catch (err) {
    if (deployer.verbose) {
      console.error("watch() failed:", err);
    } else {
      console.error("watch() failed:", err.message);
    }
    process.exit(1);
  }
})();

