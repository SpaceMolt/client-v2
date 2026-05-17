import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionManager, createPassthroughAdapter, type MultiSessionFile } from '../src/session.ts';
import { ApiClient } from '../src/api.ts';

const TEST_DIR = join(tmpdir(), `spacemolt-api-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const API_BASE = 'http://test-server:9999/api/v2';

function makeClient(subdir: string) {
  const dir = join(TEST_DIR, subdir);
  mkdirSync(dir, { recursive: true });
  const sessionPath = join(dir, 'session.json');
  const session = new SessionManager({ sessionPath, apiBase: API_BASE, debug: false });
  const client = new ApiClient({ apiBase: API_BASE, debug: false, session });
  return { client, session, sessionPath };
}

/** Seed a valid non-expired session so getValidSession returns it directly */
function seedSession(session: SessionManager) {
  session.saveSession({
    id: 'test-session-abc',
    created_at: '2026-01-01T00:00:00Z',
    expires_at: '2099-12-31T23:59:59Z',
  });
}

describe('ApiClient.call', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  test('sends POST with session header and body', async () => {
    const { client, session } = makeClient('post');
    seedSession(session);

    let capturedMethod = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';

    globalThis.fetch = mock(async (_input: string | Request, init?: RequestInit) => {
      capturedMethod = init?.method || 'GET';
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      capturedBody = init?.body ? String(init.body) : '';
      return new Response(
        JSON.stringify({ result: 'ok', notifications: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    await client.call('/spacemolt/mine', { some_param: 'value' });

    expect(capturedMethod).toBe('POST');
    expect(capturedHeaders['x-session-id']).toBe('test-session-abc');
    expect(capturedHeaders['content-type']).toBe('application/json');
    expect(JSON.parse(capturedBody)).toEqual({ some_param: 'value' });
  });

  test('sends POST without body when no payload', async () => {
    const { client, session } = makeClient('nobody');
    seedSession(session);

    let capturedBody: string | undefined;

    globalThis.fetch = mock(async (_input: string | Request, init?: RequestInit) => {
      capturedBody = init?.body ? String(init.body) : undefined;
      return new Response(
        JSON.stringify({ result: 'done', notifications: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    await client.call('/spacemolt/dock');
    expect(capturedBody).toBeUndefined();
  });

  test('throws on non-JSON response', async () => {
    const { client, session } = makeClient('nonjson');
    seedSession(session);

    globalThis.fetch = mock(async () =>
      new Response('<!DOCTYPE html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ) as typeof fetch;

    await expect(client.call('/spacemolt/mine')).rejects.toThrow('Unexpected response type');
  });

  test('throws on connection failure', async () => {
    const { client, session } = makeClient('connfail');
    seedSession(session);

    globalThis.fetch = mock(async () => {
      throw new TypeError('Network unreachable');
    }) as typeof fetch;

    await expect(client.call('/spacemolt/mine')).rejects.toThrow('Connection failed');
  });

  test('updates session from response data', async () => {
    const { client, session, sessionPath } = makeClient('update-sess');
    seedSession(session);

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          result: 'ok',
          session: { expires_at: '2028-06-01T00:00:00Z', player_id: 'new-pid' },
          notifications: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    await client.call('/spacemolt/get_status');

    const store = JSON.parse(readFileSync(sessionPath, 'utf-8')) as MultiSessionFile;
    // seedSession creates a pending session (no active account)
    expect(store.pendingSession?.expires_at).toBe('2028-06-01T00:00:00Z');
    expect(store.pendingSession?.player_id).toBe('new-pid');
  });

  test('retries on session_invalid with credentials', async () => {
    const { client, session } = makeClient('retry');
    session.saveSession({
      id: 'old-sess',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2099-12-31T23:59:59Z',
      username: 'RetryUser',
      password: 'RetryPass',
    });

    let apiCallCount = 0;

    globalThis.fetch = mock(async (input: string | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;

      // Session creation
      if (url.endsWith('/session') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ session: { id: 'new-s', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-12-31T23:59:59Z' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Re-auth
      if (url.includes('/login')) {
        return new Response(
          JSON.stringify({ session: { id: 'reauth-s', expires_at: '2099-12-31T23:59:59Z', player_id: 'p1' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // API calls
      apiCallCount++;
      if (apiCallCount === 1) {
        return new Response(
          JSON.stringify({ error: { code: 'session_invalid', message: 'Expired' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ result: 'success after retry', notifications: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const result = await client.call('/spacemolt/get_status');
    expect(result.result).toBe('success after retry');
    expect(apiCallCount).toBe(2);
  });

  test('retries on not_authenticated with credentials', async () => {
    const { client, session } = makeClient('retry-not-auth');
    session.saveSession({
      id: 'old-sess',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2099-12-31T23:59:59Z',
      username: 'RetryUser',
      password: 'RetryPass',
    });

    let apiCallCount = 0;

    globalThis.fetch = mock(async (input: string | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;

      if (url.endsWith('/session') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ session: { id: 'new-s', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-12-31T23:59:59Z' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/login')) {
        return new Response(
          JSON.stringify({ session: { id: 'reauth-s', expires_at: '2099-12-31T23:59:59Z', player_id: 'p1' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      apiCallCount++;
      if (apiCallCount === 1) {
        return new Response(
          JSON.stringify({ error: { code: 'not_authenticated', message: 'Session expired server-side' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ result: 'success after retry', notifications: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const result = await client.call('/spacemolt/get_status');
    expect(result.result).toBe('success after retry');
    expect(apiCallCount).toBe(2);
  });

  test('gives up after max retries', async () => {
    const { client, session } = makeClient('maxretry');
    session.saveSession({
      id: 'sess',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2099-12-31T23:59:59Z',
      username: 'U',
      password: 'P',
    });

    globalThis.fetch = mock(async (input: string | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;

      if (url.endsWith('/session') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ session: { id: 'x', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-12-31T23:59:59Z' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/login')) {
        return new Response(
          JSON.stringify({ session: { id: 'x', expires_at: '2099-12-31T23:59:59Z' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ error: { code: 'session_invalid', message: 'Bad' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const result = await client.call('/spacemolt/mine');
    expect(result.error).toBeDefined();
  });

  test('stores credentials on successful login', async () => {
    const { client, session, sessionPath } = makeClient('login');
    seedSession(session);

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          result: 'Welcome!',
          structuredContent: { player_id: 'p1' },
          session: { expires_at: '2099-12-31T23:59:59Z' },
          notifications: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    await client.call('/spacemolt_auth/login', { username: 'MyAgent', password: 'secret123' });

    const store = JSON.parse(readFileSync(sessionPath, 'utf-8')) as MultiSessionFile;
    expect(store.activeAccount).toBe('myagent');
    expect(store.accounts['myagent'].username).toBe('MyAgent');
    expect(store.accounts['myagent'].password).toBe('secret123');
  });

  test('does not store credentials on error', async () => {
    const { client, session, sessionPath } = makeClient('login-err');
    seedSession(session);

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ error: { code: 'auth_failed', message: 'Wrong' }, notifications: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const result = await client.call('/spacemolt_auth/login', { username: 'A', password: 'B' });
    expect(result.error).toBeDefined();

    const store = JSON.parse(readFileSync(sessionPath, 'utf-8')) as MultiSessionFile;
    // No accounts should exist since login failed
    expect(Object.keys(store.accounts)).toHaveLength(0);
  });

  test('returns error data without throwing', async () => {
    const { client, session } = makeClient('err-data');
    seedSession(session);

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ error: { code: 'not_docked', message: 'Must be docked' }, notifications: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const result = await client.call('/spacemolt/sell', { id: 'ore_iron', quantity: 5 });
    expect(result.error).toBeDefined();
    expect((result.error as any).code).toBe('not_docked');
  });
});

describe('ApiClient.get', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  test('sends GET request with session header', async () => {
    const { client, session } = makeClient('get-json');
    seedSession(session);

    let capturedMethod = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock(async (_input: string | Request, init?: RequestInit) => {
      capturedMethod = init?.method || 'GET';
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      return new Response(
        JSON.stringify({ result: 'help text', notifications: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const result = await client.get('/spacemolt/help');

    expect(capturedMethod).toBe('GET');
    expect(capturedHeaders['x-session-id']).toBe('test-session-abc');
    expect(result.result).toBe('help text');
  });

  test('handles plain text response', async () => {
    const { client, session } = makeClient('get-text');
    seedSession(session);

    globalThis.fetch = mock(async () =>
      new Response('Plain help text', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    ) as typeof fetch;

    const result = await client.get('/spacemolt/help');
    expect(result.result).toBe('Plain help text');
  });
});

describe('ApiClient with passthrough session adapter', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('sends the provided token as X-Session-Id', async () => {
    const adapter = createPassthroughAdapter('my-explicit-token-123');
    const client = new ApiClient({ apiBase: API_BASE, debug: false, session: adapter });

    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock(async (_input: string | Request, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      return new Response(
        JSON.stringify({ result: 'ok', notifications: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    await client.call('/spacemolt/get_status');
    expect(capturedHeaders['x-session-id']).toBe('my-explicit-token-123');
  });

  test('saveSession is a no-op (no file created)', async () => {
    const adapter = createPassthroughAdapter('token-abc');
    const client = new ApiClient({ apiBase: API_BASE, debug: false, session: adapter });

    const sessionDir = join(TEST_DIR, 'passthrough-noop');
    mkdirSync(sessionDir, { recursive: true });
    const sessionPath = join(sessionDir, 'session.json');

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          result: 'ok',
          session: { expires_at: '2028-01-01T00:00:00Z', player_id: 'p1' },
          notifications: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    await client.call('/spacemolt/get_status');

    // No session file should exist — the adapter doesn't write anything
    expect(existsSync(sessionPath)).toBe(false);
  });

  test('reAuthenticate returns null', async () => {
    const adapter = createPassthroughAdapter('token-xyz');
    const session = await adapter.getValidSession();
    const result = await adapter.reAuthenticate(session);
    expect(result).toBeNull();
  });

  test('getValidSession always returns the same token', async () => {
    const adapter = createPassthroughAdapter('stable-token');
    const s1 = await adapter.getValidSession();
    const s2 = await adapter.getValidSession();
    expect(s1.id).toBe('stable-token');
    expect(s2.id).toBe('stable-token');
  });
});
