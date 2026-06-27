// Hand-written WebSocket type surface for @spacemolt/client-v2, mirroring the
// hand-written REST `sdk-session.ts`. Lives OUTSIDE src/generated/ (which is
// clobbered by `bun run generate`). Game-event payloads reuse the generated
// Notification* types; connection/auth control frames are defined by hand.
import type {
  NotificationChatMessage,
  NotificationCombatUpdate,
  NotificationCraftingUpdate,
  NotificationMarketUpdate,
  NotificationMiningYield,
  NotificationObservationUpdate,
  NotificationPilotlessShip,
  NotificationPlayerDied,
  NotificationReconnected,
  NotificationScanDetected,
  NotificationScanResult,
  NotificationSkillLevelUp,
  NotificationTradeOfferReceived,
} from './generated';

/** Which outbound framing to send. Server->client frames are identical on both. */
export type SocketEndpoint = 'v1' | 'v2';

/** Authenticate the socket with an account username + password. */
export interface SocketCredentials {
  username: string;
  /** Held only for the single login frame; never persisted or logged by the package. */
  password: string;
}
/** Authenticate the socket with a single-use, ~5-min login token. */
export interface SocketLoginToken {
  loginToken: string;
  username?: string;
}
/** Connect passively: welcome only, send no credential. */
export interface SocketAnonymous {
  anonymous: true;
}
/** Exactly one of: credentials | loginToken | anonymous. */
export type SocketAuth = SocketCredentials | SocketLoginToken | SocketAnonymous;

/** Exponential-backoff reconnect policy (defaults applied by the factory). */
export interface ReconnectOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
  maxAttempts?: number;
}

/**
 * Minimal structural WebSocket instance the factory drives. Satisfiable by both
 * the global DOM `WebSocket` and the `ws` package (both expose addEventListener).
 */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}
/** Injected WebSocket constructor (defaults to global WebSocket, then lazy `import("ws")`). */
export type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocketLike;

export interface SocketOptions {
  /** How to authenticate the socket. */
  auth: SocketAuth;
  /** Outbound framing. Default: 'v1'. */
  endpoint?: SocketEndpoint;
  /** API origin. Default https://game.spacemolt.com. */
  baseUrl?: string;
  /** Full ws url override (else derived: baseUrl http->ws + /ws or /ws/v2). */
  wsUrl?: string;
  /** Reconnect policy. Default: enabled with exponential backoff. */
  reconnect?: ReconnectOptions | false;
  /** Injected WebSocket constructor (testing / runtime choice). */
  WebSocketImpl?: WebSocketCtor;
}

// --- Hand-written control-frame payloads (no generated counterpart) ---

/** First frame after connect; the client logs in after receiving it. */
export interface WelcomePayload {
  version: string;
  release_date?: string;
  release_notes?: string[];
  tick_rate: number;
  current_tick: number;
  server_time: number;
  motd?: string;
  game_info?: string;
  website?: string;
  help_text?: string;
  terms?: string;
}

/** Auth success; createSocket resolves here. Game-state blobs kept loose by design. */
export interface LoggedInPayload {
  player: Record<string, unknown>;
  ship: Record<string, unknown>;
  modules?: unknown;
  system: Record<string, unknown>;
  poi: Record<string, unknown>;
  pending_trades?: unknown[];
  recent_chat?: unknown[];
  unread_chat?: number;
}

/** Registration only (out of normal package scope; register stays CLI-only). */
export interface RegisteredPayload {
  /** 256-bit hex account password — the caller must persist it. */
  password: string;
  player_id: string;
}

/** Synchronous failure / rejected frame, or post-tick action_error. */
export interface ErrorPayload {
  code: string;
  message: string;
  wait_seconds?: number;
}

/** Connection-lifecycle event surfaced via `.on('open'|'close'|'reconnect'|'error')`. */
export interface ConnectionEvent {
  type: 'open' | 'close' | 'reconnect' | 'error';
  /** Close code (on 'close'). */
  code?: number;
  reason?: string;
  /** Reconnect attempt count (on 'reconnect'). */
  attempt?: number;
  error?: unknown;
}

export type SocketStatus =
  | 'connecting'
  | 'open'
  | 'authenticated'
  | 'reconnecting'
  | 'closed';

/**
 * The discriminated union the caller consumes. Notification payloads reuse the
 * generated Notification* types; control frames are hand-written above. The
 * union is closed for clean discriminated-union narrowing; unknown/future
 * frames fall outside it and are typed via `RawServerFrame` (see below).
 */
