import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionManager, type MultiSessionFile } from '../src/session.ts';
import { ApiClient } from '../src/api.ts';
import { displayResponse } from '../src/output/index.ts';

const TEST_DIR = join(tmpdir(), `spacemolt-integ-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const API_BASE = 'http://test-server:9999/api/v2';

function makeClient(subdir: string) {
  const dir = join(TEST_DIR, subdir);
  mkdirSync(dir, { recursive: true });
  const sessionPath = join(dir, 'session.json');
  const session = new SessionManager({ sessionPath, apiBase: API_BASE, debug: false });
  const client = new ApiClient({ apiBase: API_BASE, debug: false, session });
  return { client, session, sessionPath };
}

function captureAll(fn: () => void): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = mock((...args: unknown[]) => { stdout.push(args.map(String).join(' ')); }) as typeof console.log;
  console.error = mock((...args: unknown[]) => { stderr.push(args.map(String).join(' ')); }) as typeof console.error;
  fn();
  console.log = origLog;
  console.error = origErr;
  return { stdout, stderr };
}

describe('Integration: login -> API call -> display', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  test('full login flow: create session -> login -> save credentials -> make API call -> display', async () => {
    const { client, session, sessionPath } = makeClient('full-flow');

    let callCount = 0;

    globalThis.fetch = mock(async (input: string | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      callCount++;

      // 1. Session creation
      if (url.endsWith('/session') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            session: { id: 'sess-001', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-12-31T23:59:59Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // 2. Login
      if (url.includes('/login')) {
        return new Response(
          JSON.stringify({
            result: 'Welcome, TestAgent!',
            structuredContent: { player_id: 'p123', password: 'secret' },
            session: { id: 'sess-001', expires_at: '2099-12-31T23:59:59Z', player_id: 'p123' },
            notifications: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // 3. get_status
      if (url.includes('/get_status')) {
        return new Response(
          JSON.stringify({
            result: 'Status OK',
            structuredContent: {
              player: { username: 'TestAgent', empire: 'solarian', credits: 500 },
              ship: { name: 'Prospector', class_id: 'starter', hull: 100, max_hull: 100, shield: 50, max_shield: 50, fuel: 80, max_fuel: 100, cargo_used: 0, cargo_capacity: 50 },
              location: { system_name: 'Sol', poi_name: 'Sol Station' },
            },
            notifications: [
              { type: 'system', timestamp: '2026-01-01T12:00:00Z', data: { message: 'Welcome to SpaceMolt!' } },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ error: { code: 'unknown', message: 'Not found' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    // Step 1: Login
    const loginResult = await client.call('/spacemolt_auth/login', { username: 'TestAgent', password: 'secret' });
    expect(loginResult.result).toBe('Welcome, TestAgent!');

    // Verify credentials were stored
    const store = JSON.parse(readFileSync(sessionPath, 'utf-8')) as MultiSessionFile;
    expect(store.activeAccount).toBe('testagent');
    expect(store.accounts['testagent'].password).toBe('secret');

    // Step 2: Make an API call
    const statusResult = await client.call('/spacemolt/get_status');
    expect(statusResult.structuredContent).toBeDefined();

    // Step 3: Display the result
    const { stdout } = captureAll(() =>
      displayResponse('spacemolt/get_status', statusResult as any),
    );

    // Notification should appear
    expect(stdout.some(l => l.includes('Welcome to SpaceMolt'))).toBe(true);
    // Player data should appear (from custom formatter)
    expect(stdout.some(l => l.includes('TestAgent'))).toBe(true);
    expect(stdout.some(l => l.includes('Prospector'))).toBe(true);
  });

  test('session expiry triggers re-auth and retry', async () => {
    const { client, session } = makeClient('reauth-flow');

    // Set up account with credentials
    session.saveSession({
      id: 'old-sess',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2099-12-31T23:59:59Z',
      username: 'Agent',
      password: 'pass',
    });
    session.storeCredentials('Agent', 'pass');

    let apiCallCount = 0;

    globalThis.fetch = mock(async (input: string | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;

      if (url.endsWith('/session') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ session: { id: 'new-sess', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-12-31T23:59:59Z' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/login')) {
        return new Response(
          JSON.stringify({ session: { id: 'reauthed-sess', expires_at: '2099-12-31T23:59:59Z', player_id: 'p1' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      apiCallCount++;
      if (apiCallCount === 1) {
        return new Response(
          JSON.stringify({ error: { code: 'session_expired', message: 'Session expired' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ result: 'Success after re-auth', notifications: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const result = await client.call('/spacemolt/get_status');
    expect(result.result).toBe('Success after re-auth');
    expect(apiCallCount).toBe(2);
  });
});
