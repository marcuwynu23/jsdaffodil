#!/usr/bin/env node
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { Daffodil, parseInventoryFile } from "../src/index.js";

function loadConfig(configPath) {
  const full = path.resolve(configPath);
  const raw = fs.readFileSync(full, "utf8");
  const cfg = yaml.load(raw) || {};
  cfg.__configDir = path.dirname(full);
  return cfg;
}

function loadInventoryHosts(config) {
  const inventoryFile = config.inventoryFile || config.inventoryYml;
  if (!inventoryFile) return [];
  const fullPath = path.isAbsolute(inventoryFile)
    ? inventoryFile
    : path.join(config.__configDir || process.cwd(), inventoryFile);
  const group = config.inventoryGroup || config.inventory_group || null;
  return parseInventoryFile(fullPath, group);
}

function normalizeHosts(config) {
  if (Array.isArray(config.hosts) && config.hosts.length > 0)
    return config.hosts;
  const inventoryHosts = loadInventoryHosts(config);
  if (inventoryHosts.length > 0) return inventoryHosts;
  if (config.remoteHost && config.remoteUser) {
    return [
      {
        name: "default",
        host: config.remoteHost,
        user: config.remoteUser,
        port: config.port,
        remotePath: config.remotePath,
      },
    ];
  }
  return [];
}

function requireField(step, type, field) {
  const value = step[field];
  if (value === undefined || value === null || value === "") {
    throw new Error(`${type} step requires '${field}'`);
  }
  return value;
}

function buildSteps(deployer, steps = []) {
  return steps.map((s) => {
    const stepName = s.name || s.step || s.type || "step";
    const when = s.when;
    if (when && when !== "changed" && when !== "always") {
      throw new Error(`Unsupported when condition: ${when}`);
    }
    if (s.type === "local") {
      return { step: stepName, when, command: () => deployer.local(s.command) };
    }
    if (s.type === "ssh") {
      return {
        step: stepName,
        when,
        command: () => deployer.sshCommand(s.command),
      };
    }
    if (s.type === "transfer") {
      return {
        step: stepName,
        when,
        command: () =>
          deployer.transferFiles(s.localPath, s.destinationPath, {
            force: Boolean(s.force),
          }),
      };
    }
    if (s.type === "lineinfile") {
      const target = requireField(s, "lineinfile", "path");
      const line = requireField(s, "lineinfile", "line");
      return {
        step: stepName,
        when,
        command: () =>
          deployer.ensureLineInFile(target, line, { marker: s.marker }),
      };
    }
    if (s.type === "copy") {
      const target = requireField(s, "copy", "path");
      let content = s.content;
      if (content === undefined || content === null) {
        const src = requireField(s, "copy", "src");
        content = fs.readFileSync(
          path.isAbsolute(src)
            ? src
            : path.join(deployer.__configDir || process.cwd(), src),
          "utf8"
        );
      }
      return {
        step: stepName,
        when,
        command: () =>
          deployer.writeFileIfChanged(target, content, {
            mode: s.mode,
            owner: s.owner,
          }),
      };
    }
    if (s.type === "package") {
      const pkg = requireField(s, "package", "package");
      return {
        step: stepName,
        when,
        command: () => deployer.ensurePackage(pkg),
      };
    }
    if (s.type === "user") {
      const user = requireField(s, "user", "user");
      return {
        step: stepName,
        when,
        command: () => deployer.ensureUser(user, { system: Boolean(s.system) }),
      };
    }
    if (s.type === "service") {
      const service = requireField(s, "service", "service");
      return {
        step: stepName,
        when,
        command: () =>
          deployer.ensureServiceEnabled(service, {
            enabled: s.enabled !== false,
          }),
      };
    }
    if (s.type === "directory") {
      const target = requireField(s, "directory", "path");
      return {
        step: stepName,
        when,
        command: () => deployer.ensureDirectory(target),
      };
    }
    throw new Error(`Unsupported step type: ${s.type}`);
  });
}

