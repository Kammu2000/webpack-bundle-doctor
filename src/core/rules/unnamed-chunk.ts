import { BundleDoctorContext, Issue, Rule } from "../../shared/types.js";
import { effectiveSize } from "../../plugin/utils.js";
import { ChunkType, Severity } from "../../shared/constants.js";

interface UnnamedChunkOptions {
  /** Chunk types to check. Defaults to all four types (sync, lazy, prefetch, preload). */
  chunkTypes?: ChunkType[];
  /** Skip chunks smaller than this (KiB). Useful to suppress tiny runtime chunks. Defaults to 0. */
  minSizeKb?: number;
}

/**
 * Detects chunks that have no explicit name. Webpack assigns numeric or hash-based IDs
 * to unnamed chunks. Those IDs are derived from the module graph structure and can shift
 * when unrelated modules are added or removed, busting browser cache for chunks whose
 * content has not changed.
 *
 * Fix for lazy/prefetch/preload chunks: add a webpackChunkName magic comment to the
 * dynamic import — e.g. import(/* webpackChunkName: "my-feature" *\/ './my-feature').
 * Fix for sync chunks: add a named entry in webpack configuration.
 */
export const unnamedChunkRule: Rule<UnnamedChunkOptions> = {
  id: "unnamed-chunk",
  meta: {
    description:
      "Detects chunks with no name. Unnamed chunks receive numeric IDs that shift when " +
      "the module graph changes, invalidating browser cache for unmodified chunks.",
    fixable: false,
  },
  defaultSeverity: Severity.Warn,

  check(context: BundleDoctorContext, options?: UnnamedChunkOptions): Issue[] {
    const allowedTypes = options?.chunkTypes ?? (Object.values(ChunkType) as ChunkType[]);
    const minBytes = (options?.minSizeKb ?? 0) * 1024;
    const issues: Issue[] = [];

    for (const [chunkId, chunk] of context.chunks) {
      if (chunk.name) continue;
      if (!allowedTypes.includes(chunk.chunkType as ChunkType)) continue;

      const size = effectiveSize(chunk.sizes);
      if (size < minBytes) continue;

      const sizeKb = (size / 1024).toFixed(1);
      const fix =
        chunk.chunkType === ChunkType.Sync
          ? "Add a named entry in your webpack configuration."
          : `Add /* webpackChunkName: "descriptive-name" */ to the dynamic import.`;

      issues.push({
        ruleId: "unnamed-chunk",
        severity: Severity.Warn,
        message:
          `Chunk id=${chunkId} [${chunk.chunkType}] is unnamed (${sizeKb} KiB). ` +
          `Unnamed chunks use numeric IDs that shift when the module graph changes, ` +
          `busting browser cache for unmodified chunks. ${fix}`,
        affectedChunks: [chunk.name ?? chunkId],
        metadata: {
          chunkId,
          chunkType: chunk.chunkType,
          sizes: chunk.sizes,
        },
      });
    }

    return issues;
  },
};
