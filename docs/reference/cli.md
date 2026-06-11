# CLI reference

`datasynx-cartography <command>` (the discovery/management CLI) and
`cartography-mcp` (the MCP server binary).

| Command | Purpose |
| --- | --- |
| `discover` | Scan and map your infrastructure (`--output-format text\|json\|stream-json`). |
| `diff [base] [current]` | Compare two sessions for drift (`--format text\|json\|mermaid`). |
| `seed` | Manually add known tools/DBs/APIs. |
| `install --client <id>` | Register the MCP server into a host's config. |
| `list-clients` | List supported hosts. |
| `mcp` | Run the MCP server (stdio by default; `--http` for Streamable HTTP). |
| `export [session]` | Export Mermaid / JSON / YAML / HTML. |
| `show [session]` | Show session details. |
| `sessions` | List all sessions. |
| `overview` | Aggregate overview across sessions. |
| `bookmarks` | View browser bookmarks. |
| `doctor` | Check requirements (kubectl, aws, gcloud, az). |
| `prune` | Remove old sessions. |
| `docs` | Full in-terminal feature reference. |

## `mcp` flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--http` | off | Use Streamable HTTP instead of stdio. |
| `--port <n>` | `3737` | HTTP port. |
| `--host <h>` | `127.0.0.1` | HTTP host. |
| `--allowed-hosts <list>` | — | Host allowlist (required for non-loopback `--host`). |
| `--db <path>` | default catalog | Catalog to serve. |
| `--session <id>` | `latest` | Session to serve. |
| `--no-semantic` | — | Disable semantic (vector) search. |
