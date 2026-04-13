import { BundleDoctorContext, Issue, IssueSeverity, Reporter } from "../../shared/types.js";
import {
  ANSI_BOLD,
  ANSI_BLUE,
  ANSI_GREEN,
  ANSI_RED,
  ANSI_RESET,
  ANSI_YELLOW,
  DISPLAY_NAME,
  Severity,
} from "../../shared/constants.js";

function colorForSeverity(s: IssueSeverity): string {
  switch (s) {
    case Severity.Error:
      return ANSI_RED;
    case Severity.Warn:
      return ANSI_YELLOW;
    case Severity.Info:
      return ANSI_BLUE;
  }
}

function labelForSeverity(s: IssueSeverity): string {
  switch (s) {
    case Severity.Error:
      return "ERROR";
    case Severity.Warn:
      return "WARN ";
    case Severity.Info:
      return "INFO ";
  }
}

export class ConsoleReporter implements Reporter {
  report(issues: Issue[], _context: BundleDoctorContext): void {
    if (issues.length === 0) {
      process.stdout.write(`\n${ANSI_GREEN}[${DISPLAY_NAME}]${ANSI_RESET} No issues found.\n\n`);
      return;
    }

    process.stdout.write(`\n${ANSI_BOLD}[${DISPLAY_NAME}]${ANSI_RESET}\n\n`);

    for (const issue of issues) {
      const color = colorForSeverity(issue.severity);
      const label = labelForSeverity(issue.severity);
      process.stdout.write(
        `${color}${ANSI_BOLD}[${label}]${ANSI_RESET} ${color}[${issue.ruleId}]${ANSI_RESET} ${issue.message}\n`,
      );
      if (issue.affectedChunks && issue.affectedChunks.length > 0) {
        process.stdout.write(`         Chunks: ${issue.affectedChunks.slice(0, 5).join(", ")}\n`);
      }
      if (issue.affectedModules && issue.affectedModules.length > 0) {
        const shown = issue.affectedModules.slice(0, 5);
        const extra = issue.affectedModules.length - shown.length;
        const suffix = extra > 0 ? ` (+${extra} more)` : "";
        process.stdout.write(`         Modules: ${shown.join(", ")}${suffix}\n`);
      }
      process.stdout.write("\n");
    }

    const errors = issues.filter((i) => i.severity === Severity.Error).length;
    const warns = issues.filter((i) => i.severity === Severity.Warn).length;
    const infos = issues.filter((i) => i.severity === Severity.Info).length;

    process.stdout.write(
      `${ANSI_BOLD}[${DISPLAY_NAME}]${ANSI_RESET} ${issues.length} issue(s): ` +
        `${ANSI_RED}${errors} error(s)${ANSI_RESET}, ` +
        `${ANSI_YELLOW}${warns} warning(s)${ANSI_RESET}, ` +
        `${ANSI_BLUE}${infos} info(s)${ANSI_RESET}\n\n`,
    );
  }
}
