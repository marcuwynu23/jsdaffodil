// ESM Test Suite for JSDaffodil
import {
  Daffodil,
  PathNotFoundError,
  TransferError,
  DeploymentError,
} from "../../index.js";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const TEST_CONFIG = {
  remoteUser: process.env.REMOTE_USER || "testuser",
  remoteHost: process.env.REMOTE_HOST || "test.example.com",
  remotePath: process.env.REMOTE_PATH || "/tmp/test",
  port: parseInt(process.env.REMOTE_PORT) || 22,
};

// Test results
let testsPassed = 0;
let testsFailed = 0;
const failures = [];

// Simple test runner
function test(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    testsFailed++;
    failures.push({ name, error: error.message });
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// Test Suite
console.log("\n🧪 Running ESM Tests for JSDaffodil\n");
console.log("=".repeat(50));

// Test 1: Constructor
test("Constructor - creates instance with required parameters", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  assert(deployer instanceof Daffodil, "Should create Daffodil instance");
  assertEqual(deployer.remoteUser, TEST_CONFIG.remoteUser);
  assertEqual(deployer.remoteHost, TEST_CONFIG.remoteHost);
});

test("Constructor - sets default values", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  assertEqual(deployer.remotePath, ".");
  assertEqual(deployer.port, 22);
  assertEqual(deployer.ignoreFile, ".scpignore");
  assertEqual(deployer.verbose, false);
});

test("Constructor - accepts custom parameters", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
    remotePath: "/custom/path",
    port: 2222,
    ignoreFile: ".customignore",
    verbose: true,
  });
  assertEqual(deployer.remotePath, "/custom/path");
  assertEqual(deployer.port, 2222);
  assertEqual(deployer.ignoreFile, ".customignore");
  assertEqual(deployer.verbose, true);
});

// Test 2: setOption
test("setOption - sets verbose option", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  assertEqual(deployer.verbose, false);
  deployer.setOption({ verbose: true });
  assertEqual(deployer.verbose, true);
  deployer.setOption({ verbose: false });
  assertEqual(deployer.verbose, false);
});

// Test 3: getTimestamp
test("getTimestamp - returns ISO formatted timestamp", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  const timestamp = deployer.getTimestamp();
  assert(timestamp.includes("T"), "Should contain ISO date separator");
  assert(
    timestamp.includes("Z") || timestamp.includes("+"),
    "Should be ISO format"
  );
});

// Test 4: getHumanReadableError
test("getHumanReadableError - handles PathNotFoundError", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  const error = new PathNotFoundError("/nonexistent", "file");
  const message = deployer.getHumanReadableError(error);
  assert(message.includes("/nonexistent"), "Should include path");
  assert(message.includes("file"), "Should include type");
});

test("getHumanReadableError - handles TransferError", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  const error = new TransferError("Transfer failed");
  const message = deployer.getHumanReadableError(error);
  assertEqual(message, "Transfer failed");
});

test("getHumanReadableError - handles SSH authentication errors", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  const error = new Error("All configured authentication methods failed");
  const message = deployer.getHumanReadableError(error);
  assert(
    message.includes("SSH connection failed"),
    "Should provide SSH error message"
  );
  assert(
    message.includes("Authentication failed"),
    "Should mention authentication"
  );
});

test("getHumanReadableError - handles connection errors", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
    port: 22,
  });
  const error = new Error("ECONNREFUSED");
  error.code = "ECONNREFUSED";
  const message = deployer.getHumanReadableError(error);
  assert(
    message.includes("SSH connection failed"),
    "Should provide connection error message"
  );
});

test("getHumanReadableError - handles timeout errors", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
    port: 22,
  });
  const error = new Error("ETIMEDOUT");
  error.code = "ETIMEDOUT";
  const message = deployer.getHumanReadableError(error);
  assert(
    message.includes("Connection timeout"),
    "Should provide timeout error message"
  );
});

test("getHumanReadableError - handles file system errors", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  const error = new Error("ENOENT");
  error.code = "ENOENT";
  const message = deployer.getHumanReadableError(error);
  assert(
    message.includes("not found"),
    "Should provide file system error message"
  );
});

