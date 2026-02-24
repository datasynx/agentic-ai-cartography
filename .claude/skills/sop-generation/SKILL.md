# SOP Generation Skill

Generate Standard Operating Procedures from observed workflows.

## Process

1. Load completed tasks from DB
2. Cluster tasks by similar `involvedServices` + `steps`
3. Per cluster: Anthropic Messages API (no agent loop)
4. Response → `db.insertSOP()`

## SOP Format

```markdown
# <Title>
**Description:** <What and why>
**Systems:** <system1, system2, ...>
**Duration:** ~<N> minutes
**Frequency:** <X times daily/weekly>
**Confidence:** <0.0–1.0>

## Steps
1. **<tool>** → `<target>`
   `<command>`
   _<Expected result>_

## Variations
- <Scenario> → <Action option>
```

## Quality Criteria

- Each step has a clear goal and an expected result
- Variations cover common failure cases
- No credentials or sensitive data
- Confidence >= 0.7 for production-ready SOPs
