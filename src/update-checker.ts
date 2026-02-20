import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { VERSION, GITHUB_REPO, NO_UPDATE_CHECK } from './config.ts';
import { c } from './output/colors.ts';

const CACHE_PATH = join(homedir(), '.config', 'spacemolt', 'update-check.json');
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const NOTIFY_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const TIMEOUT_MS = 3000;

interface UpdateCache {
  checked_at: string;
  latest_version: string;
  notified_at?: string;
  notified_version?: string;
}

export function compareVersions(a: string, b: string): number {
  const normalize = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const pa = normalize(a);
  const pb = normalize(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** Non-blocking update check. Fire and forget. */
export function checkForUpdates(): void {
  if (NO_UPDATE_CHECK) return;

  // Run async, never block
  doCheck().catch(() => {});
}

async function doCheck(): Promise<void> {
  // Check cache
  let cache: UpdateCache | null = null;
  try {
    cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
  } catch {}

  let latestVersion: string;

  if (cache && Date.now() - new Date(cache.checked_at).getTime() < CACHE_TTL_MS) {
    latestVersion = cache.latest_version;
  } else {
    // Fetch from GitHub
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
        },
      );
      clearTimeout(timer);

      if (!response.ok) return;
      const data = await response.json();
      latestVersion = data.tag_name || '';
    } catch {
      return; // Silently fail
    }

    // Update cache
    const newCache: UpdateCache = {
      checked_at: new Date().toISOString(),
      latest_version: latestVersion,
      notified_at: cache?.notified_at,
      notified_version: cache?.notified_version,
    };

    try {
      const dir = join(homedir(), '.config', 'spacemolt');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(CACHE_PATH, JSON.stringify(newCache, null, 2));
    } catch {}
  }

  // Compare versions
  if (!latestVersion || compareVersions(latestVersion, VERSION) <= 0) return;

  // Rate-limit notifications
  if (
    cache?.notified_version === latestVersion &&
    cache?.notified_at &&
    Date.now() - new Date(cache.notified_at).getTime() < NOTIFY_INTERVAL_MS
  ) {
    return;
  }

  // Show update notice
  console.error(
    `\n${c.yellow}Update available:${c.reset} ${c.dim}v${VERSION}${c.reset} -> ${c.green}${latestVersion}${c.reset}`,
  );
  console.error(
    `${c.dim}Run: bun install -g @spacemolt/client  or download from GitHub${c.reset}\n`,
  );

  // Record that we notified
  try {
    const updated: UpdateCache = {
      checked_at: new Date().toISOString(),
      latest_version: latestVersion,
      notified_at: new Date().toISOString(),
      notified_version: latestVersion,
    };
    writeFileSync(CACHE_PATH, JSON.stringify(updated, null, 2));
  } catch {}
}
