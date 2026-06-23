# `@spacemolt/client-v2` Importable SDK — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this repo's OpenAPI codegen emit a full typed SDK and publish it as an importable ESM library (`import { createClient, createSession, spacemoltAuthLogin } from '@spacemolt/client-v2'`) installable via a packed tarball, without breaking the existing CLI.

**Architecture:** Add hey-api's `@hey-api/sdk` + `@hey-api/client-fetch` plugin strings to the existing generator so `bun run generate` also emits callable functions + a self-contained fetch client. Add a library entry (`src/index.ts`) that re-exports the generated surface plus a small runtime-agnostic session helper (login + auto re-auth, no file I/O). Add an ESM library build (`dist/`) and publish-ready `package.json` metadata. Verify by packing a tarball and importing it from a clean directory under Node.

**Tech Stack:** Bun (dev/build/test), TypeScript, `@hey-api/openapi-ts@0.73.0` (devDependency, already installed), native `fetch`.

## Global Constraints

- **Module format:** ESM-only. No CommonJS output.
- **Runtime dependencies:** Target **zero**. Do not add anything to `dependencies` unless Task 1 proves the generated client emits an unbundled external `import` — then add exactly that one package and note it.
- **Do NOT publish:** Keep `"private": true` in `package.json`. Never run `npm publish` / `bun publish`. `pack` is allowed.
- **Do NOT edit generated files by hand:** `src/generated/**` and `src/commands.ts` are codegen output.
- **Do NOT touch CLI-only modules** beyond what's listed: `src/main.ts`, `src/dispatch.ts`, `src/commands.ts`, `src/args.ts`, `src/api.ts`, `src/session.ts`, `src/session-store.ts`, `src/update-checker.ts`, `src/output/**`, `src/config.ts`.
- **CLI must keep working:** after every task, `bun test`, `bun run typecheck`, and `bun run build` (CLI binary) must all still pass.
- **Library default base URL:** `https://game.spacemolt.com` (origin — generated URLs already include `/api/v2`). This is **not** `src/config.ts`'s `API_BASE` (which includes `/api/v2`); the library must not import `src/config.ts`.
- **Test conventions (`bun:test`):** `import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';` Mock the network with `globalThis.fetch = mock(async (input, init) => new Response(JSON.stringify(...), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;`
- **Commit after every task** with a `feat:`/`chore:`/`test:` prefix. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

- **Modify** `openapi-ts.config.ts` — add SDK + client-fetch plugin strings.
- **Regenerated** `src/generated/**` — `types.gen.ts` (existing) + `sdk.gen.ts` + client (`client.gen.ts` and/or `client/`) + `index.ts` barrel. (Output of `bun run generate`; not hand-edited.)
- **Create** `src/sdk-session.ts` — runtime-agnostic session helper (`createSession`). One responsibility: login + inject `X-Session-Id` + auto re-auth.
- **Create** `src/index.ts` — library entry barrel. Re-exports the generated surface + `createSession`. Distinct from the CLI entry `src/main.ts`.
- **Create** `tsconfig.lib.json` — declaration-emit config scoped to the library files.
- **Create** `tests/sdk-session.test.ts` — unit tests for the session helper.
- **Create** `tests/library-exports.test.ts` — asserts the library entry exports the expected names.
- **Modify** `package.json` — add `exports`, `files`, `types`, `build:lib` + `pack:lib` scripts; bump version.
- **Create (throwaway, under scratchpad)** consumer dir for the tarball install test — not committed.

---

### Task 1: Generate the full SDK and verify the output

**Files:**
- Modify: `openapi-ts.config.ts`
- Regenerated (not hand-edited): `src/generated/**`

**Interfaces:**
- Produces (for later tasks, to be CONFIRMED by the verification steps below and recorded in the commit message):
  - A `createClient` factory importable from the generated barrel (`./generated`) or `./generated/client.gen`.
  - A generated login function. **Expected name:** `spacemoltAuthLogin` (operationId for `POST /api/v2/spacemolt_auth/login`). Confirm the exact exported name.
  - SDK functions accept `{ client, body }` and return `{ data, error, request, response }` (hey-api result envelope).
  - Generated request URLs include the `/api/v2` prefix (so library baseUrl = origin).

- [ ] **Step 1: Add the SDK + client plugins to the generator config**

Replace the `plugins` array in `openapi-ts.config.ts`. Full new file contents:

