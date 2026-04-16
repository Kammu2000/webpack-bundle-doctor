import { Severity, LogLevel, ModuleType, ChunkType } from "./constants.js";

type ModuleId = string;
type ChunkId = string;

export type ModuleInfo = {
  id: ModuleId;
   // Human-facing label (webpack stats style). Always set — use this for logs/UI.
  name: string;
   // Webpack's internal unique id (verbose). Use when you need an unambiguous key.
  identifier: string;
  /** Absolute resource path. Set for NormalModule and for inner modules of a ConcatenatedModule. */
  resource?: string;
  type?: ModuleType;
  sizes: {
    raw: number;
    parsed?: number;
    gzipped?: number;
  };
  chunks: ChunkId[];
  /**
   * Set when this module is an inner module of a ConcatenatedModule (scope hoisting).
   * Value is the chunk-graph ID of the parent ConcatenatedModule.
   */
  concatenatedInto?: string;
  /**
   * Exports that webpack determined are unused and will be tree-shaken.
   * Undefined when tree-shaking analysis is unavailable (CJS modules, sideEffects: true, etc).
   */
  unusedExports?: string[];
};

export type ChunkInfo = {
  id: string;
  name?: string;
  chunkType: ChunkType;
  sizes: {
    raw: number;
    parsed?: number;
    gzipped?: number;
  };
  modules: ModuleId[];
};

export type IssueSeverity = Severity;

export interface Issue {
  ruleId: string;
  severity: IssueSeverity;
  message: string;
  affectedModules?: ModuleId[];
  affectedChunks?: ChunkId[];
  /** Rule-specific structured data reserved for future fix generation. */
  metadata?: Record<string, unknown>;
}

export interface BundleDoctorContext {
  chunks: Map<string, ChunkInfo>;
  modules: Map<string, ModuleInfo>;
  /** pkgName → (pkgRoot → moduleId[]) — for duplicate detection; resolve IDs via `modules` */
  modulesByPackage: Map<string, Map<string, string[]>>;
  dependencyGraph: Map<string, string[]>;
  getModulesOfChunk(chunkId: string): ModuleInfo[];
  getChunksOfModule(moduleId: string): ChunkInfo[];
}

export interface Rule<TOptions = Record<string, unknown>> {
  readonly id: string;
  readonly meta: { description: string; fixable?: boolean };
  readonly defaultSeverity: IssueSeverity;
  check(context: BundleDoctorContext, options?: TOptions): Issue[];
}

export interface Reporter {
  report(issues: Issue[], context: BundleDoctorContext): void;
}

export type RuleConfig = "off" | IssueSeverity | [IssueSeverity, Record<string, unknown>];

export interface WebpackBundleDoctorOptions {
  logFile?: string;
  jsonFile?: string;
  rules?: Record<string, RuleConfig>;
  reporters?: ("console" | "json")[];
  logLevel?: LogLevel;
}
