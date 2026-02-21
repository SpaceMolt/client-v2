// Respect NO_COLOR (https://no-color.org/), --no-color flag, and non-TTY output
const noColor =
  !!process.env.NO_COLOR ||
  process.argv.includes('--no-color') ||
  !process.stdout.isTTY;

function code(ansi: string): string {
  return noColor ? '' : ansi;
}

export const c = {
  reset: code('\x1b[0m'),
  bright: code('\x1b[1m'),
  dim: code('\x1b[2m'),
  red: code('\x1b[31m'),
  green: code('\x1b[32m'),
  yellow: code('\x1b[33m'),
  blue: code('\x1b[34m'),
  magenta: code('\x1b[35m'),
  cyan: code('\x1b[36m'),
  white: code('\x1b[37m'),
} as const;
