<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/lh_banner_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/lh_banner_light.png">
  <img src="docs/assets/lh_banner_light.png" alt="LearnHarness" width="640">
</picture>

# LearnHarness Server

**An AI teacher you host yourself, for the browser and the phone.**

[![Release](https://img.shields.io/github/v/release/Banner7/learnharness-server?style=flat-square)](https://github.com/Banner7/learnharness-server/releases)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-3c873a?style=flat-square)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-amd64-blue?style=flat-square)](deploy/README.md)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-lightgrey?style=flat-square)](LICENSE)

[Overview](#overview) · [Features](#features) · [Getting started](#getting-started) · [Configuration](#configuration) · [Security](#security) · [Documentation](docs/README.md)

</div>

## Overview

LearnHarness uses AI agents to plan and teach lessons from your current understanding to your goal. It reads your answers and your written reasoning to decide what you need next, and a persistent knowledge graph carries what you learn across sessions.

LearnHarness Server runs it as a single-owner web app on a machine you control. The server does all the work (agents, storage, background jobs); a desktop browser or a phone is only the screen. There is no desktop app.

Based on [LearnHarness](https://github.com/amosblomqvist/learnharness) by Amos Blomqvist, and released under the same AGPL-3.0 license.

![LearnHarness teaching session](docs/assets/teaching-session.png)

## Features

- **Teaching.** The agent finds where your understanding ends, plans a dependency map to your goal, and teaches one reasoning step at a time with predictions and checks.
- **Practice.** Separate sessions pose varied problems that adapt to your reasoning.
- **Knowledge graph.** Lessons accumulate as propositions and reasoning chains, linked back to the sessions and notes they came from.
- **Flashcards.** Spaced review scheduled with FSRS-6.
- **Side conversations.** Ask a side question without derailing the lesson.
- **Notes library.** Upload notes, or let the library follow a read-only Markdown folder and sync it into the graph.
- **Phone-first layout.** Drawers, full-screen sheets and touch-sized controls on narrow screens; installable as a home-screen web app.
- **Plugins and themes.** Flashcards, Coding Questions, Drawing Pad and Rich code blocks ship as core plugins; themes are presets or [imported files](docs/themes.md).
- **Your models.** Hosted providers by API key, any number of OpenAI-compatible endpoints, and Claude through the Claude Code CLI.

![LearnHarness knowledge graph](docs/assets/knowledge-graph.png)

## Getting started

### Prerequisites

- Docker on an amd64 host.
- An authenticated HTTPS reverse proxy in front of the container, for example Tailscale Serve.
- At least one model provider key, or a custom OpenAI-compatible endpoint.

### Run with Docker

```sh
git clone https://github.com/Banner7/learnharness-server.git
cd learnharness-server
docker build -t learnharness:0.2.2 .

mkdir -p data secrets/config claude && chown 1000:1000 claude
cp deploy/config.example.json secrets/config/config.json
chmod 600 secrets/config/config.json && chown -R 1000:1000 secrets/config
cp deploy/compose.example.yml compose.yml

# Create secrets/runtime.env with at least LH_WEB_ORIGIN and LH_WEB_ACCESS_TOKEN
docker compose up -d
```

Open the configured origin and sign in with username `learnharness` and the access token. Then choose Strong, Cheap and Vision models in Settings.

> [!IMPORTANT]
> The access gate is fail-closed: every request is refused until `LH_WEB_ORIGIN` and `LH_WEB_ACCESS_TOKEN` are set.

Volumes, the secrets layout and image contents are covered in the [deployment guide](deploy/README.md). For first use, see [getting started](docs/getting-started.md).

## Configuration

Set these in the server environment. With Docker, that is `secrets/runtime.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `LH_WEB_ORIGIN` | Yes | Exact public origin, e.g. `https://learn.example.com`. HTTPS, or plain HTTP for `localhost`, `127.0.0.1` or `[::1]` only. No path (a bare trailing `/` is accepted), query or user info. |
| `LH_WEB_ACCESS_TOKEN` | Yes | 64 hex characters (`openssl rand -hex 32`). The Basic auth password for username `learnharness`. |
| `LH_TAILSCALE_USERS` | No | Comma-separated Tailscale logins admitted by the `Tailscale-User-Login` header without a password. See the warning below. |
| `LH_CONFIG_FILE` | No | Read-only operator config file: `keys`, `customProviders`, `claudeCode`. `/secrets/config/config.json` in the image. See [config file](deploy/README.md#config-file). |
| `LH_VAULT_DIR` | No | Folder of Markdown notes the library follows read-only. Unset turns the follower off. |
| `LH_VAULT_EXCLUDE` | No | Comma-separated skip patterns (`folder/`, `path/note.md`, `*` and `**` globs) that seed the Library skip list until one is saved. |
| `LH_DATA_DIR` | No | Chats, graph, settings, prompts. `/data` in the image. |
| Provider keys | No | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` and the others listed in `src/core/auth-keys.ts`. Set them in the environment or in the config file's `keys`; the environment wins. |
| Search keys | No | `TAVILY_API_KEY`, `BRAVE_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `OLLAMA_API_KEY`. |
| `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR` | No | Authenticate the Claude Code CLI in the image. See [Claude Code](docs/claude-code.md). |
| `CHROME_PATH` | No | Chrome executable for demo verification. Set in the image. |

Credentials are never entered in the app: the Providers page is read-only, and the server picks up edits to the config file without a restart. Custom endpoints are declared under `customProviders` ([guide](docs/custom-providers.md)).

> [!WARNING]
> Set `LH_TAILSCALE_USERS` only when nothing but Tailscale Serve can reach the container. Host processes and containers on the same network can reach it directly and forge the `Tailscale-User-Login` header.

## Security

- The access gate is for a single owner. It is not multi-user hosting: everyone admitted sees every chat and setting.
- Keep the container port on loopback behind an authenticated HTTPS proxy. Never publish the port directly.
- Agent file tools can read files the server's user can read, minus a sensitive-path guard. Mount only what you want the agent to see.
- Model providers and web research receive the content needed for each request.

> [!CAUTION]
> **Coding Questions runs learner and model code on the server without a sandbox**, as the server's user, with `node` and `python3`. Disable the plugin if that is not acceptable. Community plugins are trusted code too: their backends run inside the server process with its file and network access.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Differences from upstream

| Area | Upstream LearnHarness | LearnHarness Server |
| --- | --- | --- |
| Packaging | Electron desktop app with installers and in-app updates | Server only, shipped as a Docker image |
| Access | Desktop shell; browser-only mode has no login | Fail-closed gate: HTTP Basic auth or an allowlisted Tailscale identity, with Host and Origin pinned to the configured origin |
| Credentials | Keys entered in Settings; ChatGPT, GitHub Copilot and Grok sign-in | Server environment or the read-only config file only; no in-app key entry and no subscription sign-in |
| Custom endpoints | One OpenAI-compatible endpoint configured in the app | Any number, declared in the config file |
| Notes library | Notes imported by upload | Can also follow a read-only Markdown folder |
| Layout | Desktop window | Phone-first; side conversations become a bottom sheet, the Drawing Pad accepts touch ink, and on narrow screens node search lives in Chains |
| Look | Default theme | Kasumi by default, plus an Automatic theme that follows the system light/dark setting; the old default is kept as "Classic Dark" |
| Claude Code | Enabled in Settings | Enabled in the config file; the CLI is pinned in the image |
| Local files | Picker and drag-and-drop attach local paths | Files on your device cannot be attached; paste a path on the server instead |
| Dictation | Built-in voice dictation through Deepgram | Removed; use the device keyboard's dictation |

Upstream is not merged wholesale. Each upstream release is reviewed, and selected features and fixes are brought over. Version 0.1.0 started from upstream 0.6.0; see the [release notes](docs/releases) for what each version took.

## Development

```sh
npm ci
npm run plugins:setup
export LH_WEB_ORIGIN=http://localhost:3000 LH_WEB_ACCESS_TOKEN=$(openssl rand -hex 32)
npm run dev        # http://localhost:3000
npm test
```

## Resources

- [Documentation index](docs/README.md)
- [Deployment guide](deploy/README.md)
- [Architecture](docs/architecture.md) and [development](docs/development.md)
- [Plugin authoring guide](docs/plugin-authoring.md)
- [Teaching methodology](docs/teaching-methodology.md)
