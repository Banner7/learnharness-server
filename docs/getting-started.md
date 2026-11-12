# Getting started

LearnHarness Server runs in a container on a server you control; see [deploy/README.md](../deploy/README.md). Open the configured origin in a browser and sign in with username `learnharness` and the server's access token (or through an allowlisted Tailscale identity). For running from source, see [Development](development.md).

## Connect models

Connections are configured on the server, not in the app. **Settings → Providers** shows which credentials the server has; it cannot add or change them.

- **Provider API keys:** set the provider's environment variable (for example `OPENAI_API_KEY`) or add it to the `keys` section of the server's config file (`LH_CONFIG_FILE`). Environment values take precedence.
- **[Claude Code](claude-code.md):** the CLI pinned in the image, authenticated with `CLAUDE_CODE_OAUTH_TOKEN` and enabled in the server config file. Its own configuration controls routing and billing.
- **[Custom providers](custom-providers.md):** OpenAI-compatible endpoints declared in the config file's `customProviders`, including a local model server.

There are no ChatGPT, GitHub Copilot, or Grok sign-in connections.

Choose **Strong**, **Cheap**, and **Vision** models in Settings. There are no factory model selections. New sessions start with Strong; background roles use their assigned slots or role overrides. A model selected inside an existing session belongs to that session and does not change background-role choices.

Optional web search supports Tavily, Brave, Exa, Firecrawl, and hosted Ollama search; set the key for the engine you want to use on the server. Research can still fetch known URLs without a search key. Dictation has its own service key below.

## Start a session

Choose **Teach** and describe what you want to understand. The agent probes your starting point, presents a plan, and teaches through explanations and checks. Reply naturally to accept or revise the plan.

Use the thinking fields to explain your reasoning, uncertainty, or reaction—not only your selected answer. You can type or dictate. Your confidence is self-reported, not an independent assessment.

Choose **Practice** for problems rather than a lesson. Start from selected graph material or describe material directly. Submit your thinking as you work; the model's committed solution is revealed when the problem concludes. Use **Next problem** when ready to continue.

Sessions are saved on the server, including earlier messages when context is compacted. The [keyboard guide](keyboard.md) covers submission, focus, question controls, and cancellation.

## Dictation

1. Create a [Deepgram API key](https://console.deepgram.com/) with the **Member role or higher**, required for [short-lived token minting](https://developers.deepgram.com/reference/auth/tokens/grant).
2. Set it as `DEEPGRAM_API_KEY` on the server, then choose the language under **Settings → Providers → Dictation**. **Multilingual** supports automatic recognition and mixed-language speech.
3. Use the microphone or **Mod+D** to start and stop. Review the text before sending. **Esc cancellation discards the pending transcript**; stop normally to keep it.

Audio streams from your browser directly to Deepgram using a short-lived token. A `403 Insufficient permissions` error while obtaining that token can mean the key's role is insufficient.

## Use server files in a session

The agent reads files on the machine running the server, not on your browser's device. Files from your phone or laptop cannot be attached; paste a full server path into the message instead. Attaching a path does not grant permissions, and it is **not an upload**: originals stay where they are. The agent can locate and read supported content under the existing file-access guards.

The teacher can show a local raster image or request an annotated visual based on it. Displayed/annotated pictures are saved as session-owned snapshots, so those saved results no longer depend on the original file. This does not snapshot every file attachment. Offline regression tests cover snapshot/payload behavior, not the quality of model-generated annotations.

File tools are read-only but have broad filesystem access under the server's user; they are not confined to a selected folder. The sensitive-path guard blocks known credential/private locations, not all sensitive content. Review what you make available: file content read by an agent may be sent to its configured model provider. See [file-access boundaries](architecture.md#file-access-and-external-services).

## Extract into the graph

For lessons, attach material to a session instead. Use the graph's **Extract files… → Files** or **Folder** picker for Markdown, plain text, or PDFs. This is a separate import flow, not the session's path attachments. Extract files accepts `.txt`, `.md`, `.markdown`, `.rst`, `.org`, `.adoc`, `.tex` and `.pdf` (any letter case); other extensions are turned away with a short message. Each supported file is uploaded for processing; folders organize imported sources.

- Files are limited to **25 MiB each**. Imports queue independently, with up to three files in flight.
- Within the accepted extensions, PDFs are recognized by their `%PDF-` header and converted locally, without OCR. Image-only pages are skipped and counted; scanner text can be inaccurate. Check the import's notices.
- Other files are read as UTF-8. A zero byte in the first 8 KiB causes rejection before source registration or model calls. This catches many binary files renamed to `.txt`, but is not complete binary detection; UTF-16 text is not decoded correctly and is often rejected. Save text as UTF-8.
- Imported text then goes through model-based proposition/chain extraction. Local PDF conversion does not make the whole import offline.
- Completed chunks survive later failures. Retry is explicit and reprocesses the file; unchanged content is not automatically skipped. The file queue does not survive a page reload.

If the server sets `LH_VAULT_DIR`, **Settings → Library** follows that Markdown folder read-only: **Sync now** extracts new and changed notes, auto-extract is off by default, a skip list excludes paths, and notes that disappear are listed for review.

The graph stores propositions and reasoning chains with source provenance, **not mastery scores**. A proposition's presence is not proof that you understood or retained it. Automatic session extraction can be disabled independently of graph rendering.

## Data, privacy, and usage

Chats, graph records, and settings live under the server's data directory (`LH_DATA_DIR`, `/data` in the image). Credentials live in the server environment or in the config file beside it (`LH_CONFIG_FILE`), which is plaintext with restrictive file permissions, not an encrypted vault. Keep these private; do not share credential files or raw debug captures in bug reports.

**Local storage does not mean local-only processing.** Configured models, the Claude Code CLI, web research, and dictation can receive content. A local custom model is a separate setup choice, not an offline guarantee for other enabled services.

Click the context/cost row beneath the composer for Session stats. Dollar figures estimate known API costs; CLI and custom-provider usage are not treated as free. See [context, caching, and costs](compaction-accounting.md) for the details.

To update, build or pull a newer image and recreate the container. Report problems through [GitHub Issues](https://github.com/Banner7/learnharness-server/issues), with reproduction steps and the version rather than private learning records or keys.
