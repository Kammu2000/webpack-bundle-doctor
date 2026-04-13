import { BundleDoctorContext, Issue, Rule } from "../../shared/types.js";
import { effectiveSize } from "../../plugin/utils.js";
import { DEFAULT_LARGE_CHUNK_THRESHOLD_KB, Severity } from "../../shared/constants.js";

interface LargeChunkOptions {
  maxSizeKb?: number;
}

export const largeChunkRule: Rule<LargeChunkOptions> = {
  id: "large-chunk",
  meta: {
    description: "Detects output chunks that exceed a configurable size threshold.",
  },
  defaultSeverity: Severity.Warn,

  check(context: BundleDoctorContext, options?: LargeChunkOptions): Issue[] {
    const maxKb = options?.maxSizeKb ?? DEFAULT_LARGE_CHUNK_THRESHOLD_KB;
    const threshold = maxKb * 1024;
    const issues: Issue[] = [];

    for (const [chunkId, chunk] of context.chunks) {
      const size = effectiveSize(chunk.sizes);
      if (size <= threshold) continue;

      const label = chunk.name ?? chunkId;
      const sizeLabel = chunk.sizes.parsed != null ? "parsed" : "stat";
      const actualKb = (size / 1024).toFixed(1);

      issues.push({
        ruleId: "large-chunk",
        severity: Severity.Warn,
        message: `Chunk "${label}" is ${actualKb} KiB (${sizeLabel}), exceeds threshold of ${maxKb} KiB`,
        affectedChunks: [chunk.name ?? chunkId],
        metadata: {
          chunkId,
          chunkName: chunk.name,
          sizes: chunk.sizes,
          thresholdBytes: threshold,
        },
      });
    }

    return issues;
  },
};