test("getHumanReadableError - handles permission errors", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  const error = new Error("EACCES");
  error.code = "EACCES";
  const message = deployer.getHumanReadableError(error);
  assert(
    message.includes("Permission denied"),
    "Should provide permission error message"
  );
});

test("getHumanReadableError - handles unknown errors", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  const error = new Error("Unknown error");
  const message = deployer.getHumanReadableError(error);
  assertEqual(message, "Unknown error");
});

test("getHumanReadableError - handles null/undefined", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  const message = deployer.getHumanReadableError(null);
  assertEqual(message, "Unknown error occurred");
});

// Test 5: loadIgnoreList
test("loadIgnoreList - creates ignore file if not exists", async () => {
  const testIgnoreFile = path.join(__dirname, ".test-scpignore");
  // Clean up if exists
  if (await fs.pathExists(testIgnoreFile)) {
    await fs.remove(testIgnoreFile);
  }

  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
    ignoreFile: testIgnoreFile,
  });

  assert(await fs.pathExists(testIgnoreFile), "Should create ignore file");
  await fs.remove(testIgnoreFile);
});

test("loadIgnoreList - loads existing ignore patterns", async () => {
  const testIgnoreFile = path.join(__dirname, ".test-scpignore-2");
  await fs.writeFile(testIgnoreFile, "node_modules\n.env\n*.log\n");

  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
    ignoreFile: testIgnoreFile,
  });

  assert(deployer.excludeList.length === 3, "Should load 3 patterns");
  assert(
    deployer.excludeList.includes("node_modules"),
    "Should include node_modules"
  );
  assert(deployer.excludeList.includes(".env"), "Should include .env");
  assert(deployer.excludeList.includes("*.log"), "Should include *.log");

  await fs.remove(testIgnoreFile);
});

test("loadIgnoreList - filters comments and empty lines", async () => {
  const testIgnoreFile = path.join(__dirname, ".test-scpignore-3");
  await fs.writeFile(
    testIgnoreFile,
    "# This is a comment\nnode_modules\n\n.env\n# Another comment\n"
  );

  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
    ignoreFile: testIgnoreFile,
  });

  assert(
    deployer.excludeList.length === 2,
    "Should load 2 patterns (excluding comments and empty lines)"
  );
  assert(
    deployer.excludeList.includes("node_modules"),
    "Should include node_modules"
  );
  assert(deployer.excludeList.includes(".env"), "Should include .env");

  await fs.remove(testIgnoreFile);
});

// Test 6: Error Classes
test("PathNotFoundError - creates error with path and type", () => {
  const error = new PathNotFoundError("/test/path", "directory");
  assertEqual(error.name, "PathNotFoundError");
  assertEqual(error.path, "/test/path");
  assertEqual(error.type, "directory");
  assert(error.message.includes("/test/path"), "Message should include path");
  assert(error.message.includes("directory"), "Message should include type");
});

test("TransferError - creates error with message and original error", () => {
  const originalError = new Error("Original error");
  const error = new TransferError("Transfer failed", originalError);
  assertEqual(error.name, "TransferError");
  assertEqual(error.message, "Transfer failed");
  assertEqual(error.originalError, originalError);
});

test("DeploymentError - creates error with stack trace suppression", () => {
  const errorWithStack = new DeploymentError("Test error", false);
  assert(
    errorWithStack.stack,
    "Should have stack trace when suppressStackTrace is false"
  );

  const errorWithoutStack = new DeploymentError("Test error", true);
  assertEqual(
    errorWithoutStack.stack,
    "Test error",
    "Stack should equal message when suppressed"
  );
});

// Test 7: runCommand (mock test - won't actually run commands)
test("runCommand - method exists and is callable", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  assert(
    typeof deployer.runCommand === "function",
    "runCommand should be a function"
  );
});

