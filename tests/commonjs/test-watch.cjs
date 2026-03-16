// CommonJS Tests for Daffodil.watch() (using dynamic import of ESM entry)
let testsPassed = 0;
let testsFailed = 0;
const failures = [];

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

console.log("\n🧪 Running CommonJS watch() Tests for JSDaffodil\n");
console.log("=".repeat(50));

(async () => {
  const { Daffodil } = await import("../../src/index.js");

  const TEST_CONFIG = {
    remoteUser: "testuser",
    remoteHost: "test.example.com",
  };

  test("watch - method exists on Daffodil instances", () => {
    const deployer = new Daffodil({
      remoteUser: TEST_CONFIG.remoteUser,
      remoteHost: TEST_CONFIG.remoteHost,
    });
    assert(typeof deployer.watch === "function", "watch should be a function");
  });

  test("watch - returns watcher with deploy and stop", () => {
    const deployer = new Daffodil({
      remoteUser: TEST_CONFIG.remoteUser,
      remoteHost: TEST_CONFIG.remoteHost,
    });
    const watcher = deployer.watch({ paths: ["./dist"] });
    assert(watcher, "watch() should return a watcher object");
    assertEqual(
      typeof watcher.deploy,
      "function",
      "watcher.deploy should be a function"
    );
    assertEqual(
      typeof watcher.stop,
      "function",
      "watcher.stop should be a function"
    );
  });

  test("watch - throws when deploy() called with empty steps", async () => {
    const deployer = new Daffodil({
      remoteUser: TEST_CONFIG.remoteUser,
      remoteHost: TEST_CONFIG.remoteHost,
    });
    const watcher = deployer.watch({});

    let threw = false;
    try {
      await watcher.deploy([]);
    } catch (error) {
      threw = true;
      assert(
        error.message.includes("requires a non-empty steps array"),
        "deploy() should validate steps array"
      );
    }
    assert(threw, "deploy([]) should throw");
  });

  console.log("\n" + "=".repeat(50));
  console.log("\n📊 Test Results (watch - CommonJS):");
  console.log(`✓ Passed: ${testsPassed}`);
  console.log(`✗ Failed: ${testsFailed}`);

  if (failures.length > 0) {
    console.log("\n❌ Failed Tests:");
    failures.forEach(({ name, error }) => {
      console.log(`  - ${name}: ${error}`);
    });
  }

  if (testsFailed === 0) {
    console.log("\n✅ All watch() tests (CommonJS) passed!");
    process.exit(0);
  } else {
    console.log("\n❌ Some watch() tests (CommonJS) failed!");
    process.exit(1);
  }
})();
