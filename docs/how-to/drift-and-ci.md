# How to detect drift and run discovery in CI

Cartography stores every discovery as a versioned snapshot (a *session*). You can
compare two snapshots to see how your landscape changed, and run discovery
headlessly so a pipeline can do it on a schedule.

## Compare two snapshots (drift detection)

```bash
# Compare the two most recent discovery sessions (human-readable summary)
datasynx-cartography diff

# Compare specific sessions, as JSON (for scripting)
datasynx-cartography diff <base-session-id> <current-session-id> --format json

# Produce a colored Mermaid diagram (added=green, removed=red, changed=amber)
datasynx-cartography diff --format mermaid -o drift.mmd
```

The diff reports **added**, **removed**, and **changed** nodes plus **added** and
**removed** edges. A node counts as *changed* only when a meaningful field differs
(`type`, `name`, `domain`, `subDomain`, `qualityScore`, `metadata`, `tags`);
confidence fluctuations between scans are reported as a delta but never on their
own flag a node as drifted.

Agents can do the same over MCP via the read-only **`diff_topology`** tool, or via
the **`compare-environments`** prompt.

## Run discovery headlessly

`discover` supports machine-readable output so it fits into CI/CD:

```bash
# Stream every discovery event as newline-delimited JSON (NDJSON) on stdout
datasynx-cartography discover --output-format stream-json | jq -c .

# Emit only the final catalog as a single JSON object
datasynx-cartography discover --output-format json > catalog.json
```

In `json` / `stream-json` modes stdout stays machine-clean — human progress goes to
stderr — and the interactive node review and follow-up search are skipped. A failed
run exits non-zero so the pipeline stops.

A typical pipeline step: run `discover --output-format json`, then on the next run
`diff` against the previous session and fail the build (or alert) if unexpected
services appeared or critical dependencies disappeared.