```ts
import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './openapi.json',
  output: {
    path: './src/generated',
  },
  plugins: [
    '@hey-api/typescript',
    '@hey-api/sdk',
    '@hey-api/client-fetch',
  ],
});
```

- [ ] **Step 2: Regenerate**

Run: `bun run generate`
Expected: completes without error; `src/generated/` now contains `sdk.gen.ts` and a client file (`client.gen.ts` and/or a `client/` dir) in addition to `types.gen.ts` and `index.ts`. `src/commands.ts` is also regenerated (unchanged behavior).

- [ ] **Step 3: VERIFY — record the generated export names and the runtime-dependency answer**

Run these and read the output:

```bash
ls src/generated
grep -rn "export const createClient\|export { createClient\|createClient" src/generated/index.ts src/generated/client.gen.ts 2>/dev/null | head
grep -rn "export const spacemoltAuthLogin\|spacemoltAuthLogin" src/generated/sdk.gen.ts | head
grep -rn "url: '/api/v2" src/generated/sdk.gen.ts | head -1
# THE dependency question — does the generated client import an EXTERNAL package?
grep -rn "from '@hey-api/client-fetch'\|from \"@hey-api/client-fetch\"\|require('@hey-api" src/generated || echo "NO EXTERNAL CLIENT IMPORT (self-contained)"
```

Expected and required outcomes:
- `createClient` is exported (note from which file). If the barrel `src/generated/index.ts` does NOT re-export `createClient`, that's fine — Task 2's `src/index.ts` re-exports it explicitly from `./generated/client.gen`.
- The login function is named `spacemoltAuthLogin` (record the actual name if different — every later reference to `spacemoltAuthLogin` must be updated to match).
- A generated `url:` value begins with `/api/v2` (confirms baseUrl = origin).
- **Dependency answer:** if the last grep prints `NO EXTERNAL CLIENT IMPORT (self-contained)`, the package stays zero-dependency. If instead it shows an import from `@hey-api/client-fetch` (or any external pkg), STOP and note it: that package must be installed and added to `dependencies` in Task 5, and bundling in Task 4 must mark it `--external`.

- [ ] **Step 4: Confirm the CLI still builds, type-checks, and tests pass**

Run: `bun run typecheck`
Expected: no errors.

Run: `bun test`
Expected: all existing tests pass.

