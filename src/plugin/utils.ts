import { gzipSync } from "zlib";
import { NormalModule, Compilation, Module, Chunk, ChunkGroup } from "webpack";
import ConcatenatedModule from "webpack/lib/optimize/ConcatenatedModule";
import { PKG_RE, ModuleType, ChunkType } from "../shared/constants.js";

interface ConcatenatedModuleShape extends Module {
  modules: Set<Module>;
}

/**
 * For non-NormalModule types (e.g. modules whose class doesn't extend NormalModule
 * at runtime), extract the resource path from the webpack identifier string.
 * Webpack encodes loader chains as "loader1!loader2!resource" — the resource is
 * everything after the last "!".
 */
function resourceFromIdentifier(identifier: string): string | undefined {
  const bang = identifier.lastIndexOf("!");
  const candidate = bang >= 0 ? identifier.slice(bang + 1) : identifier;
  return /\.\w+$/.test(candidate) ? candidate : undefined;
}

export function getModuleIdentity(
  module: Module,
  compilation: Compilation,
): { name: string; identifier: string; resource?: string } {
  const { requestShortener } = compilation.runtimeTemplate;
  return {
    name: module.readableIdentifier(requestShortener),
    identifier: module.identifier(),
    resource:
      module instanceof NormalModule
        ? module.resource || module.userRequest || undefined
        : resourceFromIdentifier(module.identifier()),
  };
}

export function getModuleType(module: Module): ModuleType {
  if (module instanceof NormalModule) return ModuleType.Normal;
  if (module instanceof ConcatenatedModule) return ModuleType.Concatenated;
  return ModuleType.External;
}

export function getChunkType(chunk: Chunk, _compilation: Compilation): ChunkType {
  if (chunk.canBeInitial()) return ChunkType.Sync;

  for (const group of chunk.groupsIterable) {
    const { options } = group as ChunkGroup;
    if (options?.prefetchOrder !== undefined) return ChunkType.Prefetch;
    if (options?.preloadOrder !== undefined) return ChunkType.Preload;
  }

  return ChunkType.Lazy;
}

export function getConcatenatedInnerModules(module: Module): NormalModule[] {
  if (!(module instanceof ConcatenatedModule)) return [];
  const innerSet = (module as ConcatenatedModuleShape).modules;
  const result: NormalModule[] = [];
  for (const inner of innerSet) {
    if (inner instanceof ConcatenatedModule) {
      result.push(...getConcatenatedInnerModules(inner));
    } else if (inner instanceof NormalModule) {
      result.push(inner);
    }
  }
  return result;
}

/**
 * Returns parsed (pre-minification) and gzipped byte sizes for a module
 * by reading webpack's code generation results.
 *
 * Sizes reflect post-webpack-transform but pre-Terser code. On minified
 * builds they overestimate; on development builds they are accurate.
 */
export function getModuleSizes(
  module: Module,
  compilation: Compilation,
): { parsed?: number; gzipped?: number } {
  const { chunkGraph, codeGenerationResults } = compilation;
  if (!codeGenerationResults) return {};

  const runtimes = chunkGraph.getModuleRuntimes(module);
  for (const runtime of runtimes) {
    try {
      const result = codeGenerationResults.get(module, runtime);
      const jsSource = result.sources.get("javascript");
      if (!jsSource) continue;
      const buf = jsSource.buffer();
      return { parsed: buf.length, gzipped: gzipSync(buf).length };
    } catch {
      // module not code-generated for this runtime — try next
    }
  }
  return {};
}

export function getChunkAssetSizes(
  fileNames: Set<string>,
  assets: Compilation["assets"],
): { parsed: number; gzipped: number } {
  let parsed = 0;
  let gzipped = 0;

  for (const name of fileNames) {
    if (name.endsWith(".map")) continue;

    const asset = assets[name];
    if (!asset) continue;
    const buf = asset.buffer();
    parsed += buf.length;
    gzipped += gzipSync(buf).length;
  }

  return { parsed, gzipped };
}

export function effectiveSize(sizes: { raw: number; parsed?: number }): number {
  return sizes.parsed ?? sizes.raw;
}

export function extractPackageInfo(resource: string): { pkgName: string; pkgRoot: string } | null {
  const match = PKG_RE.exec(resource);
  if (!match) return null;
  return {
    pkgName: match[1].replace(/\\/g, "/"),
    pkgRoot: resource.slice(0, match.index + match[0].length),
  };
}

/**
 * Returns the list of exports that webpack determined are unused (tree-shaken) for
 * a NormalModule across all runtimes it participates in.
 *
 * Returns undefined when tree-shaking analysis is unavailable — e.g. CJS modules,
 * modules with sideEffects:true, or when webpack has no export usage data.
 */
export function getModuleUnusedExports(
  module: NormalModule,
  compilation: Compilation,
): string[] | undefined {
  const { chunkGraph, moduleGraph } = compilation;
  const runtimes = [...chunkGraph.getModuleRuntimes(module)];
  if (runtimes.length === 0) return undefined;

  const usedExports = new Set<string>();

  for (const runtime of runtimes) {
    const used = moduleGraph.getUsedExports(module, runtime);
    // null  → tree shaking disabled for this module (CJS, sideEffects, etc.)
    // true  → all exports are used in this runtime
    if (used === null || used === true) return undefined;
    // false → no exports used in this runtime; keep going to check others
    if (used === false) continue;
    for (const name of used) usedExports.add(name);
  }

  const unused: string[] = [];
  for (const exportInfo of moduleGraph.getExportsInfo(module).orderedExports) {
    if (exportInfo.name && exportInfo.provided === true && !usedExports.has(exportInfo.name)) {
      unused.push(exportInfo.name);
    }
  }

  return unused;
}
