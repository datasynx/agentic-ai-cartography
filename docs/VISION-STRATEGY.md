# Vision & Strategy 2026–2027

**Product:** `@datasynx/agentic-ai-cartography`
**Date:** 2026-05-30
**Status:** Draft v1.0
**Owner:** Datasynx AI

---

## 1. Executive Summary

`@datasynx/agentic-ai-cartography` sits at the intersection of three explosive market trends: **agentic AI** ($7–8B in 2025, 40–45% CAGR), **platform engineering** ($5–7B, 24% CAGR), and the growing enterprise pain of **shadow IT** (30–40% of IT spend, $4.2M per incident). Traditional CMDBs (ServiceNow $30K–$80K/yr, Lansweeper, Device42) require manual curation and go stale within weeks. Developer portals (Backstage, Port, Cortex, OpsLevel) solve the catalog problem but not the discovery problem.

This product is the first **AI-native, agent-driven infrastructure discovery CLI** — fully open source (MIT), commercially usable, and provider-agnostic. It discovers infrastructure autonomously — local apps, databases, cloud resources, Kubernetes clusters, browser bookmarks — and generates actionable topology maps, Mermaid diagrams, Backstage YAML, and interactive HTML visualizations. No manual inventory. No stale data. No vendor lock-in.

**Strategic bet:** The CMDB market ($14.4B → $23.6B by 2029) is ripe for disruption from the bottom up. Instead of competing with ServiceNow on enterprise features, we compete on **zero-configuration discovery**, **developer experience**, and **100% open source** — the same playbook that made Terraform, Docker, and Backstage category-defining. Revenue comes from commercial support, consulting, and managed hosting — never from gating features behind a proprietary license.

---

## 2. Market Analysis

### 2.1 CMDB & IT Asset Management

| Metric | Value | Source |
|--------|-------|--------|
| Global CMDB market (2024) | $14.4B | Gartner |
| Projected CMDB market (2029) | $23.6B | Gartner |
| CAGR | ~10.4% | Gartner |
| ServiceNow ITSM pricing | $30K–$80K/yr (mid-market) | Public pricing |
| Lansweeper pricing | $2–$8/asset/yr | Public pricing |
| Device42 pricing | $1.50–$4/device/yr | Public pricing |
| Flexera pricing | Enterprise-only quotes | N/A |

**Key insight:** The CMDB market is massive but the products are heavyweight, expensive, and agent-based (install scanners on every machine). Modern cloud-native teams skip CMDBs entirely and rely on tribal knowledge — creating the shadow IT problem.

### 2.2 Developer Portal & Service Catalog

| Platform | Pricing | Market Position |
|----------|---------|-----------------|
| Backstage (Spotify) | Open source, ~$50K–$100K internal cost | 89% awareness, ~10% actual adoption |
| Port | $78/developer/month | Commercial Backstage alternative |
| Cortex | $65–$69/developer/month | Service catalog + scorecards |
| OpsLevel | $39/developer/month | Service ownership + maturity |
| Roadie | $22/developer/month | Managed Backstage |

**Key insight:** Backstage has massive awareness but low actual adoption due to operational complexity. The commercial alternatives (Port, Cortex, OpsLevel) are expensive and focused on catalog/scorecards, not discovery. None of them autonomously discover infrastructure — they all require manual service registration or CI integration.

### 2.3 Agentic AI Market

| Metric | Value |
|--------|-------|
| Agentic AI market (2025) | $7–8B |
| Projected (2030) | $50–65B |
| CAGR | 40–45% |
| MCP SDK monthly downloads | 97M+ (npm) |
| MCP servers available | 5,800+ |
| Claude Agent SDK adoption | Growing, early-stage ecosystem |

**Key insight:** The MCP (Model Context Protocol) ecosystem is experiencing hockey-stick growth. Claude Agent SDK provides the best foundation for agentic applications today. Being early to build production tools on this SDK creates a durable competitive advantage.

### 2.4 Adjacent Markets

