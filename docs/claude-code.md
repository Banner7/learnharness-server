# Claude Code

LearnHarness can use an externally installed **Claude Code CLI** as a model provider. This is separate from the Anthropic API. The CLI owns authentication, routing, model access, and billing; LearnHarness does **not** guarantee subscription-only use.

## Set up

The Docker image includes a pinned Claude Code CLI (`/usr/local/bin/claude`) running as the image's `node` user. Enablement is in the server's config file; there is no toggle in the app.

1. Create a token with `claude setup-token` on any machine where you can sign in, and set it as `CLAUDE_CODE_OAUTH_TOKEN` in the server environment or in the config file's `keys`.
2. Keep `CLAUDE_CONFIG_DIR` (default `/claude` in the image) on a volume writable by uid 1000. `DISABLE_AUTOUPDATER=1` keeps the pinned CLI from updating itself.
3. Add `"claudeCode": {"enabled": true}` to the config file (`LH_CONFIG_FILE`, `/secrets/config/config.json` in the image; see [deployment](../deploy/README.md#config-file)). The file is re-read when it changes and the switch is checked on every new admission, so no restart is needed. Remove it or set `false` to turn the provider off.
4. Select a Claude Code model: `opus`, `sonnet`, or `haiku`. These are CLI aliases, not pinned underlying versions.

Outside the image, install and authenticate the CLI under the server's OS user and make `claude` discoverable in that user's `PATH`. **Settings → Providers** shows installation status read-only.

The minimum version is **2.1.259** ([contract](../src/core/contracts/claude-code.ts)). The check runs only `--version`, not authentication or inference. Fresh model processes check again and refuse old/unverifiable versions. Passing proves neither account access, quota, billing method, nor complete protocol compatibility.

Install, update, sign in, and change CLI accounts externally. LearnHarness has no CLI account-status or reauthentication control. Disabling the setting blocks future requests without rewriting model selections or signing out the CLI; it does not interrupt an already admitted turn. Use normal cancellation for running work.

## What goes through the CLI

LearnHarness keeps control of its agent loop, tools, questions, saved history, and jobs. It supplies prompts, relevant history, and tool results to the CLI's configured service.

The CLI receives an allowlisted environment: its own `CLAUDE_*`/`ANTHROPIC_*` variables, Bedrock/Vertex routing (`AWS_*`, `GOOGLE_*`, `CLOUD_ML_REGION`), locale, temp, proxy, and TLS settings from the server's launch environment, plus `CLAUDE_CODE_OAUTH_TOKEN` from the config file. Other keys from the config file, such as `ANTHROPIC_API_KEY` for LearnHarness's own Anthropic provider, are never passed. Launch-environment credentials and native CLI authentication remain available and may affect billing.

Each child runs without a shell in an empty temporary working directory. LearnHarness disables built-in tools, hooks, slash commands, CLI session persistence, and permission prompts, and exposes its own declared tools through a token-protected loopback MCP bridge. Streamed tool intent is insufficient: execution requires an authenticated MCP request whose unique identity, name, and arguments match the stream. There is no stdout-only fallback.

These are integration boundaries, **not an OS sandbox or a provider-policy certification**. User settings/authentication remain available. Managed settings still take precedence where the CLI defines them. Bounded CLI stderr is logged when the process closes, so server logs can contain CLI diagnostics.

### Instruction loading

LearnHarness forces `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` in the child environment **and** inline settings, and pins `outputStyle: default`. User auth/routing settings otherwise remain available. The CLI's documented memory switch excludes user/project/managed-policy `CLAUDE.md` instructions, their imports/rules, and auto memory; it does not remove managed settings.

These controls depend on the CLI honoring them. Instruction isolation at the accepted minimum **2.1.259 has not been runtime verified**. Official documentation does not establish the switch's first supported version or exact startup evaluation order; managed settings can outrank inline settings. This is not a guarantee against every plugin instruction channel or CLI-added account context.

Official references: [memory switch](https://code.claude.com/docs/en/env-vars#variables), [managed instruction files](https://code.claude.com/docs/en/memory#deploy-organization-wide-claude-md), [settings precedence](https://code.claude.com/docs/en/settings#settings-precedence), and [settings environment values](https://code.claude.com/docs/en/settings-reference#env).

## Questions, reuse, and cancellation

The persisted LearnHarness transcript—not a CLI saved session—is authoritative. A child normally exits after its final response. It can stay alive while tools await results, including a learner question, and resume only for the same owner/session and compatible history, tools, model, prompt, effort, and environment.

Held children expire after **10 minutes** idle. The CLI MCP timeout is **30 minutes**, providing headroom rather than a general model deadline. If no eligible child remains after timeout/restart/configuration change, the next call starts fresh and replays active history as labelled user/assistant/tool text, preserving user/tool images. This is not CLI `--resume` or exact native-role/thinking restoration. Admitted compatibility failures are reported, not silently hidden by replay.

Abort terminates the child and active stream. Cancelling a queued tool request prevents later admission but cannot undo already admitted work. Normal exit, failure, abort, and idle expiry close bridge calls/listeners and remove temporary directories, escalating process termination if necessary. Cleanup is not guaranteed after an OS crash or forced server termination.

## Usage and troubleshooting

Tokens come from CLI stream usage, including cache counts. A best-effort local CLI query may report an effective context budget; it can be lower than the nominal model window because of CLI auto-compaction. Missing metadata leaves the maximum unknown, not guessed.

Dollar costs remain **unpriced** and menus say **CLI billing**. LearnHarness does not import successful CLI result-line dollar totals; internal zero rates are placeholders, not free inference. Check actual charges and entitlements independently. See [accounting](compaction-accounting.md).

| Symptom | Check |
| --- | --- |
| Model absent/unavailable | Check `claudeCode.enabled` in the config file (and the Providers page for a config file error) and executable discovery under the server's OS user/environment. |
| Not found, unchecked, or update required | Repair or update the executable (in the image, rebuild with a newer pinned version). The bounded version probe times out after five seconds. |
| Meets minimum but requests fail | Check native authentication, routing, model access, and quota externally. |
| MCP identity/admission error | Investigate installed-CLI compatibility; do not bypass the bridge's admission checks. |
| Answer starts a new process | Expected after idle expiry, restart, or failed reuse validation. |
| No context maximum/dollar estimate | Missing budget metadata or CLI-controlled billing—not zero usage. |

## Maintainer entry points

[`src/agent/claude-code/`](../src/agent/claude-code/) contains discovery/launch, stream adaptation, MCP admission, reuse, replay, and context-window probing. The engine is registered in [`models.ts`](../src/agent/models.ts); credential provenance is in [`auth-env.ts`](../src/core/auth-env.ts). Settings status is exposed by [`server/claude-code.ts`](../src/server/claude-code.ts).

The `tests/claude-code-*.test.*` suites use synthetic CLI processes and MCP requests. They cover adapter contracts, not live account eligibility, provider approval, billing, or lesson quality.
