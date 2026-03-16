require("dotenv").config(); // Load .env at the top

// watch-sample.cjs - CommonJS watch() example using dynamic import
(async () => {
  const { Daffodil } = await import("../src/index.js");

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
      command: () => deployer.sshCommand("pm2 restart myapp"),
    },
  ];

  try {
    await deployer
      .watch({
        paths: ["./dist", "./src"],
        debounce: 2000,
        repoPath: process.env.REPO_PATH || process.cwd(),
        branch: process.env.WATCH_BRANCH || "main",
        tags: true,
        tagPattern: /^v\d+\.\d+\.\d+$/,
        events: ["commit", "merge", "tag"],
        interval: 5000,
      })
      .deploy(steps);

    console.log(
      "watch() is now active (CJS). Edit files or push commits to trigger deployments."
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
