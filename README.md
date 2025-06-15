<div align="center">
  <h1> JSDaffodil </h1>
</div>

<p align="center">
  <img src="https://img.shields.io/github/stars/marcuwynu23/jsdaffodil.svg" alt="Stars Badge"/>
  <img src="https://img.shields.io/github/forks/marcuwynu23/jsdaffodil.svg" alt="Forks Badge"/>
  <img src="https://img.shields.io/github/issues/marcuwynu23/jsdaffodil.svg" alt="Issues Badge"/>
  <img src="https://img.shields.io/github/license/marcuwynu23/jsdaffodil.svg" alt="License Badge"/>
</p>

A lightweight, declarative deployment automation framework for Node.js, inspired by [pydaffodil](https://pypi.org/project/pydaffodil/).

Built with:

- 🧠 SSH automation using `node-ssh`
- 🗃️ Step-by-step task execution
- 🚀 Clean API for local/remote scripts
- 💡 Dual support for **CommonJS** and **ESM**

---

## 📦 Installation

```bash
npm install @marcuwynu23/jsdaffodil
```

---

## 🚀 Usage

### ✅ ESM Example (`type: module` or `.mjs`)

```js
// test.mjs or test.js (with "type": "module" in package.json)
import { Daffodil } from "@marcuwynu23/jsdaffodil";

const deployer = new Daffodil({
  remoteUser: "deployer", // Cloud server username
  remoteHost: "231.142.34.222", // Replace with your VPS or cloud IP
  remotePath: "/root/test", // Remote target path
});

const steps = [
  { step: "List local directory.", command: () => deployer.runCommand("ls -a") },
  { step: "List remote directory.", command: () => deployer.sshCommand("ls -a") },
];

await deployer.deploy(steps);
```

---

### ✅ CommonJS Example (`.js` or `.cjs`)

```js
// test.cjs or test.js (without "type": "module")
const { Daffodil } = require("@marcuwynu23/jsdaffodil");

const deployer = new Daffodil({
  remoteUser: "deployer",
  remoteHost: "231.142.34.222",
  remotePath: "/root/test",
});

const steps = [
  { step: "List local directory.", command: () => deployer.runCommand("ls -a") },
  { step: "List remote directory.", command: () => deployer.sshCommand("ls -a") },
];

deployer.deploy(steps);
```

---

## 🛠 Features

- 🔐 Multi-key SSH fallback (supports id_rsa, id_ed25519, etc.)
- 📁 SCP-based file transfer with `.scpignore` support
- 🟨 Ora & Chalk for styled terminal output
- ✅ Progress bars for file transfers
- ⚙️ CLI-ready architecture for future tooling

---

## 📂 Ignore List (`.scpignore`)

A `.scpignore` file is automatically created on first run.  
Add filenames or patterns to exclude from SCP transfer.

```plaintext
node_modules
.env
*.log
```

---

## 🧪 Tips

- Ensure your local SSH key is authorized for the remote user.
- Use the same key that your CI/CD (e.g., GitHub Actions) uses, or add your own key to `~/.ssh/authorized_keys` on the server.
- Enable `debug` logs in your script by logging keys before connection if needed.

---

## 📄 License

[MIT License](./LICENSE)
