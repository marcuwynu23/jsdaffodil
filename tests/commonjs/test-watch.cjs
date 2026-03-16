// CommonJS Tests for Daffodil.watch() using a simple custom runner
const TEST_CONFIG = {
  remoteUser: "testuser",
  remoteHost: "test.example.com",
};

let testsPassed = 0;
let testsFailed = 0;
const failures = [];

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      testsPassed++;
      console.log(`✓ ${name}`);
    })
    .catch((error) => {
      testsFailed++;
      failures.push({ name, error: error.message });
      console.error(`✗ ${name}`);
      console.error(`  Error: ${error.message}`);
    });
}

console.log("\n🧪 Running CommonJS watch() Tests for JSDaffodil\n");
console.log("=".repeat(50));

(async () => {
  const { Daffodil } = await import("../../src/index.js");

  test("watch - method exists on Daffodil instances (CJS)", () => {
    const deployer = new Daffodil({
      remoteUser: TEST_CONFIG.remoteUser,
      remoteHost: TEST_CONFIG.remoteHost,
    });
    if (typeof deployer.watch !== "function") {
      throw new Error("watch should be a function");
    }
  });

  test("watch - returns watcher with deploy and stop (CJS)", () => {
    const deployer = new Daffodil({
      remoteUser: TEST_CONFIG.remoteUser,
      remoteHost: TEST_CONFIG.remoteHost,
    });
    const watcher = deployer.watch({ paths: ["./dist"] });
    if (!watcher) {
      throw new Error("watch() should return a watcher object");
    }
    if (typeof watcher.deploy !== "function") {
      throw new Error("watcher.deploy should be a function");
    }
    if (typeof watcher.stop !== "function") {
      throw new Error("watcher.stop should be a function");
    }
  });

  test(
    "watch - throws when deploy() called with empty steps (CJS)",
    async () => {
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
        if (
          !error.message.includes("requires a non-empty steps array")
        ) {
          throw new Error(
            "deploy() should validate steps array and mention non-empty requirement"
          );
        }
      }
      if (!threw) {
        throw new Error("deploy([]) should throw");
      }
    }
  );

  // Small delay to allow async tests to finish
  setTimeout(() => {
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

    process.exit(testsFailed === 0 ? 0 : 1);
  }, 100);
})();
