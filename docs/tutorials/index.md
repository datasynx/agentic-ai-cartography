# Tutorial: from zero to an agent that knows your system

A guided, first-run walkthrough. By the end you'll have discovered your local
landscape and queried it from an AI client.

## 1. Discover (read-only, no LLM required)

```bash
npx -y --package @datasynx/agentic-ai-cartography datasynx-cartography discover
```

This scans your machine deterministically — installed apps, listening ports,
browser bookmarks — and writes a catalog. Nothing leaves your machine.

## 2. Run the MCP server

```bash
npx -y --package @datasynx/agentic-ai-cartography cartography-mcp
```

The server speaks the Model Context Protocol over stdio.

## 3. Connect a client

Let the harness write the config for you:

```bash
datasynx-cartography install --client claude-code
```

Restart the host, then ask it: *"Read cartography://graph/summary and describe my system."*

Next: the [How-to guides](/how-to/) for specific tasks, or the [Reference](/reference/).
