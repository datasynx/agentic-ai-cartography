# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through one of:

- GitHub's [private vulnerability reporting](https://github.com/datasynx/agentic-ai-cartography/security/advisories/new)
  (preferred — **Security → Advisories → Report a vulnerability**).
- Email: **majone.software@gmail.com** with subject `SECURITY: agentic-ai-cartography`.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (proof-of-concept if possible).
- Affected version(s) and environment.

We aim to acknowledge reports within **72 hours** and to ship a fix or
mitigation for confirmed issues as quickly as is practical, crediting reporters
who wish to be named.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 2.x     | ✅        |
| < 2.0   | ❌        |

## Security model

This tool performs **read-only** infrastructure discovery. Its safety boundary
is the read-only allowlist in `src/allowlist.ts`, which is enforced for every
command spawned by `run()` (`src/platform.ts`) regardless of origin (scanner,
agent, or MCP tool). Key guarantees and expectations:

- **No destructive commands.** Anything not provably read-only is rejected.
- **Scan parameters are validated** before being placed in a shell command
  (`src/tools.ts`, `assertSafeScanArg`), so user/agent-supplied values cannot
  inject additional commands.
- **Credentials are redacted** from node ids and metadata before they are
  persisted (`stripSensitive`, `redactValue`).
- **The HTTP transport requires authentication** when bound to a non-loopback
  host: a bearer token (`--token` / `CARTOGRAPHY_HTTP_TOKEN`) is mandatory, and
  DNS-rebinding protection plus a Host allowlist are enforced.

If you find a way around any of these, it is a vulnerability — please report it.
