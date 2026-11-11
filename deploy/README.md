# LearnHarness — container deployment

Build and run the v0.1.1 server (Next.js standalone) in a container, behind an
authenticated reverse proxy (e.g. Tailscale Serve). The app's own access gate
is fail-closed: without the gate variables configured, **every request is
refused**, which is the intended safety property for a public deployment.

> The example files here are templates. Copy them into a private deployment
> repo (they hold real hostnames, keys and credentials in practice) and never
> commit `secrets/runtime.env`.

## Build

```sh
docker build -t learnharness:0.1.1 .
```

The build runs `npm ci` → `npm run plugins:setup` → `npm run build` (core
plugins + authoring kit + `next build`) → `node scripts/build-server.mjs`
(which curates `.next/standalone`). The final image is `amd64`-only because
Chrome for Testing publishes no linux-arm64 headless shell.

## Run

```sh
mkdir -p data secrets claude
# uid 1000 owns the Claude CLI state dir (the `node` user in the image).
chown 1000:1000 claude
# Create auth.json before the first start (or delete its volume line):
# if the host file is missing, Docker creates a root-owned DIRECTORY there
# and the app silently reads no keys from it.
echo '{}' > secrets/auth.json
# Copy to the repository root: build: . and ./data resolve relative to the
# compose file, so a copy inside deploy/ points at the wrong directories.
cp deploy/compose.example.yml compose.yml
# Edit compose.yml + secrets/runtime.env, then:
docker compose up -d
```

The port is published loopback-only (`127.0.0.1:3000`). Put Tailscale Serve
(or an equivalent authenticated proxy) in front of it.

### Secrets layout

```text
secrets/
  runtime.env   # read by compose (env_file); never mounted into the container
  auth.json     # optional; mounted read-only as /secrets/auth.json
```

Only `auth.json` is mounted, read-only, because it is the only secrets file
the app reads at runtime, and the app never writes it. Keeping `runtime.env`
out of the container means a file-reading bug cannot expose it. If you keep
every key in `runtime.env`, delete the `auth.json` volume line.

### Security note: `LH_TAILSCALE_USERS`

`LH_TAILSCALE_USERS` admits any request whose `Tailscale-User-Login` header
names an allowlisted login. The app cannot tell whether Tailscale Serve set
that header, so it trusts it from anything that can reach the container port.
Use it only when the listener is reachable solely through Tailscale Serve, with
the container on a dedicated Docker network that no other container shares.
Otherwise leave it unset and use the Basic token (`LH_WEB_ACCESS_TOKEN`) only.

### Security note: Coding Questions runs model-written code

Enabling the Coding Questions plugin runs programs the model wrote as the
server's own user (`node`), inside the container, with network access. Its
environment is scrubbed, but the program can still read the server's secrets
another way: the server process's environment through `/proc` (the access
token, provider keys, `CLAUDE_CODE_OAUTH_TOKEN`), `/secrets/auth.json` and
`/claude`. It can also change `/data`. A prompt injection in a web page or
note can make the model write such a program. Keep the plugin disabled
(the default) unless you accept that risk.

## Image contents

The runtime image contains:

- `.next/standalone` — `server.js` + the traced `node_modules` subset,
  `public/`, `.next/static/`, `core-plugins/` (built core plugins), the
  runtime plugin loader, and the traced prompt assets.
- The pinned `@anthropic-ai/claude-code` CLI (see `Claude Code` below).
- The pinned `chrome-headless-shell` under
  `/opt/chrome-headless-shell-linux64/` (`CHROME_PATH`), with its shared
  libraries, CA roots, and `fonts-dejavu-core` + `fontconfig-config` so
  resvg/Skia render figure text.
- `python3` and `node` for the Coding Questions plugin's test programs.
- `node:22-bookworm-slim` base, running as the non-root `node` user (uid 1000).

The image is **amd64-only** (headless-shell constraint). `python3` adds
roughly 50 MB; if coding questions are disabled, it can be dropped from the
`Dockerfile` apt list.

## Volumes

| Mount | Purpose |
| --- | --- |
| `./data:/data` | Mutable state — chats, graph, settings, debug (see `LH_DATA_DIR`). |
| `./secrets/auth.json:/secrets/auth.json:ro` (optional) | Read-only `auth.json` key map (see `LH_AUTH_FILE`). Only this file is mounted; `secrets/runtime.env` stays on the host. |
| `./claude:/claude` | Claude Code CLI state; owned by uid 1000 (see `CLAUDE_CONFIG_DIR`). |
| `./vault:/vault:ro` (optional) | Markdown notes library (see `LH_VAULT_DIR`). |

`no-new-privileges` and `cap_drop: ALL` are recommended; the headless shell is
run with `--no-sandbox` by the demo verifier, so nothing needs extra caps.

## Environment variables

All secrets belong in `secrets/runtime.env` (mounted via `env_file`). Values
below are placeholders — generate real ones per the instructions.

### Access gate (required — fail-closed)

