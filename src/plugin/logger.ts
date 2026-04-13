import { isAbsolute, resolve } from "path";
import { Compilation } from "webpack";
import { BundleDoctorContext, ModuleInfo } from "../shared/types.js";
import { effectiveSize } from "./utils.js";
import { clearOldLogs, logToFile } from "./log.js";
import {
  DEFAULT_LOG_FILE,
  DISPLAY_NAME,
  LOGGER_MODULE_TOP_N,
  LOGGER_SEP_WIDTH,
  LOGGER_SINGLETON_PREVIEW,
  LOGGER_SUMMARY_TOP_N,
  LogLevel,
  ModuleType,
} from "../shared/constants.js";

function fmtBytes(n: number): string {
  const kib = n / 1024;
  return `${n}  (${kib.toFixed(1)} KiB)`;
}

function fmtKib(n: number): string {
  return `${(n / 1024).toFixed(0)} KiB`;
}

export class BundleDoctorLogger {
  readonly resolvedLogFile: string;

  constructor(
    private readonly level: LogLevel,
    logFile?: string,
  ) {
    const candidate = logFile ?? DEFAULT_LOG_FILE;
    this.resolvedLogFile = isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
  }

  write(compilation: Compilation, context: BundleDoctorContext): void {
    if (this.level === LogLevel.Off) return;

    clearOldLogs();
    this.writeHeader(compilation, context);

    if (this.level === LogLevel.Summary) {
      this.writeSummaryStats(context);
    } else {
      this.writeChunksSection(context);
      this.writeModulesSection(context);
      this.writePackagesSection(context);
      this.writeSummaryStats(context);
    }

    this.line();
    this.line("=".repeat(LOGGER_SEP_WIDTH));
    this.line("end of bundle-doctor log");
    this.line("=".repeat(LOGGER_SEP_WIDTH));
  }

  // ── Header ────────────────────────────────────────────────────────────────

  private writeHeader(compilation: Compilation, context: BundleDoctorContext): void {
    const label = this.level === LogLevel.Summary ? "[SUMMARY]" : "[VERBOSE]";
    const ts = new Date().toISOString();
    const entries = [...compilation.entries.keys()].join(", ") || "(none)";

    this.line("=".repeat(LOGGER_SEP_WIDTH));
    this.line(`${DISPLAY_NAME}  ${ts}  ${label}`);
    if (compilation.name)
      this.line(`  compilation: ${compilation.name}  hash: ${compilation.hash ?? "n/a"}`);
    else this.line(`  hash: ${compilation.hash ?? "n/a"}`);
    this.line(`  context:     ${compilation.compiler.context}`);
    this.line(`  entries:     ${entries}`);
    if (this.level === LogLevel.Verbose) {
      this.line(
        `  errors:      ${compilation.errors.length}    warnings: ${compilation.warnings.length}`,
      );
    }
    this.line("=".repeat(LOGGER_SEP_WIDTH));
  }

  // ── Summary stats ─────────────────────────────────────────────────────────

