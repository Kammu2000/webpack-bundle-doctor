# webpack-bundle-doctor

A webpack plugin that analyzes your bundle and reports actionable issues — duplicate packages, oversized chunks, large modules, and inlined SVGs. Think of it as ESLint for your webpack output.

## Installation

```bash
npm install webpack-bundle-doctor --save-dev
```

## Basic usage

```js
// webpack.config.js
const { WebpackBundleDoctorPlugin } = require("webpack-bundle-doctor");

module.exports = {
  plugins: [
    new WebpackBundleDoctorPlugin(),
  ],
};
```

After each build, the plugin prints a report to the console:

```
[bundle-doctor]

[ERROR] [duplicate-packages] "lodash" is bundled 2 times from different node_modules trees:
  - /app/node_modules/lodash (12 modules)
  - /app/node_modules/some-lib/node_modules/lodash (12 modules)
         Modules: /app/node_modules/lodash/lodash.js, ...

[WARN]  [large-chunk] Chunk "vendor" is 380.2 KiB (parsed), exceeds threshold of 244 KiB

[bundle-doctor] 2 issue(s): 1 error(s), 1 warning(s), 0 info(s)
```

## Options

```js
new WebpackBundleDoctorPlugin({
  rules: { ... },                    // per-rule overrides (see Rules section)
  reporters: ["console", "json"],    // default: ["console"]
  logFile: "bundle-doctor.log",      // diagnostic log output path
  jsonFile: "bundle-doctor-report.json", // JSON reporter output path
  logLevel: "off",                   // "off" | "summary" | "verbose"
})
```

### `rules`

Selectively enable, disable, or reconfigure individual rules. Each rule accepts one of:

| Value | Effect |
|---|---|
| `"off"` | Disable the rule entirely |
| `"error"` / `"warn"` / `"info"` | Enable at the given severity |
| `["warn", { ...options }]` | Enable with custom options |

```js
new WebpackBundleDoctorPlugin({
  rules: {
    "duplicate-packages": "off",
    "large-chunk": "error",
    "large-module": ["warn", { maxSizeKb: 100 }],
    "inlined-svg": ["error", { maxSizeKb: 20 }],
    "unnamed-chunk": ["warn", { minSizeKb: 10 }],
  },
})
```

### `reporters`

Controls where output is written. Both reporters can be active at the same time.

| Value | Output |
|---|---|
| `"console"` | Colored output to stdout (default) |
| `"json"` | JSON array of issues written to `jsonFile` |

```js
new WebpackBundleDoctorPlugin({
  reporters: ["console", "json"],
  jsonFile: "reports/bundle-issues.json",
})
```

### `logFile`

Path for the diagnostic logger output (controlled by `logLevel`). Relative paths are resolved from `process.cwd()`. Default: `bundle-doctor.log`.

### `jsonFile`

Path for the `json` reporter output. Relative paths are resolved from `process.cwd()`. Default: `bundle-doctor-report.json`.

### `logLevel`

Controls how much diagnostic information is written to `logFile` after each build.

| Value | Written to `logFile` |
|---|---|
| `"off"` | Nothing — no file created (default) |
| `"summary"` | Aggregate stats: chunk/module counts by type, top 5 largest chunks and modules, duplicate package list |
| `"verbose"` | All chunks with full size breakdown, top 20 modules by size, package roots, and summary stats |

```js
new WebpackBundleDoctorPlugin({
  logLevel: "verbose",
  logFile: "bundle-doctor.log",
})
```

Example `"verbose"` output for a single chunk:

```
── chunk 1 of 3 ─────────────────────────────────────────────────────────
  id:        "0"
  name:      "main"
  type:      sync
  sizes.raw:     913408  (892.0 KiB)
  sizes.parsed:  759040  (741.3 KiB)
  sizes.gzipped: 202752  (198.0 KiB)
  modules:   412
```

## Rules

### `duplicate-packages`

**Default severity: `error`**

Detects npm packages that are bundled more than once from different `node_modules` trees. This typically happens when two packages depend on incompatible version ranges of the same dependency, causing npm/yarn to install separate copies.

Duplicate packages increase bundle size and can cause subtle runtime bugs when two copies of a singleton (e.g. React, a state store) exist in the same page.

No configurable options.

---

### `large-chunk`

**Default severity: `warn`**

Detects output chunks whose size exceeds a threshold. Uses the parsed (post-minification) size when available, falling back to the raw stat size.

| Option | Type | Default | Description |
|---|---|---|---|
| `maxSizeKb` | `number` | `244` | Threshold in KiB |

```js
"large-chunk": ["warn", { maxSizeKb: 500 }]
```

---

### `large-module`

**Default severity: `warn`**

Detects individual modules whose size exceeds a threshold. Large modules are candidates for lazy loading or code splitting. Scope-hoisted (concatenated) container modules are skipped — only their inner modules are evaluated.

| Option | Type | Default | Description |
|---|---|---|---|
| `maxSizeKb` | `number` | `50` | Threshold in KiB |

```js
"large-module": ["warn", { maxSizeKb: 100 }]
```

---

### `inlined-svg`

**Default severity: `error`**

Detects SVG files inlined into the JS bundle by loaders such as `@svgr/webpack` or `svg-react-loader`. These loaders convert SVG markup into JS components, which prevents webpack from emitting the SVG as a separate cacheable asset and inflates every JS chunk that imports it.

Any module whose resource path ends with `.svg` and whose size exceeds the threshold is flagged.

| Option | Type | Default | Description |
|---|---|---|---|
| `maxSizeKb` | `number` | `10` | Threshold in KiB — SVGs above this size are flagged |

```js
"inlined-svg": ["error", { maxSizeKb: 20 }]
```

---

### `unnamed-chunk`

**Default severity: `warn`**

Detects chunks that have no explicit name. Webpack assigns numeric or hash-based IDs to unnamed chunks. Those IDs are derived from the module graph and can shift when unrelated modules are added or removed elsewhere in the project, busting browser cache for chunks whose content has not changed.

- For **lazy/prefetch/preload** chunks: add a `/* webpackChunkName: "name" */` magic comment to the dynamic import.
- For **sync** chunks: add a named entry in your webpack configuration.

| Option | Type | Default | Description |
|---|---|---|---|
| `chunkTypes` | `ChunkType[]` | all types | Limit which chunk types are checked |
| `minSizeKb` | `number` | `0` | Skip unnamed chunks smaller than this (useful to suppress tiny runtime chunks) |

```js
"unnamed-chunk": ["warn", { minSizeKb: 10 }]
```

---

## Full configuration example

```js
// webpack.config.js
const { WebpackBundleDoctorPlugin } = require("webpack-bundle-doctor");

module.exports = {
  // ... your existing config
  plugins: [
    new WebpackBundleDoctorPlugin({
      reporters: ["console", "json"],
      logFile: "reports/bundle-doctor.log",
      jsonFile: "reports/bundle-doctor-report.json",
      logLevel: "summary",
      rules: {
        "duplicate-packages": "error",
        "large-chunk": ["warn", { maxSizeKb: 400 }],
        "large-module": ["warn", { maxSizeKb: 100 }],
        "inlined-svg": ["error", { maxSizeKb: 20 }],
        "unnamed-chunk": ["warn", { minSizeKb: 10 }],
      },
    }),
  ],
};
```

## License

Copyright (c) 2026 Deepanshu Upadhyay. Licensed under the [MIT License](LICENSE).
