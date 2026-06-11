# Cartography — Claude Code plugin

This directory is the [Claude Code](https://docs.claude.com/en/docs/claude-code)
plugin for **Datasynx Cartography**. It bundles the Cartography MCP server so it
can be installed in one step from the shared Datasynx marketplace — the same way
as [`shadowing`](https://github.com/datasynx/agentic-ai-shadowing).

## Install

```text
/plugin marketplace add datasynx/claude-plugins
/plugin install cartography@datasynx
```

Verify the server is live with `/mcp` — you should see a `cartography` server
exposing the topology resources, tools and prompts. Discover your landscape
first (read-only, deterministic, no LLM) so the graph has data to serve:

```bash
npx -p @datasynx/agentic-ai-cartography datasynx-cartography discover
```

## What's inside

| File | Purpose |
| --- | --- |
| `.claude-plugin/plugin.json` | Plugin manifest (name, version, metadata, MCP wiring). |
| `.mcp.json` | Starts the Cartography MCP server over stdio via `npx`. |

The server is the published `@datasynx/agentic-ai-cartography` package, so the
plugin always tracks the latest release on npm.

## Marketplace registration

The plugin is referenced from the
[`datasynx/claude-plugins`](https://github.com/datasynx/claude-plugins)
marketplace via a `git-subdir` source pointing at this directory:

```json
{
  "name": "cartography",
  "description": "Read-only awareness of your system landscape — services, databases, SaaS, installed apps and dependencies — via MCP. Fully local.",
  "homepage": "https://datasynx.github.io/agentic-ai-cartography/",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/datasynx/agentic-ai-cartography.git",
    "path": "plugin"
  }
}
```

Add that object to the `plugins` array in the marketplace's
`.claude-plugin/marketplace.json` to make `cartography@datasynx` installable.

> Step-by-step procedure (pre-flight, validation, verification, rollback):
> [`SOP-marketplace-registration.md`](./SOP-marketplace-registration.md).