export type ServerEvent =
  // connection / auth control
  | { type: 'welcome'; payload: WelcomePayload }
  | { type: 'logged_in'; payload: LoggedInPayload }
  | { type: 'registered'; payload: RegisteredPayload }
  | { type: 'ok'; payload: Record<string, unknown>; request_id?: string }
  | { type: 'result'; payload: Record<string, unknown>; request_id?: string }
  | { type: 'error'; payload: ErrorPayload; request_id?: string }
  | { type: 'action_result'; payload: Record<string, unknown>; request_id?: string }
  | { type: 'action_error'; payload: ErrorPayload; request_id?: string }
  // game-event pushes (payloads = generated Notification* types)
  | { type: 'combat_update'; payload: NotificationCombatUpdate }
  | { type: 'player_died'; payload: NotificationPlayerDied }
  | { type: 'scan_result'; payload: NotificationScanResult }
  | { type: 'scan_detected'; payload: NotificationScanDetected }
  | { type: 'pilotless_ship'; payload: NotificationPilotlessShip }
  | { type: 'reconnected'; payload: NotificationReconnected }
  | { type: 'mining_yield'; payload: NotificationMiningYield }
  | { type: 'chat_message'; payload: NotificationChatMessage }
  | { type: 'trade_offer_received'; payload: NotificationTradeOfferReceived }
  | { type: 'skill_level_up'; payload: NotificationSkillLevelUp }
  | { type: 'market_update'; payload: NotificationMarketUpdate }
  | { type: 'observation_update'; payload: NotificationObservationUpdate }
  | { type: 'crafting_update'; payload: NotificationCraftingUpdate };

/**
 * The raw shape of any frame the socket may yield, including unknown/future `type`s.
 * The runtime never drops a frame with a string `type`; unknown ones are still
 * delivered through the event stream, but they fall OUTSIDE the discriminated
 * `ServerEvent` union above — handle them in a `default:` branch by treating the
 * value as `RawServerFrame`. A `{ type: string }` member cannot live inside
 * `ServerEvent` itself: under TypeScript 6 it collapses every case's `payload` to
 * `unknown` and breaks discriminated-union narrowing.
 */
export interface RawServerFrame {
  type: string;
  payload?: unknown;
  request_id?: string;
}

/** v1 flat outbound frame: {type, payload?, request_id?}. */
export interface OutboundFrameV1 {
  type: string;
  payload?: Record<string, unknown>;
  request_id?: string;
}
/** v2 tool/action outbound frame: {tool, action, payload?, request_id?}. */
export interface OutboundFrameV2 {
  tool: string;
  action: string;
  payload?: Record<string, unknown>;
  request_id?: string;
}
/** A raw outbound frame; the factory sends it as-is (framing per configured endpoint). */
export type OutboundFrame = OutboundFrameV1 | OutboundFrameV2;

/** The socket handle returned by `createSocket` (runtime impl lands in step 3). */
export interface SpacemoltSocket {
  /** Primary consumption surface: a typed async stream of server events. */
  [Symbol.asyncIterator](): AsyncIterator<ServerEvent>;
  events(): AsyncIterable<ServerEvent>;

  /** Emitter surface (additive to the iterator). Connection events first, then frame types. */
  on(
    type: 'open' | 'close' | 'reconnect' | 'error',
    cb: (info: ConnectionEvent) => void,
  ): () => void;
  on<T extends ServerEvent['type']>(
    type: T,
    cb: (e: Extract<ServerEvent, { type: T }>) => void,
  ): () => void;

  /** Send a raw outbound frame (framing chosen by the configured endpoint). */
  send(frame: OutboundFrame): void;

  /**
   * Send a frame with request_id correlation and resolve on the matching terminal
   * response. A `request_id` is generated if the frame lacks one. The `ok {pending:true}`
   * ack for a queued mutation is skipped; the promise resolves on the post-tick
   * action_result/action_error (or, for a query, the synchronous ok/error).
   * Default timeout 600_000ms; pass `timeoutMs: 0` or `Infinity` to disable.
   */
  request(frame: OutboundFrame, opts?: { timeoutMs?: number }): Promise<ServerEvent>;

  /** Convenience wrappers over send() for the documented subscriptions. */
  subscribeMarket(): void;
  unsubscribeMarket(): void;
  subscribeObservation(opts?: { activeScan?: boolean }): void;
  unsubscribeObservation(): void;

  /** Current connection + auth status, for diagnostics. */
  readonly status: SocketStatus;

  /** Close cleanly (default code 1000). Resolves once the underlying socket is closed. */
  close(code?: number, reason?: string): Promise<void>;
}
