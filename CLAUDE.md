# S3 Multi

Browser-only manager for S3-compatible object storage (AWS S3, Cloudflare R2,
MinIO/custom). React 19 + TanStack Router/Query + Vite, Biome, pnpm.
**No backend** — every API call goes from the browser straight to the provider,
and credentials are AES-GCM encrypted in IndexedDB.

## Read `docs/` before changing anything

`docs/` is a maintained wiki written for agents, not a stale README dump. It is
the authoritative explanation of this codebase — **read the relevant page before
editing, and update it in the same change when behaviour moves.**

Start at **[docs/index.md](docs/index.md)**: it has the page index, a relation
graph, task-based reading paths, and the project invariants.

| Page | Covers |
|---|---|
| `00-product.md` | What this is, who for, hard constraints |
| `01-architecture.md` | Layers, data flow, routes, state ownership |
| `02-provider-vault.md` | Credential storage, encryption, IndexedDB schema |
| `03-s3-client.md` | SDK client construction, per-provider quirks, CORS |
| `04-browsing.md` | Prefix listing, query keys, virtualization |
| `05-transfers.md` | Upload/download, progress, persisted history |
| `06-text-editing.md` | The `/edit` page: rich text + code editors, diagnostics, save + verify |
| `07-cdn-purge.md` | CloudFront invalidation, Cloudflare purge, the CORS wall |
| `08-caching-layers.md` | The four caches, and which one ate your edit |
| `09-failure-modes.md` | Symptom → cause → fix catalogue |
| `10-development.md` | Commands, recipes, verification traps |
| `11-cache-control.md` | Edge-cache headers vs always-fresh reads |
| `12-deployment.md` | Static hosting: HTTPS requirement, SPA fallback, CSP/CDN headers |

Pick the reading path from `index.md` rather than reading everything. For a bug
report, `09-failure-modes.md` first — the symptom is usually already catalogued
with its real cause.

**The docs contract:** one concept per page; a header block naming the files each
page owns; typed `## Relations` edges; claims that point at `path:symbol`.
Gotchas and failure modes are the highest-value content, not footnotes. If a page
and the code disagree, **the code wins and the page is stale — fix it in the same
change.**

## Before you commit

```bash
pnpm lint:error && npx tsc --noEmit && node src/lib/cdn.check.ts && node src/lib/richtext.check.ts && node src/lib/utils.check.ts
```

Never run `pnpm lint` (`biome check --write`) on a file that does not parse — it
reformats what it can and mangles JSX it cannot, turning a syntax error into a
corrupted file. Always `npx tsc --noEmit` first.

## Non-negotiables

Full list in `docs/index.md` § Invariants. The ones most often broken:

- **No request sets a fetch `cache` mode.** It appends non-CORS-safelisted headers
  and breaks every request. Use the signed `ResponseCacheControl` S3 parameter.
- **A write is not "saved" until it has been read back.**
- **Every failure is visible to the user.** No silent `catch`, no status message
  set but never rendered.
- **An overwrite preserves the object's metadata.** `Cache-Control` is the only
  field a caller may override, and only explicitly.
- **A spec citation is not a measurement.** Two bugs shipped here on plausible
  but unverified reasoning about the HTTP cache. Measure the real requests.
- **The UI is stock shadcn.** Controls come from `src/components/ui/` (add them
  with `shadcn add`, don't hand-roll); colours, radii and shadows resolve to the
  theme tokens in `src/styles.css`. Dark mode is the `dark` class on `<html>`.
  `.markdown-body` is the one sanctioned bespoke rule. See
  `01-architecture.md` § Styling.

## Working notes

- `lib/` is React-free and holds all I/O. Domain logic in a route is misplaced.
- Query keys live in `src/lib/query-options.ts`, never inlined.
- `src/routeTree.gen.ts` is generated. Never hand-edit.
- Convention for deliberate shortcuts: a `ponytail:` comment naming the ceiling
  and the upgrade path, so a simplification reads as intent rather than
  oversight. (Currently zero in the tree — the last one prescribed a fix that was
  tried and rejected; see `11-cache-control.md`.)
- No test framework. Non-trivial pure functions get an `assert`-based
  `*.check.ts` sibling (excluded from tsconfig, run directly by Node).
- Anything needing live credentials is not covered by checks — verify manually
  against a scratch bucket, and see `10-development.md` § Verifying in a browser
  for the traps that produce confidently wrong conclusions.
