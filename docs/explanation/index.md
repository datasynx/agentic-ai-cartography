# Why MCP-first?

Cartography's primary interface is a **Model Context Protocol** server, not a CLI or
a library. That choice is deliberate.

## One integration surface, every host

The [Model Context Protocol](https://modelcontextprotocol.io) is the common
denominator across AI hosts and agent frameworks. By exposing discovery as an MCP
server, Cartography works in Claude Code, Cursor, VS Code, Cline, Windsurf, Zed,
LangGraph, CrewAI and more — without bespoke integrations for each.

## Read-only by construction

Every tool is annotated `readOnlyHint: true`; the command allowlist rejects anything
that mutates. The server *describes* your landscape — it never changes it.

## Progressive disclosure

Agents read `cartography://graph/summary` first (a low-token index), then drill into
specific nodes. This keeps token usage bounded even for large landscapes — important
where hosts cap tool output or total tool count.

## The CLI and SDK are adapters

The `datasynx-cartography` CLI and the embeddable library are thin layers over the
same core. The MCP server is the headline; everything else is convenience.
