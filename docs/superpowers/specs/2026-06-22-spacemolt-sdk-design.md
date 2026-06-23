# Design: Publish `@spacemolt/client-v2` as an importable OpenAPI SDK

**Date:** 2026-06-22
**Status:** Approved (design); pending implementation plan

## Goal

Make the OpenAPI-generated SDK in this repo consumable as a library, so a user can
`pnpm install @spacemolt/client-v2` and `import` typed, callable API functions to script
against the SpaceMolt v2 API — without depending on any CLI-only machinery.

This package remains both the CLI and the library; we add a library surface alongside the
existing CLI rather than splitting repos.

## Background (current state)

- `bun run generate` runs `@hey-api/openapi-ts` (v0.73.0, in devDependencies) then a CLI
  codegen step (`scripts/build-commands.ts`).
- Today the hey-api config uses only the `@hey-api/typescript` plugin, so `src/generated/`
  contains **types only** (`types.gen.ts` + an `index.ts` barrel) — there are no callable
  request functions.
- The only runtime HTTP client is `src/api.ts`, which is tightly coupled to the CLI:
  file-based session store, automatic re-auth, retry/backoff, CLI logging.
- Authentication: the credential is a session id sent as the `X-Session-Id` header. `login`
  / `register` / `session` are ordinary API operations. Sessions carry an `expires_at`; on
  `session_expired` / `session_invalid` / `not_authenticated` the CLI re-authenticates using
  stored credentials. Default base URL `https://game.spacemolt.com/api/v2`, overridable via
  `SPACEMOLT_URL`.
- `package.json` is currently `"private": true`, zero runtime dependencies, no `exports` /
  `files`. tsconfig is `noEmit: true`, `declaration: false`. `bun run build` compiles a CLI
  binary only — there is no library build.

## Decisions

- **SDK shape:** Full typed client — add hey-api's SDK + fetch-client plugins so `generate`
  emits one callable, typed function per operation.
- **Auth:** Also ship a small runtime-agnostic session helper (no file I/O) that logs in,
  injects `X-Session-Id`, and auto-re-authenticates on expiry.
- **Distribution:** Make it fully installable (packaging + library build) but **do not run
  `npm publish`** in this work. Keep `"private": true` for now.
- **Module format:** ESM-only.

## Design

### 1. Codegen — emit a full SDK (not just types)

Keep invoking the generator exactly as today (`bun run openapi-ts`, equivalent to
`npx @hey-api/openapi-ts`). Update `openapi-ts.config.ts` to add two **plugin identifier
strings** (these are config strings, **not** npm packages to install):

```ts
plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch']
```

`bun run generate` then emits into `src/generated/`:
- `types.gen.ts` — types (as today)
- `sdk.gen.ts` — one typed function per operation, keyed off the spec's operationIds
- a self-contained fetch client (e.g. `client.gen.ts` / `client/`) exposing a `createClient`
  factory with `setConfig` for baseUrl + headers
- an updated `index.ts` barrel

The CLI codegen step (`scripts/build-commands.ts`) is unaffected — it parses `openapi.json`
independently. `src/api.ts` keeps compiling since it only consumes the `V2Response` type.

**Runtime dependency claim (must be verified, not assumed):** For 0.73.0 the fetch-client
runtime is bundled inside `@hey-api/openapi-ts` and emitted as self-contained code, so the
package is expected to stay **zero runtime dependencies**. This is verified empirically in
§5 (grep generated client imports + Node-ESM tarball run). If — and only if — the emitted
client imports an external specifier that isn't bundled, we add exactly that one dependency
and note it.

### 2. Library entry point — separate from the CLI

Add `src/index.ts` as the library entry (distinct from the CLI entry `src/main.ts`). It
re-exports:
- all generated types
- all generated SDK functions
- the generated `createClient` factory
- the session helper from §3

CLI-only modules (`main.ts`, `dispatch.ts`, `commands.ts`, `args.ts`, `output/`,
`update-checker.ts`, `session.ts`, `session-store.ts`, `api.ts`) are **not** part of the
library surface.

### 3. Session helper — the useful part of `api.ts`, decoupled

Add a runtime-agnostic `createSession({ baseUrl?, username, password })` (no `node:fs`, no
CLI logging):
- creates a configured fetch client (default baseUrl `https://game.spacemolt.com/api/v2`,
  overridable; also honors `SPACEMOLT_URL` when no baseUrl is passed)
- calls the generated `login`, injects the returned session id as the `X-Session-Id` header
- registers a response interceptor that, on `session_expired` / `session_invalid` /
  `not_authenticated`, re-authenticates with the in-memory credentials and retries the
  request once — mirroring `api.ts` minus the file store and CLI retry/backoff
- returns the configured client (usable with any generated SDK function)

Consumers who want raw control skip this and use `createClient` + the typed `login()`
directly.

### 4. Build & packaging — ESM-only, installable (not published)

- Add `tsconfig.lib.json` (extends base): `noEmit: false`, `declaration: true`,
  `outDir: dist`, `rootDir: src`; `include` the library entry + generated + session helper;
  `exclude` all CLI files. Configure hey-api / tsconfig so emitted import specifiers resolve
  cleanly under Node ESM.
- Add a `build:lib` script that emits ESM `.js` + `.d.ts` to `dist/`.
- `package.json`: keep `"private": true` for now, but add publish-ready metadata —
  `"exports"` (`.` → `dist/index.js` + types), `"files": ["dist"]`, `"types"`, the
  `"build:lib"` script. No change to `dependencies` (expected to stay empty per §1).
- The CLI binary build (`bun build --compile`) and the `bin` field are unchanged.

### 5. Testing & verification

**Tarball install test — the real `import` proof (headline):**
1. `bun run build:lib` → `dist/`.
2. `bun pm pack` (or `npm pack`) → `spacemolt-client-v2-X.Y.Z.tgz`, honoring `files`/
   `exports`. (`pack` works with `private: true`; only `publish` is blocked.)
3. In a throwaway consumer dir under the scratchpad: `pnpm init`, then
   `pnpm add <abs-path>/spacemolt-client-v2-X.Y.Z.tgz`.
4. A tiny consumer module does
   `import { createClient, createSession, login } from '@spacemolt/client-v2'` and uses a
   generated type; run it **under Node** (the real target runtime) to prove ESM resolution,
   and run `tsc` against it to prove `.d.ts`/`types` resolve.
5. Assert clean import + type-check; tear the consumer dir down.

This is also where the §1 dependency question is empirically settled: if the
installed-from-tarball client pulls an unbundled external `import`, the Node run fails here.

**In-repo unit tests:**
- Existing `bun test` stays green after regeneration (proves the CLI didn't break).
- New tests: the library entry exports the expected names; the session helper logs in and
  injects `X-Session-Id`, and re-auths + retries once on an expiry error (against mocked
  fetch).

**Release hygiene:** minor version bump + tag + rebuild per the repo's version workflow.

## Open points

- **`bin` field:** currently points at `./src/main.ts` (runnable only under Bun); for an
  npm/Node consumer it's a dead entry, but the CLI is really distributed as the compiled
  binary. Left untouched and out of scope unless raised.

## Out of scope

- Running `npm publish`.
- Porting the file-based session store or CLI retry/backoff into the library.
- Dual ESM + CJS output.
- Reworking the CLI's `bin` for Node.
