import { writeFileSync } from "fs";
import { isAbsolute, resolve } from "path";
import { BundleDoctorContext, Issue, Reporter } from "../../shared/types.js";
import { DEFAULT_JSON_REPORT_FILE } from "../../shared/constants.js";

export class JsonReporter implements Reporter {
  readonly resolvedOutputFile: string;

  constructor(outputFile?: string) {
    const candidate = outputFile ?? DEFAULT_JSON_REPORT_FILE;
    this.resolvedOutputFile = isAbsolute(candidate)
      ? candidate
      : resolve(process.cwd(), candidate);
  }

  report(issues: Issue[], _context: BundleDoctorContext): void {
    writeFileSync(this.resolvedOutputFile, JSON.stringify(issues, null, 2), "utf8");
  }
}
