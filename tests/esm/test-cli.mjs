import { spawnSync } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function test(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    testsFailed++;
    console.error(`✗ ${name}`);
    console.error(`  Error: ${err.message}`);
  }
}

function runCli(args) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return spawnSync(process.execPath, ["bin/jsdaffodil.mjs", ...args], {
    cwd: path.resolve(path.join(__dirname, "..", "..")),
    encoding: "utf8",
  });
}

console.log("\n🧪 Running ESM CLI Tests for JSDaffodil\n");
console.log("=".repeat(50));

test("CLI fails without --config", () => {
  const res = runCli([]);
  assert(res.status !== 0, "Expected non-zero exit code");
});

test("CLI fails when YAML has no hosts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsdaffodil-cli-"));
  const cfg = path.join(dir, ".daffodil.yml");
  fs.writeFileSync(
    cfg,
    `steps:\n  - name: Build\n    type: local\n    command: echo hello\n`,
    "utf8"
  );
  const res = runCli(["--config", cfg]);
  assert(res.status !== 0, "Expected non-zero exit code");
  assert(
    (res.stderr || "").includes("No hosts found in YAML config"),
    "Expected missing hosts error"
  );
  fs.removeSync(dir);
});

test("CLI fails for unsupported step type", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsdaffodil-cli-"));
  const cfg = path.join(dir, ".daffodil.yml");
  fs.writeFileSync(
    cfg,
    `hosts:\n  - name: web1\n    host: 127.0.0.1\n    user: deploy\nsteps:\n  - name: Invalid\n    type: unknown\n`,
    "utf8"
  );
  const res = runCli(["--config", cfg]);
  assert(res.status !== 0, "Expected non-zero exit code");
  assert(
    (res.stderr || "").includes("Unsupported step type"),
    "Expected unsupported step error"
  );
  fs.removeSync(dir);
});

test("CLI reads hosts from inventory.yml reference", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsdaffodil-cli-"));
  const cfg = path.join(dir, ".daffodil.yml");
  const inv = path.join(dir, "inventory.yml");
  fs.writeFileSync(
    inv,
    `hosts:\n  - name: web1\n    host: 127.0.0.1\n    user: deploy\n`,
    "utf8"
  );
  fs.writeFileSync(
    cfg,
    `inventoryFile: inventory.yml\nsteps:\n  - name: Invalid\n    type: unknown\n`,
    "utf8"
  );
  const res = runCli(["--config", cfg]);
  assert(res.status !== 0, "Expected non-zero exit code");
  assert(
    (res.stderr || "").includes("Unsupported step type"),
    "Expected parser to load inventory and proceed to step validation"
  );
  fs.removeSync(dir);
});

console.log("\n" + "=".repeat(50));
console.log(`✓ Passed: ${testsPassed}`);
console.log(`✗ Failed: ${testsFailed}`);
process.exit(testsFailed === 0 ? 0 : 1);
