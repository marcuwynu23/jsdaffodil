// Idempotent provisioning tests for JSDaffodil (fake SSH backend + CLI checks)
import { Daffodil, DeploymentError } from "../../src/index.js";
import crypto from "crypto";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

let testsPassed = 0;
let testsFailed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
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
  if (!condition) throw new Error(message || "Assertion failed");
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message ||
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

class FakeRemote {
  constructor({
    files = {},
    dirs = [],
    users = [],
    packages = [],
    services = {},
    home = "/home/deployer",
    packageManager = "apt",
    serviceManager = "systemctl",
    user = "deployer",
  } = {}) {
    this.files = new Map();
    for (const [key, value] of Object.entries(files)) {
      this.files.set(key, Buffer.from(value, "utf8"));
    }
    this.stats = new Map();
    this.dirs = new Set(dirs);
    this.users = new Set(users);
    this.packages = new Set(packages);
    this.services = new Map(Object.entries(services));
    this.home = home;
    this.packageManager = packageManager;
    this.serviceManager = serviceManager;
    this.user = user;
    this.commands = [];
    this.putFiles = [];
    this.mutations = 0;
  }

  out(code = 0, stdout = "", stderr = "") {
    return { code, stdout, stderr };
  }

  async connect() {}

  dispose() {}

  async putFile(localPath, remotePath) {
    const content = await fs.readFile(localPath);
    this.files.set(remotePath, content);
    if (!this.stats.has(remotePath)) {
      this.stats.set(remotePath, {
        mode: "644",
        owner: `${this.user}:${this.user}`,
      });
    }
    this.putFiles.push(remotePath);
    this.mutations++;
  }

  async execCommand(cmd) {
    this.commands.push(cmd);
    let m;

    if (/printf '%s' "\$HOME"/.test(cmd)) {
      return this.out(0, this.home);
    }

    m = cmd.match(
      /^if \[ -f '([^']+)' \]; then cat '([^']+)';(?: else exit 3;)? fi$/
    );
    if (m) {
      const buf = this.files.get(m[1]);
      if (!buf) return this.out(cmd.includes("else exit 3") ? 3 : 0, "");
      return this.out(0, buf.toString("utf8"));
    }

    if (cmd.includes("(sha256sum")) {
      m = cmd.match(/if \[ -f '([^']+)' \]/);
      const buf = m ? this.files.get(m[1]) : null;
      if (!buf) return this.out(3);
      const hash = crypto.createHash("sha256").update(buf).digest("hex");
      return this.out(0, `${hash}\n`);
    }

    if (cmd.includes("stat -c '%a %U:%G'")) {
      m = cmd.match(/if \[ -f '([^']+)' \]/);
      if (!m || !this.files.has(m[1])) return this.out(3);
      const st = this.stats.get(m[1]) || {
        mode: "644",
        owner: `${this.user}:${this.user}`,
      };
      return this.out(0, `${st.mode} ${st.owner}\n`);
    }

    m = cmd.match(/^chmod '([^']+)' '([^']+)'$/);
    if (m) {
      const st = this.stats.get(m[2]) || {
        mode: "644",
        owner: `${this.user}:${this.user}`,
      };
      st.mode = parseInt(m[1], 8).toString(8);
      this.stats.set(m[2], st);
      this.mutations++;
      return this.out(0);
    }

    m = cmd.match(/^chown '([^']+)' '([^']+)'$/);
    if (m) {
      const st = this.stats.get(m[2]) || {
        mode: "644",
        owner: `${this.user}:${this.user}`,
      };
      st.owner = m[1];
      this.stats.set(m[2], st);
      this.mutations++;
      return this.out(0);
    }

    m = cmd.match(/^\[ -d '([^']+)' \]$/);
    if (m) return this.out(this.dirs.has(m[1]) ? 0 : 1);

    m = cmd.match(/^mkdir -p '([^']+)'(?: \|\| true)?$/);
    if (m) {
      if (!this.dirs.has(m[1])) {
        this.dirs.add(m[1]);
        this.mutations++;
      }
      return this.out(0);
    }

    m = cmd.match(/^id -u '([^']+)' >\/dev\/null 2>&1$/);
    if (m) return this.out(this.users.has(m[1]) ? 0 : 1);

