import { describe, test, expect, afterEach } from 'bun:test';
import { WebSocketServer, WebSocket as WsClient } from 'ws';
import { createSocket } from '../src/sdk-socket.ts';
import type { SpacemoltSocket } from '../src/socket-types.ts';
import { VERSION } from '../src/config.ts';

type Json = Record<string, any>;
type OnMessage = (
  frame: Json,
  send: (obj: Json) => void,
  received: Json[],
  sock: WsClient,
) => void;

const WELCOME: Json = {
  type: 'welcome',
  payload: { version: '0.0.0-test', tick_rate: 10, current_tick: 1, server_time: 0 },
};

interface Harness {
  url: string;
  received: Json[];
  /** On-the-wire upgrade request headers per connection (ws lowercases header names). */
  headers: Record<string, string | string[] | undefined>[];
  close(): Promise<void>;
}

async function startServer(onMessage?: OnMessage): Promise<Harness> {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const addr = wss.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const received: Json[] = [];
  const headers: Record<string, string | string[] | undefined>[] = [];

  wss.on('connection', (sock, request) => {
    headers.push(request.headers);
    const send = (obj: Json) => sock.send(JSON.stringify(obj));
    send(WELCOME);
    sock.on('message', (data) => {
      let frame: Json;
      try {
        frame = JSON.parse(String(data));
      } catch {
        return;
      }
      received.push(frame);
      if (onMessage) onMessage(frame, send, received, sock as unknown as WsClient);
    });
  });

  return {
    url: `ws://127.0.0.1:${port}`,
    received,
    headers,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) {
          try {
            c.terminate();
          } catch {
            /* ignore */
          }
        }
        // Under Bun, wss.close()'s callback can hang while sockets tear down;
        // fire close but never block the suite on its callback.
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        wss.close(finish);
        setTimeout(finish, 100);
      }),
  };
}

function isLogin(frame: Json): boolean {
  return frame.type === 'login' || (frame.tool === 'spacemolt_auth' && frame.action === 'login');
}

function withTimeout<T>(p: Promise<T>, ms = 2000, label = 'timeout'): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(label)), ms)),
  ]);
}

const LOGGED_IN: Json = {
  type: 'logged_in',
  payload: { player: {}, ship: {}, system: {}, poi: {} },
};

let activeSocket: SpacemoltSocket | undefined;
let activeHarness: Harness | undefined;

afterEach(async () => {
  if (activeSocket) {
    try {
      await activeSocket.close(1000);
    } catch {
      /* ignore */
    }
    activeSocket = undefined;
  }
  if (activeHarness) {
    await activeHarness.close();
    activeHarness = undefined;
  }
});