  private writeSummaryStats(context: BundleDoctorContext): void {
    this.line();
    this.sep(true);
    const sectionLabel =
      this.level === LogLevel.Summary ? "ANALYSIS SUMMARY" : "SECTION 4 — ANALYSIS SUMMARY";
    this.line(sectionLabel);
    this.sep(true);

    // Chunk counts by type
    const chunksByType = { sync: 0, lazy: 0, prefetch: 0, preload: 0 };
    for (const chunk of context.chunks.values()) {
      chunksByType[chunk.chunkType]++;
    }
    this.line();
    this.line("[AGGREGATE STATS]");
    this.line(
      `  chunks total:   ${context.chunks.size}  ` +
        `(sync:${chunksByType.sync}  lazy:${chunksByType.lazy}  ` +
        `prefetch:${chunksByType.prefetch}  preload:${chunksByType.preload})`,
    );

    // Module counts by type
    const modsByType: Record<string, number> = {};
    for (const mod of context.modules.values()) {
      const t = mod.type ?? "Unknown";
      modsByType[t] = (modsByType[t] ?? 0) + 1;
    }
    const modTypeSummary = Object.entries(modsByType)
      .map(([t, n]) => `${t}:${n}`)
      .join("  ");
    this.line(`  modules total:  ${context.modules.size}  (${modTypeSummary})`);

    // Size overview — top 5 chunks by parsed/raw
    this.line();
    this.line("[SIZE OVERVIEW]");
    this.line("  largest chunks (parsed size preferred):");
    const sortedChunks = [...context.chunks.values()].sort(
      (a, b) => effectiveSize(b.sizes) - effectiveSize(a.sizes),
    );
    sortedChunks.slice(0, LOGGER_SUMMARY_TOP_N).forEach((chunk, i) => {
      const label = chunk.name ? `"${chunk.name}"` : `id=${chunk.id}`;
      const rawKib = fmtKib(chunk.sizes.raw);
      const parsedKib = chunk.sizes.parsed != null ? fmtKib(chunk.sizes.parsed) : "n/a";
      const gzipKib = chunk.sizes.gzipped != null ? fmtKib(chunk.sizes.gzipped) : "n/a";
      this.line(
        `    ${String(i + 1).padStart(2)}. ${label.padEnd(20)} [${chunk.chunkType}]  ` +
          `id=${chunk.id.padEnd(4)}  raw=${rawKib.padStart(8)}  parsed=${parsedKib.padStart(8)}  gzip=${gzipKib.padStart(8)}`,
      );
    });
    if (sortedChunks.length > LOGGER_SUMMARY_TOP_N)
      this.line(`    … ${sortedChunks.length - LOGGER_SUMMARY_TOP_N} more chunks`);

    this.line();
    this.line("  largest modules (parsed size preferred):");
    const sortedMods = [...context.modules.values()]
      .filter((m) => m.type !== ModuleType.Concatenated)
      .sort((a, b) => effectiveSize(b.sizes) - effectiveSize(a.sizes));
    sortedMods.slice(0, LOGGER_SUMMARY_TOP_N).forEach((mod, i) => {
      const shortName = mod.resource
        ? mod.resource.replace(/.*node_modules[\\/]/, "node_modules/")
        : mod.name;
      const rawKib = fmtKib(mod.sizes.raw);
      const parsedKib = mod.sizes.parsed != null ? fmtKib(mod.sizes.parsed) : "n/a";
      const gzipKib = mod.sizes.gzipped != null ? fmtKib(mod.sizes.gzipped) : "n/a";
      const chunksLabel = `chunks=[${mod.chunks.slice(0, 3).join(",")}${mod.chunks.length > 3 ? ",…" : ""}]`;
      this.line(
        `    ${String(i + 1).padStart(2)}. ${shortName.slice(0, 45).padEnd(45)}  [${(mod.type ?? "?").padEnd(11)}]  ` +
          `raw=${rawKib.padStart(8)}  parsed=${parsedKib.padStart(8)}  gzip=${gzipKib.padStart(8)}  ${chunksLabel}`,
      );
    });
    if (sortedMods.length > LOGGER_SUMMARY_TOP_N)
      this.line(`    … ${sortedMods.length - LOGGER_SUMMARY_TOP_N} more modules`);

    // Packages
    let totalPkgs = 0;
    let duplicated = 0;
    for (const [, rootMap] of context.modulesByPackage) {
      totalPkgs++;
      if (rootMap.size >= 2) duplicated++;
    }
    this.line();
    this.line("[PACKAGES]");
    this.line(
      `  total: ${totalPkgs}  duplicated: ${duplicated}  singletons: ${totalPkgs - duplicated}`,
    );
    if (duplicated > 0) {
      this.line("  duplicated:");
      for (const [pkgName, rootMap] of context.modulesByPackage) {
        if (rootMap.size < 2) continue;
        const moduleCount = [...rootMap.values()].reduce((s, ids) => s + ids.length, 0);
        this.line(`    - "${pkgName}"  ${rootMap.size} roots, ${moduleCount} modules`);
      }
    }
  }

  // ── Chunks section (verbose only) ────────────────────────────────────────

  private writeChunksSection(context: BundleDoctorContext): void {
    const chunks = [...context.chunks.values()].sort(
      (a, b) => effectiveSize(b.sizes) - effectiveSize(a.sizes),
    );

    this.line();
    this.sep(true);
    this.line(`SECTION 1 — CHUNKS  (${chunks.length} total)`);
    this.sep(true);

    chunks.forEach((chunk, idx) => {
      this.line();
      this.line(`── chunk ${idx + 1} of ${chunks.length} ${"─".repeat(LOGGER_SEP_WIDTH - 20)}`);
      this.line(`  id:        "${chunk.id}"`);
      this.line(`  name:      ${chunk.name != null ? `"${chunk.name}"` : "(unnamed)"}`);
      this.line(`  type:      ${chunk.chunkType}`);
      this.line(`  sizes.raw:     ${fmtBytes(chunk.sizes.raw)}`);
      this.line(
        `  sizes.parsed:  ${chunk.sizes.parsed != null ? fmtBytes(chunk.sizes.parsed) : "(unavailable)"}`,
      );
      this.line(
        `  sizes.gzipped: ${chunk.sizes.gzipped != null ? fmtBytes(chunk.sizes.gzipped) : "(unavailable)"}`,
      );
      this.line(`  modules:   ${chunk.modules.length}`);
    });
  }

  // ── Modules section (verbose only) ───────────────────────────────────────

