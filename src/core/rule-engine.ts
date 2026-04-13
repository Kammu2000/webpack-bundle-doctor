import { BundleDoctorContext, Issue, IssueSeverity, Rule, RuleConfig } from "../shared/types.js";
import { DISPLAY_NAME } from "../shared/constants.js";

interface ResolvedRuleEntry {
  rule: Rule<Record<string, unknown>>;
  severity: IssueSeverity;
  options: Record<string, unknown> | undefined;
}

export class RuleEngine {
  private readonly resolved: ResolvedRuleEntry[];

  constructor(
    defaultRules: Map<string, Rule<Record<string, unknown>>>,
    userConfig: Record<string, RuleConfig> = {},
  ) {
    this.resolved = [];

    for (const [ruleId, rule] of defaultRules) {
      const userEntry = userConfig[ruleId];

      if (userEntry === "off") continue;

      if (Array.isArray(userEntry)) {
        const [severity, options] = userEntry;
        this.resolved.push({ rule, severity, options });
        continue;
      }

      if (typeof userEntry === "string") {
        this.resolved.push({ rule, severity: userEntry as IssueSeverity, options: undefined });
        continue;
      }

      // Not in user config — use rule's default
      this.resolved.push({ rule, severity: rule.defaultSeverity, options: undefined });
    }

    // Warn about unknown rule IDs in user config
    for (const ruleId of Object.keys(userConfig)) {
      if (!defaultRules.has(ruleId)) {
        process.stderr.write(`[${DISPLAY_NAME}] Unknown rule "${ruleId}" in config — ignored\n`);
      }
    }
  }

  run(context: BundleDoctorContext): Issue[] {
    const allIssues: Issue[] = [];

    for (const { rule, severity, options } of this.resolved) {
      let issues: Issue[];
      try {
        issues = rule.check(context, options);
      } catch (err) {
        process.stderr.write(
          `[${DISPLAY_NAME}] Rule "${rule.id}" threw an error: ${String(err)}\n`,
        );
        continue;
      }

      for (const issue of issues) {
        allIssues.push({ ...issue, severity });
      }
    }

    return allIssues;
  }
}
