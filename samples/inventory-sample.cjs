// inventory-sample.cjs - CommonJS multi-host deployment example using inventory.ini
require("dotenv").config();

(async () => {
  const { Daffodil } = await import("../src/index.js");

  const deployer = new Daffodil({
    inventory: process.env.INVENTORY_PATH || "./inventory.ini",
    group: process.env.INVENTORY_GROUP || "webservers",
    remotePath: process.env.REMOTE_PATH || "/var/www/myapp",
  });

  deployer.setOption({
    verbose: false,
  });

  const steps = [
    {
      step: "Transfer application files",
      command: () => deployer.transferFiles("./dist"),
    },
    {
      step: "Install dependencies",
      command: () =>
        deployer.ssh("cd /var/www/myapp && npm install --production=false"),
    },
    {
      step: "Restart application",
      command: () => deployer.ssh("pm2 restart myapp"),
    },
  ];

  try {
    await deployer.deploy(steps);
    console.log("Multi-host deployment finished successfully! (CJS)");
  } catch (err) {
    console.error("Multi-host deployment failed (CJS):", err.message);
    process.exit(1);
  }
})();

