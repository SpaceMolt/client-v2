# Code Review - Client v2

## Critical (fix before release)

1. ~~**Session file corruption risk** — `loadStore()` silently discards corrupted files with no backup. `saveStore()` uses non-atomic writes — crash mid-write = data loss. (`session.ts:69-104`)~~ **FIXED** — Atomic writes via temp+rename, corrupt files backed up with `.corrupt` extension.
2. ~~**No fetch timeouts** — `createSession()` and `reAuthenticate()` can hang indefinitely on unresponsive servers. (`session.ts:200-285`)~~ **FIXED** — 30s `AbortSignal.timeout` on all fetch calls.
3. ~~**JSON parse without try/catch** — `response.json()` in `ApiClient.call()` can throw on malformed responses, crashing the CLI. (`api.ts:63`)~~ **FIXED** — Wrapped in try/catch, throws clear error message.

## High Priority

4. ~~**No required param validation** — `parseArgs()` never checks if required parameters are present; sends empty payloads that produce cryptic server errors. (`args.ts:17-76`)~~ **FIXED** — Validates required params, throws `ArgError` caught in main.ts.
5. ~~**Unsafe type coercion** — `coerceValue()` silently passes strings when integer parsing fails (e.g., `quantity=abc`). (`args.ts:79-93`)~~ **FIXED** — Throws `ArgError` on invalid integer values.
6. ~~**No `NO_COLOR` support** — ANSI codes leak into piped output. No `--no-color` flag or `NO_COLOR` env var. (`colors.ts`)~~ **FIXED** — Respects `NO_COLOR` env var, `--no-color` flag, and non-TTY detection.
7. ~~**Formatters/notifications can crash** — No try/catch around custom formatters or notification handlers. Malformed server data crashes the CLI. (`formatters.ts:91-102`, `notifications.ts:185-208`)~~ **FIXED** — Both wrapped in try/catch with graceful fallback.
8. ~~**Re-auth retry doesn't catch exceptions** — `createSession()` / `reAuthenticate()` during retry can throw, crashing instead of returning the error response. (`api.ts:74-84`)~~ **FIXED** — Retry block wrapped in try/catch.

## Medium Priority

9. ~~**Catalog has no custom formatter** — The new catalog command dumps raw JSON for ships/items/skills/recipes. Needs formatted output.~~ **FIXED** — Added formatter for ships, items, skills, recipes with pagination info.
10. ~~**Credential warning only shown in DEBUG mode** — Users never see that passwords are stored in plaintext unless they set `DEBUG=true`. (`session.ts:190-195`)~~ **FIXED** — Warning shown always.
11. ~~**Version duplication** — `config.ts:4` and `package.json` both hardcode `1.0.0` independently. Should read from one source.~~ **FIXED** — config.ts reads from package.json.
12. ~~**`@types/bun@latest` unpinned** — Non-deterministic builds.~~ **FIXED** — Pinned to `^1.3.9`.
13. ~~**No catalog example in main help** — Users won't discover the catalog command without digging into `spacemolt help`.~~ **FIXED** — Added catalog examples to help text.

## Test Coverage Gaps

14. ~~**Zero tests for CLI entry points** — `main.ts` has no tests: help, accounts, switch, smart login, error handling, exit codes.~~ **FIXED** — 12 subprocess tests covering --version, --help, accounts, switch, unknown commands, arg errors.
15. ~~**Zero tests for** `config.ts`, `colors.ts`, `errors.ts`.~~ **FIXED** — New test files for all three.
16. ~~**20+ notification handlers untested** — Only a few notification types verified.~~ **Already covered** — Existing tests cover all 24 handler types.
17. ~~**`getActiveUsername()` has no tests** at all.~~ **Already covered** — Tested in session.test.ts multi-account suite.
18. ~~**No integration tests** — Full login-to-API-call-to-display flow never tested end-to-end.~~ **FIXED** — New integration.test.ts with full flow + re-auth retry flow.

## Low Priority / Code Quality

19. ~~**Duplicate imports in `api.ts`** — Session functions imported twice (lines 2 and 137) with different names.~~ **FIXED** — Consolidated to single import.
20. ~~**`coerceValue()` exported but never used externally** — Should be private.~~ **Kept exported** — Still used in tests directly.
21. ~~**Non-null assertions (`!`)** in dispatch.ts:50, args.ts:95, formatters.ts:95 — should use proper null checks.~~ **FIXED** — Replaced with proper null checks / `??` operator.
22. **SessionManager is 389 lines** mixing file I/O, lifecycle, credentials, and multi-account — could benefit from splitting. **DEFERRED** — Significant refactor, should be a separate discussion.
