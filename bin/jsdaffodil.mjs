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
  if (Array.isArray(config.hosts) && config.hosts.length > 0) return config.hosts;
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

function buildSteps(deployer, steps = []) {
  return steps.map((s) => {
    const stepName = s.name || s.step || s.type || "step";
    if (s.type === "local") {
      return { step: stepName, command: () => deployer.local(s.command) };
    }
    if (s.type === "ssh") {
      return { step: stepName, command: () => deployer.sshCommand(s.command) };
    }
    if (s.type === "transfer") {
      return {
        step: stepName,
        command: () => deployer.transferFiles(s.localPath, s.destinationPath),
      };
    }
    throw new Error(`Unsupported step type: ${s.type}`);
  });
}

async function runConfig(config, watchMode = false) {
  const hosts = normalizeHosts(config);
  if (!hosts.length) throw new Error("No hosts found in YAML config.");
  const steps = Array.isArray(config.steps) ? config.steps : [];
  if (!steps.length) throw new Error("No steps provided in YAML config.");

  for (const host of hosts) {
    const deployer = new Daffodil({
      remoteUser: host.user || config.remoteUser,
      remoteHost: host.host || config.remoteHost,
      remotePath: host.remotePath || config.remotePath || ".",
      port: host.port || config.port || 22,
      ignoreFile: config.ignoreFile || ".scpignore",
      verbose: Boolean(config.verbose),
    });

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
          tagPattern: watch.tagPattern ? new RegExp(watch.tagPattern) : undefined,
          events: watch.events || ["commit", "merge", "tag"],
          interval: watch.interval ?? 5000,
        })
        .deploy(runSteps);
    } else {
      await deployer.deploy(runSteps);
    }
  }
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
  await runConfig(config, watchMode);
  if (watchMode) {
    console.log("watch() active. Press Ctrl+C to exit.");
  }
}

main().catch((err) => {
  console.error("jsdaffodil CLI failed:", err.message);
  process.exit(1);
});