    if (cmd.includes("useradd")) {
      m = cmd.match(
        /useradd(?: --system)? -m '([^']+)'|useradd(?: --system)? '([^']+)'/
      );
      const name = m && (m[1] || m[2]);
      if (name) {
        this.users.add(name);
        this.mutations++;
        return this.out(0);
      }
    }

    if (cmd.includes("then echo apt;")) {
      return this.out(0, `${this.packageManager}\n`);
    }

    if (cmd.includes("dpkg-query")) {
      m = cmd.match(/-- '([^']+)'/);
      return this.out(m && this.packages.has(m[1]) ? 0 : 1);
    }
    if (/^rpm -q -- '([^']+)'/.test(cmd)) {
      m = cmd.match(/^rpm -q -- '([^']+)'/);
      return this.out(this.packages.has(m[1]) ? 0 : 1);
    }
    if (/^apk info -e -- '([^']+)'/.test(cmd)) {
      m = cmd.match(/^apk info -e -- '([^']+)'/);
      return this.out(this.packages.has(m[1]) ? 0 : 1);
    }
    if (cmd.includes("brew list")) {
      m = cmd.match(/brew list --formula '([^']+)'/);
      return this.out(m && this.packages.has(m[1]) ? 0 : 1);
    }

    m = cmd.match(/apt-get install -y -q -- '([^']+)'/);
    if (m) {
      this.packages.add(m[1]);
      this.mutations++;
      return this.out(0);
    }
    m = cmd.match(/(?:dnf|yum) install -y '([^']+)'/);
    if (m) {
      this.packages.add(m[1]);
      this.mutations++;
      return this.out(0);
    }
    m = cmd.match(/apk add --no-cache '([^']+)'/);
    if (m) {
      this.packages.add(m[1]);
      this.mutations++;
      return this.out(0);
    }
    m = cmd.match(/brew install '([^']+)'/);
    if (m) {
      this.packages.add(m[1]);
      this.mutations++;
      return this.out(0);
    }

    if (cmd.includes("echo systemctl")) {
      return this.out(0, `${this.serviceManager}\n`);
    }

    m = cmd.match(/^systemctl is-enabled '([^']+)' 2>\/dev\/null$/);
    if (m) {
      return this.services.get(m[1])
        ? this.out(0, "enabled\n")
        : this.out(1, "disabled\n");
    }
    m = cmd.match(/^systemctl (enable|disable) '([^']+)'$/);
    if (m) {
      this.services.set(m[2], m[1] === "enable");
      this.mutations++;
      return this.out(0);
    }

    if (cmd.includes("rc-update show")) {
      m = cmd.match(/grep -qw -- '([^']+)'/);
      return this.out(m && this.services.get(m[1]) ? 0 : 1);
    }
    m = cmd.match(/^rc-update (add|del) '([^']+)'$/);
    if (m) {
      this.services.set(m[2], m[1] === "add");
      this.mutations++;
      return this.out(0);
    }

    if (cmd.includes("tar -xzf")) return this.out(0);
    if (/^rm -f /.test(cmd)) return this.out(0);

    return this.out(0, "");
  }
}

async function makeDeployer({
  check = false,
  remote = null,
  ignoreFile = null,
} = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jsdaffodil-idem-"));
  const ignore = ignoreFile || path.join(dir, ".scpignore");
  if (!(await fs.pathExists(ignore))) {
    await fs.writeFile(ignore, "# test ignore\n");
  }
  const keyPath = path.join(dir, "id_test");
  await fs.writeFile(keyPath, "dummy-key-material", "utf8");

  const deployer = new Daffodil({
    remoteUser: "deployer",
    remoteHost: "127.0.0.1",
    remotePath: "/home/deployer",
    port: 2222,
    ignoreFile: ignore,
    check,
    sshKeyPath: keyPath,
  });

  const fake = remote || new FakeRemote();
  deployer.ssh = fake;
  deployer.__testDir = dir;
  deployer.__fake = fake;
  return deployer;
}

