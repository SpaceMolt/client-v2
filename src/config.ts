import { join } from 'path';

// Version inlined from package.json — single source of truth in ./version
// (kept node-free so the library declaration build can include it).
export { VERSION } from './version';

export const API_BASE = process.env.SPACEMOLT_URL || 'https://game.spacemolt.com/api/v2';

export let DEBUG = process.env.DEBUG === 'true';

export function enableDebug(): void {
  DEBUG = true;
}

export const SESSION_PATH =
  process.env.SPACEMOLT_SESSION ||
  join(process.cwd(), '.spacemolt-session.json');

export const NO_UPDATE_CHECK = process.env.SPACEMOLT_NO_UPDATE_CHECK === 'true';

export const GITHUB_REPO = 'SpaceMolt/client-v2';