| Market | Size | CAGR | Relevance |
|--------|------|------|-----------|
| Platform Engineering | $5–7B | 24% | Target buyer persona |
| Cloud Waste/FinOps | $44.5B projected waste (2025) | — | Discovery reduces waste |
| Graph Databases | $3.8B → $9.5B by 2028 | 20%+ | Topology storage backend |
| Observability | $62B by 2029 | 13% | Complementary data source |

---

## 3. Competitive Landscape

### 3.1 Direct Competitors

#### lyft/cartography (CNCF Sandbox)

| Dimension | lyft/cartography | datasynx-cartography |
|-----------|-----------------|---------------------|
| Language | Python | TypeScript |
| Backend | Neo4j (required) | SQLite (embedded) |
| Discovery | API-driven (AWS, GCP, Azure, Okta, GSuite) | Agent-driven (local + cloud + browser) |
| Setup time | Hours (Neo4j + config) | Seconds (`npx`) |
| Focus | Cloud security posture | Full-stack topology |
| License | Apache-2.0 | MIT |
| Community | CNCF Sandbox, ~3,500 GitHub stars | Early stage |
| Maintenance | Active, multi-contributor | Single-team |

**Differentiation:** lyft/cartography is a security-focused cloud asset graph. It requires Neo4j, Python, and cloud API credentials. Our product discovers **everything** — local apps, databases, browser bookmarks, cloud resources — with zero configuration, using Claude as the discovery agent. Different positioning entirely.

#### ServiceNow Discovery

Enterprise-grade, agent-based discovery requiring ServiceNow platform ($100K+/yr). Not a realistic competitor at the CLI/developer tier.

#### Backstage

Not a discovery tool — it's a service catalog. Requires manual registration. Complementary, not competitive. Our Backstage YAML export makes us an **upstream data source** for Backstage.

### 3.2 Positioning Matrix

```
                    Agent-Driven ←→ Manual/Config-Driven
                         ↑
                         |
         datasynx-    |
         cartography  |  ServiceNow
              ★       |  Discovery
                      |
    Developer  -------+--------  Enterprise
    CLI/DevTool       |          Platform
                      |
         lyft/        |  Backstage
         cartography  |  Port / Cortex
                      |
                         ↓
                    Cloud-Only ←→ Full-Stack
```

**Our quadrant:** Developer CLI + Agent-Driven + Full-Stack. No one else occupies this space.

---

## 4. Product Vision

### Mission Statement

> Make infrastructure visible. Automatically. For every developer.

### Vision (2027)

> The default way teams understand what they have. From `npx datasynx-cartography discover` to a living, queryable topology in under 60 seconds — no agents to install, no credentials to configure, no CMDBs to maintain.

### Core Principles

1. **Zero-config discovery** — Works out of the box, discovers what's reachable
2. **AI-native, provider-agnostic** — LLM agent drives discovery; ships with Claude support, pluggable for any provider (OpenAI, Ollama, Mistral, local models)
3. **Developer-first** — CLI, composable, pipe-friendly, open formats
4. **Non-invasive** — Read-only, no agents installed, no system state modified
5. **Fully open source** — MIT license, every feature in the open, standard export formats, no vendor lock-in, commercially usable without restrictions

---

## 5. Product Architecture (Current State)

```
┌──────────────────────────────────────────────┐
│  CLI (commander)                              │
│  discover · export · show · chat · seed · ... │
└──────────────┬───────────────────────────────┘
               │
┌──────────────▼───────────────────────────────┐
│  Agent Orchestrator (Provider-Agnostic)       │
│  9-step mandatory sequence · 30-min timeout   │
│  Human-in-the-loop · Circuit breaker          │
│  Providers: Claude | OpenAI | Ollama | custom │
└──────────────┬───────────────────────────────┘
               │
┌──────────────▼───────────────────────────────┐
│  MCP Tools (12 custom tools)                  │
│  scan_* · add_node · add_edge · ask_user      │
│  stripSensitive() · safeEnv()                 │
└──────────────┬───────────────────────────────┘
               │
┌──────────────▼───────────────────────────────┐
│  Storage (better-sqlite3, WAL mode)           │
│  8 tables · Zod validation · Session-scoped   │
└──────────────┬───────────────────────────────┘
               │
┌──────────────▼───────────────────────────────┐
│  Exporters (7 formats)                        │
│  JSON · JGF · Mermaid · Backstage YAML        │
│  Interactive HTML (D3.js) · Topology · App    │
└──────────────────────────────────────────────┘
```

