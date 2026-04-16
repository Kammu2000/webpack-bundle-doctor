import { Compiler, Compilation } from "webpack";
import { setLogFile, logToFile } from "./log.js";
import { buildContext } from "./context-builder.js";
import { BundleDoctorLogger } from "./logger.js";
import { RuleEngine } from "../core/rule-engine.js";
import { defaultRules } from "../core/rules/index.js";
import { ConsoleReporter } from "../core/reporters/console-reporter.js";
import { JsonReporter } from "../core/reporters/json-reporter.js";
import { WebpackBundleDoctorOptions } from "../shared/types.js";
import { PLUGIN_NAME, LogLevel } from "../shared/constants.js";

export class WebpackBundleDoctorPlugin {
  constructor(private readonly options: WebpackBundleDoctorOptions = {}) {}

  apply(compiler: Compiler): void {
    const logger = new BundleDoctorLogger(
      this.options.logLevel ?? LogLevel.Off,
      this.options.logFile,
    );
    setLogFile(logger.resolvedLogFile);

    compiler.hooks.emit.tap(PLUGIN_NAME, (compilation: Compilation) => {
      const context = buildContext(compilation);
      logger.write(compilation, context);

      const engine = new RuleEngine(defaultRules, this.options.rules ?? {});
      const issues = engine.run(context);

      const reporterNames = this.options.reporters ?? ["console"];
      for (const name of reporterNames) {
        if (name === "console") new ConsoleReporter().report(issues, context);
        if (name === "json") new JsonReporter(this.options.jsonFile).report(issues, context);
      }
    });

    compiler.hooks.failed.tap(PLUGIN_NAME, (error) => {
      try {
        logToFile(
          `\n[FAILED] ${new Date().toISOString()}\n${(error as Error)?.stack ?? String(error)}\n`,
        );
      } catch {
        logToFile(
          `\n[FAILED] Compilation failed because of unknown issue\n`,
        );
      }
    });
  }
}