async function makeFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jsdaffodil-fixture-"));
  await fs.outputFile(path.join(dir, "index.html"), "<html>ok</html>");
  await fs.outputFile(path.join(dir, "css", "app.css"), "body{}");
  return dir;
}

console.log("\n🧪 Running Idempotency Tests for JSDaffodil\n");
console.log("=".repeat(50));

await test("ensureLineInFile - appends once and is idempotent", async () => {
  const d = await makeDeployer();
  const target = "/home/deployer/.bashrc";

  const first = await d.ensureLineInFile(target, "export APP_ENV=production");
  assertEqual(first.changed, true, "first apply should change");
  assertEqual(first.status, "changed");

  const second = await d.ensureLineInFile(target, "export APP_ENV=production");
  assertEqual(second.changed, false, "second apply must not change");
  assertEqual(second.status, "ok");

  const content = d.__fake.files.get(target).toString("utf8");
  const occurrences = content.split("export APP_ENV=production").length - 1;
  assertEqual(occurrences, 1, "line must never be duplicated");
  await fs.remove(d.__testDir);
});

await test("ensureLineInFile - appends to an existing file without clobbering", async () => {
  const d = await makeDeployer({
    remote: new FakeRemote({
      files: { "/home/deployer/.bashrc": "alias ll='ls -l'\n" },
    }),
  });
  await d.ensureLineInFile("/home/deployer/.bashrc", "export FOO=bar");
  const content = d.__fake.files.get("/home/deployer/.bashrc").toString("utf8");
  assert(
    content.includes("alias ll='ls -l'"),
    "existing content must be preserved"
  );
  assert(content.includes("export FOO=bar"), "new line must be present");
  await fs.remove(d.__testDir);
});

await test("ensureLineInFile - managed marker block replaces instead of duplicating", async () => {
  const d = await makeDeployer();
  const target = "/home/deployer/app.env";
  const marker = "# {mark} daffodil-managed";

  await d.ensureLineInFile(target, "A=1", { marker });
  await d.ensureLineInFile(target, "A=1", { marker });
  let content = d.__fake.files.get(target).toString("utf8");
  assertEqual(
    content.split("daffodil-managed").length - 1,
    2,
    "single BEGIN/END block"
  );
  assert(content.includes("A=1"), "line present");

  const replaced = await d.ensureLineInFile(target, "A=2", { marker });
  assertEqual(replaced.changed, true, "changing managed line reports change");
  content = d.__fake.files.get(target).toString("utf8");
  assert(!content.includes("A=1"), "old line must be replaced");
  assert(content.includes("A=2"), "new line must be present");
  assertEqual(content.split("A=2").length - 1, 1, "no duplicate managed lines");

  const stable = await d.ensureLineInFile(target, "A=2", { marker });
  assertEqual(stable.changed, false, "re-apply with same content is stable");
  await fs.remove(d.__testDir);
});

await test("writeFileIfChanged - writes once, then detects no change", async () => {
  const d = await makeDeployer();
  const target = "/home/deployer/app.conf";
  const body = "key=value\n";

  const first = await d.writeFileIfChanged(target, body, { mode: "0644" });
  assertEqual(first.changed, true);
  const writesAfterFirst = d.__fake.putFiles.length;
  assertEqual(writesAfterFirst, 1);

  const second = await d.writeFileIfChanged(target, body, { mode: "0644" });
  assertEqual(second.changed, false, "identical content must not rewrite");
  assertEqual(
    d.__fake.putFiles.length,
    writesAfterFirst,
    "no additional remote writes"
  );

  const third = await d.writeFileIfChanged(target, "key=other\n", {
    mode: "0644",
  });
  assertEqual(third.changed, true, "different content must rewrite");
  assertEqual(d.__fake.files.get(target).toString("utf8"), "key=other\n");
  await fs.remove(d.__testDir);
});

