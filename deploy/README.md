# LearnHarness — container deployment

Build and run the v0.2.2 server (Next.js standalone) in a container, behind an
authenticated reverse proxy (e.g. Tailscale Serve). The app's own access gate
is fail-closed: without the gate variables configured, **every request is
refused**, which is the intended safety property for a public deployment.

> The example files here are templates. Copy them into a private deployment
> repo (they hold real hostnames, keys and credentials in practice) and never
> commit `secrets/runtime.env`.

## Build

```sh
docker build -t learnharness:0.2.2 .
```

The build runs `npm ci` → `npm run plugins:setup` → `npm run build` (core
plugins + authoring kit + `next build`) → `node scripts/build-server.mjs`
(which curates `.next/standalone`). The final image is `amd64`-only because
Chrome for Testing publishes no linux-arm64 headless shell.

## Run

```sh
mkdir -p data secrets/config claude
# uid 1000 owns the Claude CLI state dir (the `node` user in the image).
chown 1000:1000 claude
# The config directory holds ONLY config.json (never runtime.env).
cp deploy/config.example.json secrets/config/config.json
chmod 600 secrets/config/config.json && chown -R 1000:1000 secrets/config
# Copy to the repository root: build: . and ./data resolve relative to the
# compose file, so a copy inside deploy/ points at the wrong directories.
cp deploy/compose.example.yml compose.yml
# Edit compose.yml, secrets/runtime.env and secrets/config/config.json, then:
docker compose up -d
```

The port is published loopback-only (`127.0.0.1:3000`). Put Tailscale Serve
(or an equivalent authenticated proxy) in front of it.

### Secrets layout

```text
secrets/
  runtime.env       # read by compose (env_file); never mounted into the container
  config/
    config.json     # optional; the directory is mounted read-only as /secrets/config
```

Only the `config/` directory is mounted, read-only, because `config.json` is
the only secrets file the app reads at runtime, and the app never writes it.
The directory is mounted rather than the file: editors, `sed -i` and atomic
writers save by writing a new file and renaming it over the old one, and a
single-file bind mount would stay pinned to the old inode, so an edit (or a
key revocation) would go unseen until a restart. Keep only `config.json` in
that directory and **never put `runtime.env` there**; it would then be
readable inside the container. Keeping `runtime.env`
out of the container means a file-reading bug cannot expose it. If you keep
every key in `runtime.env` and use neither custom providers nor Claude Code,
delete the `config` volume line.

### Config file

`config.json` (path: `LH_CONFIG_FILE`, `/secrets/config/config.json` in the image)
is one JSON object. Every section is optional; unknown fields are rejected.
Start from [`config.example.json`](config.example.json):

```json
{
  "version": 1,
  "keys": { "OPENROUTER_API_KEY": "sk-or-...", "TAVILY_API_KEY": "tvly-..." },
  "customProviders": [],
  "claudeCode": { "enabled": false }
}
```

| Section | Purpose |
| --- | --- |
| `keys` | Provider and tool keys by environment-variable name (list below), plus any secret a custom provider references. A real environment variable with the same name wins. Empty values are ignored. |
| `customProviders` | OpenAI-compatible providers; see [docs/custom-providers.md](../docs/custom-providers.md). Only `{id, name}` summaries reach the browser. |
| `claudeCode` | `{"enabled": true}` turns on the Claude Code provider; see [docs/claude-code.md](../docs/claude-code.md). |

The app re-reads the file when it changes, so keys, custom providers and the
Claude Code switch take effect without a restart. To change it safely, write
a temporary file in the same directory and rename it over `config.json` (most
editors do this). If the file is invalid (bad JSON, unknown field,
duplicate or reserved provider id), the server logs the error once and ignores
the whole file until it is fixed: environment keys and built-in providers keep
working, and the Providers page shows the error.

### Upgrading from 0.1.x

0.2.0 no longer reads `LH_AUTH_FILE`, `LH_CUSTOM_PROVIDERS` or the
`claudeCode` entry in `data/settings.json`; the server logs a warning if either
variable is still set.

1. Create `secrets/config/config.json` with `"version": 1` (the `config/` directory holds nothing else).
2. Move every entry of `secrets/auth.json` into `"keys"` unchanged.
3. Move the `LH_CUSTOM_PROVIDERS` array into `"customProviders"` and delete the
   variable from `runtime.env`. `{"env": "NAME"}` secrets may now also be
   stored in `"keys"`.
4. If `data/settings.json` had `"claudeCode": {"enabled": true}`, set
   `"claudeCode": {"enabled": true}` in the config file. The old entry is
   dropped from settings automatically.
