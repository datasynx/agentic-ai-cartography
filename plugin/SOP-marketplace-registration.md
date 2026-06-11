# SOP — Register / update Cartography in the `datasynx/claude-plugins` marketplace

**Document owner:** Datasynx AI · Platform
**Applies to:** [`datasynx/claude-plugins`](https://github.com/datasynx/claude-plugins) → `.claude-plugin/marketplace.json`
**Scope:** Adding the `cartography` plugin entry, or updating it after a metadata/source change.
**Audience:** Maintainers with write access (or fork + PR rights) to `datasynx/claude-plugins`.

> The plugin **manifest** lives in this repo at [`plugin/`](./). The **marketplace**
> repo only holds a *pointer* to it (a `git-subdir` source). This SOP changes that
> pointer; it does not change plugin behaviour. Behaviour changes happen in this repo.

---

## 1. Purpose

Make `cartography` installable from the shared Datasynx marketplace so users can run:

```text
/plugin marketplace add datasynx/claude-plugins
/plugin install cartography@datasynx
```

---

## 2. When to run this

| Trigger | Action |
| --- | --- |
| First-time registration (entry absent) | §5 — Add the entry |
| Plugin `description` / `homepage` changed | §5 — Update the entry's fields |
| Plugin directory moved/renamed in this repo | §5 — Update `source.path` |
| Repo URL changed (rename/transfer) | §5 — Update `source.url` |
| **Plugin `version` bump only** | **No change here.** Version lives in `plugin/.claude-plugin/plugin.json`; the marketplace tracks `main`. |

---

## 3. Prerequisites

- Write access to `datasynx/claude-plugins`, or ability to open a PR from a fork.
- `git`, `node` (for JSON validation), and a text editor.
- The plugin already merged to `main` in `datasynx/agentic-ai-cartography` under `plugin/`
  (confirm `plugin/.claude-plugin/plugin.json` and `plugin/.mcp.json` exist on `main`).

---

## 4. Pre-flight checks

```bash
# Plugin exists on this repo's default branch
curl -fsSL https://raw.githubusercontent.com/datasynx/agentic-ai-cartography/main/plugin/.claude-plugin/plugin.json | node -e 'JSON.parse(require("fs").readFileSync(0))' && echo "plugin.json OK"

# Package is published (npx resolves it)
npm view @datasynx/agentic-ai-cartography version
```

Both must succeed before editing the marketplace. The `.mcp.json` runs
`npx -y -p @datasynx/agentic-ai-cartography cartography-mcp`, so an unpublished or
broken package would yield a plugin that installs but fails to start.

---

## 5. Procedure

### 5.1 Clone and branch

```bash
git clone https://github.com/datasynx/claude-plugins.git
cd claude-plugins
git checkout -b add-cartography-plugin
```

### 5.2 Edit `.claude-plugin/marketplace.json`

Add the object below to the `plugins` array (keep `shadowing` and any others; mind
the comma after the previous entry). For an **update**, edit the existing
`cartography` object in place instead of adding a second one.

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

Resulting file shape (abbreviated):

```json
{
  "name": "datasynx",
  "owner": { "name": "Datasynx AI", "email": "info@datasynx.de" },
  "description": "Official Datasynx Claude Code plugins",
  "plugins": [
    { "name": "shadowing", "...": "unchanged" },
    { "name": "cartography", "...": "added per above" }
  ]
}
```

**Field rules**

| Field | Rule |
| --- | --- |
| `name` | Must equal the manifest `name` (`cartography`) and be **unique** in the array. This is the `@datasynx` install handle. |
| `description` | Keep ≤ ~140 chars; should match the manifest's intent. |
| `homepage` | Public docs URL. |
| `source.source` | Always `git-subdir`. |
| `source.url` | `.git` clone URL of this repo. |
| `source.path` | Directory holding `.claude-plugin/plugin.json` — currently `plugin`. |

### 5.3 Validate locally

```bash
node -e 'const m=require("./.claude-plugin/marketplace.json");
  const names=m.plugins.map(p=>p.name);
  if(new Set(names).size!==names.length) throw new Error("duplicate plugin name");
  const c=m.plugins.find(p=>p.name==="cartography");
  if(!c) throw new Error("cartography missing");
  for(const k of ["description","homepage"]) if(!c[k]) throw new Error("missing "+k);
  if(c.source.source!=="git-subdir"||!c.source.url||!c.source.path) throw new Error("bad source");
  console.log("marketplace.json valid; plugins:",names.join(", "));'
```

Must print `cartography` in the list with no thrown error.

### 5.4 Commit and open a PR

```bash
git add .claude-plugin/marketplace.json
git commit -m "Add cartography plugin to marketplace"
git push -u origin add-cartography-plugin
```

Open a PR against `datasynx/claude-plugins:main`. Do **not** push straight to `main`.

---

## 6. Verification (after merge to `main`)

On a clean machine / fresh Claude Code profile:

```text
/plugin marketplace add datasynx/claude-plugins
/plugin install cartography@datasynx
/mcp
```

Pass criteria:

1. `cartography` appears in `/plugin` as installable, then installed.
2. `/mcp` lists a connected `cartography` server.
3. The server exposes the topology tools (e.g. `get_summary`, `query_infrastructure`).

> Seed data first so queries return results — discovery is read-only and LLM-free:
> `npx -p @datasynx/agentic-ai-cartography datasynx-cartography discover`.

If the marketplace was already added, refresh it before testing:
`/plugin marketplace update datasynx` (or remove and re-add).

---

## 7. Rollback

- **Bad entry merged:** revert the marketplace commit (`git revert <sha>`) and merge.
  Existing installs keep working from their cached subdir; new installs stop resolving.
- **Plugin starts but misbehaves:** the fix is in *this* repo (`plugin/.mcp.json` or
  the published package), not the marketplace. The marketplace pointer is unaffected.

---

## 8. Definition of done

- [ ] `cartography` object present and unique in `marketplace.json` on `main`.
- [ ] JSON validates (§5.3).
- [ ] Fresh-profile install + `/mcp` verification passes (§6).
- [ ] This SOP and `plugin/README.md` still reflect the live `source.path` / `url`.
