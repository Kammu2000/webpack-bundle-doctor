import { BundleDoctorContext, Issue, Rule } from "../../shared/types.js";
import { effectiveSize } from "../../plugin/utils.js";
import { DEFAULT_LARGE_MODULE_THRESHOLD_KB, ModuleType, Severity } from "../../shared/constants.js";

interface LargeModuleOptions {
  maxSizeKb?: number;
}

export const largeModuleRule: Rule<LargeModuleOptions> = {
  id: "large-module",
  meta: {
    description:
      "Detects individual modules that exceed a configurable size threshold — candidates for lazy loading.",
  },
  defaultSeverity: Severity.Warn,

  check(context: BundleDoctorContext, options?: LargeModuleOptions): Issue[] {
    const maxKb = options?.maxSizeKb ?? DEFAULT_LARGE_MODULE_THRESHOLD_KB;
    const threshold = maxKb * 1024;
    const issues: Issue[] = [];

    for (const [moduleId, mod] of context.modules) {
      // Skip the ConcatenatedModule container — its inner modules are analyzed individually
      if (mod.type === ModuleType.Concatenated) continue;

      const size = effectiveSize(mod.sizes);
      if (size <= threshold) continue;

      const sizeLabel = mod.sizes.parsed != null ? "parsed" : "stat";
      const actualKb = (size / 1024).toFixed(1);

      issues.push({
        ruleId: "large-module",
        severity: Severity.Warn,
        message: `Module "${mod.name}" is ${actualKb} KiB (${sizeLabel}), exceeds threshold of ${maxKb} KiB`,
        affectedModules: [mod.resource ?? mod.name],
        metadata: {
          moduleId,
          moduleName: mod.name,
          resource: mod.resource,
          sizes: mod.sizes,
          thresholdBytes: threshold,
        },
      });
    }

    return issues;
  },
};