// Test 8: sshCommand (mock test)
test("sshCommand - method exists and is callable", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  assert(
    typeof deployer.sshCommand === "function",
    "sshCommand should be a function"
  );
});

// Test 9: makeDirectory (mock test)
test("makeDirectory - method exists and is callable", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  assert(
    typeof deployer.makeDirectory === "function",
    "makeDirectory should be a function"
  );
});

// Test 10: transferFiles (mock test)
test("transferFiles - method exists and is callable", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  assert(
    typeof deployer.transferFiles === "function",
    "transferFiles should be a function"
  );
});

test("transferFiles - throws PathNotFoundError for non-existent path", async () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });

  // Mock connect to avoid actual SSH connection
  deployer.ssh = {
    execCommand: async () => ({ code: 0 }),
    putFile: async () => {},
  };

  try {
    await deployer.transferFiles("/nonexistent/path");
    throw new Error("Should have thrown PathNotFoundError");
  } catch (error) {
    if (!(error instanceof PathNotFoundError)) {
      throw new Error(
        `Expected PathNotFoundError, got ${error.constructor.name}`
      );
    }
  }
});

// Test 11: deploy (mock test)
test("deploy - method exists and is callable", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
  });
  assert(typeof deployer.deploy === "function", "deploy should be a function");
});

test("deploy - throws DeploymentError when step fails (non-verbose)", async () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
    verbose: false,
  });

  // Mock connect
  deployer.ssh = {
    connect: async () => {},
    execCommand: async () => ({ code: 0 }),
    dispose: () => {},
  };

  const steps = [
    {
      step: "Failing step",
      command: async () => {
        throw new Error("Step failed");
      },
    },
  ];

  try {
    await deployer.deploy(steps);
    throw new Error("Should have thrown DeploymentError");
  } catch (error) {
    if (!(error instanceof DeploymentError)) {
      throw new Error(
        `Expected DeploymentError, got ${error.constructor.name}`
      );
    }
  }
});

// Test 12: Verbose logging
test("log - includes timestamp when verbose is true", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
    verbose: true,
  });

  // Capture console.log
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
  };

  deployer.log("Test message", "blue");
  console.log = originalLog;

  assert(logs.length > 0, "Should log message");
  assert(logs[0].includes("Test message"), "Should include message");
  assert(logs[0].includes("["), "Should include timestamp bracket");
});

test("log - no timestamp when verbose is false", () => {
  const deployer = new Daffodil({
    remoteUser: TEST_CONFIG.remoteUser,
    remoteHost: TEST_CONFIG.remoteHost,
    verbose: false,
  });

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    // Join args and strip ANSI color codes for testing
    const logMessage = args.join(" ");
    // Remove ANSI escape codes (simple regex)
    const cleanMessage = logMessage.replace(/\u001b\[[0-9;]*m/g, "");
    logs.push(cleanMessage);
  };

  deployer.log("Test message", "blue");
  console.log = originalLog;

  assert(logs.length > 0, "Should log message");
  assert(logs[0].includes("Test message"), "Should include message");
  // Check that it doesn't contain ISO timestamp pattern (YYYY-MM-DDTHH:mm:ss)
  const isoDatePattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assert(!isoDatePattern.test(logs[0]), "Should not include ISO timestamp");
  // Also check no bracket with timestamp-like content
  const timestampBracketPattern = /\[\d{4}-\d{2}-\d{2}/;
  assert(
    !timestampBracketPattern.test(logs[0]),
    "Should not include timestamp bracket"
  );
});

// Test Summary
console.log("\n" + "=".repeat(50));
console.log("\n📊 Test Results:");
console.log(`✓ Passed: ${testsPassed}`);
console.log(`✗ Failed: ${testsFailed}`);

if (failures.length > 0) {
  console.log("\n❌ Failed Tests:");
  failures.forEach(({ name, error }) => {
    console.log(`  - ${name}: ${error}`);
  });
}

if (testsFailed === 0) {
  console.log("\n✅ All tests passed!");
  process.exit(0);
} else {
  console.log("\n❌ Some tests failed!");
  process.exit(1);
}
