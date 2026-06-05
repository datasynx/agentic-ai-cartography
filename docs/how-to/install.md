# How to install Cartography into a client

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
