// Hand-written, framework-agnostic WebSocket runtime for @spacemolt/client-v2,
// mirroring the hand-written REST `createSession` in sdk-session.ts. Lives OUTSIDE
// src/generated/. Dependency-free: the WebSocket impl is injected or discovered
// (global WebSocket, else a lazy `import("ws")`); no hard runtime dep on `ws`.
//
// Reconnect: after the FIRST successful auth, an unexpected close (including the
// server's normal close=1000 on deploy/idle) triggers a backoff reconnect that
// re-runs the full handshake (welcome -> login -> logged_in). The event stream
// stays live across reconnects; it only ends on an explicit close() or when the
// reconnect policy is exhausted/disabled. A failure on the FIRST connection (or a
// rejected credential at any time) is terminal and rejects/ends rather than looping.
//
// Keepalive: there is no app-level heartbeat frame (the server pushes none); we rely
// on the transport answering protocol pings (automatic with `ws` and browsers).
import type {
  SocketOptions,
  SocketAuth,
  SocketEndpoint,
  SocketStatus,
  SpacemoltSocket,
  ServerEvent,
  OutboundFrame,
  ConnectionEvent,
  ReconnectOptions,
  WebSocketCtor,
  WebSocketLike,
} from './socket-types';

/** Default API origin (mirrors sdk-session.ts; duplicated to avoid coupling the modules). */
const DEFAULT_BASE_URL = 'https://game.spacemolt.com';

const WS_PATH: Record<SocketEndpoint, string> = { v1: '/ws', v2: '/ws/v2' };

/** Names routed to the connection-lifecycle emitter rather than the frame emitter. */
const CONNECTION_EVENT_NAMES = new Set(['open', 'close', 'reconnect', 'error']);

interface ResolvedReconnect {
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: boolean;
  maxAttempts: number;
}
function normalizeReconnect(r: ReconnectOptions | false | undefined): ResolvedReconnect | null {
  if (r === false) return null;
  const o = r ?? {};
  return {
    initialDelayMs: o.initialDelayMs ?? 500,
    maxDelayMs: o.maxDelayMs ?? 30_000,
    factor: o.factor ?? 2,
    jitter: o.jitter ?? true,
    maxAttempts: o.maxAttempts ?? Infinity,
  };
}
function backoffDelay(r: ResolvedReconnect, attempt: number): number {
  const raw = Math.min(r.maxDelayMs, r.initialDelayMs * Math.pow(r.factor, Math.max(0, attempt - 1)));
  // full jitter in [raw/2, raw]
  return r.jitter ? raw / 2 + Math.random() * (raw / 2) : raw;
}

function deriveWsUrl(baseUrl: string, endpoint: SocketEndpoint): string {
  // http->ws, https->wss; then append the endpoint path.
  return `${baseUrl.replace(/^http/, 'ws')}${WS_PATH[endpoint]}`;
}