await test("writeFileIfChanged - detects mode drift", async () => {
  const d = await makeDeployer();
  const target = "/home/deployer/secret.conf";
  await d.writeFileIfChanged(target, "x\n", { mode: "0600" });
  assertEqual(d.__fake.stats.get(target).mode, "600");

  const again = await d.writeFileIfChanged(target, "x\n", { mode: "0600" });
  assertEqual(again.changed, false, "matching mode is stable");

  const drifted = await d.writeFileIfChanged(target, "x\n", { mode: "0644" });
  assertEqual(drifted.changed, true, "mode mismatch reports change");
  assertEqual(d.__fake.stats.get(target).mode, "644");
  await fs.remove(d.__testDir);
});

await test("ensurePackage - installs once, second run is a no-op", async () => {
  const d = await makeDeployer({
    remote: new FakeRemote({ packages: ["curl"] }),
  });

  const existing = await d.ensurePackage("curl");
  assertEqual(existing.changed, false, "already-installed package is stable");

  const missing = await d.ensurePackage("nginx");
  assertEqual(missing.changed, true, "missing package should install");
  assert(d.__fake.packages.has("nginx"), "package recorded as installed");

  const installs = d.__fake.commands.filter((c) =>
    c.includes("apt-get install")
  ).length;
  assertEqual(installs, 1, "install command must run exactly once");

  const again = await d.ensurePackage("nginx");
  assertEqual(again.changed, false, "second ensure is idempotent");
  assertEqual(
    d.__fake.commands.filter((c) => c.includes("apt-get install")).length,
    1,
    "no duplicate installs"
  );
  await fs.remove(d.__testDir);
});

await test("ensureUser - creates once, second run is a no-op", async () => {
  const d = await makeDeployer({
    remote: new FakeRemote({ users: ["existing"] }),
  });

  const present = await d.ensureUser("existing");
  assertEqual(present.changed, false);

  const created = await d.ensureUser("deployer2");
  assertEqual(created.changed, true);
  assert(d.__fake.users.has("deployer2"));

  const again = await d.ensureUser("deployer2");
  assertEqual(again.changed, false, "existing user reports no change");
  assertEqual(
    d.__fake.commands.filter((c) => c.includes("useradd")).length,
    1,
    "useradd runs exactly once"
  );
  await fs.remove(d.__testDir);
});

await test("ensureServiceEnabled - enables once, supports disable", async () => {
  const d = await makeDeployer({
    remote: new FakeRemote({ services: { nginx: false, postgres: true } }),
  });

  const enabledAlready = await d.ensureServiceEnabled("postgres");
  assertEqual(enabledAlready.changed, false);

  const enable = await d.ensureServiceEnabled("nginx");
  assertEqual(enable.changed, true);
  assertEqual(d.__fake.services.get("nginx"), true);

  const again = await d.ensureServiceEnabled("nginx");
  assertEqual(again.changed, false, "enabled service is stable");

  const disable = await d.ensureServiceEnabled("nginx", { enabled: false });
  assertEqual(disable.changed, true);
  assertEqual(d.__fake.services.get("nginx"), false);
  await fs.remove(d.__testDir);
});

await test("ensureDirectory - creates once (mkdir -p semantics with change detection)", async () => {
  const d = await makeDeployer({
    remote: new FakeRemote({ dirs: ["/home/deployer/existing"] }),
  });

  const present = await d.ensureDirectory("/home/deployer/existing");
  assertEqual(present.changed, false);

  const created = await d.ensureDirectory("/home/deployer/newdir");
  assertEqual(created.changed, true);
  assert(d.__fake.dirs.has("/home/deployer/newdir"));

  const again = await d.ensureDirectory("/home/deployer/newdir");
  assertEqual(again.changed, false);

  const relative = await d.ensureDirectory("relative-dir");
  assertEqual(relative.changed, true);
  assert(
    d.__fake.dirs.has("/home/deployer/relative-dir"),
    "relative paths resolve against remotePath"
  );
  await fs.remove(d.__testDir);
});