**By the numbers:**

| Metric | Value |
|--------|-------|
| Source LOC | 6,486 |
| Test files | 14 |
| Tests | 244 |
| MCP tools | 12 |
| Export formats | 7 |
| DB tables | 8 |
| Node types | 16 |
| Edge relationships | 6 |
| Platforms | Linux, macOS, Windows |

---

## 6. Feature Roadmap

### Phase 1: Foundation Hardening (Q2–Q3 2026)

**Theme:** Production-readiness, reliability, trust

| Feature | Priority | Effort | Impact |
|---------|----------|--------|--------|
| **Incremental discovery** — Diff-based rescans that update existing topology instead of creating new sessions | P0 | L | Enables continuous use |
| **Plugin system** — User-defined MCP tool bundles for custom scanners | P0 | L | Extensibility moat |
| **Remote discovery** — SSH/WinRM-based scanning of remote hosts | P1 | L | Enterprise requirement |
| **Multi-provider agent layer** — `AgentProvider` interface with Claude, OpenAI, Ollama backends | P0 | L | Eliminates vendor lock-in |
| **Credential vault integration** — HashiCorp Vault, AWS Secrets Manager, 1Password CLI (all open source compatible) | P1 | M | Security/compliance |
| **Scheduled discovery** — Cron-like recurring scans with change detection | P1 | M | Living topology |
| **Multi-tenant sessions** — Team-shared discovery databases | P2 | M | Collaboration |

### Phase 2: Intelligence Layer (Q3–Q4 2026)

**Theme:** From discovery to insight

| Feature | Priority | Effort | Impact |
|---------|----------|--------|--------|
| **Drift detection** — Alert on topology changes between scans | P0 | M | Security/compliance killer feature |
| **Dependency analysis** — Infer service dependencies from network traffic, logs, config | P0 | L | High value for incident response |
| **Cost attribution** — Map cloud resources to teams/services with cost data | P1 | M | FinOps integration |
| **Compliance scoring** — Rate infrastructure against CIS benchmarks, SOC2, ISO 27001 | P1 | L | Enterprise sales enabler |
| **Natural language queries** — "Show me all services that depend on the payments database" | P2 | M | Developer experience |
| **Anomaly detection** — Flag unusual infrastructure patterns (orphaned resources, shadow IT) | P2 | M | Cloud waste reduction |

### Phase 3: Platform (Q1–Q2 2027)

**Theme:** From CLI to platform

| Feature | Priority | Effort | Impact |
|---------|----------|--------|--------|
| **Web dashboard** — Real-time topology visualization with drill-down | P0 | XL | Required for enterprise adoption |
| **API server** — REST/GraphQL API for programmatic access | P0 | L | Integration backbone |
| **Graph database backend** — Neo4j/Memgraph option for large topologies | P1 | L | Scale for enterprises |
| **Webhook integrations** — Slack, PagerDuty, Jira on topology changes | P1 | M | Operational workflows |
| **RBAC** — Role-based access control for team features | P1 | M | Enterprise requirement |
| **Backstage plugin** — Native Backstage integration as data source | P2 | M | Distribution channel |

### Phase 4: Ecosystem (Q3–Q4 2027)

**Theme:** From product to ecosystem

| Feature | Priority | Effort | Impact |
|---------|----------|--------|--------|
| **Terraform state import** — Enrich topology with IaC state | P1 | M | DevOps workflow |
| **Kubernetes operator** — Continuous in-cluster discovery | P1 | L | Cloud-native distribution |
| **IDE extension** — VS Code/JetBrains sidebar showing service topology | P2 | L | Developer experience |
| **Community tool marketplace** — Share/download custom MCP tool bundles | P2 | XL | Network effects |
| **Multi-cloud correlation** — Unified view across AWS/GCP/Azure/on-prem | P1 | L | Enterprise differentiator |