| Variable | Purpose |
| --- | --- |
| `LH_WEB_ORIGIN` | Exact public HTTPS origin, e.g. `https://learn.example.com`. No path, query or userinfo (a bare trailing `/` is accepted). The gate pins `Host` and `Origin` to it. |
| `LH_WEB_ACCESS_TOKEN` | 64-hex secret: `openssl rand -hex 32`. HTTP Basic password, username `learnharness`. |
| `LH_TAILSCALE_USERS` | Optional comma-separated Tailscale logins admitted by identity (`Tailscale-User-Login`) without a password. Only safe when the listener is reachable solely through Tailscale Serve; see the security note above. |

### Custom providers (optional)

| Variable | Purpose |
| --- | --- |
| `LH_CUSTOM_PROVIDERS` | JSON array of OpenAI-compatible providers: `[{ "id", "name?", "baseUrl", "apiKey" \| {"env": "NAME"}, "headers?", "models": [{ "id", "name?", "contextWindow", "maxTokens", "input", "reasoning", "compat?" }] }]`. Secrets may be inline strings or `{"env":"NAME"}` resolved server-side per request; only `{id, name}` summaries reach the browser. Full schema: [docs/custom-providers.md](../docs/custom-providers.md). |

### Vault library (optional)

| Variable | Purpose |
| --- | --- |
| `LH_VAULT_DIR` | Path to a read-only Markdown notes folder (e.g. `/vault`) the library follows. |
| `LH_VAULT_EXCLUDE` | Comma-separated skip patterns (`folder/`, `path/note.md`, `*`/`**` globs) that seed the Settings → Library skip list until one is saved. |

### Data, auth and hosts

| Variable | Purpose |
| --- | --- |
| `LH_DATA_DIR` | Mutable state root. Defaults to `/data` in the image. |
| `LH_AUTH_FILE` | Optional flat JSON map of key variables (`{"OPENAI_API_KEY": "..."}`). Defaults to `/secrets/auth.json` in the image. The app only reads it and picks up edits without a restart; environment values take precedence. A single-file bind mount follows the original inode, so editors that save by replacing the file need `docker compose restart`. |
| `LH_HOST_PORT` | Compose only: loopback host port to publish (default `3000`). |

### Claude Code CLI

| Variable | Purpose |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Token from `claude setup-token`; authenticates the pinned CLI. |
| `CLAUDE_CONFIG_DIR` | Writable CLI state dir. Defaults to `/claude` in the image. |
| `DISABLE_AUTOUPDATER` | Set to `1` (default in image) so the pinned CLI never self-updates. |

The Claude Code provider is opt-in via `"claudeCode": {"enabled": true}` in
`data/settings.json` (server-managed; there is no in-app toggle). See
[docs/claude-code.md](../docs/claude-code.md).

### Provider API keys (optional — any subset)

The app is BYOK; set only the keys for providers you use. Full list from
`src/core/auth-keys.ts`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`,
`MISTRAL_API_KEY`, `XAI_API_KEY`, `ZAI_API_KEY`, `TOGETHER_API_KEY`,
`CEREBRAS_API_KEY`, `FIREWORKS_API_KEY`, `NVIDIA_API_KEY`, `HF_TOKEN`,
`KIMI_API_KEY`, `META_API_KEY`, `MINIMAX_API_KEY`, `MINIMAX_CN_API_KEY`,
`MOONSHOT_API_KEY`, `BASETEN_API_KEY`, `RADIUS_API_KEY`,
`AI_GATEWAY_API_KEY`, `XIAOMI_API_KEY`, `ANT_LING_API_KEY`,
`OPENCODE_API_KEY`, `QWEN_TOKEN_PLAN_API_KEY`, `QWEN_TOKEN_PLAN_CN_API_KEY`,
`TYPESAFE_API_KEY`, `ZAI_CODING_CN_API_KEY`.

Search/dictation adapters: `TAVILY_API_KEY`, `BRAVE_API_KEY`, `EXA_API_KEY`,
`FIRECRAWL_API_KEY`, `OLLAMA_API_KEY`, `DEEPGRAM_API_KEY`.

### Runtime hygiene (set by the image)

`NODE_ENV=production`, `HOSTNAME=0.0.0.0`, `PORT=3000`,
`NEXT_TELEMETRY_DISABLED=1`, `CHROME_PATH` (headless shell). `HOSTNAME` must
stay `0.0.0.0` inside the container; the loopback-only publish in compose keeps
it off the public interface.

## Health check

The compose health check is a liveness probe: because the gate answers
unauthenticated requests with an HTTP error, "any HTTP response" means the
server is listening. It does not authenticate; the gate's behavior is what you
exercise through the real proxy.

## Maintenance

- The headless-shell version/sha pin is inherited from the prior fork; bump
  `CHROME_HEADLESS_SHELL_VERSION` and `CHROME_HEADLESS_SHELL_SHA256` together
  when refreshing Chrome.