const SUPPORTED_STEP_TYPES = [
  "local",
  "ssh",
  "transfer",
  "lineinfile",
  "copy",
  "package",
  "user",
  "service",
  "directory",
];

function validateSteps(steps) {
  for (const s of steps) {
    const stype = (s.type || "").toString().trim().toLowerCase();
    if (!SUPPORTED_STEP_TYPES.includes(stype)) {
      throw new Error(`Unsupported step type: ${s.type}`);
    }
  }
}

function printSummary(results) {
  const counts = {
    changed: 0,
    "would-change": 0,
    ok: 0,
    skipped: 0,
    failed: 0,
  };
  for (const r of results) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    const color =
      r.status === "failed"
        ? "red"
        : r.status === "changed" || r.status === "would-change"
          ? "yellow"
          : r.status === "skipped"
            ? "cyan"
            : "green";
    console.log(chalk[color](`  [${r.status}] ${r.name}`));
  }
  console.log(
    chalk.blue(
      `Summary: ${counts.changed} changed, ${counts["would-change"]} would-change, ${counts.ok} ok, ${counts.skipped} skipped, ${counts.failed} failed`
    )
  );
  return counts.failed > 0;
}

async function runConfig(config, watchMode = false, checkMode = false) {
  const hosts = normalizeHosts(config);
  if (!hosts.length) throw new Error("No hosts found in YAML config.");
  const steps = Array.isArray(config.steps) ? config.steps : [];
  if (!steps.length) throw new Error("No steps provided in YAML config.");
  validateSteps(steps);

  const check = checkMode || Boolean(config.check);
  let hadFailure = false;

  for (const host of hosts) {
    const deployer = new Daffodil({
      remoteUser: host.user || config.remoteUser,
      remoteHost: host.host || config.remoteHost,
      remotePath: host.remotePath || config.remotePath || ".",
      port: host.port || config.port || 22,
      ignoreFile: config.ignoreFile || ".scpignore",
      verbose: Boolean(config.verbose),
      check,
      sshKeyPath: config.sshKeyPath || config.ssh_key_path || null,
    });
    deployer.__configDir = config.__configDir;

    const runSteps = buildSteps(deployer, steps);
    if (watchMode) {
      const watch = config.watch || {};
      await deployer
        .watch({
          paths: watch.paths || [],
          debounce: watch.debounce ?? 2000,
          repoPath: watch.repoPath,
          branch: watch.branch,
          branches: watch.branches,
          tags: watch.tags ?? true,
          tagPattern: watch.tagPattern
            ? new RegExp(watch.tagPattern)
            : undefined,
          events: watch.events || ["commit", "merge", "tag"],
          interval: watch.interval ?? 5000,
        })
        .deploy(runSteps);
    } else {
      const results = await deployer.deploy(runSteps);
      printSummary(results);
      hadFailure = hadFailure || results.some((r) => r.status === "failed");
    }
  }
  return hadFailure;
}

async function main() {
  const args = process.argv.slice(2);
  let configPath = ".daffodil.yml";
  const configIdx = args.indexOf("--config");
  if (configIdx !== -1) {
    configPath = args[configIdx + 1] || "";
  }
  if (!configPath || path.basename(configPath) !== ".daffodil.yml") {
    console.error(
      "Config filename must be exactly '.daffodil.yml' (use project/samples/.daffodil.yml)."
    );
    process.exit(1);
  }
  const config = loadConfig(configPath);
  const watchMode = args.includes("--watch");
  const checkMode = args.includes("--check");
  const hadFailure = await runConfig(config, watchMode, checkMode);
  if (watchMode) {
    console.log("watch() active. Press Ctrl+C to exit.");
  }
  if (hadFailure) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("jsdaffodil CLI failed:", err.message);
  process.exit(1);
});
