import { BundleDoctorContext, Issue, Rule } from "../../shared/types.js";
import { Severity } from "../../shared/constants.js";

export const duplicatePackagesRule: Rule<Record<string, never>> = {
  id: "duplicate-packages",
  meta: {
    description:
      "Detects npm packages that are bundled more than once from different node_modules trees.",
  },
  defaultSeverity: Severity.Error,

  check(context: BundleDoctorContext): Issue[] {
    const issues: Issue[] = [];

    for (const [pkgName, rootMap] of context.modulesByPackage) {
      if (rootMap.size < 2) continue;

      const affectedModules: string[] = [];
      const rootSummaries: string[] = [];

      for (const [pkgRoot, moduleIds] of rootMap) {
        for (const id of moduleIds) {
          const mod = context.modules.get(id);
          affectedModules.push(mod?.resource ?? mod?.name ?? id);
        }
        rootSummaries.push(
          `  - ${pkgRoot} (${moduleIds.length} module${moduleIds.length > 1 ? "s" : ""})`,
        );
      }

      issues.push({
        ruleId: "duplicate-packages",
        severity: Severity.Error,
        message:
          `"${pkgName}" is bundled ${rootMap.size} times from different node_modules trees:\n` +
          rootSummaries.join("\n"),
        affectedModules,
        metadata: {
          packageName: pkgName,
          roots: [...rootMap.keys()],
          copyCount: rootMap.size,
        },
      });
    }

    return issues;
  },
};
