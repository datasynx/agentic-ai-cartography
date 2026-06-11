# Threat model

Cartography performs **read-only** infrastructure discovery and exposes the result over the Model
Context Protocol. Its safety boundary is the read-only allowlist in
[`src/allowlist.ts`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/allowlist.ts),
enforced for every command spawned by `run()`
([`src/platform.ts`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/platform.ts))
regardless of origin — scanner template, agent, or MCP tool. This page makes the model behind that
boundary explicit: who the attacker is, what is worth protecting, where trust changes hands, and
which mechanism defends each crossing.

It complements the guarantee list in
[`SECURITY.md`](https://github.com/datasynx/agentic-ai-cartography/blob/main/SECURITY.md); that file
is the contract, this one is the reasoning.

## Attacker model

Three attackers are in scope:

1. **A malicious or compromised MCP client / agent.** It can call any exposed tool with any
   arguments and is assumed to *want* to run destructive commands, inject extra shell commands
   through scan parameters, or exfiltrate credentials. It is *not* trusted.
2. **Untrusted scanned content.** Bookmark titles, browser-history entries, and the stdout of host
   CLIs (`aws`, `gcloud`, `az`, `kubectl`, database clients) are attacker-influenceable data. A
   payload hidden there may try to smuggle instructions into the agent's context (prompt injection)
   or blow up the context window.
3. **A network attacker against the HTTP transport.** When the Streamable HTTP transport is bound to
   a non-loopback address, an unauthenticated peer or a DNS-rebinding origin may try to reach it.

Out of scope: an attacker who already has the user's shell, the host CLIs' own credential stores, or
the integrity of the operating system. Cartography trusts the host it runs on (see *Residual risk*).

## Assets

- **The local command-execution surface.** The single most valuable target — code that can run
  shell commands on the user's machine.
- **Cloud and cluster credentials.** AWS/GCP/Azure/Kubernetes configs the host CLIs read on
  Cartography's behalf.
- **Scanned personal data.** Browser bookmarks and history, installed applications.
- **The catalog.** Node ids, metadata, and edge evidence persisted to SQLite — which later re-enter
  an LLM context when an agent queries the topology.

## Trust boundaries

| # | Boundary | Untrusted side → trusted side |
|---|----------|-------------------------------|
| B1 | Agent/client → command execution | Tool calls and their string arguments → `run()` shell |
| B2 | Scanner output → catalog / LLM context | CLI stdout, bookmark/history text → persisted nodes, agent context |
| B3 | Network → HTTP transport | Remote requests → the MCP server |
| B4 | Catalog persistence | Node ids/metadata containing secrets → durable storage |

## Mitigations per boundary

Each mitigation is enforced in code; the citations point at the implementing lines.

| Boundary / threat | Mitigation | Location |
|---|---|---|
| **B1** Arbitrary / destructive command execution | Positive read-only **allowlist** (known-read-only binaries + per-tool verb rules), not a denylist — anything not provably read-only is rejected | [`src/allowlist.ts:14-29,44-65,181-222`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/allowlist.ts#L14-L222) |
| **B1** Command injection via substitution | `$()` and backticks rejected before execution | [`src/allowlist.ts:211`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/allowlist.ts#L211) |
| **B1** Shell-arg injection through scan parameters | `assertSafeScanArg` validates region/profile/project/namespace/etc. against strict regexes before they are spliced into a command | [`src/tools.ts:83-114`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/tools.ts#L83-L114) |
| **B1** Defense-in-depth at the execution chokepoint | `run()` re-checks `checkReadOnly()` immediately before `execSync`, regardless of origin | [`src/platform.ts:77-95`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/platform.ts#L77-L95) |
| **B1** Secret env leaking into child processes | `safeEnv()` passes only an allowlist of environment keys to spawned commands | [`src/platform.ts:60-75`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/platform.ts#L60-L75) |
| **B1** Agent-driven Bash in the optional Claude loop | `safetyHook` PreToolUse denies non-read-only Bash before it runs | [`src/safety.ts:1-42`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/safety.ts#L1-L42) |
| **B2** Hidden prompt-injection in untrusted text | `sanitizeUntrusted` strips invisible/bidi/format/control Unicode (NFC-normalized) before text enters the catalog or an LLM context | [`src/sanitize.ts:18-45`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/sanitize.ts#L18-L45), applied at [`src/db.ts:475-492,539-550`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/db.ts#L475-L550) |
| **B2** Context-window exhaustion from large output | `clampText` caps a single tool response at `maxToolResponseBytes` (default 100 000) | [`src/tools.ts:48-65`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/tools.ts#L48-L65), [`src/types.ts:194,213`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/types.ts#L194-L213) |
| **B3** Unauthenticated HTTP access | Non-loopback bind requires a bearer token; tokens are compared in constant time | [`src/mcp/transports.ts:36-107`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/mcp/transports.ts#L36-L107) |
| **B3** DNS-rebinding (CVE-2025-66414) | Non-loopback bind requires an explicit `allowedHosts` Host allowlist | [`src/mcp/transports.ts:36-107`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/mcp/transports.ts#L36-L107) |
| **B4** Credentials persisted in node ids / metadata | `stripSensitive`, `redactSecrets`, `redactValue` remove `user:password@` and query/path secrets before persistence | [`src/tools.ts:67-81,111-126`](https://github.com/datasynx/agentic-ai-cartography/blob/main/src/tools.ts#L67-L126) |

These mechanisms are exercised by `test/safety.test.ts`, `test/tools-hardening.test.ts`,
`test/sanitize.test.ts`, and `test/transports.test.ts`.

## Residual risk and assumptions

- **The host is trusted.** Cartography assumes the machine it runs on, its installed CLIs
  (`aws`/`gcloud`/`az`/`kubectl`/database clients), and those CLIs' credential stores are not already
  compromised. It reads through them; it does not sandbox them.
- **Allowlist correctness is the trust root.** The read-only guarantee is exactly as strong as
  `checkReadOnly()`. A gap there is a vulnerability — see *Reporting* below.
- **Out-of-process secret hygiene is the operator's job.** Cartography redacts secrets it persists,
  but it does not manage how cloud credentials are stored on the host.
- **Hosted Smithery runs are read-only.** The managed runtime serves a catalog with no host CLIs and
  no secrets (`smithery.yaml` declares `env: {}`); the cloud scanners are intended for
  local/self-hosted use only.

If you find a way around any boundary above, it is a vulnerability — please report it privately via
[`SECURITY.md`](https://github.com/datasynx/agentic-ai-cartography/blob/main/SECURITY.md).
