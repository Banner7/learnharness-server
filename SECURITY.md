# Security policy

LearnHarness Server reads API keys from its server environment, stores chats and learning records on the server, and its agent reads files and fetches web content on your behalf. If you find a way to abuse any of that, please tell us privately so a fix can ship before the details are public.

## Reporting a vulnerability

**Do not open a public issue, pull request, or Discord post for a security problem.**

Report it through GitHub's private vulnerability reporting:
[Security → Report a vulnerability](https://github.com/Banner7/learnharness-server/security/advisories/new).

Issues that also affect upstream LearnHarness should additionally be reported to [upstream](https://github.com/amosblomqvist/learnharness/security/advisories/new).

A useful report includes:

- the LearnHarness Server version and how it is deployed (image, reverse proxy);
- what an attacker can do and what they need first (a web page the agent reads, a file the learner opens, network access, and so on);
- steps to reproduce, or a proof of concept;
- any fix or mitigation you have in mind.

## What to expect

These are targets, not guarantees:

| Step | Target |
| --- | --- |
| Acknowledge your report | within 7 days |
| Initial assessment (confirmed or not, severity) | within 14 days |
| Fix released and advisory published | within 90 days of the report |

The fix is developed privately in a GitHub security advisory. We will keep you updated, agree on a disclosure date with you, and credit you in the published advisory unless you prefer to stay anonymous. A CVE can be requested through GitHub when one is warranted.

## Supported versions

Only the latest release receives security fixes. There is no automatic updater: rebuild or pull the latest release image, or update a source checkout to the latest `main` or release tag.

## Scope

In scope:

- the access gate (`LH_WEB_ORIGIN`, `LH_WEB_ACCESS_TOKEN`, `LH_TAILSCALE_USERS`) and anything that bypasses it;
- the API server and the Docker image;
- the agent and its tools, including prompt injection from web pages, PDFs, or other content that leads to reading, changing, or sending your data;
- rendered content such as demos, figures, and markdown;
- the release pipeline.

Out of scope:

- attacks that already require running code as the server's OS user;
- code run by the Coding Questions plugin or by installed community plugins, which are unsandboxed by design;
- deployments that publish the port without the documented loopback listener and authenticated proxy;
- bugs in third-party model or service providers themselves (report those to the provider);
- automated scanner output without a demonstrated impact on LearnHarness.

Built-in hardening: the agent's file tools refuse the credential directory (the folder holding `LH_AUTH_FILE`), the Claude Code config directory (`CLAUDE_CONFIG_DIR`), `/proc`, and `/sys`, and the Coding Questions plugin runs test programs with a minimal environment (`PATH`, `LANG`, and a temporary `HOME`/`TMPDIR`).

**Coding Questions is code execution.** Enabling it runs model-authored programs as the server's user, with network access. Such a program can read the server's secrets (the server process environment through `/proc`, `auth.json`, and the Claude Code config directory) and change its data. A prompt injection can trigger this. Keep the plugin disabled unless you accept that.
