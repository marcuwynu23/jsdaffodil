# JSDaffodil — Developer Documentation

Documentation for contributors and maintainers. End-user usage is covered in [GUIDELINES.md](./GUIDELINES.md) and [README.md](./README.md).

## Table of contents

1. [Project overview](#project-overview)
2. [Repository layout](#repository-layout)
3. [Architecture](#architecture)
4. [Main package (`src/`)](#main-package-src)
5. [CLI (`bin/jsdaffodil.mjs`)](#cli-binjsdaffodilmjs)
6. [Features aligned with the Daffodil family](#features-aligned-with-the-daffodil-family)
7. [Development setup](#development-setup)
8. [Testing](#testing)
9. [Building and distribution](#building-and-distribution)
10. [Extension points](#extension-points)
11. [Code style](#code-style)
12. [Runtime requirements](#runtime-requirements)
13. [Additional resources](#additional-resources)
14. [Questions](#questions)

## Project overview

JSDaffodil is the **Node.js** implementation of the Daffodil deployment helpers. It uses **node-ssh**, **tar**, and related libraries for archive-based transfer, supports **`.scpignore`**, optional **`watch()`** (filesystem + Git polling), multi-host mode via **`inventory.ini`** (constructor + `parseInventoryFile`), and a small **YAML CLI**.

**Key dependencies** (see `package.json`): `node-ssh`, `tar`, `fs-extra`, `chalk`, `ora`, `cli-progress`, `js-yaml` (CLI).

Sister projects: [PyDaffodil](https://github.com/marcuwynu23/pydaffodil) (Python), [GoDaffodil](https://github.com/marcuwynu23/godaffodil) (Go).

## Repository layout

```
jsdaffodil/
├── LICENSE
├── CONTRIBUTING.md
├── DOCUMENTATION.md      # This file
├── GUIDELINES.md
├── README.md
├── CHANGELOG.md
├── package.json
├── src/
│   ├── index.js          # ESM: Daffodil, errors, parseInventoryFile export
│   └── index.cjs         # CommonJS proxy (dynamic import guidance)
├── bin/
│   └── jsdaffodil.mjs    # YAML CLI: --config .daffodil.yml [--watch]
├── samples/              # ESM/CJS examples, watch, inventory
├── tests/
│   ├── esm/
│   └── commonjs/
└── inventory.ini.example
```

## Architecture

```
Application or bin/jsdaffodil.mjs
              │
              ▼
┌─────────────────────────┐
│  Daffodil (src/index.js) │  connect, transferFiles, sshCommand, deploy, watch
└────────────┬────────────┘
             │
     ┌───────┴────────┐
     ▼                ▼
  NodeSSH           tar / fs
```

- **ESM** is primary (`"type": "module"`); **CommonJS** uses `src/index.cjs` (proxy to encourage `import()`).
- **Inventory**: `parseInventoryFile(path, group)` parses Ansible-style INI; used by the class and the YAML CLI.

## Main package (`src/`)

| File | Role |
| ---- | ---- |
| `src/index.js` | `Daffodil` class; `PathNotFoundError`, `TransferError`, `DeploymentError`; `parseInventoryFile`; `watch().deploy()` pipeline |
| `src/index.cjs` | CommonJS entry: surfaces helpful error directing users to ESM `import` |

Exports include deployment steps as `{ step, command }` async functions, `deploy(steps)`, and optional `inventory` + `group` on the constructor for multi-host sequential deploys.

## CLI (`bin/jsdaffodil.mjs`)

- **Invocation**: `jsdaffodil --config path/to/.daffodil.yml` and optional **`--watch`**
- **Config path**: basename must be exactly **`.daffodil.yml`**
- Loads YAML with `js-yaml`, resolves hosts via **`normalizeHosts`**: inline **`hosts`** first, then **`inventoryFile`** + **`inventoryGroup`** (`parseInventoryFile`), then **`remoteHost`** / **`remoteUser`**
- Step types in YAML: **`local`**, **`ssh`**, **`transfer`** — mapped to `runCommand`, `sshCommand`, `transferFiles`
- **No** separate subcommands (aligned with **PyDaffodil**’s single-entry CLI; **GoDaffodil** uses `godaffodil run --config` only)

End-user CLI details belong in [GUIDELINES.md](./GUIDELINES.md) and [README.md](./README.md), not here.

## Features aligned with the Daffodil family

| Feature | JSDaffodil notes |
| ------- | ---------------- |
| `.daffodil.yml` | Same shape as Python/Go: `steps`, optional `hosts`, `watch`, `inventoryFile`, `inventoryGroup` |
| `inventory.ini` | `parseInventoryFile`; CLI uses `inventoryFile` + `inventoryGroup` |
| Host precedence (CLI) | `hosts` → inventory → default `remoteHost` / `remoteUser` |
| `watch()` | API + YAML CLI `--watch` with `watch:` block |

## Development setup

**Prerequisites:** Node.js ≥ 14 (see `package.json` engines if present), npm, Git.

```bash
git clone https://github.com/marcuwynu23/jsdaffodil.git
cd jsdaffodil
npm install
npm test
```

Optional local env for integration-style tests (see test files):

```env
REMOTE_USER=your_user
REMOTE_HOST=your_host
REMOTE_PATH=/path/to/app
```

## Testing

```bash
npm test                 # ESM + CommonJS suites
npm run test:esm
npm run test:common
```

Add or extend tests under `tests/esm` and `tests/commonjs` when changing public API, CLI behavior, or inventory parsing.

## Building and distribution

- **Format**: `npm run format` / `npm run format:check` (Prettier)
- **Publish**: `npm test` then `npm publish` (maintainer); version in `package.json`, entries in [CHANGELOG.md](./CHANGELOG.md)

No separate build step required for the library (source is published as-is per package layout).

## Extension points

- New **YAML step types**: update `bin/jsdaffodil.mjs` (`buildSteps` / validation) and document in GUIDELINES; align with PyDaffodil/GoDaffodil if cross-cutting.
- **Inventory**: keep `parseInventoryFile` compatible with Ansible-style lines consumed by all three projects.
- **Public API**: prefer backward-compatible changes; use semver and CHANGELOG for breaking changes.

## Code style

- **Prettier** / project config for formatting
- **JSDoc** on public methods where helpful
- **async/await** for async flows; custom errors (`PathNotFoundError`, `TransferError`, `DeploymentError`) for predictable handling

## Runtime requirements

- Node.js as per `package.json`
- SSH access and keys as documented in [GUIDELINES.md](./GUIDELINES.md)

## Additional resources

- [GUIDELINES.md](./GUIDELINES.md) — User-facing guide
- [CONTRIBUTING.md](./CONTRIBUTING.md) — PR workflow and commits
- [README.md](./README.md) — Sister projects and quick links

## Questions

Open an issue on GitHub or check [PyDaffodil](https://github.com/marcuwynu23/pydaffodil) / [GoDaffodil](https://github.com/marcuwynu23/godaffodil) developer docs for cross-language behavior.
