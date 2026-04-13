export const PLUGIN_NAME = "WebpackBundleDoctorPlugin";

export const DISPLAY_NAME = "bundle-doctor";

export const DEFAULT_LOG_FILE = "bundle-doctor.log";

export const DEFAULT_JSON_REPORT_FILE = "bundle-doctor-report.json";

/** Default chunk size threshold for the large-chunk rule (in KiB). */
export const DEFAULT_LARGE_CHUNK_THRESHOLD_KB = 244;

/** Default module size threshold for the large-module rule (in KiB). */
export const DEFAULT_LARGE_MODULE_THRESHOLD_KB = 50;

/** Default size threshold above which an inlined SVG module is flagged (in KiB). */
export const DEFAULT_INLINED_SVG_THRESHOLD_KB = 10;

// ── Logger ────────────────────────────────────────────────────────────────

/** Width of separator lines in the diagnostic log file. */
export const LOGGER_SEP_WIDTH = 72;

/** Max chunks shown in the verbose chunk-comparison section. */
export const LOGGER_CHUNK_CAP = 30;

/** Number of modules shown in the verbose module-comparison section (top N by raw size). */
export const LOGGER_MODULE_TOP_N = 20;

/** Number of items shown in summary lists (top chunks, top modules). */
export const LOGGER_SUMMARY_TOP_N = 5;

/** Max assets / issuer entries shown in the raw compilation snapshot. */
export const LOGGER_ASSET_CAP = 20;

/** Number of singleton package names previewed in the packages section. */
export const LOGGER_SINGLETON_PREVIEW = 10;

// ── Regex ─────────────────────────────────────────────────────────────────

/**
 * Matches the package name segment inside a node_modules path.
 * Captures scoped packages (`@scope/name`) and plain packages (`name`).
 * Used for duplicate-package detection and modulesByPackage grouping.
 */
export const PKG_RE = /node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)/;

/**
 * Matches any path that contains a node_modules segment.
 * Used to classify modules as third-party for filtering purposes.
 */
export const NODE_MODULES_RE = /node_modules[\\/]/;

// ── ANSI terminal colors ──────────────────────────────────────────────────

export const ANSI_RESET = "\x1b[0m";
export const ANSI_RED = "\x1b[31m";
export const ANSI_YELLOW = "\x1b[33m";
export const ANSI_BLUE = "\x1b[34m";
export const ANSI_GREEN = "\x1b[32m";
export const ANSI_BOLD = "\x1b[1m";

// ── Enums ─────────────────────────────────────────────────────────────────

export enum Severity {
  Error = "error",
  Warn = "warn",
  Info = "info",
}

export enum LogLevel {
  Off = "off",
  Summary = "summary",
  Verbose = "verbose",
}

export enum ModuleType {
  Normal = "Normal",
  Concatenated = "Concatenated",
  External = "External",
}

export enum ChunkType {
  Sync = "sync",
  Lazy = "lazy",
  Prefetch = "prefetch",
  Preload = "preload",
}
