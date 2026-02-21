import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { compareVersions, UpdateChecker, type UpdateCache } from '../src/update-checker.ts';

const TEST_DIR = join(tmpdir(), `spacemolt-update-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

function makeChecker(subdir: string, overrides: Partial<ConstructorParameters<typeof UpdateChecker>[0]> = {}) {
  const dir = join(TEST_DIR, subdir);
  mkdirSync(dir, { recursive: true });
  const cachePath = join(dir, 'update-check.json');
  const checker = new UpdateChecker({
    cachePath,
    currentVersion: '1.0.0',
    githubRepo: 'SpaceMolt/client',
    cacheTtlMs: 5 * 60 * 1000,
    notifyIntervalMs: 4 * 60 * 60 * 1000,
    timeoutMs: 3000,
    ...overrides,
  });
  return { checker, cachePath };
}

describe('compareVersions', () => {
  test('equal versions return 0', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('v1.0.0', 'v1.0.0')).toBe(0);
  });

  test('strips v prefix', () => {
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
  });

  test('major version comparison', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
  });

  test('minor version comparison', () => {
    expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
    expect(compareVersions('1.1.0', '1.2.0')).toBeLessThan(0);
  });

  test('patch version comparison', () => {
    expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1', '1.0.2')).toBeLessThan(0);
  });

  test('different length versions', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
  });

  test('double-digit versions', () => {
    expect(compareVersions('0.110.0', '0.109.6')).toBeGreaterThan(0);
    expect(compareVersions('0.109.6', '0.110.0')).toBeLessThan(0);
  });
});

describe('UpdateChecker.check', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  test('fetches from GitHub when no cache exists', async () => {
    const { checker, cachePath } = makeChecker('no-cache', { currentVersion: '1.0.0' });

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ tag_name: 'v2.0.0' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    await checker.check();

    // Should have written cache
    expect(existsSync(cachePath)).toBe(true);
    const cache: UpdateCache = JSON.parse(readFileSync(cachePath, 'utf-8'));
    expect(cache.latest_version).toBe('v2.0.0');
    expect(cache.notified_version).toBe('v2.0.0');
  });

  test('uses cache when fresh', async () => {
    const { checker, cachePath } = makeChecker('cached', { currentVersion: '1.0.0' });

    // Write fresh cache
    writeFileSync(cachePath, JSON.stringify({
      checked_at: new Date().toISOString(),
      latest_version: 'v2.0.0',
    }));

    let fetchCalled = false;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    await checker.check();

    // Should NOT have fetched — cache is fresh
    expect(fetchCalled).toBe(false);
  });

  test('refetches when cache is stale', async () => {
    const { checker, cachePath } = makeChecker('stale', {
      currentVersion: '1.0.0',
      cacheTtlMs: 1, // 1ms TTL — always stale
    });

    writeFileSync(cachePath, JSON.stringify({
      checked_at: '2020-01-01T00:00:00Z', // Old
      latest_version: 'v1.5.0',
    }));

    let fetchCalled = false;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return new Response(
        JSON.stringify({ tag_name: 'v2.0.0' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    await checker.check();
    expect(fetchCalled).toBe(true);
  });

  test('silently fails on fetch error', async () => {
    const { checker } = makeChecker('fetch-err', { currentVersion: '1.0.0' });

    globalThis.fetch = mock(async () => {
      throw new Error('Network error');
    }) as typeof fetch;

    // Should not throw
    await checker.check();
  });

  test('silently fails on non-OK response', async () => {
    const { checker } = makeChecker('non-ok', { currentVersion: '1.0.0' });

    globalThis.fetch = mock(async () =>
      new Response('Not Found', { status: 404 }),
    ) as typeof fetch;

    await checker.check();
  });

  test('does not notify when already on latest', async () => {
    const { checker, cachePath } = makeChecker('current', { currentVersion: '2.0.0' });

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ tag_name: 'v2.0.0' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const origError = console.error;
    let notified = false;
    console.error = mock((...args: unknown[]) => {
      if (args.some(a => String(a).includes('Update available'))) notified = true;
    }) as typeof console.error;

    await checker.check();
    console.error = origError;

    expect(notified).toBe(false);
  });

  test('does not notify when on newer version', async () => {
    const { checker } = makeChecker('newer', { currentVersion: '3.0.0' });

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ tag_name: 'v2.0.0' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const origError = console.error;
    let notified = false;
    console.error = mock((...args: unknown[]) => {
      if (args.some(a => String(a).includes('Update available'))) notified = true;
    }) as typeof console.error;

    await checker.check();
    console.error = origError;

    expect(notified).toBe(false);
  });

  test('notifies when update is available', async () => {
    const { checker } = makeChecker('notify', { currentVersion: '1.0.0' });

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ tag_name: 'v2.0.0' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const origError = console.error;
    let notified = false;
    console.error = mock((...args: unknown[]) => {
      if (args.some(a => String(a).includes('Update available'))) notified = true;
    }) as typeof console.error;

    await checker.check();
    console.error = origError;

    expect(notified).toBe(true);
  });

  test('rate-limits notifications', async () => {
    const { checker, cachePath } = makeChecker('rate-limit', { currentVersion: '1.0.0' });

    // Write cache with recent notification
    writeFileSync(cachePath, JSON.stringify({
      checked_at: new Date().toISOString(),
      latest_version: 'v2.0.0',
      notified_at: new Date().toISOString(),
      notified_version: 'v2.0.0',
    }));

    const origError = console.error;
    let notified = false;
    console.error = mock((...args: unknown[]) => {
      if (args.some(a => String(a).includes('Update available'))) notified = true;
    }) as typeof console.error;

    await checker.check();
    console.error = origError;

    expect(notified).toBe(false);
  });

  test('re-notifies after interval expires', async () => {
    const { checker, cachePath } = makeChecker('re-notify', {
      currentVersion: '1.0.0',
      notifyIntervalMs: 1, // 1ms — always expired
    });

    writeFileSync(cachePath, JSON.stringify({
      checked_at: new Date().toISOString(),
      latest_version: 'v2.0.0',
      notified_at: '2020-01-01T00:00:00Z', // Old notification
      notified_version: 'v2.0.0',
    }));

    const origError = console.error;
    let notified = false;
    console.error = mock((...args: unknown[]) => {
      if (args.some(a => String(a).includes('Update available'))) notified = true;
    }) as typeof console.error;

    await checker.check();
    console.error = origError;

    expect(notified).toBe(true);
  });

  test('records notification in cache after notifying', async () => {
    const { checker, cachePath } = makeChecker('record', { currentVersion: '1.0.0' });

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ tag_name: 'v3.0.0' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const origError = console.error;
    console.error = mock(() => {}) as typeof console.error;
    await checker.check();
    console.error = origError;

    const cache: UpdateCache = JSON.parse(readFileSync(cachePath, 'utf-8'));
    expect(cache.notified_version).toBe('v3.0.0');
    expect(cache.notified_at).toBeTruthy();
  });

  test('creates cache directory if missing', async () => {
    const dir = join(TEST_DIR, 'deep', 'nested');
    const cachePath = join(dir, 'update-check.json');
    const checker = new UpdateChecker({
      cachePath,
      currentVersion: '1.0.0',
      githubRepo: 'SpaceMolt/client',
    });

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ tag_name: 'v2.0.0' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const origError = console.error;
    console.error = mock(() => {}) as typeof console.error;
    await checker.check();
    console.error = origError;

    expect(existsSync(cachePath)).toBe(true);
  });

  test('handles empty tag_name gracefully', async () => {
    const { checker } = makeChecker('empty-tag', { currentVersion: '1.0.0' });

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ tag_name: '' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    // Should not throw or notify
    const origError = console.error;
    let notified = false;
    console.error = mock((...args: unknown[]) => {
      if (args.some(a => String(a).includes('Update available'))) notified = true;
    }) as typeof console.error;

    await checker.check();
    console.error = origError;

    expect(notified).toBe(false);
  });
});
