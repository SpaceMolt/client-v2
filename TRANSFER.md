# Repo transfer plan: cahaseler/client-v2 → SpaceMolt/client-v2

Working notes for moving this repo to the SpaceMolt org. Not part of the
released artifact — delete this file after transfer is complete.

## Decisions locked in

- **Final name:** `SpaceMolt/client-v2` (coexist with `SpaceMolt/client`; don't rename either)
- **License:** MIT, matching v1
- **Visibility:** Public
- **Default branch:** `main`
- **Issues:** enabled
- **Recommended client:** v2 (this repo) — README and AGENTS.md make this explicit

## Pre-transfer checklist (this repo)

- [x] README.md
- [x] AGENTS.md
- [x] LICENSE (MIT)
- [x] package.json public metadata (`description`, `repository`, `license`, `homepage`)
- [x] `.github/workflows/ci.yml` — typecheck + tests on push/PR
- [x] `.github/workflows/release.yml` — matrix build on `v*` tag push
- [x] `.gitignore` covers session files, env files, OS junk, IDE settings
- [x] Internal review docs removed (CODE_REVIEW.md deleted)
- [x] Update checker points at the right repo (`SpaceMolt/client-v2`)
- [x] No secrets in tracked files (scanned)
- [x] CI green on `main`
- [ ] First Release run succeeds (binaries attached to v1.4.1 release)

## Transfer steps (GitHub UI, owner action)

The transfer must be initiated by the current owner (`cahaseler`) and
accepted by an admin in the `SpaceMolt` org.

1. **On `github.com/cahaseler/client-v2`:** Settings → Danger Zone →
   *Transfer ownership*. New owner: `SpaceMolt`. New name: `client-v2`.
2. Coordinate with Ian (org admin) — he may need to accept on the SpaceMolt
   side depending on org settings.
3. GitHub automatically:
   - moves the repo, all branches, tags, and releases
   - redirects `cahaseler/client-v2` → `SpaceMolt/client-v2` for git URLs
   - keeps existing PR/issue numbers
4. **Things that do NOT transfer automatically:**
   - GitHub Actions secrets (none currently, so nothing to do)
   - Branch protection rules (none currently — add `main` protection in the new home if desired)
   - Repo-level webhooks (none)
   - Repo description/topics/homepage URL (set those on the new repo)

## Post-transfer checklist (in SpaceMolt/client-v2)

- [ ] Set repo description: "Typed CLI client for the SpaceMolt v2 REST API"
- [ ] Set homepage URL: `https://www.spacemolt.com`
- [ ] Add topics: `spacemolt`, `cli`, `bun`, `typescript`, `openapi`, `mmo`, `llm-agents`
- [ ] (Optional) Enable branch protection on `main` (require PR + green CI)
- [ ] Confirm Actions are enabled (re-run release.yml against the v1.4.1 tag if needed)
- [ ] Update local `origin` remote: `git remote set-url origin https://github.com/SpaceMolt/client-v2.git`
- [ ] Update v1 client's README if it should mention v2 as the recommended option
- [ ] Update https://www.spacemolt.com/clients to list v2 (likely matches Ian's existing process)

## Things to know

- The redirect from `cahaseler/client-v2` is automatic, so old clones
  continue to work without action. Any user who had cloned during the
  short-lived `cahaseler` window can keep their `origin` as-is or update
  it; both work.
- The v1.4.0 tag exists on this repo but no binaries were attached (the
  release workflow didn't exist yet). The first "real" release will be
  v1.4.1, built by the workflow added in this commit.
- After transfer, the `repository.url` in `package.json` (`SpaceMolt/client-v2`)
  and the update-checker's `GITHUB_REPO` constant will both line up with the
  canonical URL. No additional code changes needed.

## If the transfer can't happen yet

The repo is fully release-ready on `cahaseler/client-v2`. You can ship
binaries from there (the workflow builds and releases without caring
about the org), and transfer later when convenient — every existing
release moves with the repo, so nothing is lost.
