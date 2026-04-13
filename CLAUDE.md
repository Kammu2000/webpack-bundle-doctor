# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build (production)
npm run build

# Build (debug — unminified, with source maps, BUNDLE_DOCTOR_DEBUG=1)
npm run build:debug
```

There are no test or lint scripts configured.

## Architecture

**Webpack Bundle Doctor** is a webpack plugin — the "ESLint of Bundling" — that hooks into webpack's compilation lifecycle to analyze and report on chunk/module composition. The compiled output lives in `dist/` as CommonJS2 (required for webpack plugin compatibility); webpack and webpack/* are externalized so the plugin shares the host project's webpack instance.

### Build pipeline

`src/index.ts` → webpack + ts-loader → `dist/index.js` (CJS2, Node target)

The TypeScript target is ES2020 with `module: node16`. Declaration files are emitted alongside `dist/index.js` for library consumers.

### Plugin lifecycle

```
Webpack Compiler
  └── plugin.apply(compiler)
        ├── compiler.hooks.emit      → buildContext() → BundleDoctorLogger.write() → RuleEngine.run() → reporters
        └── compiler.hooks.failed   → log error to file
```

`apply()` in `src/plugin/index.ts` instantiates `BundleDoctorLogger` first (path resolution happens in its constructor), then on `afterEmit`:
1. `buildContext()` — builds a normalized `BundleDoctorContext` snapshot from webpack's internal graphs
2. `logger.write()` — logs to file at the configured `logLevel` (`"off"` | `"summary"` | `"verbose"`)
3. `RuleEngine.run()` — runs all active rules against the context, returns `Issue[]`
4. Reporters (`ConsoleReporter`, `JsonReporter`) format and output the issues

### BundleDoctorContext

`buildContext()` in `src/plugin/context-builder.ts` produces a flat, serializable snapshot via three passes:

- **Pass 1** — iterates `compilation.chunks` to build `chunkMap` and `moduleMap`. ConcatenatedModules (scope-hoisted groups) are decomposed into their inner `NormalModule`s and registered separately with a `concatenatedInto` back-reference.
- **Pass 2** — builds `modulesByPackage` (`pkgName → pkgRoot → moduleId[]`) for duplicate detection.
- **Pass 3** — builds `dependencyGraph` (`moduleId → outgoing moduleId[]`) by walking `moduleGraph.getOutgoingConnections`.

### Rule system

Rules live in `src/core/rules/`. Each rule implements `Rule<TOptions>` from `shared/types.ts`:

```typescript
interface Rule<TOptions> {
  readonly id: string;
  readonly meta: { description: string; fixable?: boolean };
  readonly defaultSeverity: IssueSeverity;
  check(context: BundleDoctorContext, options?: TOptions): Issue[];
}
```

The four built-in rules:
| Rule ID | File | What it detects |
|---|---|---|
| `duplicate-modules` | `rules/duplicate-modules.ts` | Same npm package bundled from multiple `node_modules` roots |
| `large-chunk` | `rules/large-chunk.ts` | Chunks exceeding a configurable KiB threshold |
| `large-module` | `rules/large-module.ts` | Individual modules exceeding a configurable KiB threshold |
| `circular-dependency` | `rules/circular-dependency.ts` | Import cycles (DFS, skips `node_modules`) |

`RuleEngine` in `src/core/rule-engine.ts` merges per-rule user config (`"off"` | severity | `[severity, options]`) with each rule's `defaultSeverity`.

### Key files

| File | Role |
|------|------|
| `src/plugin/index.ts` | `WebpackBundleDoctorPlugin` — `apply()`, wires up logger + engine + reporters |
| `src/plugin/context-builder.ts` | `buildContext()` — 3-pass compilation → `BundleDoctorContext` |
| `src/plugin/utils.ts` | Per-module helpers: `getModuleIdentity`, `getModuleType`, `getModuleSizes`, `getChunkAssetSizes`, `getConcatenatedInnerModules`, `getModuleUnusedExports`, `extractPackageInfo` |
| `src/plugin/logger.ts` | `BundleDoctorLogger` — structured file logger; path resolution in constructor; exposes `resolvedLogFile` |
| `src/plugin/log.ts` | `logToFile()`, `clearOldLogs()`, `setLogFile()` — low-level append-to-file primitives |
| `src/core/rule-engine.ts` | `RuleEngine` — merges config, runs rules, collects issues |
| `src/core/rules/index.ts` | `defaultRules` map — registers all built-in rules |
| `src/core/reporters/console-reporter.ts` | Prints issues to stderr with ANSI colors |
| `src/core/reporters/json-reporter.ts` | Writes issues as JSON to disk |
| `src/shared/types.ts` | All shared TypeScript types (`ModuleInfo`, `ChunkInfo`, `Issue`, `Rule`, `BundleDoctorContext`, etc.) |
| `src/shared/constants.ts` | All constants: plugin name, log file defaults, thresholds, ANSI codes, regex patterns |
| `src/index.ts` | Public barrel — re-exports plugin class and all public types |

### Constants

All constants live in `src/shared/constants.ts`. Do not define inline magic numbers or strings in other files — add them here.

## TypeScript / style

- Strict mode on; no implicit any.
- Prettier: double quotes, semicolons, trailing commas everywhere, 100-char line width.
- Comments are stripped in compiled output (`removeComments: true` in tsconfig).
- Only `src/index.ts` (the barrel) exports symbols to consumers. Internal files must not re-export symbols imported from other modules.
- No `import type` — use plain `import` for all type imports.
