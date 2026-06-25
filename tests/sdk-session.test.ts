import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createSession } from '../src/sdk-session.ts';

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('createSession', () => {
  test('logs in and exposes the returned session id', async () => {
    const calls: Array<{ url: string; sessionHeader: string | null; body: string }> = [];
    globalThis.fetch = mock(async (input: Request) => {
      const req = input as Request;
      calls.push({
        url: req.url,
        sessionHeader: req.headers.get('X-Session-Id'),
        body: await req.clone().text(),
      });
      if (req.url.includes('/api/v2/session') && !req.url.includes('login')) {
        return jsonResponse({ session: { id: 'sess-123' } });
      }
      return jsonResponse({ session: { id: 'sess-123' }, structuredContent: {} });
    }) as typeof fetch;

    const session = await createSession({ username: 'alice', password: 'pw' });

    expect(session.sessionId).toBe('sess-123');
    const loginCall = calls.find((c) => c.url.includes('/login'))!;
    expect(JSON.parse(loginCall.body)).toEqual({ username: 'alice', password: 'pw' });
  });

  test('mints a session before login (login requires X-Session-Id header)', async () => {
    const calls: Array<{ url: string; sessionHeader: string | null }> = [];
    globalThis.fetch = mock(async (input: Request) => {
      const req = input as Request;
      const sessionHeader = req.headers.get('X-Session-Id');
      calls.push({ url: req.url, sessionHeader });
      if (req.url.includes('/api/v2/session') && !req.url.includes('login')) {
        return jsonResponse({ session: { id: 'minted-1' } });
      }
      if (req.url.includes('/login')) {
        // Server rejects a login that arrives without a session header.
        if (!sessionHeader) return jsonResponse({ error: { code: 'session_required' } }, 401);
        return jsonResponse({ session: { id: 'minted-1' } });
      }
      return jsonResponse({ result: 'ok' });
    }) as typeof fetch;

    const session = await createSession({ username: 'alice', password: 'pw' });

    expect(session.sessionId).toBe('minted-1');
    expect(calls[0].url).toContain('/api/v2/session');
    const loginCall = calls.find((c) => c.url.includes('/login'));
    expect(loginCall?.sessionHeader).toBe('minted-1');
  });

  test('injects X-Session-Id on subsequent requests', async () => {
    let lastSessionHeader: string | null = null;
    globalThis.fetch = mock(async (input: Request) => {
      const req = input as Request;
      lastSessionHeader = req.headers.get('X-Session-Id');
      if (req.url.includes('/api/v2/session') && !req.url.includes('login')) {
        return jsonResponse({ session: { id: 'sess-abc' } });
      }
      if (req.url.includes('/login')) {
        return jsonResponse({ session: { id: 'sess-abc' } });
      }
      return jsonResponse({ result: 'ok' });
    }) as typeof fetch;

    const session = await createSession({ username: 'a', password: 'b' });
    const client = session.client as { get: (o: { url: string }) => Promise<unknown> };
    await client.get({ url: '/api/v2/spacemolt/status' });

    expect(lastSessionHeader).toBe('sess-abc');
  });

  for (const authErrorCode of ['session_expired', 'session_invalid', 'not_authenticated']) {
    test(`re-authenticates once and retries on ${authErrorCode}`, async () => {
      let loginCount = 0;
      let statusCalls = 0;
      globalThis.fetch = mock(async (input: Request) => {
        const req = input as Request;
        if (req.url.includes('/api/v2/session') && !req.url.includes('login')) {
          return jsonResponse({ session: { id: `minted-${loginCount + 1}` } });
        }
        if (req.url.includes('/login')) {
          loginCount += 1;
          return jsonResponse({ session: { id: `sess-${loginCount}` } });
        }
        statusCalls += 1;
        if (statusCalls === 1) {
          return jsonResponse({ error: { code: authErrorCode } });
        }
        return jsonResponse({ result: 'ok', structuredContent: { ok: true } });
      }) as typeof fetch;

      const session = await createSession({ username: 'a', password: 'b' });
      const client = session.client as { post: (o: { url: string; body?: unknown }) => Promise<{ data?: unknown }> };
      const res = await client.post({ url: '/api/v2/spacemolt/mine', body: { foo: 1 } });

      expect(loginCount).toBe(2); // initial + one re-auth
      expect(statusCalls).toBe(2); // failed + retried
      expect((res.data as { structuredContent?: { ok?: boolean } })?.structuredContent?.ok).toBe(true);
      expect(session.sessionId).toBe('sess-2');
    });
  }
});