---

## 7. Go-to-Market Strategy

### 7.1 Revenue Model (100% Open Source)

Every feature ships under MIT. No open-core, no feature gates, no proprietary add-ons.

| Revenue Stream | Price | Target | Description |
|---------------|-------|--------|-------------|
| **Open Source (CLI + all features)** | Free (MIT) | Everyone | Full discovery, all export formats, all backends, all integrations |
| **Commercial Support** | $5K–$25K/yr | Teams & enterprises | SLA-backed support, priority issue resolution, upgrade assistance |
| **Consulting & Integration** | $200–$300/hr | Enterprise | Custom scanner development, infrastructure onboarding, topology design |
| **Managed Hosting** | $15–$50/user/month | Teams wanting zero-ops | Hosted dashboard, scheduled scans, drift alerts — all from the open-source codebase |
| **Training & Certification** | $1K–$3K/seat | Platform engineering teams | Instructor-led workshops, certification program |

**Rationale:** The Terraform/Kubernetes playbook — 100% open source builds trust, adoption, and community. Revenue comes from the services around the software, not from locking features. Port charges $78/user/month for a proprietary catalog without discovery. We offer more capability for free, and monetize support and managed hosting for teams that want zero-ops.

**Anti-patterns we avoid:**
- No "community vs. enterprise edition" split
- No features behind a license key
- No telemetry that phones home without explicit opt-in
- No CLA that allows relicensing — contributions stay MIT forever

### 7.2 Distribution Channels

1. **npm** — Primary distribution (`npx @datasynx/agentic-ai-cartography discover`)
2. **GitHub** — Community, issues, contributions, trust signal
3. **Docker Hub** — Container distribution for CI/CD integration
4. **Homebrew** — macOS developer reach (`brew install datasynx-cartography`)
5. **Backstage plugin marketplace** — Reach Backstage's install base as a data source
6. **MCP tool registries** — Leverage the growing MCP ecosystem

### 7.3 Growth Flywheel

```
Install via npm/brew → Discover infrastructure in 60 seconds →
Share topology maps with team → Team adopts for all environments →
Organization standardizes → Needs support/managed hosting →
Community contributes custom scanners → Ecosystem grows → More users
```

### 7.4 Target Personas

| Persona | Pain Point | Entry Point |
|---------|-----------|-------------|
| **Platform Engineer** | "I don't know what we're running" | `discover` command |
| **SRE / DevOps** | "Incident response requires tribal knowledge" | Dependency graph export |
| **Security Engineer** | "Shadow IT is invisible" | Anomaly detection, drift alerts |
| **FinOps Analyst** | "We're wasting $44.5B on cloud" | Cost attribution, orphan detection |
| **Engineering Manager** | "Onboarding takes weeks" | Interactive HTML topology map |
| **CTO / VP Eng** | "ServiceNow costs $80K and data is stale" | Full open-source alternative, commercial support available |

---

## 8. Technical Strategy

### 8.1 Architecture Evolution

**Current (v1.x):** Monolithic CLI with embedded SQLite

```
CLI → Agent → SQLite → Exporters
```

**Target (v2.x):** Layered architecture with pluggable everything

```
CLI / Web UI (open source) / REST API
       │
  Core Engine (discovery + analysis)
       │
  ┌────┴────────────────┐
  │                     │
  LLM Provider          Storage Adapter
  (Claude/OpenAI/       (SQLite/Neo4j/
   Ollama/vLLM/any)      PostgreSQL)
  │                     │
  └────┬────────────────┘
       │
  Plugin System (MCP tool bundles, community scanners)
```

