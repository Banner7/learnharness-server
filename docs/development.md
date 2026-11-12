# Development

For product setup, see [Getting started](getting-started.md). For runtime flows, see [Architecture](architecture.md). These guides follow [the repository source](README.md#about-these-docs).

## Setup

CI uses **Node 26** (`.github/workflows/ci.yml`); the Docker image builds and runs on **Node 22** (`Dockerfile`). Use the lockfile and a compatible native build environment:

```sh
npm ci
npm run plugins:setup  # generate local SDKs and install locked source-plugin dependencies
npm run dev            # normally http://localhost:3000
```

`plugins:setup` prepares each source package under `plugins/`: it generates its ignored `.sdk/` when needed, then runs `npm ci`. Run it after a fresh checkout and again after public API or plugin lockfile changes. Root typecheck/build includes plugin sources, so CI uses the same preparation. It does not build plugin bundles, install/enable plugins in your learning-data directory, or populate `core-plugins/`.

`npm run plugins:build-core` builds the four IDs in `core-plugins.json` and stages complete app-owned packages in generated `core-plugins/<id>/`. `dev` and `build` run it automatically. Core code loads directly from this directory; restart the server after source edits/rebuilding (there is no plugin hot reload). Do not use raw `next dev`/`next build` without first staging core packages. Fresh checkouts need `plugins:setup` before these commands.

For a community/developer plugin, build in its source directory and follow the [installation guide](plugin-authoring.md#package-and-installation). Generated `core-plugins/`, plugin `dist/`, `.sdk/` and `node_modules/` stay out of Git. UI Showcase remains a developer example, not a shipped core package. Never install a community package using a reserved core ID.

Core data lives in `<learning data>/core-plugin-data/<id>/`; community code/data remains `<learning data>/plugins/<id>/{dist,data}/`. All newly discovered plugins start disabled. Core code is never copied into the learning-data directory, and switching to this layout does not migrate old development data.

The server refuses every request until the access gate is configured. For local work, set an HTTP loopback origin and a token:

```sh
export LH_WEB_ORIGIN=http://localhost:3000
export LH_WEB_ACCESS_TOKEN=$(openssl rand -hex 32)
npm run dev            # sign in as learnharness with the token
```

No model key is needed to open the UI. Provide credentials through environment variables or the config file's `keys`, then choose the Strong/Cheap/Vision slots before model-driven use; there are no factory model selections.

```sh
npm run build          # stage core plugins, then Next production/standalone build
npm start              # serve the production build with Next
```

### Access gate

`npm run dev` and `npm start` listen on `localhost` only. The gate in `proxy.ts` (`src/server/web-access.ts`) admits a request only when its `Host` matches `LH_WEB_ORIGIN`, cross-site and mismatched-`Origin` requests are refused, and the request carries Basic auth `learnharness:<LH_WEB_ACCESS_TOKEN>` or a `Tailscale-User-Login` listed in `LH_TAILSCALE_USERS`. A missing or malformed token or origin returns 503 everywhere. To reach the server from another device, put an HTTPS reverse proxy in front of it and set `LH_WEB_ORIGIN` to the proxy's origin; the proxy must preserve the public `Host`.

## Configuration

Nonsecret settings are deltas in `<data root>/settings.json`; absent values resolve through `src/core/settings.ts` and `settings-resolution.ts`. Models and role overrides are settings, not environment variables. [Prompt overrides](../src/agent/prompts/README.md) live under `<data root>/prompts/` and require explicit enable switches.

| Variable | Purpose |
| --- | --- |
| `LH_DATA_DIR` | Mutable chats/jobs/graph/settings/prompts; default repo `data/`. |
| `LH_CONFIG_FILE` | Read-only operator config file (`keys`, `customProviders`, `claudeCode`; schema in `src/core/server-config.ts`); default repo-root `config.json`, outside `data/`. Re-read when it changes; the app never writes it. See [deployment](../deploy/README.md#config-file). |
| `LH_WEB_ORIGIN` | Required. Exact origin of the app; HTTPS, or HTTP for `localhost`/`127.0.0.1`/`[::1]`. |
| `LH_WEB_ACCESS_TOKEN` | Required. 64 hex characters; Basic auth password for user `learnharness`. |
| `LH_TAILSCALE_USERS` | Optional comma-separated Tailscale logins admitted without a password. |
| `LH_VAULT_DIR` | Optional vault library: a folder of Markdown notes the server follows read-only (30 s poll; Settings → Library for Sync now, auto-extract, skip list, missing-note review). Unset = off. |
| `LH_VAULT_EXCLUDE` | Optional comma-separated skip patterns (`folder/`, `exact/path.md`, globs with `*`/`**`) seeding the Library skip list until one is saved. Dot entries are always skipped. |
| Provider API-key variables | Optional, selected-provider dependent; UI names are in `src/core/auth-keys.ts`. |
| `TAVILY_API_KEY`, `BRAVE_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `OLLAMA_API_KEY` | Optional search adapters. Without a Settings pin, the first keyed engine wins: Tavily → Brave → Exa → Firecrawl → Ollama. A pinned engine requires its own key; no silent fallback. Ollama search is hosted at ollama.com, not a local model server. Page fetching is independent; research can fetch known URLs without a search key. |
| `CHROME_PATH` | Chrome/Chromium executable for demo verification. No extra Chromium is downloaded. |

Ordinary Next development can read `.env.local`. Real environment keys take precedence over the config file's `keys`. That file is restrictive-permission plaintext, not an encrypted vault.

Provider-specific setup and limitations: [Claude Code](claude-code.md), [custom providers](custom-providers.md), [context/cost accounting](compaction-accounting.md).

The gate is a single-owner login, not multi-user hosting. Keep the listener on loopback behind an authenticated HTTPS proxy.

## Safe local work

Use a disposable data root and a separate config file (a missing file is an empty config):

```sh
LH_DATA_DIR=/absolute/path/to/scratch/data \
LH_CONFIG_FILE=/absolute/path/to/scratch/config.json \
LH_WEB_ORIGIN=http://localhost:3001 \
LH_WEB_ACCESS_TOKEN=$(openssl rand -hex 32) \
npm run dev -- --port 3001
```

These variables isolate app records/saved keys, **not every external effect**. Ambient keys still win; Claude Code can use its native profile. File tools have broad read access under the server's user, subject to the [path guard](architecture.md#file-access-and-external-services). A scratch data root is not a filesystem or credential sandbox. Use synthetic fixtures/fake providers for automated reproduction and avoid personal files or ambient credentials.

Do not commit `.env.local`, credentials, or learning records. Do not copy a personal profile into a fixture. Avoid separate writers against live profiles; store initialization and maintenance scripts can mutate data or invoke model stages. Inspect scripts before using them. See [storage and compatibility](architecture.md#storage-and-notifications) before changing formats.

Read the relevant installed Next guide under `node_modules/next/dist/docs/` before framework-facing changes. The import restrictions live in `eslint.config.mjs`; they do not enforce every architectural convention. [Architecture's code map](architecture.md#code-boundaries) and [prompt composition](../src/agent/prompts/README.md) identify the main entry points. For plugins, start with the [authoring/capability map](plugin-authoring.md), [host source map and verification](plugin-architecture.md), [`examples/plugins/`](../examples/plugins/) templates and [`plugins/`](../plugins/) feature sources.

## Debugging

- `LH_PROVIDER_EVENTS=1` saves raw provider events under the selected data root. They may contain private lesson/provider content.
- `LH_BACKGROUND_CAPTURE=auditor` (or comma-separated roles, or `all`) captures background requests/results. Roles are `researcher`, `demoBuilder`, `extractor`, `auditor`, `visualMaker`, and `pdfReader`; foreground teaching/probing is excluded.

For example:

```sh
LH_BACKGROUND_CAPTURE=auditor npm run dev
```

The flag must reach the **Next server**; restart an existing server to change it. Captures are off by default and written to `<data root>/debug/background-captures/<role>-<run ID>.json`. Each file retains the last request and response/error/tool results, with prior conversation in that request and compact per-turn timings—not every request body.

`request.format: provider` means adapter-exposed outgoing payload after app transport restrictions; `context` means model-facing conversation, not HTTP wire (for example, CLI). Captures do not enable thinking or recover reasoning a provider did not return. Request options/auth headers are not recorded, recognized nested credential/header fields are redacted, and POSIX files are owner-only. They still contain private source/graph content, have **no automatic expiry**, and require review before sharing and manual deletion when no longer needed. Capture/serialization errors do not fail workers.

For frontend failures, inspect the actual UI, requests, console, and state. A static render alone does not establish that an interaction works.

## Checks

```sh
npm test               # node:test via tsx; injected engines, fixtures, fake transports
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint, including import restrictions
npm run build          # Next production build
```

The suite requires no paid models or real accounts. Some tests use temporary files, native processes, or local fake endpoints: deterministic does not mean every test is pure or cannot bind a loopback port. Inspect focused-suite setup before running beside a live app.

[Golden fixtures](../tests/fixtures/golden-data/README.md) exercise saved records through production paths. Keep compatibility expectations with intentional format changes; do not hand-edit fixture content to make tests pass. [Standalone skill-reader tests](../tests/skills/README.md) run separately with Python and no app runtime.

Additional runtime gates have prerequisites:

| Check | Prerequisite / purpose |
| --- | --- |
| `node scripts/smoke-provider-runtime.mjs` | Fresh build; traced provider payload/runtime paths with fixtures. |
| `node scripts/build-plugin-types.mjs` | Builds the portable type-only plugin SDK under `dist/plugin-sdk`. |
| `node scripts/build-server.mjs` then `node scripts/smoke-server.mjs --isolated --browser` | Fresh build; assemble/verify a source-free standalone copy, installed plugin backends and browser UI. Browser checks require local Chrome/Chromium. |
| Other `scripts/smoke-*.mjs` | Standalone/native renderers, image workers, demo helper, compression, opening. Read each script before running. |

Run checks proportionate to the change. Offline gates prove exercised contracts, not live entitlements or model-authored lesson quality.
