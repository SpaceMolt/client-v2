// Public library entry for @spacemolt/client-v2.
// Re-exports the generated OpenAPI SDK surface plus the session helper.
export * from './generated';
// createClient may not be in the generated barrel; re-export it explicitly to be safe.
export { createClient } from './generated/client';
export { createSession } from './sdk-session';
export type { SessionOptions, SpacemoltSession } from './sdk-session';
