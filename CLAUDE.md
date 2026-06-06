# SpaceMolt Client v2 — Developer Guide

## Repository

Standalone TypeScript/Bun CLI client for the SpaceMolt v2 REST API.
Designed for use by AI agents. Not a monorepo — this directory is its own git repo.

---

## Commands

```bash
bun test              # Run all tests
bun run build         # Compile binary → ./spacemolt
bun run generate      # Regenerate src/commands.ts + src/generated/ from openapi.json
bun run typecheck     # Type-check without building
```

---

## Version Bump Workflow

**Do this whenever you make changes and build a new binary:**

1. Bump `package.json` version (semver: patch for fixes, minor for new features/spec syncs)
2. Commit: `git commit -m "vX.Y.Z: Description of changes"`
3. Tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`
4. Build: `bun run build`

The binary embeds both the client version (from `package.json`) and the game API spec version
(from `openapi.json` at codegen time). Verify with `./spacemolt --version`.

---

## Syncing the Game API Spec

When the server ships a new release:

1. Fetch the spec: `./scripts/fetch-spec.sh`
   - Writes to `openapi.staging.json`, verifies it's a valid spec, then moves to `openapi.json`
   - If you hit a rate limit (usually caused by fetching repeatedly in quick succession), wait ~35s and try again
2. Regenerate: `bun run generate`
3. Run tests: `bun test`
4. Bump version and rebuild

---

## Architecture

- `src/commands.ts` — Auto-generated command registry. Do not edit.
- `src/generated/` — Auto-generated types from openapi-ts. Do not edit.
- `src/dispatch.ts` — Command resolution logic (aliases, short names, qualified names)
- `src/main.ts` — CLI entry point, arg parsing, help output
- `src/api.ts` — HTTP client with session management and retry logic
- `src/session.ts` / `src/session-store.ts` — Multi-account session management
- `scripts/build-commands.ts` — Codegen script: reads openapi.json → writes commands.ts

## Key Constants (src/dispatch.ts)

- `COMMAND_ALIASES` — User-facing shortcuts (e.g. `view_storage` → `spacemolt_storage/view`)
- `AMBIGUOUS_DEFAULTS` — Default tool group when action name exists in multiple groups
- `DEPRECATED_COMMANDS` — Checked before resolution; prints migration message and exits

## HTTP Timeouts

All fetch timeouts are 5 minutes (`300_000ms`). Jumps are synchronous and can take several
minutes to complete. Do not reduce below 5 minutes.
