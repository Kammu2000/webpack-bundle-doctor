import { writeFileSync, appendFileSync } from "fs";
import { isAbsolute, resolve } from "path";
import { DEFAULT_LOG_FILE } from "../shared/constants.js";

let logFilePath = resolve(process.cwd(), DEFAULT_LOG_FILE);

export function setLogFile(file: string): void {
  logFilePath = isAbsolute(file) ? file : resolve(process.cwd(), file);
}

export function clearOldLogs(): void {
  writeFileSync(logFilePath, "", "utf8");
}

export function logToFile(...args: unknown[]): void {
  const message = args
    .map((a) => (typeof a === "object" && a !== null ? JSON.stringify(a, null, 2) : String(a)))
    .join(" ");

  appendFileSync(logFilePath, message + "\n", "utf8");
}