await test("transferFiles - skips upload when manifest is unchanged", async () => {
  const d = await makeDeployer();
  const fixture = await makeFixture();

  const first = await d.transferFiles(fixture, "/opt/site");
  assertEqual(first.changed, true, "first transfer reports change");
  const afterFirst = d.__fake.putFiles.length;
  assert(afterFirst >= 2, "archive and manifest were uploaded");

  const second = await d.transferFiles(fixture, "/opt/site");
  assertEqual(second.changed, false, "unchanged content must skip transfer");
  assertEqual(d.__fake.putFiles.length, afterFirst, "no additional uploads");

  await fs.outputFile(path.join(fixture, "index.html"), "<html>changed</html>");
  const third = await d.transferFiles(fixture, "/opt/site");
  assertEqual(third.changed, true, "modified content must transfer again");

  await fs.remove(fixture);
  await fs.remove(d.__testDir);
});

await test("transferFiles - force option ignores the manifest", async () => {
  const d = await makeDeployer();
  const fixture = await makeFixture();

  await d.transferFiles(fixture, "/opt/site");
  const afterFirst = d.__fake.putFiles.length;
  const forced = await d.transferFiles(fixture, "/opt/site", { force: true });
  assertEqual(forced.changed, true, "force re-runs the transfer");
  assert(d.__fake.putFiles.length > afterFirst, "force uploads again");
  await fs.remove(fixture);
  await fs.remove(d.__testDir);
});

await test("sshCommand - returns structured result and skips in check mode", async () => {
  const d = await makeDeployer();
  const ok = await d.sshCommand("echo hello");
  assertEqual(ok.status, "ok");
  assertEqual(ok.changed, false);

  d.check = true;
  const before = d.__fake.commands.length;
  const skipped = await d.sshCommand("touch /tmp/nope");
  assertEqual(skipped.status, "skipped");
  assertEqual(
    d.__fake.commands.length,
    before,
    "check mode must not execute remote commands"
  );
  await fs.remove(d.__testDir);
});

await test("deploy - returns structured results and is idempotent across runs", async () => {
  const d = await makeDeployer({
    remote: new FakeRemote({ packages: ["curl"], dirs: ["/home/deployer"] }),
  });
  const fixture = await makeFixture();

  const steps = [
    { step: "App dir", command: () => d.ensureDirectory("/opt/app") },
    {
      step: "App config",
      command: () =>
        d.writeFileIfChanged("/opt/app/config.yaml", "a: 1\n", {
          mode: "0644",
        }),
    },
    {
      step: "Bashrc",
      command: () =>
        d.ensureLineInFile("/home/deployer/.bashrc", "export APP=1"),
    },
    { step: "Package", command: () => d.ensurePackage("curl") },
    { step: "Upload", command: () => d.transferFiles(fixture, "/opt/app") },
    {
      step: "Restart",
      when: "changed",
      command: () => d.sshCommand("restart-app"),
    },
  ];

  const first = await d.deploy(steps);
  assert(Array.isArray(first), "deploy returns an array of step results");
  assertEqual(first.length, steps.length);
  const firstChanged = first.filter((r) => r.changed);
  assert(firstChanged.length > 0, "first run reports changed steps");
  const restart1 = first.find((r) => r.name === "Restart");
  assertEqual(restart1.status, "ok", "restart runs when something changed");
  assert(
    d.__fake.commands.includes("restart-app"),
    "restart command must have executed"
  );

  const mutationsAfterFirst = d.__fake.mutations;
  const second = await d.deploy(steps);
  const secondChanged = second.filter((r) => r.changed);
  assertEqual(
    secondChanged.length,
    0,
    "second run must report zero changed steps"
  );
  const restart2 = second.find((r) => r.name === "Restart");
  assertEqual(
    restart2.status,
    "skipped",
    "when:changed step skips when nothing changed"
  );
  assert(
    d.__fake.mutations === mutationsAfterFirst,
    "second run must not mutate the remote state"
  );

  await fs.remove(fixture);
  await fs.remove(d.__testDir);
});