describe('createSocket runtime', () => {
  test('v1 credentials handshake + outbound framing', async () => {
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) send(LOGGED_IN);
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        endpoint: 'v1',
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
      }),
    );
    activeSocket = socket;

    expect(socket.status).toBe('authenticated');
    expect(harness.received[0]).toEqual({
      type: 'login',
      payload: { username: 'alice', password: 'pw' },
    });
  });

  test('v2 credentials framing', async () => {
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) send(LOGGED_IN);
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        endpoint: 'v2',
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
      }),
    );
    activeSocket = socket;

    expect(socket.status).toBe('authenticated');
    expect(harness.received[0]).toEqual({
      tool: 'spacemolt_auth',
      action: 'login',
      payload: { username: 'alice', password: 'pw' },
    });
  });

  test('login_token (v1)', async () => {
    const harness = await startServer((frame, send) => {
      if (frame.type === 'login_token') send(LOGGED_IN);
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { loginToken: 'tok-123' },
        endpoint: 'v1',
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
      }),
    );
    activeSocket = socket;

    expect(socket.status).toBe('authenticated');
    expect(harness.received[0]).toEqual({
      type: 'login_token',
      payload: { token: 'tok-123' },
    });
  });

  test('anonymous resolves on welcome alone', async () => {
    const harness = await startServer();
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { anonymous: true },
        endpoint: 'v1',
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
      }),
    );
    activeSocket = socket;

    expect(socket.status).toBe('open');
    // give any erroneous outbound frame a tick to arrive
    await new Promise((r) => setTimeout(r, 50));
    expect(harness.received).toEqual([]);
  });

  test('event stream via async iterator', async () => {
    const combat = { type: 'combat_update', payload: { attacker: 'x', damage: 42 } };
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) {
        send(LOGGED_IN);
        send(combat);
      }
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
      }),
    );
    activeSocket = socket;

    const got = await withTimeout(
      (async () => {
        for await (const ev of socket) {
          if (ev.type === 'welcome' || ev.type === 'logged_in') continue;
          if (ev.type === 'combat_update') return ev;
        }
        return undefined;
      })(),
    );

    expect(got).toBeDefined();
    expect(got!.payload).toEqual(combat.payload);
  });

  test("emitter on('combat_update')", async () => {
    const combat = { type: 'combat_update', payload: { attacker: 'y', damage: 7 } };
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) {
        send(LOGGED_IN);
        send(combat);
      }
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
      }),
    );
    activeSocket = socket;

    const fired = new Promise<any>((resolve) => {
      socket.on('combat_update', (e) => resolve(e));
    });
    const e = await withTimeout(fired);
    expect((e as any).payload).toEqual(combat.payload);
  });

  test('one JSON object per message (no concatenation)', async () => {
    const first = { type: 'combat_update', payload: { seq: 1 } };
    const second = { type: 'combat_update', payload: { seq: 2 } };
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) {
        send(LOGGED_IN);
        send(first);
        send(second);
      }
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
      }),
    );
    activeSocket = socket;

    const seen = await withTimeout(
      (async () => {
        const out: any[] = [];
        for await (const ev of socket) {
          if (ev.type !== 'combat_update') continue;
          out.push(ev.payload);
          if (out.length === 2) return out;
        }
        return out;
      })(),
    );

    expect(seen).toEqual([{ seq: 1 }, { seq: 2 }]);
  });

  test('subscribe framing (v1)', async () => {
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) send(LOGGED_IN);
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        endpoint: 'v1',
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
      }),
    );
    activeSocket = socket;

    socket.subscribeMarket();
    socket.subscribeObservation({ activeScan: true });

    await withTimeout(
      (async () => {
        while (harness.received.length < 3) await new Promise((r) => setTimeout(r, 10));
      })(),
    );

    expect(harness.received).toContainEqual({ type: 'subscribe_market' });
    expect(harness.received).toContainEqual({
      type: 'subscribe_observation',
      payload: { active_scan: true },
    });
  });

  test('subscribe framing (v2)', async () => {
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) send(LOGGED_IN);
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        endpoint: 'v2',
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
      }),
    );
    activeSocket = socket;

    socket.subscribeMarket();
    socket.subscribeObservation({ activeScan: true });

    await withTimeout(
      (async () => {
        while (harness.received.length < 3) await new Promise((r) => setTimeout(r, 10));
      })(),
    );

    expect(harness.received).toContainEqual({
      tool: 'spacemolt_market',
      action: 'subscribe_market',
    });
    expect(harness.received).toContainEqual({
      tool: 'spacemolt',
      action: 'subscribe_observation',
      payload: { active_scan: true },
    });
  });

  test('clean close ends the stream', async () => {
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) send(LOGGED_IN);
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
      }),
    );

    await withTimeout(socket.close(1000));
    expect(socket.status).toBe('closed');

    // The stream drains any buffered frames (welcome/logged_in) and then ends:
    // a subsequent next() must report done:true rather than hanging.
    const iter = socket[Symbol.asyncIterator]();
    const result = await withTimeout(
      (async () => {
        let r = await iter.next();
        while (!r.done) r = await iter.next();
        return r;
      })(),
    );
    expect(result.done).toBe(true);
    // already closed/cleaned by the test body
    activeSocket = undefined;
  });

  test('handshake rejects on pre-auth close', async () => {
    const harness = await startServer((frame, _send, _received, sock) => {
      if (isLogin(frame)) {
        // close the connection instead of replying
        try {
          sock.close(4002);
        } catch {
          /* ignore */
        }
      }
    });
    activeHarness = harness;

    await expect(
      withTimeout(
        createSocket({
          auth: { username: 'alice', password: 'pw' },
          wsUrl: harness.url,
          WebSocketImpl: WsClient as any,
        }),
      ),
    ).rejects.toThrow();
    activeSocket = undefined;
  });

  test('password is never logged', async () => {
    const secret = 'super-secret-pw';
    const captured: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const originals = methods.map((m) => console[m]);
    for (const m of methods) {
      (console as any)[m] = (...args: any[]) => {
        captured.push(args.map((a) => String(a)).join(' '));
      };
    }

    try {
      const harness = await startServer((frame, send) => {
        if (isLogin(frame)) send(LOGGED_IN);
      });
      activeHarness = harness;

      const socket = await withTimeout(
        createSocket({
          auth: { username: 'alice', password: secret },
          wsUrl: harness.url,
          WebSocketImpl: WsClient as any,
        }),
      );
      activeSocket = socket;
    } finally {
      methods.forEach((m, i) => {
        (console as any)[m] = originals[i];
      });
    }

    for (const line of captured) {
      expect(line.includes(secret)).toBe(false);
    }
  });

  test('default User-Agent header when no wsOptions', async () => {
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) send(LOGGED_IN);
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
      }),
    );
    activeSocket = socket;

    expect(harness.headers[0]?.['user-agent']).toBe(`@spacemolt/client-v2/${VERSION}`);
  });

  test('caller User-Agent prepends the default', async () => {
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) send(LOGGED_IN);
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
        wsOptions: { headers: { 'User-Agent': 'roci' } },
      }),
    );
    activeSocket = socket;

    expect(harness.headers[0]?.['user-agent']).toBe(`roci @spacemolt/client-v2/${VERSION}`);
  });

  test('caller User-Agent match is case-insensitive (no duplicate header)', async () => {
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) send(LOGGED_IN);
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
        wsOptions: { headers: { 'user-agent': 'roci' } },
      }),
    );
    activeSocket = socket;

    // A single, correctly prepended UA (not an array of two values).
    expect(harness.headers[0]?.['user-agent']).toBe(`roci @spacemolt/client-v2/${VERSION}`);
  });

  test('arbitrary caller headers pass through alongside the default UA', async () => {
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) send(LOGGED_IN);
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
        wsOptions: { headers: { 'X-Trace-Id': 'abc' } },
      }),
    );
    activeSocket = socket;

    expect(harness.headers[0]?.['x-trace-id']).toBe('abc');
    expect(harness.headers[0]?.['user-agent']).toBe(`@spacemolt/client-v2/${VERSION}`);
  });

  test('non-string caller User-Agent falls back to the bare default', async () => {
    const harness = await startServer((frame, send) => {
      if (isLogin(frame)) send(LOGGED_IN);
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
        // e.g. `process.env.CUSTOM_UA` when unset — must not become "undefined <default>".
        wsOptions: { headers: { 'User-Agent': undefined } },
      }),
    );
    activeSocket = socket;

    expect(harness.headers[0]?.['user-agent']).toBe(`@spacemolt/client-v2/${VERSION}`);
  });
});