Run: `bun run build`
Expected: produces the `./spacemolt` binary with no error. (Then `rm -f spacemolt` — don't commit the binary.)

- [ ] **Step 5: Commit**

```bash
rm -f spacemolt
git add openapi-ts.config.ts src/generated src/commands.ts
git commit -m "feat: generate full typed SDK + fetch client via hey-api plugins

Verified: login fn = spacemoltAuthLogin; createClient exported from <file>;
generated URLs include /api/v2; client runtime is <self-contained | external dep X>.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Library entry point + export test

**Files:**
- Create: `src/index.ts`
- Test: `tests/library-exports.test.ts`

**Interfaces:**
- Consumes: `createClient` and `spacemoltAuthLogin` from `./generated` (Task 1); `createSession` from `./sdk-session` (Task 3 — created next; until then the import will fail the test, which is expected TDD ordering, so create `src/sdk-session.ts` as a stub in Step 3 here).
- Produces: the public import surface of `@spacemolt/client-v2` — all generated types + SDK functions + `createClient` + `createSession`.

- [ ] **Step 1: Write the failing test**

Create `tests/library-exports.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import * as lib from '../src/index.ts';

describe('library entry exports', () => {
  test('re-exports the generated client factory', () => {
    expect(typeof lib.createClient).toBe('function');
  });

  test('re-exports a generated SDK operation', () => {
    expect(typeof lib.spacemoltAuthLogin).toBe('function');
  });

  test('exports the session helper', () => {
    expect(typeof lib.createSession).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/library-exports.test.ts`
Expected: FAIL — `src/index.ts` does not exist yet (module not found).

- [ ] **Step 3: Create the library entry and a session-helper stub**

Create `src/index.ts`:

```ts
// Public library entry for @spacemolt/client-v2.
// Re-exports the generated OpenAPI SDK surface plus the session helper.
export * from './generated';
// createClient may not be in the generated barrel; re-export it explicitly to be safe.
export { createClient } from './generated/client.gen';
export { createSession } from './sdk-session';
export type { SessionOptions, SpacemoltSession } from './sdk-session';
```

Create `src/sdk-session.ts` as a minimal stub (fully implemented in Task 3):

```ts
export interface SessionOptions {
  username: string;
  password: string;
  baseUrl?: string;
}

export interface SpacemoltSession {
  client: unknown;
  readonly sessionId: string;
}

export async function createSession(_opts: SessionOptions): Promise<SpacemoltSession> {
  throw new Error('not implemented');
}
```

Note: if Task 1 recorded that `createClient` IS already exported by `./generated` (the barrel), the explicit `export { createClient } from './generated/client.gen';` line will cause a duplicate-export error — in that case delete that line and rely on `export * from './generated'`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/library-exports.test.ts`
Expected: PASS (all three assertions — `createSession` resolves to the stub function).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/sdk-session.ts tests/library-exports.test.ts
git commit -m "feat: add library entry point re-exporting the SDK surface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Session helper (login + inject header + auto re-auth)

**Files:**
- Modify: `src/sdk-session.ts` (replace the stub)
- Test: `tests/sdk-session.test.ts`

**Interfaces:**
- Consumes: `createClient`, `spacemoltAuthLogin` from `./generated`. `createClient(config)` returns a client with `.interceptors.request.use((request: Request) => Request)`, `.interceptors.response.use((response: Response, request: Request) => Response | Promise<Response>)`, and `.setConfig`. SDK calls: `spacemoltAuthLogin({ client, body: { username, password } })` resolves to `{ data, error, request, response }` where `data` is the parsed `V2Response` (login session id lives at `data.session.id`, with fallbacks `data.session_id` / `data.structuredContent.session_id`).
- Produces: `createSession(opts: SessionOptions): Promise<SpacemoltSession>` and the `SessionOptions` / `SpacemoltSession` types (already referenced by Task 2).

- [ ] **Step 1: Write the failing tests**

Create `tests/sdk-session.test.ts`:

```ts
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
      return jsonResponse({ session: { id: 'sess-123' }, structuredContent: {} });
    }) as typeof fetch;

    const session = await createSession({ username: 'alice', password: 'pw' });

    expect(session.sessionId).toBe('sess-123');
    expect(calls[0].url).toContain('/api/v2/spacemolt_auth/login');
    expect(JSON.parse(calls[0].body)).toEqual({ username: 'alice', password: 'pw' });
  });

  test('injects X-Session-Id on subsequent requests', async () => {
    let lastSessionHeader: string | null = null;
    globalThis.fetch = mock(async (input: Request) => {
      const req = input as Request;
      lastSessionHeader = req.headers.get('X-Session-Id');
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

  test('re-authenticates once and retries on session_expired', async () => {
    let loginCount = 0;
    let statusCalls = 0;
    globalThis.fetch = mock(async (input: Request) => {
      const req = input as Request;
      if (req.url.includes('/login')) {
        loginCount += 1;
        return jsonResponse({ session: { id: `sess-${loginCount}` } });
      }
      statusCalls += 1;
      if (statusCalls === 1) {
        return jsonResponse({ error: { code: 'session_expired' } });
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/sdk-session.test.ts`
Expected: FAIL — `createSession` throws `not implemented`.

- [ ] **Step 3: Implement the session helper**

Replace `src/sdk-session.ts` entirely:

```ts
import { createClient, spacemoltAuthLogin } from './generated';

/** Default API origin. Generated request URLs already include the /api/v2 prefix. */
export const DEFAULT_BASE_URL = 'https://game.spacemolt.com';

/** Error codes that mean "log in again and retry". Mirrors src/api.ts. */
const AUTH_ERROR_CODES = new Set(['session_invalid', 'session_expired', 'not_authenticated']);

export interface SessionOptions {
  username: string;
  password: string;
  /** Override the API origin (e.g. for self-hosted or test servers). */
  baseUrl?: string;
}

export interface SpacemoltSession {
  /** A configured client to pass to any generated SDK function as `{ client }`. */
  client: ReturnType<typeof createClient>;
  /** The current session id (updates after a re-auth). */
  readonly sessionId: string;
}

function extractSessionId(data: unknown): string | undefined {
  const d = data as
    | { session?: { id?: string }; session_id?: string; structuredContent?: { session_id?: string } }
    | undefined;
  return d?.session?.id ?? d?.session_id ?? d?.structuredContent?.session_id;
}

/**
 * Create an authenticated client: logs in, injects X-Session-Id on every request,
 * and transparently re-authenticates + retries once on an auth-expiry error.
 * Runtime-agnostic: no file system, no CLI logging.
 */
export async function createSession(opts: SessionOptions): Promise<SpacemoltSession> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const client = createClient({ baseUrl });

  let sessionId = '';

  async function login(): Promise<string> {
    const res = await spacemoltAuthLogin({
      client,
      body: { username: opts.username, password: opts.password },
    });
    const id = extractSessionId(res.data);
    if (!id) {
      const code = (res.data as { error?: { code?: string } } | undefined)?.error?.code;
      throw new Error(`Login failed${code ? ` (${code})` : ''}: no session id returned`);
    }
    return id;
  }

  sessionId = await login();

  // Pristine request clones, captured before the body is consumed, keyed by the live request.
  const pendingClones = new WeakMap<Request, Request>();

  client.interceptors.request.use((request: Request) => {
    request.headers.set('X-Session-Id', sessionId);
    pendingClones.set(request, request.clone());
    return request;
  });

  client.interceptors.response.use(async (response: Response, request: Request) => {
    const original = pendingClones.get(request);
    pendingClones.delete(request);

    let body: { error?: { code?: string } } | undefined;
    try {
      body = await response.clone().json();
    } catch {
      return response; // non-JSON; nothing to inspect
    }

    const code = body?.error?.code;
    if (code && AUTH_ERROR_CODES.has(code) && original) {
      sessionId = await login();
      const retry = original.clone();
      retry.headers.set('X-Session-Id', sessionId);
      // Bypass interceptors on the retry to avoid recursion.
      return fetch(retry);
    }

    return response;
  });

  return {
    client,
    get sessionId() {
      return sessionId;
    },
  };
}
```

Note: if Task 1 recorded the login function under a different name than `spacemoltAuthLogin`, update the import and call here to match.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/sdk-session.test.ts`
Expected: PASS — all three tests.

- [ ] **Step 5: Confirm the whole suite + typecheck still pass**

Run: `bun test`
Expected: all pass (including `tests/library-exports.test.ts`, now that `createSession` is real).

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/sdk-session.ts tests/sdk-session.test.ts
git commit -m "feat: add runtime-agnostic session helper with auto re-auth

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: ESM library build (`dist/`)

**Files:**
- Create: `tsconfig.lib.json`
- Modify: `package.json` (add `build:lib` script only — `exports`/`files`/version come in Task 5)

**Interfaces:**
- Produces: `dist/index.js` (bundled ESM runtime) + `dist/index.d.ts` (+ referenced declaration files) — the artifacts the package's `exports` map will point at in Task 5.

- [ ] **Step 1: Create the declaration-emit tsconfig**

Create `tsconfig.lib.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": true,
    "allowImportingTsExtensions": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": [],
    "lib": ["ESNext", "DOM"]
  },
  "include": ["src/index.ts", "src/sdk-session.ts", "src/generated/**/*.ts"],
  "exclude": [
    "node_modules",
    "dist",
    "src/main.ts",
    "src/dispatch.ts",
    "src/commands.ts",
    "src/args.ts",
    "src/api.ts",
    "src/session.ts",
    "src/session-store.ts",
    "src/config.ts",
    "src/update-checker.ts",
    "src/output/**/*",
    "tests/**/*",
    "scripts/**/*"
  ]
}
```

- [ ] **Step 2: Add the `build:lib` script**

Add to `package.json` `"scripts"` (keep existing scripts; this bundles the runtime with Bun and emits declarations with tsc):

```json
"build:lib": "rm -rf dist && bun build src/index.ts --outfile dist/index.js --target node --format esm && bun x tsc -p tsconfig.lib.json"
```

If Task 1 found an external client dependency `X`, change the `bun build` portion to `bun build src/index.ts --outfile dist/index.js --target node --format esm --external X`.

- [ ] **Step 3: Run the library build**

Run: `bun run build:lib`
Expected: creates `dist/index.js` and `dist/index.d.ts` (plus a `dist/generated/` declaration tree) with no errors. If `bun build` errors with an unresolved import of an external package, that is the dependency signal from Task 1 — install it (`bun add <pkg>`), add it as `--external` (Step 2) and to `dependencies` (Task 5), and re-run.

- [ ] **Step 4: Sanity-check the built runtime imports under Node**

Run:
```bash
node --input-type=module -e "import('./dist/index.js').then(m => { if (typeof m.createSession !== 'function' || typeof m.createClient !== 'function') { console.error('missing exports'); process.exit(1); } console.log('dist import OK'); })"
```
Expected: prints `dist import OK`. (This proves the bundled ESM resolves under Node before we even pack it.)

- [ ] **Step 5: Verify CLI build untouched + ignore dist in git**

Confirm `dist/` is ignored (so the build artifact isn't committed):
```bash
grep -q "^dist" .gitignore || echo "dist/" >> .gitignore
```

Run: `bun run build`
Expected: CLI binary still builds. Then `rm -f spacemolt`.

- [ ] **Step 6: Commit**

```bash
rm -f spacemolt
git add tsconfig.lib.json package.json .gitignore
git commit -m "feat: add ESM library build (dist/) via bun build + tsc declarations

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Publish-ready packaging + tarball install proof

**Files:**
- Modify: `package.json` (add `exports`, `files`, `types`, `pack:lib`; bump version)
- Create (throwaway, NOT committed): consumer dir under the scratchpad

**Interfaces:**
- Consumes: `dist/index.js` + `dist/index.d.ts` from Task 4.
- Produces: a tarball that a clean Node project can `pnpm add` and `import`.

- [ ] **Step 1: Add packaging metadata + version bump**

Edit `package.json`. Keep `"private": true`. Keep all existing fields/scripts. Add the following keys (place `exports`/`files`/`types` near the top alongside `module`):

```json
"types": "./dist/index.d.ts",
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  }
},
"files": ["dist"],
```

Add to `"scripts"`:

```json
"pack:lib": "bun run build:lib && bun pm pack"
```

Bump `"version"` from `1.4.69` to `1.5.0` (minor — new library surface).

If Task 1/Task 4 proved an external runtime dependency `X`, also add:
```json
"dependencies": { "X": "<version installed>" }
```

- [ ] **Step 2: Build + pack the tarball**

Run: `bun run pack:lib`
Expected: builds `dist/`, then writes `spacemolt-client-v2-1.5.0.tgz` in the repo root. Note its absolute path (use `pwd`).

- [ ] **Step 3: Confirm the tarball contains dist and the entry, and excludes src**

Run: `tar -tzf spacemolt-client-v2-1.5.0.tgz | sort | head -50`
Expected: contains `package/dist/index.js`, `package/dist/index.d.ts`, `package/package.json`; does **not** contain `package/src/...` (the `files` whitelist worked).

- [ ] **Step 4: Install into a clean consumer dir and import under Node (the real proof)**

Run (uses the session scratchpad; substitute the actual tarball absolute path):
```bash
SCRATCH="/private/tmp/claude-501/-Users-vcarl-workspace-client-v2/4740d553-aecd-4943-b05d-9f16523f7e70/scratchpad"
TARBALL="$(pwd)/spacemolt-client-v2-1.5.0.tgz"
rm -rf "$SCRATCH/consumer" && mkdir -p "$SCRATCH/consumer"
cd "$SCRATCH/consumer"
printf '{\n  "name": "consumer",\n  "version": "1.0.0",\n  "private": true,\n  "type": "module"\n}\n' > package.json
pnpm add "$TARBALL"
```
Expected: installs `@spacemolt/client-v2` with no peer/resolution errors.

Create `$SCRATCH/consumer/smoke.mjs`:
```js
import { createClient, createSession, spacemoltAuthLogin } from '@spacemolt/client-v2';

const ok =
  typeof createClient === 'function' &&
  typeof createSession === 'function' &&
  typeof spacemoltAuthLogin === 'function';

if (!ok) {
  console.error('FAIL: expected named exports missing');
  process.exit(1);
}
// Prove the client actually constructs (no unresolved runtime import).
const client = createClient({ baseUrl: 'https://example.invalid' });
if (typeof client.post !== 'function') {
  console.error('FAIL: createClient did not return a usable client');
  process.exit(1);
}
console.log('PASS: tarball imports cleanly under Node ESM');
```

Run: `node "$SCRATCH/consumer/smoke.mjs"`
Expected: prints `PASS: tarball imports cleanly under Node ESM`. (If this fails with an unresolved module import, the generated client needs an external dep — install it, add to `dependencies` + `--external`, re-pack, retry.)

- [ ] **Step 5: Prove the types resolve for a TS consumer**

Create `$SCRATCH/consumer/smoke.ts`:
```ts
import { createSession, type SessionOptions } from '@spacemolt/client-v2';
const opts: SessionOptions = { username: 'a', password: 'b' };
void createSession;
void opts;
```
Create `$SCRATCH/consumer/tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ESNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["smoke.ts"]
}
```
Run: `cd "$SCRATCH/consumer" && bun x tsc -p tsconfig.json`
Expected: exits 0 with no output (types resolved via the `exports.types` entry). Then return to the repo dir: `cd` back to the worktree root.

- [ ] **Step 6: Clean up the tarball and consumer dir, then commit packaging**

```bash
rm -f spacemolt-client-v2-1.5.0.tgz
rm -rf "/private/tmp/claude-501/-Users-vcarl-workspace-client-v2/4740d553-aecd-4943-b05d-9f16523f7e70/scratchpad/consumer"
git add package.json
git commit -m "feat: publish-ready packaging (exports/files/types) + v1.5.0

Verified: packed tarball installs into a clean Node project and imports cleanly
(runtime ESM + TS types). Not published (still private).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Release hygiene (tag + CLI rebuild + docs)

**Files:**
- Modify: `README.md` (add a short "Use as a library" section)
- Tag: `v1.5.0`

**Interfaces:** none (final wrap-up).

- [ ] **Step 1: Add a library usage section to the README**

Append to `README.md` (adapt the heading level to match the file's existing style):

```markdown
## Use as a library

Install from npm (or a packed tarball):

\`\`\`bash
pnpm install @spacemolt/client-v2
\`\`\`

\`\`\`ts
import { createSession, spacemoltAuthLogin } from '@spacemolt/client-v2';

// Authenticated client with automatic re-auth on session expiry:
const { client } = await createSession({ username: 'you', password: 'secret' });

// Call any generated operation, passing the client:
const status = await spacemoltAuthLogin({ client, body: { username: 'you', password: 'secret' } });

// Or drive the raw client yourself:
import { createClient } from '@spacemolt/client-v2';
const raw = createClient({ baseUrl: 'https://game.spacemolt.com' });
\`\`\`

The SDK is ESM-only and targets Node 18+ (native fetch).
```

- [ ] **Step 2: Final full verification**

Run: `bun test`
Expected: all pass.

Run: `bun run typecheck`
Expected: no errors.

Run: `bun run build:lib`
Expected: `dist/` builds clean.

Run: `bun run build && ./spacemolt --version && rm -f spacemolt`
Expected: prints the client + spec versions, exits cleanly.

- [ ] **Step 3: Commit the README and tag the release**

```bash
git add README.md
git commit -m "docs: document library usage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git tag -a v1.5.0 -m "v1.5.0: publish importable OpenAPI SDK"
```

- [ ] **Step 4: Report**

Summarize: what was added (full SDK generation, session helper, library build, packaging), the verified import proof (tarball → clean Node project), the dependency outcome (zero, or the one dep that was required), and that the package remains unpublished/private by design.

---

## Self-Review

**Spec coverage:**
- §1 Codegen → Task 1. ✓
- §2 Library entry → Task 2. ✓
- §3 Session helper (login, X-Session-Id, auto re-auth, no file I/O) → Task 3. ✓
- §4 ESM build + packaging metadata, keep private → Tasks 4 & 5. ✓
- §5 Tarball install test (headline) + unit tests + version bump → Tasks 5, 3/2, 6. ✓
- §5 dependency question settled empirically → Task 1 Step 3, Task 4 Step 3, Task 5 Step 4. ✓
- Open point (`bin` left untouched) → respected (no task modifies `bin`). ✓
- Out of scope (no publish, no file store, no dual CJS, no bin rework) → honored. ✓

**Placeholder scan:** No TBD/TODO. The two genuinely runtime-determined facts (exact login fn name; self-contained vs external client import) are handled with explicit verification steps + a single defined adaptation point each, not hand-waving. ✓

**Type consistency:** `createSession`/`SessionOptions`/`SpacemoltSession` are declared identically in Task 2's stub and Task 3's implementation. `spacemoltAuthLogin`, `createClient` referenced consistently and routed through `./generated`. Interceptor signatures match the verified hey-api 0.73 API (`request => request`, `(response, request) => response`). Version `1.5.0` consistent across Tasks 5 & 6. ✓
