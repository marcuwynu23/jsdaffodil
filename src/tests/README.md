# Test Suite for JSDaffodil

This directory contains comprehensive test suites for the JSDaffodil library, organized by module system.

## Directory Structure

```
tests/
├── esm/
│   └── test-daffodil.mjs    # ESM module tests
├── commonjs/
│   └── test-daffodil.cjs    # CommonJS module tests
└── README.md                 # This file
```

## Running Tests

### Run All Tests

```bash
npm test
```

This will run both ESM and CommonJS test suites.

### Run ESM Tests Only

```bash
npm run test:esm
# or
node tests/esm/test-daffodil.mjs
```

### Run CommonJS Tests Only

```bash
npm run test:common
# or
node tests/commonjs/test-daffodil.cjs
```

## Test Coverage

The test suite covers:

### Core Functionality

- ✅ Constructor with various configurations
- ✅ `setOption()` method
- ✅ `getTimestamp()` method
- ✅ `getHumanReadableError()` method
- ✅ `loadIgnoreList()` method
- ✅ `log()` method with verbose mode

### Error Handling

- ✅ `PathNotFoundError` class
- ✅ `TransferError` class
- ✅ `DeploymentError` class
- ✅ Human-readable error messages
- ✅ Error message formatting for different error types

### Methods (Existence and Callability)

- ✅ `runCommand()` method
- ✅ `sshCommand()` method
- ✅ `makeDirectory()` method
- ✅ `transferFiles()` method
- ✅ `deploy()` method

### Verbose Mode

- ✅ Logging with timestamps when verbose is true
- ✅ Logging without timestamps when verbose is false
- ✅ Error handling in verbose and non-verbose modes

### Integration Tests

- ✅ `transferFiles()` throws `PathNotFoundError` for non-existent paths
- ✅ `deploy()` throws `DeploymentError` when steps fail

## Test Configuration

Tests use environment variables for configuration (with defaults):

- `TEST_REMOTE_USER` - SSH username (default: "testuser")
- `TEST_REMOTE_HOST` - SSH hostname (default: "test.example.com")
- `TEST_REMOTE_PATH` - Remote path (default: "/tmp/test")
- `TEST_REMOTE_PORT` - SSH port (default: 22)

## Notes

- Most tests are unit tests that don't require actual SSH connections
- Some tests mock SSH connections to avoid network dependencies
- Tests that require file system operations use temporary files that are cleaned up
- The test suite uses a simple test runner (no external testing framework required)

## Adding New Tests

To add new tests:

1. **ESM Tests**: Add to `tests/esm/test-daffodil.mjs`
2. **CommonJS Tests**: Add to `tests/commonjs/test-daffodil.cjs`

Use the `test()` function to define tests:

```javascript
test("Test name", () => {
  // Test implementation
  assert(condition, "Error message");
  assertEqual(actual, expected, "Error message");
});
```

For async tests:

```javascript
test("Async test name", async () => {
  // Async test implementation
  try {
    await someAsyncOperation();
  } catch (error) {
    // Handle error
  }
});
```
