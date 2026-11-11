<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/lh_banner_dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/lh_banner_light.png">
    <img src="docs/assets/lh_banner_light.png" alt="LearnHarness" width="640">
  </picture>
</p>

<p align="center"><strong>A self-hosted LearnHarness server for the browser and phone.</strong></p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#differences-from-upstream">Differences from upstream</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="https://github.com/Banner7/learnharness-server/issues">Issues</a>
</p>

Based on [LearnHarness](https://github.com/amosblomqvist/learnharness) by Amos Blomqvist.

LearnHarness Server runs LearnHarness as a single-owner web app on a server you control. You open it from a desktop browser or a phone. There is no desktop app.

LearnHarness uses AI agents to plan and teach lessons from your current understanding to your goal. It uses your answers and your written reasoning to decide what you need next, and a persistent knowledge graph carries what you learn across sessions.

![LearnHarness teaching session](docs/assets/teaching-session.png)

## Features kept from upstream 0.6.0

- **Teaching.** The agent measures where your understanding ends, plans a dependency map to your goal, and teaches one reasoning step at a time with predictions and checks.
- **Practice.** Separate sessions pose varied problems that adapt to your reasoning.
- **Knowledge graph.** Lessons accumulate as propositions and reasoning chains with links back to their source sessions. Teaching and practice sessions can read it.
- **Flashcards.** Spaced review scheduled with FSRS-6.
- **Side conversations.** Ask a side question without derailing the main lesson.
- **Core plugins.** Flashcards, Coding Questions, Drawing Pad, and Rich code blocks.
- **Themes.** Preset and imported themes ([format](docs/themes.md)).
- Background research, visual explanations, annotated images, and interactive demonstrations.

![LearnHarness knowledge graph](docs/assets/knowledge-graph.png)

## Differences from upstream

| Area | Upstream LearnHarness | LearnHarness Server |
| --- | --- | --- |
| Packaging | Electron desktop app with installers and in-app updates | Server only, shipped as a Docker image. No Electron, no installers, no updater. |
| Access | Desktop shell credentials; browser-only mode has no login | Fail-closed access gate: every request is refused until `LH_WEB_ORIGIN` and `LH_WEB_ACCESS_TOKEN` are set. Access by HTTP Basic auth or an allowlisted Tailscale identity. Host and Origin are pinned to the configured origin. |
| Credentials | Keys entered in Settings; ChatGPT, GitHub Copilot, and Grok sign-in | Credentials come only from server environment variables or a server-managed `auth.json`. The Providers page is read-only. No in-app key entry and no subscription sign-in. |
| Custom endpoints | One OpenAI-compatible endpoint configured in the app | Any number of OpenAI-compatible providers declared in `LH_CUSTOM_PROVIDERS` ([docs](docs/custom-providers.md)). |
| Notes library | Notes imported by upload | The library can also follow a read-only Markdown folder (`LH_VAULT_DIR`) and sync it into the graph from Settings → Library. |
| Layout | Desktop window | Phone-first layout: sidebar and settings become drawers or full-screen sheets on narrow screens, side conversations become a bottom sheet, touch-sized controls, Drawing Pad accepts touch ink, installable web app manifest. |
| Look | Default theme | Kasumi theme by default, plus an Automatic theme that follows the system light/dark setting. The old default is kept as "Classic Dark". |
| Claude Code | Enabled in Settings | Enabled out of band in the server's `data/settings.json`; the CLI is pinned in the image ([docs](docs/claude-code.md)). |
| Local files | Picker and drag-and-drop attach local paths | Files on your device cannot be attached; paste a path on the server instead. |

## Quick start

Requirements: Docker on an amd64 host and an authenticated HTTPS reverse proxy (for example Tailscale Serve) in front of the container.

```sh
docker build -t learnharness:0.1.1 .
mkdir -p data secrets claude && chown 1000:1000 claude
cp deploy/compose.example.yml compose.yml
# create secrets/runtime.env with at least LH_WEB_ORIGIN and LH_WEB_ACCESS_TOKEN
docker compose up -d
```

Open the configured origin and sign in with username `learnharness` and the access token. Then choose Strong, Cheap, and Vision models in Settings.

Full instructions, volumes, and image contents: [deploy/README.md](deploy/README.md).

## Configuration

Set these in the server environment (with Docker, in `secrets/runtime.env`).

| Variable | Required | Purpose |
| --- | --- | --- |
| `LH_WEB_ORIGIN` | Yes | Exact public origin, e.g. `https://learn.example.com`. HTTPS, or plain HTTP for `localhost`, `127.0.0.1`, or `[::1]` only. No path (a bare trailing `/` is accepted), query, or user info. |
| `LH_WEB_ACCESS_TOKEN` | Yes | 64 hex characters (`openssl rand -hex 32`). The Basic auth password for username `learnharness`. |
| `LH_TAILSCALE_USERS` | No | Comma-separated Tailscale logins admitted by the `Tailscale-User-Login` header without a password. Only the published port is loopback: host processes and containers on the same network can still reach the container directly and forge `Tailscale-User-Login`, so set this only when nothing but Tailscale Serve can reach the container. |
| `LH_CUSTOM_PROVIDERS` | No | JSON array of OpenAI-compatible providers. See [custom providers](docs/custom-providers.md). |
| `LH_VAULT_DIR` | No | Folder of Markdown notes the library follows read-only. Unset turns the library follower off. |
| `LH_VAULT_EXCLUDE` | No | Comma-separated skip patterns (`folder/`, `path/note.md`, `*` and `**` globs) that seed the Library skip list until one is saved. |
| `LH_DATA_DIR` | No | Chats, graph, settings, prompts. `/data` in the image. |
| `LH_AUTH_FILE` | No | Read-only flat JSON map of key variables, e.g. `{"OPENAI_API_KEY": "..."}`. `/secrets/auth.json` in the image. Environment values take precedence. |
| Provider keys | No | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, and the others listed in `src/core/auth-keys.ts`. |
| Search and dictation keys | No | `TAVILY_API_KEY`, `BRAVE_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `OLLAMA_API_KEY`, `DEEPGRAM_API_KEY`. |
| `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR` | No | Authenticate the Claude Code CLI in the image. See [Claude Code](docs/claude-code.md). |
| `CHROME_PATH` | No | Chrome executable for demo verification. Set in the image. |

## Security notes

- The access gate is for a single owner. It is not multi-user hosting; everyone admitted sees every chat and setting.
- Keep the container port on loopback and put an authenticated HTTPS proxy in front of it. Never publish the port directly.
- **Coding Questions runs learner and model code on the server without a sandbox**, as the server's user, with `node` and `python3`. Disable the plugin if that is not acceptable.
- **Community plugins are trusted code.** Their backends run inside the server process with its file and network access. Install only plugins you trust.
- Agent file tools can read files the server's user can read, minus a sensitive-path guard. Mount only what you want the agent to see.
- Model providers, web research, and dictation services receive the content needed for each request.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Tracking upstream

This project does not merge upstream wholesale. Each upstream LearnHarness release is reviewed, and selected features and fixes are reimplemented here. Version 0.1.0 is based on upstream 0.6.0.

## Development

```sh
npm ci
npm run plugins:setup
npm run dev        # http://localhost:3000; set LH_WEB_ORIGIN=http://localhost:3000 and LH_WEB_ACCESS_TOKEN first
npm test
```

See [development](docs/development.md), [architecture](docs/architecture.md), and the [plugin authoring guide](docs/plugin-authoring.md).

## License

[AGPL-3.0](LICENSE). Original work copyright Amos Blomqvist and LearnHarness contributors.
