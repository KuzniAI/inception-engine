import process from "node:process";

const C = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
} as const;

type Color = keyof typeof C;

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
  const tty = Boolean(process.stdout.isTTY);
  const errTTY = Boolean(process.stderr.isTTY);

  const c = (col: Color, text: string, onTTY: boolean): string =>
    onTTY ? `${C[col]}${text}${C.reset}` : text;

  return {
    fail(label, msg) {
      if (!silent) process.stderr.write(`  ${c("red", "✗", errTTY)} ${label}: ${msg}\n`);
    },
    ok(label) {
      if (!silent) process.stdout.write(`  ${c("green", "✓", tty)} ${label}\n`);
    },
    skip(label, note) {
      if (!silent) process.stdout.write(`  ${c("yellow", "-", tty)} ${label} ${note}\n`);
    },
    plan(label) {
      if (!silent) process.stdout.write(`  ${c("cyan", "○", tty)} ${label}\n`);
    },
    warn(label, msg) {
      if (!silent) process.stdout.write(`  ${c("yellow", "!", tty)} ${label}: ${msg}\n`);
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
  return Boolean(process.stdout.isTTY) ? `\x1b[36m[dry-run]\x1b[0m ` : `[dry-run] `;
}
