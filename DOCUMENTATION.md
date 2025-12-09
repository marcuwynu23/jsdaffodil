# 🔧 JSDaffodil Developer Documentation

Comprehensive documentation for developers contributing to or extending JSDaffodil.

## 📚 Table of Contents

1. [Project Overview](#project-overview)
2. [Project Structure](#project-structure)
3. [Architecture](#architecture)
4. [Development Setup](#development-setup)
5. [Code Organization](#code-organization)
6. [Core Components](#core-components)
7. [Testing](#testing)
8. [Building & Distribution](#building--distribution)
9. [Extension Points](#extension-points)
10. [Contributing Guidelines](#contributing-guidelines)
11. [Code Style](#code-style)
12. [Debugging](#debugging)

## 🎯 Project Overview

JSDaffodil is a cross-platform deployment automation framework for Node.js. It provides a clean API for SSH-based deployments with archive-based file transfer.

### Key Technologies

- **Node.js** - Runtime environment
- **node-ssh** - SSH client library
- **tar** - Archive creation (cross-platform)
- **chalk** - Terminal styling
- **ora** - CLI spinners
- **cli-progress** - Progress bars
- **fs-extra** - Enhanced file system operations

## 📁 Project Structure

```
jsdaffodil/
├── index.js              # Main ESM module entry point
├── index.cjs            # CommonJS wrapper
├── package.json          # Package configuration
├── README.md            # User-facing documentation
├── GUIDELINES.md         # Usage guide
├── DOCUMENTATION.md      # This file - developer docs
├── COLLABORATION.md      # Contribution guidelines
├── LICENSE               # MIT License
├── samples/              # Sample examples
│   ├── sample.mjs       # ESM sample example
│   └── sample.cjs       # CommonJS sample example
└── dist/                 # Distribution/test files
```

## 🏗️ Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────┐
│         User Application                 │
│  (ESM or CommonJS)                      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         Daffodil Class                   │
│  - Connection Management                 │
│  - File Transfer                         │
│  - Command Execution                     │
│  - Step Orchestration                    │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴───────┐
       │               │
       ▼               ▼
┌──────────┐    ┌──────────┐
│  NodeSSH │    │   tar    │
│  Client  │    │  Archive │
└──────────┘    └──────────┘
```

### Core Design Principles

1. **Modularity** - Each feature is self-contained
2. **Error Handling** - Comprehensive error handling with custom error types
3. **Cross-Platform** - Works on Windows, Linux, and macOS
4. **Dual Module Support** - Both ESM and CommonJS
5. **User-Friendly** - Human-readable errors and verbose logging

## 🛠️ Development Setup

### Prerequisites

- **Node.js** >= 14.0.0
- **npm** >= 6.0.0
- **Git** for version control

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/marcuwynu23/jsdaffodil.git
cd jsdaffodil

# Install dependencies
npm install

# Run tests
npm test
```

### Development Workflow

```bash
# Run ESM tests
npm run test:esm

# Run CommonJS tests
npm run test:common

# Run all tests
npm test
```

### Environment Setup

Create a `.env` file for testing (optional):

```env
REMOTE_USER=your_ssh_user
REMOTE_HOST=your_server_ip
REMOTE_PATH=/path/to/deploy
```

## 📦 Code Organization

### Main Module (`index.js`)

The main module exports:

- `Daffodil` - Main class
- `PathNotFoundError` - Custom error class
- `TransferError` - Custom error class

### Class Structure

```javascript
export class Daffodil {
  // Constructor
  constructor({ remoteUser, remoteHost, remotePath, port, ignoreFile, verbose })
  
  // Configuration
  setOption({ verbose })
  
  // Connection
  async connect()
  
  // File Operations
  async transferFiles(localPath, destinationPath)
  async makeDirectory(dirName)
  
  // Command Execution
  async runCommand(cmd)
  async sshCommand(cmd)
  
  // Deployment
  async deploy(steps)
  
  // Internal Helpers
  loadIgnoreList()
  getTimestamp()
  log(message, color)
  logError(message, error)
  logTimeConsumption(operation, startTime)
  getHumanReadableError(error)
}
```

## 🔍 Core Components

### 1. Connection Management

**Location**: `connect()` method

**Responsibilities**:
- SSH key detection and selection
- Connection establishment
- Remote path verification

**Key Features**:
- Automatic key type detection (id_rsa, id_ed25519, id_ecdsa, id_dsa)
- Fallback mechanism for multiple keys
- Connection error handling

**Implementation Details**:

```javascript
async connect() {
  // 1. Try multiple SSH keys in order
  // 2. Connect using first successful key
  // 3. Verify/create remote path
  // 4. Handle connection failures gracefully
}
```

### 2. File Transfer System

**Location**: `transferFiles()` method

**Responsibilities**:
- Archive creation (tar.gz)
- File transfer via SSH
- Remote extraction
- Cleanup

**Transfer Flow**:

```
1. Validate local path
2. Create tar.gz archive locally
3. Transfer archive to remote server
4. Extract archive on remote server
5. Clean up local and remote archives
```

**Key Features**:
- Cross-platform archive creation
- Ignore pattern support (.scpignore)
- Automatic cleanup
- Progress tracking
- Error recovery

### 3. Logging System

**Location**: `log()`, `logError()`, `logTimeConsumption()` methods

**Features**:
- Verbose mode with timestamps
- Time consumption tracking
- Human-readable error messages
- Color-coded output

**Verbose Mode**:
- When `verbose: true`: Full technical details
- When `verbose: false`: Human-readable messages

### 4. Error Handling

**Custom Error Classes**:

1. **PathNotFoundError**
   - Thrown when file/directory doesn't exist
   - Includes path and type information

2. **TransferError**
   - Thrown during transfer failures
   - Wraps original errors

**Error Flow**:

```javascript
try {
  // Operation
} catch (err) {
  // 1. Determine error type
  // 2. Create appropriate error class
  // 3. Log with appropriate detail level
  // 4. Throw for upstream handling
}
```

### 5. Step Orchestration

**Location**: `deploy()` method

**Responsibilities**:
- Sequential step execution
- Error handling and abort
- Progress tracking
- Time consumption

**Step Structure**:

```javascript
{
  step: "Description",      // Human-readable description
  command: async () => {}   // Async function to execute
}
```

## 🧪 Testing

### Sample Structure

Samples are located in the `samples/` directory:

- `sample.mjs` - ESM module example
- `sample.cjs` - CommonJS module example

### Running Samples

```bash
# Run all samples
npm run sample

# Run specific sample
node samples/sample.mjs
node samples/sample.cjs
```

### Writing Tests

Tests should:

1. Test both ESM and CommonJS
2. Use environment variables for configuration
3. Handle errors appropriately
4. Clean up after execution

**Example Sample Structure**:

```javascript
import { Daffodil } from "../index.js";

const deployer = new Daffodil({
  remoteUser: process.env.REMOTE_USER,
  remoteHost: process.env.REMOTE_HOST,
  remotePath: process.env.REMOTE_PATH,
});

const steps = [
  { step: "Sample step", command: async () => {
    // Sample implementation
  }},
];

(async () => {
  try {
    await deployer.deploy(steps);
  } catch (err) {
    console.error("Deployment failed:", err);
    process.exit(1);
  }
})();
```

## 📦 Building & Distribution

### Module System

The project supports both ESM and CommonJS:

- **ESM**: `index.js` (native)
- **CommonJS**: `index.cjs` (wrapper)

### CommonJS Wrapper

The `index.cjs` file provides CommonJS compatibility:

```javascript
// index.cjs
module.exports = require('./index.js');
```

### Package Configuration

Key `package.json` fields:

```json
{
  "type": "module",           // ESM by default
  "main": "index.js",         // Main entry
  "exports": {
    "import": "./index.js",   // ESM import
    "require": "./index.cjs"  // CommonJS require
  }
}
```

### Publishing

```bash
# Build (if needed)
npm run build

# Test before publishing
npm test

# Publish
npm publish
```

## 🔌 Extension Points

### Adding New Methods

To add new functionality:

1. **Add method to Daffodil class**:

```javascript
async newMethod(param1, param2) {
  const startTime = Date.now();
  
  if (this.verbose) {
    this.log(`Starting new operation`, "blue");
  }
  
  try {
    // Implementation
    this.logTimeConsumption("New operation", startTime);
  } catch (err) {
    this.logError("New operation failed", err);
    throw err;
  }
}
```

2. **Follow existing patterns**:
   - Use verbose logging
   - Track time consumption
   - Handle errors appropriately
   - Add JSDoc comments

### Custom Error Classes

To add custom error types:

```javascript
export class CustomError extends Error {
  constructor(message, additionalInfo = null) {
    super(message);
    this.name = "CustomError";
    this.additionalInfo = additionalInfo;
    Error.captureStackTrace(this, this.constructor);
  }
}
```

### Extending Logging

To add custom logging:

```javascript
logCustom(message, data) {
  if (this.verbose) {
    const timestamp = this.getTimestamp();
    console.log(chalk.cyan(`[${timestamp}] ${message}`));
    console.log(chalk.gray(JSON.stringify(data, null, 2)));
  }
}
```

## 📝 Contributing Guidelines

### Code Style

1. **Use ES6+ features**
2. **Follow existing code style**
3. **Add JSDoc comments for public methods**
4. **Use meaningful variable names**
5. **Keep functions focused and small**

### Commit Messages

Follow conventional commits:

```
feat: add new feature
fix: fix bug
docs: update documentation
refactor: refactor code
test: add tests
chore: maintenance tasks
```

### Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Update documentation
5. Submit pull request

See [COLLABORATION.md](./COLLABORATION.md) for detailed guidelines.

## 🎨 Code Style

### Naming Conventions

- **Classes**: PascalCase (`Daffodil`, `PathNotFoundError`)
- **Methods**: camelCase (`transferFiles`, `runCommand`)
- **Variables**: camelCase (`remoteHost`, `archivePath`)
- **Constants**: UPPER_SNAKE_CASE (if needed)

### Code Formatting

- Use 2 spaces for indentation
- Use single quotes for strings (if consistent)
- Add trailing commas in objects/arrays
- Use async/await over promises

### Comments

- Add JSDoc for public methods
- Explain complex logic
- Keep comments up-to-date

**Example JSDoc**:

```javascript
/**
 * Transfers files from local directory to remote server
 * @param {string} localPath - Local directory path to transfer
 * @param {string} destinationPath - Remote destination path (optional)
 * @returns {Promise<void>}
 * @throws {PathNotFoundError} If local path doesn't exist
 * @throws {TransferError} If transfer fails
 */
async transferFiles(localPath, destinationPath = this.remotePath) {
  // Implementation
}
```

## 🐛 Debugging

### Enable Verbose Mode

```javascript
deployer.setOption({ verbose: true });
```

### Debug Logging

Add debug logs:

```javascript
if (this.verbose) {
  console.log("Debug info:", data);
}
```

### Common Issues

1. **SSH Connection Issues**
   - Check SSH key permissions
   - Verify server accessibility
   - Test connection manually

2. **File Transfer Issues**
   - Verify paths exist
   - Check permissions
   - Review .scpignore patterns

3. **Module System Issues**
   - Ensure correct import/require syntax
   - Check package.json type field
   - Verify file extensions

### Debugging Tips

1. **Use verbose mode** for detailed logs
2. **Test components individually**
3. **Check error messages carefully**
4. **Review stack traces**
5. **Test with minimal examples**

## 📚 Additional Resources

- **GUIDELINES.md** - User guide and examples
- **COLLABORATION.md** - Contribution guidelines
- **README.md** - Quick reference
- **Samples** - Working examples in `samples/` directory

## 🔗 External Dependencies

### Core Dependencies

- **node-ssh** (^13.2.1) - SSH client
- **tar** (^7.5.2) - Archive creation
- **fs-extra** (^11.3.0) - File operations
- **chalk** (^5.3.0) - Terminal colors
- **ora** (^8.2.0) - CLI spinners
- **cli-progress** (^3.12.0) - Progress bars

### Dev Dependencies

- **dotenv** (^17.2.3) - Environment variables

## 🚀 Future Enhancements

Potential areas for extension:

1. **Additional Transfer Methods**
   - Direct file transfer (non-archive)
   - Incremental sync
   - Parallel transfers

2. **Enhanced Logging**
   - File logging
   - Structured logging (JSON)
   - Log levels

3. **Connection Options**
   - Password authentication
   - Custom SSH config
   - Connection pooling

4. **Deployment Features**
   - Rollback support
   - Health checks
   - Notifications

## ❓ Questions?

If you have questions about development:

1. Review this documentation
2. Check [COLLABORATION.md](./COLLABORATION.md)
3. Review existing code
4. Open an issue on GitHub

---

Happy coding! 🌼

