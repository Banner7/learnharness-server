# Custom and local models

LearnHarness Server connects to OpenAI-compatible endpoints, including local model servers, through the `customProviders` section of the server's config file (`LH_CONFIG_FILE`; see [deployment](../deploy/README.md#config-file)). There is no in-app endpoint editor. Providers are declared on the server, and their models appear in the model menus. [Claude Code](claude-code.md) is a separate provider.

## Schema

`customProviders` is a JSON array. Unknown fields are rejected. The schema is defined in [`src/core/server-config.ts`](../src/core/server-config.ts).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Required. Lowercase letters, digits, and `-`, starting with a letter. Must be unique and must not collide with a built-in provider id. |
| `name` | string | Optional display name; defaults to `id`. |
| `baseUrl` | string | Required. Full API base URL, used as given (no `/v1` is appended). HTTPS, or plain HTTP only for hosts that stay off the public internet: loopback (`localhost`, `127.x.x.x`, `[::1]`), private IPv4 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), single-label hostnames such as a Docker service name (`ollama`), and `host.docker.internal`. No user info, query, or fragment. |
| `apiKey` | secret | Optional. Sent as a bearer token. |
| `headers` | object | Optional map of header name to secret. |
| `models` | array | Required, at least one. Model ids must be unique within the provider. |

A **secret** is either an inline string or `{"env": "NAME"}`, resolved on the server at request time: the environment variable `NAME` if it is set, otherwise `keys.NAME` from the same config file. The `env` form keeps one secret in one place and shows it masked on the Providers page. `NAME` must not start with `LH_` or `NODE_`: those variables hold the server's own gate and runtime settings (such as the access token), and a reference to one would send it to the provider. Any other name works, including header secrets such as `GATEWAY_CF_CLIENT_ID`; a file that breaks this rule is rejected as a whole.

Each model:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Required. Model id sent to the endpoint. |
| `name` | string | Optional display name. |
| `contextWindow` | positive integer | Required. Context budget used for requests and compaction. |
| `maxTokens` | positive integer | Required. Maximum output tokens. |
| `input` | array | `["text"]` (default) or `["text", "image"]`. A model needs `["text", "image"]` to receive images and to be offered for the Vision slot. |
| `reasoning` | boolean | Default `false`. Declares reasoning support. |
| `compat` | object | Optional: `supportsStore`, `supportsDeveloperRole`, `supportsReasoningEffort`, `supportsUsageInStreaming` (booleans), `maxTokensField` (`"max_tokens"` or `"max_completion_tokens"`). |

## Example

In the config file (`config.json`):

```json
{
  "version": 1,
  "keys": { "GATEWAY_API_KEY": "..." },
  "customProviders": [
    {
      "id": "local",
      "name": "Local server",
      "baseUrl": "http://ollama:11434/v1",
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
  ]
}
```

## Behavior

- The config file is re-read when it changes: added, removed, or edited providers take effect without a restart. A single-file Docker bind mount follows the original inode, so an editor that saves by replacing the file needs a container restart.
- An invalid file (bad JSON, a schema violation, a duplicate id, or an id reserved by a built-in provider) is ignored as a whole: environment keys and built-in providers keep working, the server logs the error once, and the Providers page shows it.
- A provider counts as available only when every `{"env": ...}` secret it references resolves. Values containing newlines or NUL characters are rejected.
- In the Docker image, `localhost` is the container itself. Reach a backend on the host through `host.docker.internal` (add `extra_hosts: ["host.docker.internal:host-gateway"]` on Linux) and a sibling container through its service name, as in the example.
- Without an `apiKey` and without an `Authorization` header, no `Authorization` header is sent.
- Only provider ids and names reach the browser. Base URLs, keys, and headers stay on the server. The Providers page shows referenced secrets masked.
- There is no model discovery. List every model you want to use.
- `contextWindow` and `maxTokens` are request and compaction budgets, not commands to the backend. Configure the server's own limits to match.
- `reasoning: true` declares a capability; it does not force thinking on, and choosing Off may not disable a backend's default thinking.
- Prices are unknown, not $0, even for a local server. See [accounting](compaction-accounting.md).
- LearnHarness does not install backends or download models.
