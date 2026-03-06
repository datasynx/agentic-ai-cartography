# License Compliance Assessment

**Date:** 2026-03-06
**Package:** `@datasynx/agentic-ai-cartography@1.1.0`
**Status:** ✅ Approved — see `docs/LEGAL-SIGNOFF-LGPL.md` (REF: OSS-REVIEW-2026-0306-001)

---

## LGPL-3.0-or-later Dependencies

| Package | Version | License | Source |
|---------|---------|---------|--------|
| `@img/sharp-libvips-linux-x64` | 1.2.4 | LGPL-3.0-or-later | [GitHub](https://github.com/lovell/sharp-libvips) |
| `@img/sharp-libvips-linuxmusl-x64` | 1.2.4 | LGPL-3.0-or-later | [GitHub](https://github.com/lovell/sharp-libvips) |

### Dependency Chain

```
@datasynx/agentic-ai-cartography
  └── @anthropic-ai/claude-agent-sdk@0.2.59
        └── @img/sharp-linux-x64@0.34.5
              └── @img/sharp-libvips-linux-x64@1.2.4 (LGPL-3.0-or-later)
```

### Technical Analysis

1. **Linking Type:** `sharp-libvips` is a prebuilt native binary (shared library `.so`). It is loaded dynamically at runtime by the `sharp` npm package via Node.js native addon mechanisms (N-API). This constitutes **dynamic linking**.

2. **LGPL-3.0 Dynamic Linking:** Under LGPL-3.0, dynamic linking does NOT trigger copyleft obligations for the consuming application. The LGPL explicitly permits using the library via dynamic linking without requiring the consuming application to be released under LGPL or GPL.

3. **Distribution Model:** This package is distributed as an npm package. The LGPL-licensed binaries are installed as separate npm packages (`@img/sharp-libvips-*`) and are not bundled into our compiled output (`dist/`). They remain in `node_modules/` as distinct components.

4. **Our License:** MIT — no conflict with LGPL dynamic linking usage.

5. **Transitive Nature:** We do not directly depend on `sharp` or `sharp-libvips`. They are transitive dependencies of `@anthropic-ai/claude-agent-sdk`. We have no control over their inclusion.

### License Distribution Summary (Production)

| License | Count | Percentage |
|---------|-------|------------|
| MIT | 169 | 80.1% |
| ISC | 17 | 8.1% |
| Apache-2.0 | 8 | 3.8% |
| BSD-3-Clause | 7 | 3.3% |
| BlueOak-1.0.0 | 5 | 2.4% |
| LGPL-3.0-or-later | 2 | 0.9% |
| Other (MIT-compatible) | 3 | 1.4% |

All non-LGPL licenses are permissive and enterprise-compatible.

### Risk Assessment

| Factor | Assessment |
|--------|------------|
| **Linking type** | Dynamic (low risk) |
| **Distribution impact** | None — separate npm packages |
| **Copyleft propagation** | No — LGPL dynamic linking exception applies |
| **Alternatives available** | Not applicable — transitive dep from Anthropic SDK |
| **Overall risk** | **Low** |

### Preliminary Recommendation

**Accept** — LGPL-3.0-or-later usage via dynamic linking of prebuilt binaries is enterprise-compatible. No code changes or mitigation measures required.

### Actions Completed

- [x] **Legal/Compliance Team:** Review and sign-off — see `docs/LEGAL-SIGNOFF-LGPL.md`
- [x] **Decision:** Accepted with two auflagen
- [x] **Auflage 1:** `THIRD-PARTY-LICENSES` file created
- [x] **Auflage 2:** License compliance CI check added (`license-checker --failOn GPL/AGPL`)