async function resolveWebSocketImpl(injected?: WebSocketCtor): Promise<WebSocketCtor> {
  if (injected) return injected;
  const globalWs = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof globalWs === 'function') return globalWs as unknown as WebSocketCtor;
  try {
    // Indirect the specifier through a variable so tsc does not statically resolve
    // `ws` (we ship neither @types/ws nor a runtime dep). Loaded only if present.
    const spec = 'ws';
    const mod = (await import(spec)) as { default?: unknown; WebSocket?: unknown };
    const ctor = mod.default ?? mod.WebSocket ?? mod;
    return ctor as unknown as WebSocketCtor;
  } catch (err) {
    throw new Error(
      'No WebSocket implementation available. Pass opts.WebSocketImpl, run on a ' +
        'runtime with a global WebSocket, or install the "ws" package. ' +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

type AuthMode = 'credentials' | 'login_token' | 'anonymous';
function authModeOf(auth: SocketAuth): AuthMode {
  if ('anonymous' in auth) return 'anonymous';
  if ('loginToken' in auth) return 'login_token';
  return 'credentials';
}

/** Build the endpoint-specific login frame. Never called for anonymous auth. */
function buildLoginFrame(endpoint: SocketEndpoint, auth: SocketAuth): string {
  if ('loginToken' in auth) {
    const payload = { token: auth.loginToken };
    return endpoint === 'v1'
      ? JSON.stringify({ type: 'login_token', payload })
      : JSON.stringify({ tool: 'spacemolt_auth', action: 'login_token', payload });
  }
  const creds = auth as { username: string; password: string };
  const payload = { username: creds.username, password: creds.password };
  return endpoint === 'v1'
    ? JSON.stringify({ type: 'login', payload })
    : JSON.stringify({ tool: 'spacemolt_auth', action: 'login', payload });
}

/** Push-based async queue feeding the iterator; ends on terminal close. */
class EventQueue {
  private buffer: ServerEvent[] = [];
  private waiters: Array<(r: IteratorResult<ServerEvent>) => void> = [];
  private ended = false;
  push(value: ServerEvent): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.buffer.push(value);
  }
  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as never, done: true });
    }
  }
  next(): Promise<IteratorResult<ServerEvent>> {
    const queued = this.buffer.shift();
    if (queued !== undefined) return Promise.resolve({ value: queued, done: false });
    if (this.ended) return Promise.resolve({ value: undefined as never, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

interface PendingRequest {
  resolve: (e: ServerEvent) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Open a SpacemoltSocket: connect, await `welcome`, send the login frame (unless
 * anonymous), await `logged_in`, then resolve. Reconnects transparently after the
 * first success (see file header).
 */
export async function createSocket(opts: SocketOptions): Promise<SpacemoltSocket> {
  const endpoint: SocketEndpoint = opts.endpoint ?? 'v1';
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const wsUrl = opts.wsUrl ?? deriveWsUrl(baseUrl, endpoint);
  const authMode = authModeOf(opts.auth);
  const reconnectPolicy = normalizeReconnect(opts.reconnect);
  const Ctor = await resolveWebSocketImpl(opts.WebSocketImpl);

  const queue = new EventQueue();
  const frameListeners = new Map<string, Set<(arg: any) => void>>();
  const connListeners = new Map<string, Set<(arg: any) => void>>();
  const pending = new Map<string, PendingRequest>();
  const closeResolvers: Array<() => void> = [];

  let status: SocketStatus = 'connecting';
  let currentWs: WebSocketLike | undefined;
  let userClosed = false;
  let everReady = false;
  let attempt = 0;
  let reqCounter = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  let resolveFirst!: (h: SpacemoltSocket) => void;
  let rejectFirst!: (e: Error) => void;
  let firstSettled = false;
  const firstHandshake = new Promise<SpacemoltSocket>((res, rej) => {
    resolveFirst = (h) => {
      if (!firstSettled) { firstSettled = true; res(h); }
    };
    rejectFirst = (e) => {
      if (!firstSettled) { firstSettled = true; rej(e); }
    };
  });

  function emitFrame(type: string, ev: ServerEvent): void {
    const set = frameListeners.get(type);
    if (set) for (const cb of [...set]) cb(ev);
  }
  function emitConn(name: string, info: ConnectionEvent): void {
    const set = connListeners.get(name);
    if (set) for (const cb of [...set]) cb(info);
  }
  function rejectAllPending(err: Error): void {
    for (const [id, p] of pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
      pending.delete(id);
    }
  }

  function send(frame: OutboundFrame): void {
    if (status === 'closed') throw new Error('Cannot send on a closed socket.');
    if (!currentWs) throw new Error('Socket is not connected.');
    currentWs.send(JSON.stringify(frame));
  }

  function makeIterator(): AsyncIterator<ServerEvent> & AsyncIterable<ServerEvent> {
    return {
      next: () => queue.next(),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  function resolvePending(rid: string, ev: ServerEvent): void {
    const t = ev.type;
    const payload = (ev as { payload?: { pending?: unknown } }).payload;
    const isPendingAck = t === 'ok' && !!payload && (payload as { pending?: unknown }).pending === true;
    const terminal =
      t === 'action_result' || t === 'action_error' || t === 'error' || (t === 'ok' && !isPendingAck);
    if (!terminal) return; // pending ack: keep waiting for the post-tick result
    const entry = pending.get(rid);
    if (!entry) return;
    pending.delete(rid);
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve(ev);
  }

  const socket: SpacemoltSocket = {
    [Symbol.asyncIterator]: () => makeIterator(),
    events: () => ({ [Symbol.asyncIterator]: () => makeIterator() }),
    on(type: string, cb: (arg: any) => void): () => void {
      const map = CONNECTION_EVENT_NAMES.has(type) ? connListeners : frameListeners;
      let set = map.get(type);
      if (!set) {
        set = new Set();
        map.set(type, set);
      }
      set.add(cb);
      return () => {
        set!.delete(cb);
      };
    },
    send,
    request(frame: OutboundFrame, reqOpts?: { timeoutMs?: number }): Promise<ServerEvent> {
      const existing = typeof (frame as { request_id?: unknown }).request_id === 'string'
        ? ((frame as { request_id?: string }).request_id as string)
        : undefined;
      const rid = existing ?? `req-${(reqCounter += 1)}`;
      const outbound = { ...frame, request_id: rid } as OutboundFrame;
      return new Promise<ServerEvent>((resolve, reject) => {
        const timeoutMs = reqOpts?.timeoutMs ?? 600_000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (timeoutMs && timeoutMs !== Infinity) {
          timer = setTimeout(() => {
            pending.delete(rid);
            reject(new Error(`request ${rid} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }
        pending.set(rid, { resolve, reject, timer });
        try {
          send(outbound);
        } catch (e) {
          pending.delete(rid);
          if (timer) clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    subscribeMarket(): void {
      send(
        endpoint === 'v1'
          ? { type: 'subscribe_market' }
          : { tool: 'spacemolt_market', action: 'subscribe_market' },
      );
    },
    unsubscribeMarket(): void {
      send(
        endpoint === 'v1'
          ? { type: 'unsubscribe_market' }
          : { tool: 'spacemolt_market', action: 'unsubscribe_market' },
      );
    },
    subscribeObservation(o?: { activeScan?: boolean }): void {
      const active = o?.activeScan === true;
      if (endpoint === 'v1') {
        send(active ? { type: 'subscribe_observation', payload: { active_scan: true } } : { type: 'subscribe_observation' });
      } else {
        send(
          active
            ? { tool: 'spacemolt', action: 'subscribe_observation', payload: { active_scan: true } }
            : { tool: 'spacemolt', action: 'subscribe_observation' },
        );
      }
    },
    unsubscribeObservation(): void {
      send(
        endpoint === 'v1'
          ? { type: 'unsubscribe_observation' }
          : { tool: 'spacemolt', action: 'unsubscribe_observation' },
      );
    },
    get status(): SocketStatus {
      return status;
    },
    close(code = 1000, reason?: string): Promise<void> {
      return new Promise<void>((resolve) => {
        userClosed = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
        }
        if (status === 'closed') {
          resolve();
          return;
        }
        // Between connections (reconnecting) there is no live socket whose close
        // event will fire — settle synchronously.
        if (status === 'reconnecting' || !currentWs) {
          status = 'closed';
          queue.end();
          rejectAllPending(new Error('socket closed'));
          emitConn('close', { type: 'close', code, reason });
          resolve();
          return;
        }
        closeResolvers.push(resolve);
        try {
          currentWs.close(code, reason);
        } catch {
          status = 'closed';
          queue.end();
          resolve();
        }
      });
    },
  };

  function markReady(isReconnect: boolean): void {
    status = authMode === 'anonymous' ? 'open' : 'authenticated';
    const tookAttempts = attempt;
    attempt = 0;
    if (!everReady) {
      everReady = true;
      resolveFirst(socket);
    } else if (isReconnect) {
      emitConn('reconnect', { type: 'reconnect', attempt: tookAttempts });
    }
  }

  function handleAuthFailure(ws: WebSocketLike, err: Error): void {
    // Server rejected the credential. Terminal — do not reconnect.
    if (!everReady) rejectFirst(err);
    userClosed = true; // suppress reconnect on the close that follows
    try {
      ws.close(1000, 'auth failed');
    } catch {
      /* already closing */
    }
  }

  function scheduleReconnect(): void {
    if (!reconnectPolicy || attempt >= reconnectPolicy.maxAttempts) {
      status = 'closed';
      queue.end();
      rejectAllPending(new Error('socket closed'));
      return;
    }
    status = 'reconnecting';
    attempt += 1;
    const delay = backoffDelay(reconnectPolicy, attempt);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      if (!userClosed) connectOnce(true);
    }, delay);
  }

  function connectOnce(isReconnect: boolean): void {
    let welcomed = false;
    let authed = false;
    let ws: WebSocketLike;
    try {
      ws = new Ctor(wsUrl);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (!everReady) rejectFirst(err);
      else scheduleReconnect();
      return;
    }
    currentWs = ws;

    ws.addEventListener('open', () => {
      if (status === 'connecting' || status === 'reconnecting') status = 'open';
      emitConn('open', { type: 'open' });
    });

    ws.addEventListener('message', (event: any) => {
      let value: unknown;
      try {
        value = JSON.parse(String(event?.data));
      } catch {
        return; // non-JSON frame: ignore (one complete JSON object per message)
      }
      if (typeof value !== 'object' || value === null || typeof (value as { type?: unknown }).type !== 'string') {
        return;
      }
      const ev = value as ServerEvent;
      const t = ev.type;
      const rid = (value as { request_id?: unknown }).request_id;

      if (!welcomed && t === 'welcome') {
        welcomed = true;
        if (authMode === 'anonymous') {
          markReady(isReconnect);
        } else {
          try {
            ws.send(buildLoginFrame(endpoint, opts.auth));
          } catch (e) {
            handleAuthFailure(ws, e instanceof Error ? e : new Error(String(e)));
          }
        }
      } else if (!authed && t === 'logged_in') {
        authed = true;
        markReady(isReconnect);
      } else if (!authed && authMode !== 'anonymous' && t === 'error') {
        const p = (ev as { payload?: { code?: unknown; message?: unknown } }).payload ?? {};
        handleAuthFailure(
          ws,
          new Error(`socket authentication failed (${String(p.code ?? 'unknown')}): ${String(p.message ?? '')}`.trim()),
        );
      }

      if (typeof rid === 'string' && pending.has(rid)) resolvePending(rid, ev);

      queue.push(ev);
      emitFrame(t, ev);
    });

    ws.addEventListener('close', (event: any) => {
      const code = typeof event?.code === 'number' ? (event.code as number) : undefined;
      const reason = typeof event?.reason === 'string' ? (event.reason as string) : undefined;

      if (userClosed) {
        status = 'closed';
        queue.end();
        emitConn('close', { type: 'close', code, reason });
        for (const resolve of closeResolvers.splice(0)) resolve();
        rejectAllPending(new Error('socket closed'));
        return;
      }
      emitConn('close', { type: 'close', code, reason });
      if (!everReady) {
        status = 'closed';
        queue.end();
        rejectAllPending(new Error('socket closed before authentication'));
        rejectFirst(
          new Error(`socket closed before authentication (code=${code ?? '?'}${reason ? `, reason=${reason}` : ''})`),
        );
        return;
      }
      scheduleReconnect();
    });

    ws.addEventListener('error', (event: any) => {
      emitConn('error', { type: 'error', error: event });
      // The transport emits 'close' after 'error'; reconnect/reject is driven there.
    });
  }

  connectOnce(false);
  return firstHandshake;
}
