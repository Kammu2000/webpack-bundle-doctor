/** Start/end character offsets of a single module factory within the bundle string. */
export interface ModuleBounds {
  start: number;
  end: number;
}

export type ModuleBoundsById = Record<string, ModuleBounds>;
export type BundleModuleSizes = Map<string, { parsed: number; gzipped: number }>;
