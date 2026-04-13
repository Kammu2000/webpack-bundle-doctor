import { Compilation, NormalModule } from "webpack";
import { BundleDoctorContext, ChunkInfo, ModuleInfo } from "../shared/types.js";
import { ModuleType } from "../shared/constants.js";
import {
  getModuleIdentity,
  getModuleType,
  extractPackageInfo,
  getChunkAssetSizes,
  getConcatenatedInnerModules,
  getChunkType,
  getModuleUnusedExports,
  getModuleSizes,
} from "./utils.js";

export function buildContext(compilation: Compilation): BundleDoctorContext {
  const { chunks, chunkGraph, moduleGraph } = compilation;

  const chunkMap = new Map<string, ChunkInfo>();
  const moduleMap = new Map<string, ModuleInfo>();

  // ── Pass 1: chunk + module maps ──────────────────────────────────────────
  for (const chunk of chunks) {
    const chunkInfo: ChunkInfo = {
      id: String(chunk.id),
      name: chunk.name ?? undefined,
      chunkType: getChunkType(chunk, compilation),
      sizes: { raw: 0 },
      modules: [],
    };
    let chunkSize = 0;

    for (const module of chunkGraph.getChunkModulesIterable(chunk)) {
      const rawId = chunkGraph.getModuleId(module);
      if (rawId == null) continue;
      const moduleId = String(rawId);

      if (moduleMap.has(moduleId)) {
        moduleMap.get(moduleId)!.chunks.push(chunkInfo.id);
        // Also update chunk membership for any already-registered inner modules
        for (const inner of getConcatenatedInnerModules(module)) {
          moduleMap.get(inner.identifier())?.chunks.push(chunkInfo.id);
        }
      } else {
        const { name, identifier, resource } = getModuleIdentity(module, compilation);
        const unusedExports =
          module instanceof NormalModule
            ? (getModuleUnusedExports(module, compilation) ?? undefined)
            : undefined;
        // Use codeGenerationResults for exact per-module sizes (post-transform, pre-Terser).
        // More accurate than chunk-level proportional estimation since it reflects the actual
        // generated code for each module individually.
        const { parsed: moduleParsed, gzipped: moduleGzipped } = getModuleSizes(
          module,
          compilation,
        );
        moduleMap.set(moduleId, {
          id: moduleId,
          name,
          identifier,
          resource,
          type: getModuleType(module),
          sizes: { raw: module.size(), parsed: moduleParsed, gzipped: moduleGzipped },
          chunks: [chunkInfo.id],
          unusedExports,
        });

        // Decompose ConcatenatedModule — register each inner NormalModule individually
        // so package deduplication and size analysis see the real module boundaries.
        // Inner modules share the outer module's code generation result, so distribute
        // the outer's parsed/gzipped proportionally among inners by raw size — tighter
        // scope than chunk-level proportional since all inners share the same transformation.
        const innerModules = getConcatenatedInnerModules(module);
        const { requestShortener } = compilation.runtimeTemplate;
        const outerRaw = module.size();
        for (const inner of innerModules) {
          const innerId = inner.identifier();
          if (moduleMap.has(innerId)) {
            moduleMap.get(innerId)!.chunks.push(chunkInfo.id);
          } else {
            const innerRaw = inner.size();
            const ratio = outerRaw > 0 ? innerRaw / outerRaw : 0;
            moduleMap.set(innerId, {
              id: innerId,
              name: inner.readableIdentifier(requestShortener),
              identifier: innerId,
              resource: inner.resource || inner.userRequest || undefined,
              type: ModuleType.Normal,
              sizes: {
                raw: innerRaw,
                parsed: moduleParsed != null ? Math.round(ratio * moduleParsed) : undefined,
                gzipped: moduleGzipped != null ? Math.round(ratio * moduleGzipped) : undefined,
              },
              chunks: [chunkInfo.id],
              concatenatedInto: moduleId,
            });
          }
        }
      }

      chunkSize += module.size();
      chunkInfo.modules.push(moduleId);
    }

    const { parsed: chunkParsed, gzipped: chunkGzipped } = getChunkAssetSizes(
      chunk.files,
      compilation.assets,
    );
    chunkInfo.sizes = {
      raw: chunkSize,
      parsed: chunkParsed > 0 ? chunkParsed : undefined,
      gzipped: chunkGzipped > 0 ? chunkGzipped : undefined,
    };
    chunkMap.set(chunkInfo.id, chunkInfo);
  }

  // ── Pass 1.5: proportional fallback for modules missing codeGenerationResults ─
  // getModuleSizes() (called in Pass 1) covers most modules via codeGenerationResults.
  // For the rare cases where it returns undefined (e.g. runtime-only modules, externals
  // with no JS source), fall back to proportional estimation from the chunk's asset sizes.
  // Assumes a uniform minification ratio within the chunk — less accurate than direct
  // code generation data, but still better than nothing.
  //
  // TODO: for post-Terser exact sizes, implement source map (VLQ) attribution —
  // parse the .map file from compilation.assets, decode VLQ mappings, and attribute
  // each byte range in the minified output back to its originating module.
  // This gives the same accuracy as webpack-bundle-analyzer without needing to
  // re-parse the bundle. Requires devtool to emit source maps; fall back to this
  // proportional approach when .map is absent.
  for (const modInfo of moduleMap.values()) {
    if (modInfo.sizes.parsed != null) continue; // already set by getModuleSizes()

    let bestChunk: ChunkInfo | null = null;
    for (const chunkId of modInfo.chunks) {
      const chunk = chunkMap.get(chunkId);
      if (!chunk || chunk.sizes.parsed == null || chunk.sizes.raw === 0) continue;
      if (!bestChunk || chunk.sizes.raw > bestChunk.sizes.raw) bestChunk = chunk;
    }
    if (!bestChunk) continue;

    const ratio = modInfo.sizes.raw / bestChunk.sizes.raw;
    modInfo.sizes.parsed = Math.round(ratio * bestChunk.sizes.parsed!);
    if (bestChunk.sizes.gzipped != null) {
      modInfo.sizes.gzipped = Math.round(ratio * bestChunk.sizes.gzipped);
    }
  }

  // ── Pass 2: modulesByPackage ─────────────────────────────────────────────
  const modulesByPackage = new Map<string, Map<string, string[]>>();

  for (const moduleInfo of moduleMap.values()) {
    const { resource } = moduleInfo;
    if (!resource) continue;

    const pkg = extractPackageInfo(resource);
    if (!pkg) continue;

    let rootMap = modulesByPackage.get(pkg.pkgName);
    if (!rootMap) {
      rootMap = new Map();
      modulesByPackage.set(pkg.pkgName, rootMap);
    }

    const list = rootMap.get(pkg.pkgRoot);
    if (list) {
      list.push(moduleInfo.id);
    } else {
      rootMap.set(pkg.pkgRoot, [moduleInfo.id]);
    }
  }

  // ── Pass 3: dependencyGraph ───────────────────────────────────────────────
  const dependencyGraph = new Map<string, string[]>();

  for (const module of compilation.modules) {
    const rawId = chunkGraph.getModuleId(module);
    if (rawId == null) continue;
    const srcId = String(rawId);

    const seen = new Set<string>();
    const outgoing: string[] = [];

    for (const conn of moduleGraph.getOutgoingConnections(module)) {
      if (!conn.module) continue;
      const dstRawId = chunkGraph.getModuleId(conn.module);
      if (dstRawId == null) continue;
      const dstId = String(dstRawId);
      if (dstId === srcId || dstId === "null" || seen.has(dstId)) continue;
      seen.add(dstId);
      outgoing.push(dstId);
    }

    dependencyGraph.set(srcId, outgoing);
  }

  return {
    chunks: chunkMap,
    modules: moduleMap,
    modulesByPackage,
    dependencyGraph,
    getModulesOfChunk: (chunkId) =>
      chunkMap
        .get(chunkId)
        ?.modules.map((id) => moduleMap.get(id)!)
        .filter(Boolean) ?? [],
    getChunksOfModule: (moduleId) =>
      moduleMap
        .get(moduleId)
        ?.chunks.map((id) => chunkMap.get(id)!)
        .filter(Boolean) ?? [],
  };
}
