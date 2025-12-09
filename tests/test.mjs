// test.mjs or test.js (ESM)
import { Daffodil } from "../index.js";
import dotenv from "dotenv";
dotenv.config();
// Read remote configuration from .env with defaults
const remoteUser = process.env.REMOTE_USER || "user";
const remoteHost = process.env.REMOTE_HOST || "ssh.server.com";
const remotePath = process.env.REMOTE_PATH || "/user/test";

const deployer = new Daffodil({
  remoteUser,   // from .env
  remoteHost,   // from .env
  remotePath,   // from .env
});


const steps = [
  { step: "List local directory.", command: () => deployer.runCommand("ls -a") },
 { step: "Transfer files.", command: () => deployer.transferFiles("s","/root/test") },
];

// Wrap top-level await in an async IIFE
(async () => {
  try {
    await deployer.deploy(steps);
    console.log("Deployment finished successfully!");
  } catch (err) {
    console.error("Deployment failed:", err);
  }
})();