  private writeModulesSection(context: BundleDoctorContext): void {
    const topMods: ModuleInfo[] = [...context.modules.values()]
      .filter((m) => m.type !== ModuleType.Concatenated)
      .sort((a, b) => effectiveSize(b.sizes) - effectiveSize(a.sizes))
      .slice(0, LOGGER_MODULE_TOP_N);

    this.line();
    this.sep(true);
    this.line(`SECTION 2 — MODULES  (top ${topMods.length} by parsed size, cap=${LOGGER_MODULE_TOP_N})`);
    this.sep(true);

    topMods.forEach((mod, idx) => {
      const parsedLabel = mod.sizes.parsed != null ? `  parsed: ${fmtKib(mod.sizes.parsed)}` : "";
      const gzipLabel = mod.sizes.gzipped != null ? `  gzip: ${fmtKib(mod.sizes.gzipped)}` : "";
      this.line();
      this.line(
        `── module ${idx + 1} of ${topMods.length}  raw: ${fmtKib(mod.sizes.raw)}${parsedLabel}${gzipLabel} ${"─".repeat(Math.max(0, LOGGER_SEP_WIDTH - 40))}`,
      );
      this.line(`  id:               "${mod.id}"`);
      this.line(`  name:             ${mod.name}`);
      this.line(`  resource:         ${mod.resource ?? "(none)"}`);
      this.line(`  type:             ${mod.type ?? "Unknown"}`);
      this.line(`  sizes.raw:        ${fmtBytes(mod.sizes.raw)}`);
      this.line(
        `  sizes.parsed:     ${mod.sizes.parsed != null ? fmtBytes(mod.sizes.parsed) : "(unavailable)"}`,
      );
      this.line(
        `  sizes.gzipped:    ${mod.sizes.gzipped != null ? fmtBytes(mod.sizes.gzipped) : "(unavailable)"}`,
      );
      this.line(`  chunks[]:         [${mod.chunks.map((c) => `"${c}"`).join(",")}]`);
      if (mod.unusedExports !== undefined) {
        if (mod.unusedExports.length > 0) {
          this.line(
            `  unusedExports:    [${mod.unusedExports.join(", ")}]  (${mod.unusedExports.length})`,
          );
        } else {
          this.line(`  unusedExports:    (none — all exports used)`);
        }
      } else {
        this.line(`  unusedExports:    (unavailable — CJS or sideEffects module)`);
      }
      this.line(
        `  concatenatedInto: ${mod.concatenatedInto != null ? `"${mod.concatenatedInto}"` : "(none)"}`,
      );
    });
  }

  // ── Packages section (verbose only) ──────────────────────────────────────

  private writePackagesSection(context: BundleDoctorContext): void {
    this.line();
    this.sep(true);
    this.line("SECTION 3 — PACKAGES  (modulesByPackage)");
    this.sep(true);

    const duplicated: Array<[string, Map<string, string[]>]> = [];
    const singletons: string[] = [];

    for (const [pkgName, rootMap] of context.modulesByPackage) {
      if (rootMap.size >= 2) duplicated.push([pkgName, rootMap]);
      else singletons.push(pkgName);
    }

    // Sort duplicates by root count desc, then total module count desc
    duplicated.sort((a, b) => {
      const rootDiff = b[1].size - a[1].size;
      if (rootDiff !== 0) return rootDiff;
      const totalA = [...a[1].values()].reduce((s, ids) => s + ids.length, 0);
      const totalB = [...b[1].values()].reduce((s, ids) => s + ids.length, 0);
      return totalB - totalA;
    });

    this.line();
    if (duplicated.length === 0) {
      this.line(`[DUPLICATED]  none — no packages are bundled from multiple node_modules roots`);
    } else {
      this.line(
        `[DUPLICATED — ${duplicated.length} package${duplicated.length > 1 ? "s" : ""} bundled from multiple node_modules roots]`,
      );
      this.line();
      for (const [pkgName, rootMap] of duplicated) {
        this.line(`  "${pkgName}"  (${rootMap.size} roots)`);
        let rootIdx = 1;
        for (const [pkgRoot, moduleIds] of rootMap) {
          const first5 = moduleIds
            .slice(0, 5)
            .map((id) => `"${id}"`)
            .join(", ");
          const moreLabel = moduleIds.length > 5 ? `, …` : "";
          this.line(`    root ${rootIdx}:  ${pkgRoot}`);
          this.line(
            `             modules: [${first5}${moreLabel}]  (${moduleIds.length} module${moduleIds.length > 1 ? "s" : ""})`,
          );
          rootIdx++;
        }
        this.line();
      }
    }

    this.line();
    this.line(`[SINGLETONS — ${singletons.length} packages with a single root]`);
    if (singletons.length > 0) {
      const preview = singletons.slice(0, LOGGER_SINGLETON_PREVIEW).join(", ");
      const more =
        singletons.length > LOGGER_SINGLETON_PREVIEW
          ? ` … +${singletons.length - LOGGER_SINGLETON_PREVIEW} more`
          : "";
      this.line(`  ${preview}${more}`);
    }
  }

  // ── Low-level helpers ─────────────────────────────────────────────────────

  private line(s?: string): void {
    logToFile(s ?? "");
  }

  private sep(heavy = false): void {
    logToFile(heavy ? "\u2550".repeat(LOGGER_SEP_WIDTH) : "\u2500".repeat(LOGGER_SEP_WIDTH));
  }
}