await test("deploy - check mode reports would-change without mutating", async () => {
  const d = await makeDeployer({
    check: true,
    remote: new FakeRemote({ packages: [] }),
  });
  const fixture = await makeFixture();

  const steps = [
    { step: "App dir", command: () => d.ensureDirectory("/opt/app") },
    {
      step: "App config",
      command: () => d.writeFileIfChanged("/opt/app/config.yaml", "a: 1\n"),
    },
    {
      step: "Bashrc",
      command: () =>
        d.ensureLineInFile("/home/deployer/.bashrc", "export APP=1"),
    },
    { step: "Package", command: () => d.ensurePackage("nginx") },
    { step: "User", command: () => d.ensureUser("newuser") },
    { step: "Service", command: () => d.ensureServiceEnabled("nginx") },
    { step: "Upload", command: () => d.transferFiles(fixture, "/opt/app") },
    { step: "Restart", command: () => d.sshCommand("restart-app") },
  ];

  const results = await d.deploy(steps);
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  assertEqual(byName["App dir"].status, "would-change");
  assertEqual(byName["App config"].status, "would-change");
  assertEqual(byName["Bashrc"].status, "would-change");
  assertEqual(byName["Package"].status, "would-change");
  assertEqual(byName["User"].status, "would-change");
  assertEqual(byName["Service"].status, "would-change");
  assertEqual(byName["Upload"].status, "would-change");
  assertEqual(
    byName["Restart"].status,
    "skipped",
    "raw ssh steps are skipped in check mode"
  );
  assertEqual(
    d.__fake.mutations,
    0,
    `check mode must not mutate the remote host (got ${d.__fake.mutations} mutations)`
  );

  await fs.remove(fixture);
  await fs.remove(d.__testDir);
});

await test("deploy - check mode reports ok once the host already matches", async () => {
  const apply = await makeDeployer({
    remote: new FakeRemote({ packages: ["curl"] }),
  });
  const steps = [
    { step: "App dir", command: () => apply.ensureDirectory("/opt/app") },
    {
      step: "App config",
      command: () => apply.writeFileIfChanged("/opt/app/config.yaml", "a: 1\n"),
    },
    { step: "Package", command: () => apply.ensurePackage("curl") },
  ];
  await apply.deploy(steps);
  await fs.remove(apply.__testDir);

  const d = await makeDeployer({ check: true, remote: apply.__fake });
  const results = await d.deploy([
    { step: "App dir", command: () => d.ensureDirectory("/opt/app") },
    {
      step: "App config",
      command: () => d.writeFileIfChanged("/opt/app/config.yaml", "a: 1\n"),
    },
    { step: "Package", command: () => d.ensurePackage("curl") },
  ]);
  const changed = results.filter((r) => r.changed);
  assertEqual(
    changed.length,
    0,
    "check mode on a converged host reports no changes"
  );
  assert(
    results.every((r) => r.status === "ok"),
    "all steps report ok"
  );
  await fs.remove(d.__testDir);
});

await test("deploy - attaches results and reports failed step", async () => {
  const d = await makeDeployer();
  const steps = [
    { step: "Good", command: () => d.ensureDirectory("/opt/ok") },
    {
      step: "Bad",
      command: async () => {
        throw new Error("boom");
      },
    },
    { step: "Never", command: () => d.ensureDirectory("/opt/never") },
  ];

  try {
    await d.deploy(steps);
    throw new Error("deploy should have failed");
  } catch (err) {
    assert(
      err instanceof DeploymentError,
      `expected DeploymentError, got ${err.constructor.name}`
    );
    assert(
      Array.isArray(err.results),
      "failure error should carry step results"
    );
    assertEqual(err.results.length, 2, "stops after the failing step");
    assertEqual(err.results[0].status, "changed");
    assertEqual(err.results[1].status, "failed");
  }
  assert(!d.__fake.dirs.has("/opt/never"), "steps after a failure do not run");
  await fs.remove(d.__testDir);
});

