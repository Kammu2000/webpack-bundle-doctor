# TODOS

Near-future improvements for webpack-bundle-doctor.

---

## 1. Exact per-module parsed/gzipped sizes via VLQ source map attribution

**Current approach** (`src/plugin/context-builder.ts`, Pass 1.5): each module's parsed and gzipped sizes are estimated proportionally from its chunk's accurate post-Terser asset sizes:

```
module.sizes.parsed ≈ (module.sizes.raw / chunk.sizes.raw) × chunk.sizes.parsed
```

This is a reasonable approximation but assumes a uniform minification ratio across all modules in a chunk, which is not always true (e.g. dead-code-eliminated modules shrink more than average).

**Target approach**: parse the `.map` file emitted alongside each chunk in `compilation.assets`, decode the VLQ mappings in `mappings`, and attribute each byte range in the minified output back to its originating source file. This is the same technique used by `webpack-bundle-analyzer` and gives exact post-Terser sizes per module.

**Implementation sketch**:
1. After Pass 1 (chunks + modules built), iterate chunks that have a corresponding `.map` asset in `compilation.assets`.
2. Parse the source map JSON and decode the `mappings` field using a VLQ library (e.g. `source-map` or `vlq`).
3. For each mapping segment, record how many output bytes are attributed to each `sources[i]` entry.
4. Match `sources[i]` paths back to `ModuleInfo` entries (normalize both sides with `path.normalize`).
5. Write exact `parsed` sizes from the attribution; keep proportional fallback when no `.map` is present.

**Prerequisite**: the consuming project must configure `devtool` to emit source maps (e.g. `"source-map"` or `"hidden-source-map"`). Document this in the README when implemented.

**Relevant code**: `src/plugin/context-builder.ts` lines 97–115 (Pass 1.5 + TODO comment).

---

## 2. `tree-shaking-miss` rule

Flag modules that export symbols which are never imported anywhere in the bundle (i.e. `unusedExports` is non-empty in `ModuleInfo`). This surfaces missed tree-shaking opportunities caused by `sideEffects: false` being absent in a package's `package.json` or by CJS interop preventing static analysis.

`unusedExports` is already populated in `ModuleInfo` via `getModuleUnusedExports()` in `src/plugin/utils.ts`.

---

## 3. `circular-dependency` rule

Detect import cycles using the `dependencyGraph` (`moduleId → outgoing moduleId[]`) already built in Pass 3 of `buildContext()`. Run a DFS from each module and report back-edges. Skip `node_modules` to reduce noise.

The `dependencyGraph` is already available on `BundleDoctorContext` but no rule currently consumes it.

---

## 4. `duplicate-packages` — add version info to issue message

The current issue message lists node_modules roots but not the version of each copy. Resolving `<pkgRoot>/package.json` and reading the `version` field would make the message actionable (shows exactly which versions conflict and which dep pulled in the extra copy).

---

## 5. GitHub Actions / CI integration

Add a `"ci"` reporter mode (or a `failOnError` option) that exits webpack with a non-zero code when any `error`-severity issue is found. This lets bundle-doctor gate PRs in CI without additional tooling.
