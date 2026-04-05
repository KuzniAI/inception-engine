import process from "node:process";
import { styleText } from "node:util";

export interface Logger {
  fail(label: string, msg: string): void;
  ok(label: string): void;
  skip(label: string, note: string): void;
  plan(label: string): void;
  warn(label: string, msg: string): void;
  info(msg: string): void;
  error(msg: string): void;
  errorRaw(value: unknown): void;
  detail(msg: string): void;
  silence(): void;
}

export function createLogger(): Logger {
  let silent = false;

  return {
    fail(label, msg) {
      if (!silent) {
        const icon = styleText("red", "✗");
        process.stderr.write(`  ${icon} ${label}: ${msg}\n`);
      }
    },
    ok(label) {
      if (!silent) {
        const icon = styleText("green", "✓");
        process.stdout.write(`  ${icon} ${label}\n`);
      }
    },
    skip(label, note) {
      if (!silent) {
        const icon = styleText("yellow", "-");
        process.stdout.write(`  ${icon} ${label} ${note}\n`);
      }
    },
    plan(label) {
      if (!silent) {
        const icon = styleText("cyan", "○");
        process.stdout.write(`  ${icon} ${label}\n`);
      }
    },
    warn(label, msg) {
      if (!silent) {
        const icon = styleText("yellow", "!");
        process.stdout.write(`  ${icon} ${label}: ${msg}\n`);
      }
    },
    info(msg) {
      if (!silent) process.stdout.write(`${msg}\n`);
    },
    error(msg) {
      if (!silent) process.stderr.write(`${msg}\n`);
    },
    errorRaw(value) {
      if (!silent) console.error(value);
    },
    detail(msg) {
      if (!silent) process.stdout.write(`    ${msg}\n`);
    },
    silence() {
      silent = true;
    },
  };
}

export const logger = createLogger();

export function dryRunPrefix(dryRun: boolean): string {
  if (!dryRun) return "";
  return styleText("cyan", "[plan] ");
}
