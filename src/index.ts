// Public library entry for @spacemolt/client-v2.
// Re-exports the generated OpenAPI SDK surface plus the session helper.
export * from './generated';
// createClient may not be in the generated barrel; re-export it explicitly to be safe.
export { createClient } from './generated/client';
export { createSession } from './sdk-session';
export { createSocket } from './sdk-socket';
export type { SessionOptions, SpacemoltSession } from './sdk-session';

// WebSocket socket module — types only (createSocket runtime lands in step 3).
export type {
  SpacemoltSocket,
  SocketOptions,
  SocketEndpoint,
  SocketAuth,
  SocketCredentials,
  SocketLoginToken,
  SocketAnonymous,
  ServerEvent,
  RawServerFrame,
  OutboundFrame,
  OutboundFrameV1,
  OutboundFrameV2,
  WelcomePayload,
  LoggedInPayload,
  RegisteredPayload,
  ErrorPayload,
  ReconnectOptions,
  ConnectionEvent,
  SocketStatus,
  WebSocketCtor,
  WebSocketLike,
} from './socket-types';
