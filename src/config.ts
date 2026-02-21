import { join } from 'path';
import { homedir } from 'os';
import { readFileSync } from 'fs';

// Read version from package.json (single source of truth)
const pkg = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf-8'));
export const VERSION: string = pkg.version;

export const API_BASE = process.env.SPACEMOLT_URL || 'https://game.spacemolt.com/api/v2';

export const DEBUG = process.env.DEBUG === 'true';

export const SESSION_PATH =
  process.env.SPACEMOLT_SESSION ||
  join(homedir(), '.config', 'spacemolt', 'session.json');

export const NO_UPDATE_CHECK = process.env.SPACEMOLT_NO_UPDATE_CHECK === 'true';

export const GITHUB_REPO = 'SpaceMolt/client';
