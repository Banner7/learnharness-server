# Custom and local models

LearnHarness Server connects to OpenAI-compatible endpoints, including local model servers, through the `LH_CUSTOM_PROVIDERS` environment variable. There is no in-app endpoint editor. Providers are declared on the server, and their models appear in the model menus. [Claude Code](claude-code.md) is a separate provider.

## Schema

`LH_CUSTOM_PROVIDERS` is a JSON array. Unknown fields are rejected. The schema is defined in [`src/agent/custom-providers.ts`](../src/agent/custom-providers.ts).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Required. Lowercase letters, digits, and `-`, starting with a letter. Must be unique and must not collide with a built-in provider id. |
| `name` | string | Optional display name; defaults to `id`. |
| `baseUrl` | string | Required. Full API base URL, used as given (no `/v1` is appended). HTTPS, or HTTP only for `localhost`, `127.0.0.1`, or `[::1]`. No user info, query, or fragment. |
| `apiKey` | secret | Optional. Sent as a bearer token. |
| `headers` | object | Optional map of header name to secret. |
| `models` | array | Required, at least one. Model ids must be unique within the provider. |

A **secret** is either an inline string or `{"env": "NAME"}`, which reads environment variable `NAME` on the server at request time. Prefer the `env` form so the JSON holds no secrets.

Each model:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Required. Model id sent to the endpoint. |
| `name` | string | Optional display name. |
| `contextWindow` | positive integer | Required. Context budget used for requests and compaction. |
| `maxTokens` | positive integer | Required. Maximum output tokens. |
| `input` | array | `["text"]` (default) or `["text", "image"]`. |
| `reasoning` | boolean | Default `false`. Declares reasoning support. |
| `compat` | object | Optional: `supportsStore`, `supportsDeveloperRole`, `supportsReasoningEffort`, `supportsUsageInStreaming` (booleans), `maxTokensField` (`"max_tokens"` or `"max_completion_tokens"`). |

## Example

```sh
LH_CUSTOM_PROVIDERS='[
  {
    "id": "local",
    "name": "Local server",
    "baseUrl": "http://localhost:11434/v1",
    "models": [
      { "id": "qwen3:14b", "contextWindow": 32768, "maxTokens": 8192, "reasoning": true }
    ]
  },
  {
    "id": "gateway",
    "baseUrl": "https://llm.example.com/v1",
    "apiKey": { "env": "GATEWAY_API_KEY" },
    "headers": { "X-Team": "learning" },
    "models": [
      { "id": "vision-model", "contextWindow": 128000, "maxTokens": 16384, "input": ["text", "image"] }
    ]
  }
]'
GATEWAY_API_KEY=...
```

## Behavior

- The variable is parsed when first used and again whenever its value changes. Invalid JSON, a schema violation, or a duplicate id raises an error that names `LH_CUSTOM_PROVIDERS`.
- A provider counts as available only when every `{"env": ...}` secret it references is set. Values containing newlines or NUL characters are rejected.
- Without an `apiKey` and without an `Authorization` header, no `Authorization` header is sent.
- Only provider ids and names reach the browser. Base URLs, keys, and headers stay on the server. The Providers page shows referenced secrets masked.
- There is no model discovery. List every model you want to use.
- `contextWindow` and `maxTokens` are request and compaction budgets, not commands to the backend. Configure the server's own limits to match.
- `reasoning: true` declares a capability; it does not force thinking on, and choosing Off may not disable a backend's default thinking.
- Prices are unknown, not $0, even for a local server. See [accounting](compaction-accounting.md).
- LearnHarness does not install backends or download models.

Changing the variable requires restarting the server process (or recreating the container) so the new environment is visible.
