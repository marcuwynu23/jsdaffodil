require("dotenv").config(); // Load .env at the top

// Note: Since index.js is ESM, we use dynamic import for CommonJS compatibility
(async () => {
  const { Daffodil } = await import("../index.js");

  const remoteUser = process.env.REMOTE_USER || "user";
  const remoteHost = process.env.REMOTE_HOST || "ssh.server.com";
  const remotePath = process.env.REMOTE_PATH || "/user/test";
  const deployer = new Daffodil({
    remoteUser, // from .env
    remoteHost, // from .env
    remotePath, // from .env
  });

  // Enable verbose logging with timestamps and time consumption
  deployer.setOption({
    verbose: false, // or true, default to false
  });

  const steps = [
    {
      step: "List local directory.",
      command: () => deployer.runCommand("ls -a"),
    },
    {
      step: "Transfer files.",
      command: () => deployer.transferFiles("dist", "/root/test"),
    },
  ];

  try {
    await deployer.deploy(steps);
    console.log("Deployment finished successfully!");
  } catch (err) {
    // When verbose is false, show only the message, otherwise show full error
    if (deployer.verbose) {
      console.error("Deployment failed:", err);
    } else {
      console.error("Deployment failed:", err.message);
    }
  }
})();
