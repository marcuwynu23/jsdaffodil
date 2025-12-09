# 📖 JSDaffodil Usage Guidelines

Complete guide to using JSDaffodil for deployment automation. This guide covers everything from basic setup to advanced usage patterns.

## 📚 Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Configuration](#configuration)
4. [Core Features](#core-features)
5. [Advanced Usage](#advanced-usage)
6. [Error Handling](#error-handling)
7. [Best Practices](#best-practices)
8. [Examples](#examples)
9. [Troubleshooting](#troubleshooting)

## 🚀 Installation

### Prerequisites

- **Node.js** >= 14.0.0
- **SSH access** to your remote server
- **SSH key** configured in `~/.ssh/` (or `%USERPROFILE%\.ssh\` on Windows)

### Install Package

```bash
npm install @marcuwynu23/jsdaffodil
```

## 🎯 Quick Start

### Basic ESM Example

```javascript
import { Daffodil } from "@marcuwynu23/jsdaffodil";

const deployer = new Daffodil({
  remoteUser: "deployer",
  remoteHost: "192.168.1.100",
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
    step: "Restart service",
    command: () => deployer.sshCommand("pm2 restart myapp"),
  },
];

await deployer.deploy(steps);
```

### Basic CommonJS Example

```javascript
const { Daffodil } = require("@marcuwynu23/jsdaffodil");

const deployer = new Daffodil({
  remoteUser: "deployer",
  remoteHost: "192.168.1.100",
  remotePath: "/var/www/myapp",
});

const steps = [
  {
    step: "Transfer files",
    command: async () => {
      await deployer.transferFiles("./dist", "/var/www/myapp");
    },
  },
];

deployer.deploy(steps).catch(console.error);
```

## ⚙️ Configuration

### Constructor Options

```javascript
const deployer = new Daffodil({
  remoteUser: "string", // Required: SSH username
  remoteHost: "string", // Required: Server hostname or IP
  remotePath: "string", // Optional: Default remote path (default: ".")
  port: number, // Optional: SSH port (default: 22)
  ignoreFile: "string", // Optional: Ignore file path (default: ".scpignore")
  verbose: boolean, // Optional: Enable verbose logging (default: false)
});
```

### Using Environment Variables

```javascript
import dotenv from "dotenv";
dotenv.config();

const deployer = new Daffodil({
  remoteUser: process.env.REMOTE_USER,
  remoteHost: process.env.REMOTE_HOST,
  remotePath: process.env.REMOTE_PATH || "/var/www/app",
  port: parseInt(process.env.REMOTE_PORT) || 22,
});
```

### Setting Options After Initialization

```javascript
const deployer = new Daffodil({...});

// Enable verbose logging
deployer.setOption({
  verbose: true  // or false, default is false
});
```

## 🔧 Core Features

### 1. File Transfer

Transfer files and directories to remote servers:

```javascript
// Transfer a directory
await deployer.transferFiles("./dist", "/var/www/myapp");

// Transfer a single file
await deployer.transferFiles("./package.json", "/var/www/myapp");

// Use default remote path
await deployer.transferFiles("./dist");
```

**Features:**

- Automatic tar.gz compression
- Efficient single-file transfer
- Automatic remote extraction
- Respects `.scpignore` patterns
- Automatic cleanup

### 2. SSH Commands

Execute commands on remote servers:

```javascript
// Simple command
await deployer.sshCommand("ls -la /var/www");

// Complex command with chaining
await deployer.sshCommand(
  "cd /var/www/myapp && npm install && pm2 restart myapp"
);

// Command with output
await deployer.sshCommand("cat /etc/os-release");
```

### 3. Local Commands

Execute commands locally:

```javascript
// Run local command
await deployer.runCommand("npm run build");

// Get command output
const output = await deployer.runCommand("git rev-parse HEAD");
console.log("Current commit:", output);
```

### 4. Directory Management

Create directories on remote server:

```javascript
await deployer.makeDirectory("uploads");
await deployer.makeDirectory("logs/error");
```

### 5. Step-by-Step Deployment

Execute deployment steps sequentially:

```javascript
const steps = [
  {
    step: "Build application",
    command: async () => {
      await deployer.runCommand("npm run build");
    },
  },
  {
    step: "Transfer files",
    command: async () => {
      await deployer.transferFiles("./dist", "/var/www/myapp");
    },
  },
  {
    step: "Install dependencies",
    command: () =>
      deployer.sshCommand("cd /var/www/myapp && npm install --production"),
  },
  {
    step: "Run migrations",
    command: () => deployer.sshCommand("cd /var/www/myapp && npm run migrate"),
  },
  {
    step: "Restart application",
    command: () => deployer.sshCommand("pm2 restart myapp"),
  },
];

await deployer.deploy(steps);
```

## 🎨 Advanced Usage

### Verbose Logging

Enable detailed logging with timestamps and time consumption:

```javascript
deployer.setOption({ verbose: true });

// Now you'll see:
// - Timestamps on all log messages
// - Time consumption for each operation
// - Detailed error information
// - More verbose progress information
```

**Example Output:**

```
[2025-12-09T12:33:53.930Z] Starting deployment with 3 step(s)
[2025-12-09T12:33:53.931Z] Attempting SSH connection to 192.168.1.100:22
[2025-12-09T12:33:55.967Z] SSH Connection completed in 2.04s
[2025-12-09T12:33:56.678Z] Executing step 1: Build application
[2025-12-09T12:33:58.123Z] Step 1: Build application completed in 1.45s
```

### Ignore Patterns (.scpignore)

Create a `.scpignore` file to exclude files from transfers:

```plaintext
# Dependencies
node_modules/
vendor/

# Environment files
.env
.env.local
.env.production
*.env

# Logs
*.log
logs/
*.log.*

# Build artifacts
dist/
build/
*.map

# IDE files
.vscode/
.idea/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db
desktop.ini

# Git
.git/
.gitignore

# Test files
samples/
*.test.js
*.spec.js
```

### Conditional Steps

Add conditional logic to your deployment:

```javascript
const steps = [
  {
    step: "Transfer files",
    command: async () => {
      await deployer.transferFiles("./dist", "/var/www/myapp");
    },
  },
  // Only run migrations in production
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          step: "Run migrations",
          command: () =>
            deployer.sshCommand("cd /var/www/myapp && npm run migrate"),
        },
      ]
    : []),
  // Conditional step based on feature flag
  ...(process.env.ENABLE_CACHE_CLEAR === "true"
    ? [
        {
          step: "Clear cache",
          command: () =>
            deployer.sshCommand("cd /var/www/myapp && npm run cache:clear"),
        },
      ]
    : []),
];
```

### Error Handling

Handle errors gracefully:

```javascript
try {
  await deployer.deploy(steps);
  console.log("✅ Deployment successful!");
} catch (error) {
  console.error("❌ Deployment failed:", error.message);

  // With verbose mode, you get detailed error information
  if (deployer.verbose) {
    console.error("Full error details:", error);
  }

  process.exit(1);
}
```

### Custom Error Messages

JSDaffodil provides human-readable error messages when verbose is disabled:

```javascript
// Without verbose: Human-readable messages
deployer.setOption({ verbose: false });
// Error: SSH connection failed: Authentication failed. Please check your SSH keys and credentials.

// With verbose: Full technical details
deployer.setOption({ verbose: true });
// Error: All configured authentication methods failed
//   Error Name: Error
//   Error Code: ECONNREFUSED
//   Stack Trace: ...
```

## 📝 Best Practices

### 1. SSH Key Setup

```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "your_email@example.com"

# Copy public key to server
ssh-copy-id deployer@your-server-ip

# Test connection
ssh deployer@your-server-ip
```

### 2. Use Environment Variables

Never hardcode credentials:

```javascript
// ❌ Bad
const deployer = new Daffodil({
  remoteUser: "admin",
  remoteHost: "192.168.1.100",
});

// ✅ Good
const deployer = new Daffodil({
  remoteUser: process.env.DEPLOY_USER,
  remoteHost: process.env.DEPLOY_HOST,
  remotePath: process.env.DEPLOY_PATH,
});
```

### 3. Error Handling

Always wrap deployments in try-catch:

```javascript
(async () => {
  try {
    await deployer.deploy(steps);
    console.log("Deployment successful!");
  } catch (error) {
    console.error("Deployment failed:", error.message);
    process.exit(1);
  }
})();
```

### 4. Validate Before Deploy

Check prerequisites before deploying:

```javascript
const steps = [
  {
    step: "Validate build",
    command: async () => {
      const result = await deployer.runCommand("npm run build");
      if (!result) {
        throw new Error("Build failed");
      }
    },
  },
  {
    step: "Transfer files",
    command: async () => {
      await deployer.transferFiles("./dist", "/var/www/myapp");
    },
  },
];
```

### 5. Use .scpignore

Always use `.scpignore` to exclude unnecessary files:

```plaintext
node_modules/
.env
*.log
.git/
```

## 📚 Examples

### Complete Deployment Script

See working examples in the `samples/` directory:

- **ESM Example**: `samples/sample.mjs`
- **CommonJS Example**: `samples/sample.cjs`

### Example: Full Stack Deployment

```javascript
import { Daffodil } from "@marcuwynu23/jsdaffodil";
import dotenv from "dotenv";

dotenv.config();

const deployer = new Daffodil({
  remoteUser: process.env.REMOTE_USER,
  remoteHost: process.env.REMOTE_HOST,
  remotePath: process.env.REMOTE_PATH,
});

deployer.setOption({ verbose: true });

const steps = [
  {
    step: "Build frontend",
    command: async () => {
      await deployer.runCommand("npm run build:frontend");
    },
  },
  {
    step: "Build backend",
    command: async () => {
      await deployer.runCommand("npm run build:backend");
    },
  },
  {
    step: "Transfer frontend",
    command: async () => {
      await deployer.transferFiles("./frontend/dist", "/var/www/app/frontend");
    },
  },
  {
    step: "Transfer backend",
    command: async () => {
      await deployer.transferFiles("./backend/dist", "/var/www/app/backend");
    },
  },
  {
    step: "Install backend dependencies",
    command: () =>
      deployer.sshCommand(
        "cd /var/www/app/backend && npm install --production"
      ),
  },
  {
    step: "Run database migrations",
    command: () =>
      deployer.sshCommand("cd /var/www/app/backend && npm run migrate"),
  },
  {
    step: "Restart services",
    command: () => deployer.sshCommand("pm2 restart all"),
  },
  {
    step: "Verify deployment",
    command: () =>
      deployer.sshCommand("curl -f http://localhost:3000/health || exit 1"),
  },
];

(async () => {
  try {
    await deployer.deploy(steps);
    console.log("✅ Deployment completed successfully!");
  } catch (error) {
    console.error("❌ Deployment failed:", error.message);
    process.exit(1);
  }
})();
```

### Example: CI/CD Integration

```javascript
// deploy.js
import { Daffodil } from "@marcuwynu23/jsdaffodil";

const deployer = new Daffodil({
  remoteUser: process.env.CI_DEPLOY_USER,
  remoteHost: process.env.CI_DEPLOY_HOST,
  remotePath: process.env.CI_DEPLOY_PATH,
});

// Enable verbose in CI for better logs
deployer.setOption({ verbose: process.env.CI === "true" });

const steps = [
  {
    step: "Transfer files",
    command: async () => {
      await deployer.transferFiles("./dist", process.env.CI_DEPLOY_PATH);
    },
  },
  {
    step: "Deploy",
    command: () =>
      deployer.sshCommand(`cd ${process.env.CI_DEPLOY_PATH} && ./deploy.sh`),
  },
];

deployer.deploy(steps).catch((error) => {
  console.error("Deployment failed:", error.message);
  process.exit(1);
});
```

## 🔍 Troubleshooting

### Common Issues

#### 1. SSH Authentication Failed

**Problem**: "All configured authentication methods failed"

**Solutions**:

- Verify SSH key is in `~/.ssh/` (or `%USERPROFILE%\.ssh\` on Windows)
- Ensure public key is added to server: `ssh-copy-id user@host`
- Test connection manually: `ssh user@host`
- Check key permissions: `chmod 600 ~/.ssh/id_rsa`

#### 2. Connection Timeout

**Problem**: "Connection timeout"

**Solutions**:

- Verify server is accessible: `ping host`
- Check firewall settings
- Verify SSH port (default: 22)
- Check network connectivity

#### 3. File Transfer Fails

**Problem**: "Transfer failed: Path does not exist"

**Solutions**:

- Verify local path exists
- Check file permissions
- Ensure destination directory exists on remote
- Check `.scpignore` isn't excluding needed files

#### 4. Permission Denied

**Problem**: "Permission denied"

**Solutions**:

- Verify SSH user has write permissions
- Check remote directory permissions
- Ensure user has access to destination path

### Debugging Tips

1. **Enable Verbose Mode**:

   ```javascript
   deployer.setOption({ verbose: true });
   ```

2. **Test SSH Connection**:

   ```bash
   ssh user@host
   ```

3. **Test File Transfer Manually**:

   ```bash
   scp -r ./dist user@host:/var/www/app
   ```

4. **Check Logs**:
   - With verbose mode, all operations are logged with timestamps
   - Review error messages for specific issues

## 📖 Additional Resources

- **README.md** - Quick reference and overview
- **DOCUMENTATION.md** - Developer documentation
- **CONTRIBUTING.md** - Contribution guidelines
- **Samples Directory** - Working examples in `samples/`

## 💬 Getting Help

If you encounter issues:

1. Check this guide first
2. Review the examples in `samples/` directory
3. Enable verbose mode for detailed logs
4. Check GitHub Issues for similar problems
5. Open a new issue with details

---

Happy deploying! 🌼