### 8.2 Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| **Keep SQLite as default** | Zero-config, single-file, portable — our core advantage |
| **Add Neo4j/Memgraph as option** | Required for graph queries at enterprise scale (10K+ nodes); both open source |
| **TypeScript monorepo** | `@datasynx/core`, `@datasynx/cli`, `@datasynx/web`, `@datasynx/plugins` |
| **MCP for extensibility** | Open standard (not proprietary), growing ecosystem, multi-provider |
| **Zod for validation** | Already in stack, runtime type safety at boundaries |
| **Provider-agnostic agent layer** | Abstract LLM provider behind interface; swap Claude/OpenAI/Ollama/Mistral without code changes |
| **No proprietary protocols** | All exports use open standards (JSON, YAML, Mermaid, CycloneDX, JGF) |

### 8.3 LLM Provider Strategy (No Vendor Lock-in)

The agent layer must be **provider-agnostic**. Currently built on Claude Agent SDK, but architecturally prepared for any LLM backend.

**Provider Abstraction Roadmap:**

1. **v1.x (current)** — Claude Agent SDK as primary provider, working and shipped
2. **v2.0** — Extract `AgentProvider` interface: `{ runAgent(config, tools, prompt): AsyncIterable<Event> }`
3. **v2.1** — Add OpenAI provider (`openai` SDK, function calling)
4. **v2.2** — Add Ollama provider (local models, zero API cost, air-gapped environments)
5. **v2.3** — Add generic OpenAI-compatible provider (Mistral, Groq, Together, vLLM, any OpenAI-compatible endpoint)

**Design principles:**
- Provider selected via `--provider` CLI flag or `CARTOGRAPHY_PROVIDER` env var
- All providers implement the same interface — scanners, tools, and exporters are provider-independent
- MCP tools work identically across providers (MCP is an open standard)
- No Anthropic-specific features leak into the core engine
- Users can self-host the entire stack including the LLM (via Ollama/vLLM)

---

## 9. Competitive Moats

### 9.1 Current Moats

| Moat | Durability | Description |
|------|-----------|-------------|
| **First-mover in agentic discovery** | Medium | No other product uses LLM agents for infrastructure discovery |
| **Zero-config UX** | High | Single command to full topology — hard to replicate without agent approach |
| **100% open source** | High | Builds trust, enables contributions, eliminates procurement friction |
| **Provider-agnostic** | High | Works with any LLM — no API vendor lock-in, supports air-gapped (Ollama) |
| **MIT license** | Medium | Maximum commercial permissiveness — no CLA relicensing risk |

### 9.2 Future Moats (to build)

| Moat | Investment | Timeline |
|------|-----------|----------|
| **Community tool bundles** | Plugin marketplace | Q3 2027 |
| **Topology data network effects** | Anonymized benchmarking ("your infra vs. similar orgs") | Q4 2027 |
| **Integration ecosystem** | Backstage, Terraform, Kubernetes, CI/CD | Q2–Q4 2027 |
| **Enterprise customer base** | Direct sales, case studies, compliance certs | Q4 2027 |

---

## 10. Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Claude Agent SDK breaking changes** | Medium | Medium | Pin versions, provider abstraction layer absorbs changes |
| **Any single LLM provider becomes unavailable** | Low | Low | Provider-agnostic: switch to OpenAI, Ollama, or any compatible endpoint |
| **lyft/cartography adds agent discovery** | Low | Medium | Move faster on developer experience and full-stack scope |
| **ServiceNow acquires an agent startup** | Medium | Medium | Focus on open-source community and developer tier |
| **API cost sensitivity** | High | Medium | Ollama/vLLM for zero-cost local inference, aggressive caching |
| **Enterprise procurement friction** | Low | Low | MIT license, no vendor lock-in, self-hostable — no legal review needed |
| **Security incident (agent executes destructive command)** | Low | Critical | PreToolUse safety hook, command blocklist, read-only principle |

---

## 11. Success Metrics

### Year 1 (2026)

| Metric | Target |
|--------|--------|
| npm weekly downloads | 1,000 |
| GitHub stars | 500 |
| Active community contributors | 10 |
| Community-built scanner plugins | 5 |
| Support/consulting contracts | 5 |
| LLM providers supported | 3 (Claude, OpenAI, Ollama) |

