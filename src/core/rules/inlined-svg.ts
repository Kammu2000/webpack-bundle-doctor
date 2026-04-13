import { BundleDoctorContext, Issue, Rule } from "../../shared/types.js";
import { effectiveSize } from "../../plugin/utils.js";
import { DEFAULT_INLINED_SVG_THRESHOLD_KB, Severity } from "../../shared/constants.js";

interface InlinedSvgOptions {
  maxSizeKb?: number;
}

/**
 * Detects SVG files that have been inlined into the JS bundle by loaders such as
 * @svgr/webpack, svg-react-loader, or vue-svg-loader. These loaders convert SVG files
 * into JS components, which prevents webpack from emitting them as separate cacheable
 * assets and causes the SVG markup to inflate every JS chunk that imports them.
 *
 * Detection: any NormalModule whose resource path ends with ".svg" and whose size
 * exceeds the threshold is flagged. The threshold defaults to 10 KiB — small icon SVGs
 * are typically under 2 KiB; anything larger is worth reviewing.
 */
export const inlinedSvgRule: Rule<InlinedSvgOptions> = {
  id: "inlined-svg",
  meta: {
    description:
      "Detects SVG files inlined into the JS bundle by loaders like @svgr/webpack. " +
      "Large inlined SVGs inflate bundle size and prevent browser caching of the asset.",
    fixable: false,
  },
  defaultSeverity: Severity.Error,

  check(context: BundleDoctorContext, options?: InlinedSvgOptions): Issue[] {
    const maxKb = options?.maxSizeKb ?? DEFAULT_INLINED_SVG_THRESHOLD_KB;
    const threshold = maxKb * 1024;
    const issues: Issue[] = [];

    for (const [moduleId, mod] of context.modules) {
      if (!mod.resource?.toLowerCase().endsWith(".svg")) continue;

      const size = effectiveSize(mod.sizes);
      if (size <= threshold) continue;

      const sizeKb = (size / 1024).toFixed(1);
      const sizeLabel = mod.sizes.parsed != null ? "parsed" : "stat";
      const shortPath = mod.resource.replace(/.*node_modules[\\/]/, "node_modules/");

      issues.push({
        ruleId: "inlined-svg",
        severity: Severity.Error,
        message:
          `SVG "${shortPath}" is ${sizeKb} KiB (${sizeLabel}) and is inlined into the JS bundle. ` +
          `Consider using it as a static asset via <img src> or a URL loader instead of a JS component transform.`,
        affectedModules: [mod.resource ?? mod.name],
        metadata: {
          moduleId,
          resource: mod.resource,
          sizes: mod.sizes,
          thresholdKb: maxKb,
        },
      });
    }

    // Sort largest-first so the most impactful SVGs appear at the top
    issues.sort((a: Issue, b: Issue): number => {
      const sizeA = effectiveSize(
        (a.metadata?.sizes as { raw: number; parsed?: number } | undefined) ?? { raw: 0 },
      );
      const sizeB = effectiveSize(
        (b.metadata?.sizes as { raw: number; parsed?: number } | undefined) ?? { raw: 0 },
      );
      return sizeB - sizeA;
    });

    return issues;
  },
};
