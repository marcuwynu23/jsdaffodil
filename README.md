<div align="center">
  <h1>JSDaffodil</h1>
  <p><strong>Cross-Platform Deployment Automation Framework for Node.js</strong></p>
  <p>
    <img src="https://img.shields.io/npm/v/@marcuwynu23/jsdaffodil.svg" alt="npm version"/>
    <img src="https://img.shields.io/npm/dm/@marcuwynu23/jsdaffodil.svg" alt="npm downloads"/>
    <img src="https://img.shields.io/github/stars/marcuwynu23/jsdaffodil.svg" alt="Stars Badge"/>
    <img src="https://img.shields.io/github/license/marcuwynu23/jsdaffodil.svg" alt="License Badge"/>
  </p>
</div>

---

## Overview

**JSDaffodil** is a lightweight, declarative deployment automation framework for Node.js that simplifies remote server deployments through SSH. Inspired by [pydaffodil](https://pypi.org/project/pydaffodil/), it provides a clean, step-by-step API for executing deployment tasks on remote servers.

### Key Features

- **Archive-Based File Transfer** - Efficient tar.gz compression for fast bulk file transfers
- **Cross-Platform Support** - Works seamlessly on Windows, Linux, and macOS
- **Multi-Key SSH Authentication** - Automatic fallback across multiple SSH key types
- **Dual Module Support** - Full support for both CommonJS and ESM
- **Step-by-Step Execution** - Declarative task execution with clear progress tracking
- **Ignore Pattern Support** - `.scpignore` file for excluding files from transfers
- **Beautiful CLI Output** - Styled terminal output with progress bars and spinners
- **Zero External Dependencies** - Pure Node.js implementation for archive creation
- **Watch-Based CI/CD (`watch()`)** - Automatically trigger deployments on local file changes or Git events (commits, merges, tags)
- **Multi-Host Deployments via `inventory.ini`** - Run the same deployment steps across multiple servers defined in an inventory file

---

## Documentation

This project includes comprehensive documentation:

- **[GUIDELINES.md](./GUIDELINES.md)** - Complete usage guide with examples, best practices, troubleshooting, and real-world scenarios. Includes sample code from the `samples/` directory.
- **[DOCUMENTATION.md](./DOCUMENTATION.md)** - Developer documentation covering architecture, code organization, testing, and extension points for contributors.
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Contribution guidelines, code review process, and collaboration best practices.

For quick examples, check the `samples/` directory:

- `samples/sample.mjs` - ESM module example
- `samples/sample.cjs` - CommonJS module example
- `samples/watch-sample.mjs` - ESM example using `watch()` for file + Git triggers
- `samples/watch-sample.cjs` - CommonJS example using `watch()`
- `samples/inventory-sample.mjs` - ESM multi-host deployment with `inventory.ini`
- `samples/inventory-sample.cjs` - CommonJS multi-host deployment with `inventory.ini`

---

## Installation

```bash
npm install @marcuwynu23/jsdaffodil
```

---

## Quick Start

### ESM Example

```javascript
// test.mjs or test.js (with "type": "module" in package.json)
import { Daffodil } from "@marcuwynu23/jsdaffodil";

const deployer = new Daffodil({
  remoteUser: "deployer",
  remoteHost: "231.142.34.222",
  remotePath: "/var/www/myapp",
  port: 22, // Optional, defaults to 22
});

const steps = [
  {
    step: "Transfer application files",
    command: async () => {
      await deployer.transferFiles("./dist", "/var/www/myapp");
    },
  },
  {
    step: "Install dependencies",
    command: () => deployer.sshCommand("cd /var/www/myapp && npm install"),
  },
  {
    step: "Restart application",
    command: () => deployer.sshCommand("pm2 restart myapp"),
  },
];

await deployer.deploy(steps);
```

### CommonJS Example

```javascript
// test.cjs or test.js (without "type": "module")
const { Daffodil } = require("@marcuwynu23/jsdaffodil");

const deployer = new Daffodil({
  remoteUser: "deployer",
  remoteHost: "231.142.34.222",
  remotePath: "/var/www/myapp",
});

const steps = [
  {
    step: "Transfer files",
    command: async () => {
      await deployer.transferFiles("./dist", "/var/www/myapp");
    },
  },
  {
    step: "Run remote command",
    command: () => deployer.sshCommand("ls -la /var/www/myapp"),
  },
];

deployer.deploy(steps).catch(console.error);
```

---

## API Reference

### Constructor

```javascript
new Daffodil({
  remoteUser: string,        // SSH username (single-host mode)
  remoteHost: string,        // Server hostname or IP (single-host mode)
  remotePath?: string,       // Default remote path (default: ".")
  port?: number,             // SSH port (default: 22)
  ignoreFile?: string,       // Ignore file path (default: ".scpignore")
  verbose?: boolean,         // Verbose logging (default: false)
  inventory?: string,        // Path to inventory.ini (multi-host mode)
  group?: string,            // Group name inside inventory.ini
})
```

### Methods

#### `async connect()`

Establishes SSH connection using available SSH keys. Automatically tries multiple key types (`id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa`) in order.

#### `async transferFiles(localPath, destinationPath?)`

Transfers files from local directory to remote server using archive-based compression.

- **`localPath`** (string): Local directory path to transfer
- **`destinationPath`** (string, optional): Remote destination path (defaults to `remotePath`)

**Features:**

- Creates tar.gz archive locally (cross-platform)
- Transfers single archive file for efficiency
- Automatically extracts on remote server
- Respects `.scpignore` patterns
- Cleans up archives after successful transfer

#### `async runCommand(cmd)`

Executes a command locally and returns the output.

- **`cmd`** (string): Command to execute

#### `async sshCommand(cmd)`

Executes a command on the remote server via SSH.

- **`cmd`** (string): Command to execute remotely

#### `async makeDirectory(dirName)`

Creates a directory on the remote server.

- **`dirName`** (string): Directory name to create

#### `async deploy(steps)`

Executes a series of deployment steps sequentially.

- **`steps`** (Array): Array of step objects with `step` (description) and `command` (async function)

-#### `watch(options)`

Creates a watcher that can trigger deployments based on file system or Git changes. Returns an internal watcher with a `.deploy(steps)` method.

```javascript
deployer.watch({
  paths?: string[],           // Local files/folders to watch
  debounce?: number,          // Debounce in ms before triggering deploy
  repoPath?: string,          // Local Git repo path
  branch?: string,            // Single branch to watch
  branches?: string[],        // Multiple branches to watch
  tags?: boolean,             // Watch tags
  tagPattern?: RegExp,        // Filter tag names
  events?: ("commit" | "merge" | "tag")[], // Git events
  interval?: number,          // Poll interval in ms
}).deploy(steps);
```

---

## Advanced Features

### Archive-Based File Transfer

JSDaffodil uses an efficient archive-based transfer method:

1. **Local Archive Creation** - Files are compressed into a tar.gz archive using cross-platform Node.js libraries
2. **Single File Transfer** - Only one archive file is transferred, significantly faster than individual file transfers
3. **Remote Extraction** - Archive is automatically extracted on the remote server
4. **Automatic Cleanup** - Both local and remote archives are cleaned up after successful transfer

This approach is especially beneficial for:

- Large projects with many files
- Slow network connections
- Reducing SSH connection overhead

### Cross-Platform Support

JSDaffodil works seamlessly across all major operating systems:

- ✅ **Windows** - Uses Node.js tar library (no external dependencies)
- ✅ **Linux** - Native support
- ✅ **macOS** - Native support

### SSH Key Management

The framework automatically attempts to connect using multiple SSH key types in order:

1. `id_rsa`
2. `id_ed25519`
3. `id_ecdsa`
4. `id_dsa`

This ensures compatibility with various SSH key configurations.

### Ignore Patterns (`.scpignore`)

Create a `.scpignore` file in your project root to exclude files from transfers:

```plaintext
# Dependencies
node_modules
vendor

# Environment files
.env
.env.local
.env.production

# Logs
*.log
logs/

# Build artifacts
dist/
build/
*.map

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db
```

---

## Best Practices

### 1. SSH Key Setup

Ensure your SSH key is properly configured:

```bash
# Generate SSH key if needed
ssh-keygen -t ed25519 -C "your_email@example.com"

# Copy public key to server
ssh-copy-id deployer@your-server-ip

# Test connection
ssh deployer@your-server-ip
```

### 2. Error Handling

Always handle errors in your deployment scripts:

```javascript
try {
  await deployer.deploy(steps);
} catch (error) {
  console.error("Deployment failed:", error.message);
  process.exit(1);
}
```

### 3. Environment Variables

Use environment variables for sensitive information:

```javascript
const deployer = new Daffodil({
  remoteUser: process.env.DEPLOY_USER,
  remoteHost: process.env.DEPLOY_HOST,
  remotePath: process.env.DEPLOY_PATH,
});
```

### 4. Conditional Steps

Add conditional logic to your deployment steps:

```javascript
const steps = [
  {
    step: "Transfer files",
    command: async () => {
      await deployer.transferFiles("./dist", "/var/www/myapp");
    },
  },
  {
    step: "Run migrations",
    command: () => deployer.sshCommand("cd /var/www/myapp && npm run migrate"),
  },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          step: "Restart production server",
          command: () => deployer.sshCommand("pm2 restart myapp"),
        },
      ]
    : []),
];
```

---

## Configuration Options

| Option       | Type      | Default        | Description                                        |
| ------------ | --------- | -------------- | -------------------------------------------------- |
| `remoteUser` | `string`  | **Required\*** | SSH username for remote server (single-host mode)  |
| `remoteHost` | `string`  | **Required\*** | Remote server hostname or IP address (single-host) |
| `remotePath` | `string`  | `"."`          | Default remote directory path                      |
| `port`       | `number`  | `22`           | SSH port number                                    |
| `ignoreFile` | `string`  | `".scpignore"` | Path to ignore patterns file                       |
| `verbose`    | `boolean` | `false`        | Enable verbose logging                             |
| `inventory`  | `string`  | `undefined`    | Path to `inventory.ini` for multi-host deployments |
| `group`      | `string`  | `undefined`    | Inventory group name (e.g. `"webservers"`)         |

> \* `remoteUser` and `remoteHost` are required in single-host mode. When `inventory` is provided, hosts are taken from `inventory.ini` instead.

---

## Watch-Based CI/CD with `watch()`

Use `watch()` to automatically trigger deployments when files change or Git state updates.

### Example: Watch local files

```javascript
import { Daffodil } from "@marcuwynu23/jsdaffodil";

const deployer = new Daffodil({
  remoteUser: "deployer",
  remoteHost: "231.142.34.222",
  remotePath: "/var/www/myapp",
});

const steps = [
  {
    step: "Build project",
    command: () => deployer.runCommand("npm run build"),
  },
  {
    step: "Upload build",
    command: () => deployer.transferFiles("./dist", "/var/www/myapp"),
  },
  {
    step: "Restart application",
    command: () => deployer.sshCommand("pm2 restart myapp"),
  },
];

await deployer
  .watch({
    paths: ["./dist", "./src"],
    debounce: 2000, // ms
  })
  .deploy(steps);
```

### Example: Watch Git repository (commits/merges/tags)

```javascript
await deployer
  .watch({
    repoPath: "/home/user/projects/myapp",
    branches: ["main", "staging"],
    tags: true,
    tagPattern: /^v\d+\.\d+\.\d+$/,
    events: ["commit", "merge", "tag"],
    interval: 5000, // ms
  })
  .deploy(steps);
```

See `samples/watch-sample.mjs` and `samples/watch-sample.cjs` for complete examples.

---

## Multi-Host Deployments with `inventory.ini`

Deploy to multiple servers with a single script using an `inventory.ini` file.

### Example `inventory.ini`

```ini
[webservers]
server1 host=231.142.34.222 user=deployer port=22
server2 host=231.142.34.223 user=deployer        ; uses default port 22
server3 host=231.142.34.224 user=ubuntu port=2200
```

### Usage

```javascript
import { Daffodil } from "@marcuwynu23/jsdaffodil";

const deployer = new Daffodil({
  inventory: "./inventory.ini",
  group: "webservers",
  remotePath: "/var/www/myapp",
});

const steps = [
  {
    step: "Transfer application files",
    command: () => deployer.transferFiles("./dist"),
  },
  {
    step: "Install dependencies",
    command: () =>
      deployer.sshCommand(
        "cd /var/www/myapp && npm install --production=false"
      ),
  },
  {
    step: "Restart application",
    command: () => deployer.sshCommand("pm2 restart myapp"),
  },
];

await deployer.deploy(steps);
```

This will sequentially run the same steps for each host in the `webservers` group, with logs like:

```text
==== Starting deployment for [server1] (231.142.34.222) ====
...
==== Finished deployment for [server1] (231.142.34.222) ====
```

See `samples/inventory-sample.mjs` and `samples/inventory-sample.cjs` for full examples.

---

## Requirements

- **Node.js** >= 14.0.0
- **SSH access** to remote server
- **SSH key** configured in `~/.ssh/` (or `%USERPROFILE%\.ssh\` on Windows)

---

## Contributing

Contributions are welcome! Please read our [CONTRIBUTING.md](./CONTRIBUTING.md) guide for contribution guidelines, code review process, and best practices.

For developers, see [DOCUMENTATION.md](./DOCUMENTATION.md) for architecture details and development setup.

---

## License

[MIT License](./LICENSE) - feel free to use this project for any purpose.

---

## Acknowledgments

Inspired by [pydaffodil](https://pypi.org/project/pydaffodil/) - a Python deployment automation framework.

---

<div align="center">
  <p>Made with love by <a href="https://github.com/marcuwynu23">Mark Wayne B. Menorca</a></p>
</div>