### Year 2 (2027)

| Metric | Target |
|--------|--------|
| npm weekly downloads | 10,000 |
| GitHub stars | 3,000 |
| Active community contributors | 50 |
| Community-built scanner plugins | 25 |
| Support/consulting contracts | 25 |
| Managed hosting customers | 50 teams |
| Backstage plugin installs | 500 |

---

## 12. Strategic Recommendations

### Do Now (Q2 2026)

1. **Ship incremental discovery** — This is the #1 user request that will differentiate from one-shot scanning
2. **Build the plugin system** — Extensibility creates the community flywheel
3. **Start a Discord/community** — Developer tools live or die by community
4. **Write a "Cartography vs. ServiceNow" landing page** — SEO for the pain point

### Do Next (Q3–Q4 2026)

5. **Ship drift detection** — The killer feature for security and compliance users
6. **Build the web dashboard (open source)** — Full-featured, self-hostable, no proprietary UI
7. **Launch on Product Hunt / Hacker News** — Developer awareness
8. **Publish case studies** — "How we replaced our CMDB with a single CLI command"

### Do Later (2027)

9. **Offer managed hosting** — For teams that want zero-ops; built entirely from the open-source codebase
10. **Kubernetes operator** — Continuous discovery for cloud-native teams
11. **Strategic partnerships** — Backstage ecosystem, cloud providers, LLM providers
12. **Community governance** — Establish open governance model (similar to CNCF projects)

### Don't Do

- Don't gate features behind a proprietary license — everything stays MIT
- Don't build your own LLM — stay provider-agnostic, support all major providers
- Don't try to compete with observability tools (Datadog, Grafana) — complement them
- Don't add telemetry without explicit opt-in — trust is our moat
- Don't require a CLA that allows relicensing — keep MIT forever
- Don't build a browser extension — the CLI is the right interface for this workflow

---

## Appendix A: Research Sources

- Gartner CMDB Market Report 2024–2029
- ServiceNow, Lansweeper, Device42, Flexera public pricing pages
- Backstage adoption survey (CNCF 2025)
- Port, Cortex, OpsLevel pricing pages
- Anthropic Claude Agent SDK documentation
- MCP ecosystem statistics (npm registry, Anthropic blog)
- lyft/cartography GitHub repository and documentation
- Flexera State of IT report (shadow IT statistics)
- FinOps Foundation cloud waste projections
- Platform Engineering market reports (Gartner, Forrester)

---

## Appendix B: Competitive Comparison

| Vendor | License | All Features Free? | Vendor Lock-in? | Discovery? | Self-Hostable? |
|--------|---------|-------------------|-----------------|-----------|---------------|
| **datasynx-cartography** | MIT | **Yes** | **No** (provider-agnostic) | Yes (agent-driven) | **Yes** |
| lyft/cartography | Apache-2.0 | Yes | No (but requires Neo4j) | Yes (API-driven) | Yes |
| Backstage | Apache-2.0 | Yes | No | No (manual catalog) | Yes |
| Port | Proprietary | No ($78/user/mo) | Yes | No (manual catalog) | No |
| Cortex | Proprietary | No ($65–$69/user/mo) | Yes | No (CI integration) | No |
| OpsLevel | Proprietary | No ($39/user/mo) | Yes | No (manual + CI) | No |
| Roadie | Proprietary | No ($22/user/mo) | Yes | No (Backstage wrapper) | No |
| ServiceNow | Proprietary | No ($30K–$80K/yr) | Yes | Yes (agent-based) | Limited |
| Lansweeper | Proprietary | No ($2–$8/asset/yr) | Yes | Yes (agent-based) | Yes |

**Our advantage:** The only product that combines autonomous AI-driven discovery with full open-source availability, no vendor lock-in, and provider-agnostic LLM support.

---

*This document is a living strategy. Review quarterly and update based on market feedback, customer signals, and competitive developments.*
