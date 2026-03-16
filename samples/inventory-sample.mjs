// inventory-sample.mjs - ESM multi-host deployment example using inventory.ini
import { Daffodil } from "../src/index.js";
import dotenv from "dotenv";

dotenv.config();

// Example inventory.ini:
// [webservers]
// server1 host=231.142.34.222 user=deployer port=22
// server2 host=231.142.34.223 user=deployer
// server3 host=231.142.34.224 user=ubuntu
//
// Save this as ./inventory.ini (or adjust the path below).

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

(async () => {
  try {
    await deployer.deploy(steps);
    console.log("Multi-host deployment finished successfully!");
  } catch (err) {
    console.error("Multi-host deployment failed:", err.message);
    process.exit(1);
  }
})();

