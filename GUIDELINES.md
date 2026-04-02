# JSDaffodil Usage Guidelines

End-user guide for deployment with JSDaffodil: API usage, **`inventory.ini`**, **`.daffodil.yml`**, **`watch()`**, and troubleshooting. For contributors and architecture, see [DOCUMENTATION.md](./DOCUMENTATION.md).

Sister projects: [PyDaffodil](https://github.com/marcuwynu23/pydaffodil) (Python), [GoDaffodil](https://github.com/marcuwynu23/godaffodil) (Go). Shared **`.daffodil.yml`** schema and inventory format.

## Table of contents

1. [Installation](#installation)
2. [Quick start](#quick-start)
3. [Configuration](#configuration)
4. [Core operations](#core-operations)
5. [Multi-host (`inventory.ini`)](#multi-host-inventoryini)
6. [Watch (`watch()`)](#watch-watch)
7. [YAML CLI](#yaml-cli)
8. [Ignore file (`.scpignore`)](#ignore-file-scpignore)
9. [Best practices](#best-practices)
10. [Troubleshooting](#troubleshooting)
11. [Additional resources](#additional-resources)

## Installation

**Prerequisites:** Node.js ≥ 14, SSH access to the remote host, SSH keys in `~/.ssh/` (or `%USERPROFILE%\.ssh\` on Windows).

```bash
npm install @marcuwynu23/jsdaffodil
```

## Quick start

**ESM** (recommended; use `"type": "module"` in `package.json` or `.mjs` files):

```javascript
import { Daffodil } from "@marcuwynu23/jsdaffodil";

const deployer = new Daffodil({
  remoteUser: "deploy",
  remoteHost: "203.0.113.10",
  remotePath: "/var/www/app",
  port: 22,
});

const steps = [
  {
    step: "Upload",
    command: async () =>
      deployer.transferFiles("./dist", "/var/www/app"),
  },
  {
    step: "Reload",
    command: () => deployer.sshCommand("systemctl reload nginx"),
  },
];

await deployer.deploy(steps);
```

**CommonJS:** use dynamic `import()` or see `samples/sample.cjs` for the supported pattern (`src/index.cjs` directs users to ESM).

## Configuration

### Single-host constructor

| Option | Description |
| ------ | ----------- |
| `remoteUser` | SSH username (required) |
| `remoteHost` | Hostname or IP (required) |
| `remotePath` | Default remote path (default `"."`) |
| `port` | SSH port (default `22`) |
| `ignoreFile` | Ignore file path (default `.scpignore`) |
| `verbose` | Verbose logging (default `false`) |

### Inventory (multi-host)

| Option | Description |
| ------ | ----------- |
| `inventory` | Path to `inventory.ini` |
| `group` | Section name (e.g. `webservers`) |

When `inventory` is set, hosts come from the file; `remoteUser` / `remoteHost` are not used as the single target.

```javascript
import { Daffodil } from "@marcuwynu23/jsdaffodil";

const deployer = new Daffodil({
  inventory: "./inventory.ini",
  group: "webservers",
  remotePath: "/var/www/app",
});
```

**Runtime options:** `deployer.setOption({ verbose: true })`.

## Core operations

- **`runCommand(cmd)`** — Local shell command.
- **`sshCommand(cmd)`** — Remote command over SSH.
- **`transferFiles(localPath, destinationPath?)`** — Archive (tar.gz), upload, extract remotely; respects `.scpignore`.
- **`makeDirectory(dirName)`** — Create a directory on the remote host.
- **`deploy(steps)`** — Run steps in order; with `inventory`, runs the full sequence per host.

Steps are `{ step: string, command: async () => ... }`.

## Multi-host (`inventory.ini`)

Ansible-style INI: `[section]`, one host per line with `host=`, `user=`, optional `port=`.

```ini
[webservers]
app1 host=203.0.113.10 user=deploy port=22
app2 host=203.0.113.11 user=deploy
```

See `samples/inventory-sample.mjs`, `samples/inventory-sample.cjs`, and `inventory.ini.example`.

## Watch (`watch()`)

Triggers redeploys on file changes and/or Git activity (commits, merges, tags).

```javascript
await deployer
  .watch({
    paths: ["./dist", "./src"],
    debounce: 2000,
    repoPath: ".",
    branches: ["main"],
    tags: true,
    tagPattern: /^v\d+\.\d+\.\d+$/,
    events: ["commit", "merge", "tag"],
    interval: 5000,
  })
  .deploy(steps);
```

Provide at least one of `paths` or `repoPath`. See `samples/watch-sample.mjs` and `samples/watch-sample.cjs`.

## YAML CLI

```bash
jsdaffodil --config samples/.daffodil.yml
jsdaffodil --config samples/.daffodil.yml --watch
```

- Config path **basename** must be exactly **`.daffodil.yml`**.
- **Host resolution** (same as PyDaffodil / GoDaffodil):
  1. Non-empty **`hosts`** in YAML
  2. **`inventoryFile`** + **`inventoryGroup`**
  3. Top-level **`remoteHost`** + **`remoteUser`**

```yaml
inventoryFile: inventory.ini
inventoryGroup: webservers
```

**Go note:** GoDaffodil uses `godaffodil run --config …` (with a `run` subcommand); Node and Python use `jsdaffodil` / `pydaffodil` directly.

## Ignore file (`.scpignore`)

Patterns exclude files from packaged transfers (e.g. `node_modules/`, `.env`, `.git/`). Set `ignoreFile` if you use a non-default path.

## Best practices

- Confirm `ssh user@host` works before scripting deploys.
- Prefer environment variables for hosts and secrets, not committed YAML.
- Use **inventory** for many servers; use inline **`hosts`** in YAML for small fixed lists.
- Enable **`verbose`** when debugging; keep it off in quiet CI if you prefer minimal logs.

## Troubleshooting

| Issue | What to check |
| ----- | ---------------- |
| SSH auth failures | Keys in `~/.ssh`, `ssh-copy-id`, permissions (`chmod 600` on private keys) |
| Connection timeout | Firewall, correct `port`, host reachable |
| Transfer “path does not exist” | Local path exists; `.scpignore` not excluding needed files |
| Inventory empty / wrong group | Section name matches `group`; each line has `host=` and `user=` |
| `watch()` never triggers | `paths` or `repoPath` set; `repoPath` is a valid repo; `interval` / `debounce` reasonable |
| CLI “no hosts” | Define `hosts`, or `inventoryFile` + `inventoryGroup`, or `remoteHost` + `remoteUser` |

## Additional resources

- [README.md](./README.md) — Overview and sister projects
- [DOCUMENTATION.md](./DOCUMENTATION.md) — Developer documentation (`src/`, `bin/jsdaffodil.mjs`, tests)
- [CONTRIBUTING.md](./CONTRIBUTING.md) — How to contribute
- [samples/](./samples/) — ESM/CJS examples (deploy, watch, inventory)