5. In `compose.yml`, replace `LH_AUTH_FILE` with
   `LH_CONFIG_FILE: /secrets/config/config.json` and the `auth.json` volume with
   `./secrets/config:/secrets/config:ro`, then delete
   `secrets/auth.json` and run `docker compose up -d`.

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
token, provider keys, `CLAUDE_CODE_OAUTH_TOKEN`), `/secrets/config/config.json` and
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
| `./secrets/config:/secrets/config:ro` (optional) | Read-only operator config (see [Config file](#config-file)). Only this directory, holding only `config.json`, is mounted; `secrets/runtime.env` stays on the host. |
| `./claude:/claude` | Claude Code CLI state; owned by uid 1000 (see `CLAUDE_CONFIG_DIR`). |
| `./vault:/vault:ro` (optional) | Markdown notes library (see `LH_VAULT_DIR`). |

`no-new-privileges` and `cap_drop: ALL` are recommended; the headless shell is
run with `--no-sandbox` by the demo verifier, so nothing needs extra caps.

## Environment variables

Gate secrets belong in `secrets/runtime.env` (read by compose via
`env_file`); keys may live there or in `config.json`. Values below are
placeholders — generate real ones per the instructions.

### Access gate (required — fail-closed)

| Variable | Purpose |
| --- | --- |
| `LH_WEB_ORIGIN` | Exact public HTTPS origin, e.g. `https://learn.example.com`. No path, query or userinfo (a bare trailing `/` is accepted). The gate pins `Host` and `Origin` to it. |
| `LH_WEB_ACCESS_TOKEN` | 64-hex secret: `openssl rand -hex 32`. HTTP Basic password, username `learnharness`. |
| `LH_TAILSCALE_USERS` | Optional comma-separated Tailscale logins admitted by identity (`Tailscale-User-Login`) without a password. Only safe when the listener is reachable solely through Tailscale Serve; see the security note above. |

### Vault library (optional)

| Variable | Purpose |
| --- | --- |
| `LH_VAULT_DIR` | Path to a read-only Markdown notes folder (e.g. `/vault`) the library follows. |
| `LH_VAULT_EXCLUDE` | Comma-separated skip patterns (`folder/`, `path/note.md`, `*`/`**` globs) that seed the Settings → Library skip list until one is saved. |

### Data, auth and hosts

| Variable | Purpose |
| --- | --- |
| `LH_DATA_DIR` | Mutable state root. Defaults to `/data` in the image. |
| `LH_CONFIG_FILE` | Read-only operator config file (keys, custom providers, Claude Code). Defaults to `/secrets/config/config.json` in the image. See [Config file](#config-file). |
| `LH_HOST_PORT` | Compose only: loopback host port to publish (default `3000`). |

### Claude Code CLI

| Variable | Purpose |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Token from `claude setup-token`; authenticates the pinned CLI. May also go in the config file's `keys`. |
| `CLAUDE_CONFIG_DIR` | Writable CLI state dir. Defaults to `/claude` in the image. |
| `DISABLE_AUTOUPDATER` | Set to `1` (default in image) so the pinned CLI never self-updates. |

The Claude Code provider is opt-in via `"claudeCode": {"enabled": true}` in
the config file (there is no in-app toggle). See
[docs/claude-code.md](../docs/claude-code.md).

### Provider API keys (optional — any subset)

The app is BYOK; set only the keys for providers you use, in the config
file's `keys` or in `runtime.env` (environment wins). Full list from
`src/core/auth-keys.ts`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`,
`MISTRAL_API_KEY`, `XAI_API_KEY`, `ZAI_API_KEY`, `TOGETHER_API_KEY`,
`CEREBRAS_API_KEY`, `FIREWORKS_API_KEY`, `NVIDIA_API_KEY`, `HF_TOKEN`,
`KIMI_API_KEY`, `META_API_KEY`, `MINIMAX_API_KEY`, `MINIMAX_CN_API_KEY`,
`MOONSHOT_API_KEY`, `BASETEN_API_KEY`, `RADIUS_API_KEY`,
`AI_GATEWAY_API_KEY`, `XIAOMI_API_KEY`, `ANT_LING_API_KEY`,
`OPENCODE_API_KEY`, `QWEN_TOKEN_PLAN_API_KEY`, `QWEN_TOKEN_PLAN_CN_API_KEY`,
`TYPESAFE_API_KEY`, `ZAI_CODING_CN_API_KEY`.

Search adapters: `TAVILY_API_KEY`, `BRAVE_API_KEY`, `EXA_API_KEY`,
`FIRECRAWL_API_KEY`, `OLLAMA_API_KEY`.

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
