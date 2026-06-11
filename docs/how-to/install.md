# How to install Cartography into a client

## Claude Code — one-step plugin (recommended)

Cartography ships as a Claude Code plugin in the shared Datasynx marketplace, so
no manual config editing is needed:

```text
/plugin marketplace add datasynx/claude-plugins
/plugin install cartography@datasynx
```

Verify the server is live with `/mcp`. This is the same flow as the
[`shadowing`](https://github.com/datasynx/agentic-ai-shadowing) plugin; the
plugin manifest lives in [`plugin/`](https://github.com/datasynx/agentic-ai-cartography/tree/main/plugin)
of this repository.

## Every other host — the `install` harness

The `install` command parses your host's existing config and merges in the
Cartography MCP server **without clobbering** your other servers.

```bash
datasynx-cartography list-clients                 # see supported hosts
datasynx-cartography install --client <id>        # write the config
datasynx-cartography install --client <id> --dry-run   # preview the merge diff
```

## Scopes

- `--global` (default) — your user-level config.
- `--project` — a project-local config (e.g. `.mcp.json`, `.vscode/mcp.json`).

## Options

| Flag | Purpose |
| --- | --- |
| `--dry-run` | Print the merge diff; write nothing. |
| `--name <server>` | Server key to register (default `cartography`). |
| `--http` / `--url <url>` | Register the Streamable HTTP endpoint instead of stdio. |
| `--db <path>` | Serve a specific catalog. |
| `--session <id>` | Serve a specific discovery session. |
| `--deeplink` | Print a one-click Cursor/VS Code install link instead of writing. |

## One-click deeplinks

```bash
datasynx-cartography install --client cursor --deeplink
datasynx-cartography install --client vscode --deeplink
```

See the full host matrix in the [Reference → Supported clients](/reference/clients).