await test("deploy - rejects unsupported when conditions", async () => {
  const d = await makeDeployer();
  try {
    await d.deploy([
      { step: "x", when: "sometimes", command: async () => ({}) },
    ]);
    throw new Error("should have rejected invalid when");
  } catch (err) {
    assert(
      err.message.includes("Unsupported when condition"),
      `unexpected error: ${err.message}`
    );
  }
  await fs.remove(d.__testDir);
});

await test("setOption - toggles check mode", async () => {
  const d = await makeDeployer();
  assertEqual(d.check, false);
  d.setOption({ check: true });
  assertEqual(d.check, true);
  d.setOption({ verbose: true });
  assertEqual(d.verbose, true, "verbose toggle still works");
  assertEqual(d.check, true, "check survives unrelated setOption calls");
  await fs.remove(d.__testDir);
});

function runCli(args) {
  return spawnSync(process.execPath, ["bin/jsdaffodil.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function writeCliConfig(steps, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsdaffodil-cli-idem-"));
  const cfg = path.join(dir, ".daffodil.yml");
  const yamlLines = [
    "hosts:",
    "  - name: web1",
    "    host: 127.0.0.1",
    "    user: deploy",
    "    port: 1",
  ];
  if (extra.check) yamlLines.push("check: true");
  yamlLines.push("steps:");
  for (const step of steps) {
    let first = true;
    for (const [key, value] of Object.entries(step)) {
      if (value === undefined || value === null) continue;
      const prefix = first ? "  - " : "    ";
      yamlLines.push(`${prefix}${key}: ${JSON.stringify(value)}`);
      first = false;
    }
  }
  fs.writeFileSync(cfg, yamlLines.join("\n") + "\n", "utf8");
  return { dir, cfg };
}

await test("CLI - validates idempotent step fields without connecting", async () => {
  const cases = [
    [
      [{ name: "Bad", type: "lineinfile", line: "x=1" }],
      "lineinfile step requires 'path'",
    ],
    [
      [{ name: "Bad", type: "copy", content: "x" }],
      "copy step requires 'path'",
    ],
    [[{ name: "Bad", type: "package" }], "package step requires 'package'"],
    [[{ name: "Bad", type: "user" }], "user step requires 'user'"],
    [[{ name: "Bad", type: "service" }], "service step requires 'service'"],
    [[{ name: "Bad", type: "directory" }], "directory step requires 'path'"],
    [
      [{ name: "Bad", type: "ssh", command: "ls", when: "sometimes" }],
      "Unsupported when condition",
    ],
  ];
  for (const [steps, expected] of cases) {
    const { dir, cfg } = writeCliConfig(steps);
    const res = runCli(["--config", cfg]);
    const output = `${res.stdout || ""}${res.stderr || ""}`;
    assert(res.status !== 0, `expected non-zero exit for ${expected}`);
    assert(
      output.includes(expected),
      `expected "${expected}" in output:\n${output}`
    );
    await fs.remove(dir);
  }
});

await test("CLI - accepts new idempotent step types and --check flag", async () => {
  const steps = [
    { name: "Install", type: "package", package: "nginx" },
    { name: "User", type: "user", user: "deployer" },
    { name: "Dir", type: "directory", path: "/srv/app" },
    { name: "Conf", type: "copy", path: "/etc/app.conf", content: "a=1" },
    {
      name: "Env",
      type: "lineinfile",
      path: "/home/deploy/.bashrc",
      line: "export A=1",
    },
    { name: "Svc", type: "service", service: "nginx" },
  ];
  const { dir, cfg } = writeCliConfig(steps);
  const res = runCli(["--config", cfg, "--check"]);
  const output = `${res.stdout || ""}${res.stderr || ""}`;
  assert(res.status !== 0, "connection to dummy host should fail");
  assert(
    !output.includes("Unsupported step type"),
    `step types must parse:\n${output}`
  );
  assert(!output.includes("step requires"), `fields must validate:\n${output}`);
  await fs.remove(dir);
});

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
