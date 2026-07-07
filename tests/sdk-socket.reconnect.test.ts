import { describe, test, expect, afterEach } from 'bun:test';
import { WebSocketServer, WebSocket as WsClient } from 'ws';
import { createSocket } from '../src/sdk-socket.ts';
import type { SpacemoltSocket } from '../src/socket-types.ts';

type Json = Record<string, any>;
type OnMessage = (
  frame: Json,
  send: (obj: Json) => void,
  received: Json[],
  sock: WsClient,
  connIndex: number,
) => void;
type OnConnection = (
  send: (obj: Json) => void,
  sock: WsClient,
  connIndex: number,
) => void;

const WELCOME: Json = {
  type: 'welcome',
  payload: { version: '0.0.0-test', tick_rate: 10, current_tick: 1, server_time: 0 },
};
const LOGGED_IN: Json = {
  type: 'logged_in',
  payload: { player: {}, ship: {}, system: {}, poi: {} },
};

interface Harness {
  url: string;
  received: Json[];
  connectionCount: () => number;
  close(): Promise<void>;
}

interface ServerHooks {
  onConnection?: OnConnection;
  onMessage?: OnMessage;
}

async function startServer(hooks: ServerHooks = {}): Promise<Harness> {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const addr = wss.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const received: Json[] = [];
  let connCount = 0;

  wss.on('connection', (sock) => {
    const connIndex = connCount;
    connCount += 1;
    const send = (obj: Json) => sock.send(JSON.stringify(obj));
    send(WELCOME);
    if (hooks.onConnection) hooks.onConnection(send, sock as unknown as WsClient, connIndex);
    sock.on('message', (data) => {
      let frame: Json;
      try {
        frame = JSON.parse(String(data));
      } catch {
        return;
      }
      received.push(frame);
      if (hooks.onMessage) {
        hooks.onMessage(frame, send, received, sock as unknown as WsClient, connIndex);
      }
    });
  });

  return {
    url: `ws://127.0.0.1:${port}`,
    received,
    connectionCount: () => connCount,
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

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  await withTimeout(
    (async () => {
      while (!cond()) await new Promise((r) => setTimeout(r, 5));
    })(),
    ms,
  );
}

const SMALL_RECONNECT = { initialDelayMs: 10, maxDelayMs: 20, jitter: false };

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

describe('createSocket reconnect + request correlation', () => {
  test('reconnect after server close=1000 keeps the stream live', async () => {
    const harness = await startServer({
      onMessage: (frame, send, _received, sock, connIndex) => {
        if (isLogin(frame)) {
          send(LOGGED_IN);
          if (connIndex === 0) {
            // Server-initiated normal close after auth.
            setTimeout(() => {
              try {
                sock.close(1000);
              } catch {
                /* ignore */
              }
            }, 10);
          } else {
            send({ type: 'combat_update', payload: { seq: 99 } });
          }
        }
      },
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
        reconnect: SMALL_RECONNECT,
      }),
    );
    activeSocket = socket;

    let reconnectAttempt = -1;
    socket.on('reconnect', (info) => {
      reconnectAttempt = info.attempt ?? 0;
    });

    // The post-reconnect combat_update must arrive through the SAME live iterator,
    // proving the stream did not end at the close=1000.
    const got = await withTimeout(
      (async () => {
        for await (const ev of socket) {
          if (ev.type === 'combat_update') return ev;
        }
        return undefined;
      })(),
      3000,
    );

    expect(got).toBeDefined();
    expect((got as any).payload).toEqual({ seq: 99 });
    expect(reconnectAttempt).toBeGreaterThanOrEqual(1);
    expect(socket.status).toBe('authenticated');
    // Server saw a login on BOTH connections (transparent re-login).
    expect(harness.connectionCount()).toBeGreaterThanOrEqual(2);
    expect(harness.received.filter(isLogin).length).toBeGreaterThanOrEqual(2);
  });

  test('reconnect disabled: stream ends and no retry', async () => {
    const harness = await startServer({
      onMessage: (frame, send, _received, sock, connIndex) => {
        if (isLogin(frame) && connIndex === 0) {
          send(LOGGED_IN);
          setTimeout(() => {
            try {
              sock.close(1000);
            } catch {
              /* ignore */
            }
          }, 10);
        }
      },
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
        reconnect: false,
      }),
    );
    activeSocket = socket;

    // Drain the iterator: with reconnect disabled, close=1000 ends the stream.
    const result = await withTimeout(
      (async () => {
        const iter = socket[Symbol.asyncIterator]();
        let r = await iter.next();
        while (!r.done) r = await iter.next();
        return r;
      })(),
      3000,
    );
    expect(result.done).toBe(true);
    expect(socket.status).toBe('closed');

    // Give any (erroneous) retry a window to land, then assert exactly one connection.
    await new Promise((r) => setTimeout(r, 60));
    expect(harness.connectionCount()).toBe(1);
    activeSocket = undefined;
  });

  test('request(): query resolves on synchronous ok', async () => {
    let echoedRid: string | undefined;
    const harness = await startServer({
      onMessage: (frame, send) => {
        if (isLogin(frame)) {
          send(LOGGED_IN);
        } else if (typeof frame.request_id === 'string') {
          echoedRid = frame.request_id;
          send({ type: 'ok', payload: { ack: true }, request_id: frame.request_id });
        }
      },
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
        reconnect: SMALL_RECONNECT,
      }),
    );
    activeSocket = socket;

    const res = await withTimeout(socket.request({ type: 'get_status' }));
    expect(res.type).toBe('ok');
    expect((res as any).request_id).toBe(echoedRid);
    expect(typeof echoedRid).toBe('string');
  });

  test('request(): mutation skips pending ack, resolves on action_result', async () => {
    const harness = await startServer({
      onMessage: (frame, send) => {
        if (isLogin(frame)) {
          send(LOGGED_IN);
        } else if (typeof frame.request_id === 'string') {
          const rid = frame.request_id;
          send({ type: 'ok', payload: { pending: true, command: 'travel' }, request_id: rid });
          setTimeout(() => {
            send({ type: 'action_result', payload: { command: 'travel', tick: 5 }, request_id: rid });
          }, 20);
        }
      },
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
        reconnect: SMALL_RECONNECT,
      }),
    );
    activeSocket = socket;

    const res = await withTimeout(
      socket.request({ type: 'travel', payload: { target_poi: 'x' } }),
    );
    expect(res.type).toBe('action_result');
    expect((res as any).payload).toEqual({ command: 'travel', tick: 5 });
  });

  test('request(): v2 query resolves on result frame', async () => {
    let echoedRid: string | undefined;
    const harness = await startServer({
      onMessage: (frame, send) => {
        if (isLogin(frame)) {
          send(LOGGED_IN);
        } else if (typeof frame.request_id === 'string') {
          echoedRid = frame.request_id;
          send({
            type: 'result',
            payload: { structuredContent: { ok: true } },
            request_id: frame.request_id,
          });
        }
      },
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        endpoint: 'v2',
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
        reconnect: SMALL_RECONNECT,
      }),
    );
    activeSocket = socket;

    const res = await withTimeout(socket.request({ tool: 'spacemolt', action: 'get_status' }));
    expect(res.type).toBe('result');
    expect((res as any).request_id).toBe(echoedRid);
    expect(typeof echoedRid).toBe('string');
  });

  test('request(): v2 mutation skips pending result, resolves on action_result', async () => {
    const harness = await startServer({
      onMessage: (frame, send) => {
        if (isLogin(frame)) {
          send(LOGGED_IN);
        } else if (typeof frame.request_id === 'string') {
          const rid = frame.request_id;
          send({ type: 'result', payload: { pending: true, command: 'jump' }, request_id: rid });
          setTimeout(() => {
            send({ type: 'action_result', payload: { command: 'jump', tick: 7 }, request_id: rid });
          }, 20);
        }
      },
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        endpoint: 'v2',
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
        reconnect: SMALL_RECONNECT,
      }),
    );
    activeSocket = socket;

    const res = await withTimeout(
      socket.request({ tool: 'spacemolt', action: 'jump', payload: { target_system: 'sol' } }),
    );
    expect(res.type).toBe('action_result');
    expect((res as any).payload).toEqual({ command: 'jump', tick: 7 });
  });

  test('request(): times out when server stays silent', async () => {
    const harness = await startServer({
      onMessage: (frame, send) => {
        if (isLogin(frame)) send(LOGGED_IN);
        // ignore everything else
      },
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
        reconnect: SMALL_RECONNECT,
      }),
    );
    activeSocket = socket;

    await expect(socket.request({ type: 'get_status' }, { timeoutMs: 50 })).rejects.toThrow();
  });

  test('request(): generates request_id when absent, reuses when provided', async () => {
    const harness = await startServer({
      onMessage: (frame, send) => {
        if (isLogin(frame)) {
          send(LOGGED_IN);
        } else if (typeof frame.request_id === 'string') {
          send({ type: 'ok', payload: { ack: true }, request_id: frame.request_id });
        }
      },
    });
    activeHarness = harness;

    const socket = await withTimeout(
      createSocket({
        auth: { username: 'alice', password: 'pw' },
        wsUrl: harness.url,
        WebSocketImpl: WsClient as any,
        reconnect: SMALL_RECONNECT,
      }),
    );
    activeSocket = socket;

    // Explicit id is reused verbatim.
    await withTimeout(socket.request({ type: 'get_status', request_id: 'my-id' }));
    await waitFor(() => harness.received.some((f) => f.request_id === 'my-id'));
    const explicit = harness.received.find((f) => f.type === 'get_status' && f.request_id === 'my-id');
    expect(explicit).toBeDefined();

    // Absent id -> some non-empty string is attached.
    await withTimeout(socket.request({ type: 'get_status', payload: { n: 2 } }));
    await waitFor(() =>
      harness.received.some(
        (f) => f.type === 'get_status' && f.payload?.n === 2 && typeof f.request_id === 'string',
      ),
    );
    const generated = harness.received.find((f) => f.type === 'get_status' && f.payload?.n === 2);
    expect(generated).toBeDefined();
    expect(typeof generated!.request_id).toBe('string');
    expect((generated!.request_id as string).length).toBeGreaterThan(0);
  });
});
