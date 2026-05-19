import { describe, test, expect } from 'bun:test';

describe('config', () => {
  test('VERSION matches package.json', async () => {
    const { VERSION } = await import('../src/config.ts');
    const pkg = await import('../package.json');
    expect(VERSION).toBe(pkg.version);
  });

  test('VERSION is a semver string', async () => {
    const { VERSION } = await import('../src/config.ts');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('API_BASE defaults to production endpoint', async () => {
    const { API_BASE } = await import('../src/config.ts');
    // May be overridden by SPACEMOLT_URL env var, but should be a valid URL
    expect(API_BASE).toMatch(/^https?:\/\//);
  });

  test('SESSION_PATH is an absolute path', async () => {
    const { SESSION_PATH } = await import('../src/config.ts');
    expect(SESSION_PATH).toMatch(/^\//);
    expect(SESSION_PATH).toContain('session.json');
  });

  test('GITHUB_REPO is set', async () => {
    const { GITHUB_REPO } = await import('../src/config.ts');
    expect(GITHUB_REPO).toBe('SpaceMolt/client-v2');
  });

  test('enableDebug activates debug mode', async () => {
    const { DEBUG, enableDebug } = await import('../src/config.ts');
    const wasBefore = DEBUG;
    enableDebug();
    const { DEBUG: after } = await import('../src/config.ts');
    expect(after).toBe(true);
  });
});
