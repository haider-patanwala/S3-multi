---
id: development
type: reference
owns: package.json, biome.jsonc, tsconfig.json, vite.config.js
---

# Development

## Commands

```bash
pnpm dev            # vite dev server on :3000
pnpm build          # vite build && tsc --noEmit
pnpm preview        # serve the built bundle
pnpm lint           # biome check --write .
pnpm lint:error     # biome check, errors only
node src/lib/cdn.check.ts   # CDN URLs, purge-command building, shell quoting
```

## Pre-commit gate

```bash
pnpm lint:error && npx tsc --noEmit && node src/lib/cdn.check.ts
```

`cdn.check.ts` shells out to `/bin/sh` to verify the purge command's quoting
survives a real shell. It runs no network calls and nothing destructive.

Biome (`biome.jsonc`) enforces tab indent, sorted imports, and sorted JSX props.
It will rewrite files on `--write`, so run it before reading a file you just
edited.

## Self-checks

Files named `*.check.ts` / `*.check.js` are standalone Node scripts, not app code.
Node 24 type-strips and runs them directly. They are excluded from `tsconfig.json`
(`"exclude": ["**/*.check.ts"]`), which is why they may use `node:` imports and
explicit `.ts` import specifiers.

There is no test framework and no test runner. A new non-trivial pure function
should get an `assert`-based check in the sibling `*.check.ts`, not a new
dependency.

Anything requiring live credentials (the S3 round trip, a real purge) is not
covered. Verify those manually against a scratch bucket.

## Verifying in a browser

Driving the running app is the only way to check the S3 round trip. Traps that
produced **wrong conclusions** in practice, all of them false negatives or false
positives rather than obvious errors:

- **`document.querySelector('[role="dialog"]')` matches leftovers.** A dialog from
  a previous step can still be in the DOM. Assert on something identifying — the
  dialog title, the filename — before trusting a value read out of it. A whole
  "stale cache header" bug was invented and chased this way; it did not exist.
- **Synthetic `input.value = x` does not always reach React.** Writing the DOM
  property makes the field *look* filled while component state stays empty, so the
  subsequent save persists nothing. Use the harness's typing helper, or set via
  the native setter **and** verify the effect, not the input.
- **CDP key events may not reach the page at all.** Neither `Escape` nor typed
  characters arrived in one session, which reads exactly like a broken key handler.
  Confirm the harness can deliver *any* keydown before concluding a handler is
  broken.
- **Prefer ground truth over the UI** when checking persistence: IndexedDB for
  provider fields, the object list's byte count for writes, response headers for
  caching.

### Never run `pnpm lint` on a file that does not parse

Biome's `--write` reformats what it can parse and **mangles JSX it cannot**,
turning a one-line syntax error into a corrupted file. Gate it:

```bash
npx tsc --noEmit && pnpm lint
```

Also avoid piping source files through output-filtering shells/proxies into a
redirect (`head -n file > tmp`): a filter that abbreviates long output will happily
write `// ... N lines omitted` into real source. Recover with
`git show HEAD:path > path`.

## Generated files

`src/routeTree.gen.ts` is produced by `@tanstack/router-plugin`. Never hand-edit;
it regenerates when route files change.

## Recipe: add a field to `ProviderConfig`

Four files, in order. Miss one and the field silently vanishes on save.

1. `src/lib/types.ts` — add to `ProviderConfig`. If it is a secret, also add
   `<name>Encrypted` to `ProviderRecord` and remove the plaintext field from the
   `Omit<...>` list.
2. `src/lib/providers.ts` — add to **both** `toConfig` (read/decrypt) and
   `saveProvider` (trim/encrypt/write). `saveProvider` is a full replace: a field
   missing there is dropped on every save.
3. UI — `src/routes/providers.tsx` for connection settings, or the purge dialog in
   `src/routes/browse.tsx` for CDN settings. Seed the input state where the dialog
   opens.
4. Consumer — `src/lib/s3.ts` or `src/lib/cdn.ts`.

Reference implementation: `publicBaseUrl`, which touched exactly these four places.

**Step 2 is the one that gets missed**, including by people who have read this
recipe. `defaultCacheControl` was added to `types.ts`, the UI and the consumer,
the app said *"Stored … with encrypted credentials"*, and the field was silently
dropped on every save because `saveProvider` never mentioned it.

**Verify by reading the record back, not by trusting the success message:**

```js
// devtools console
const db = await new Promise(r => { const q = indexedDB.open('s3-multi-control-room'); q.onsuccess = () => r(q.result) })
await new Promise(r => { const q = db.transaction('providers').objectStore('providers').getAll(); q.onsuccess = () => r(console.table(q.result)) })
```

**Fifth trap, not in the four files:** any form that edits a *subset* of a provider
must round-trip the fields it does not show. `providers.tsx` rebuilds the provider
from `FormState` via `toDraft`, so CDN settings — which are edited in `/browse`'s
purge dialog — are carried through an opaque `FormState.cdn` blob. Add new
out-of-form fields there or saving connection settings will erase them.

## Recipe: add a provider type

1. Extend `ProviderType` in `src/lib/types.ts`.
2. Add its region / `forcePathStyle` / endpoint rules to `createClient`
   (`src/lib/s3.ts`).
3. Add a label to `shortProviderLabel` (`src/lib/utils.ts`).
4. Decide its purge story in `src/lib/cdn.ts` — `purgeCache` and `canPurge` both
   switch on type. `canPurge` returning `false` is a fine answer.

## Conventions

- `lib/` is React-free and holds all I/O. Domain logic in a route is misplaced.
- Every mutation reports through `setStatusMessage` (success) or `setErrorMessage`
  (failure). No silent catches — see [failure-modes](09-failure-modes.md).
- Deliberate shortcuts are marked with a `ponytail:` comment naming the ceiling and
  the upgrade path. Grep for them before assuming something is an oversight.
- Query keys live in `src/lib/query-options.ts`, never inlined in a component.
- Blob URLs from `previewObject` must be revoked on every exit path.

## Environment

`.env` holds `VITE_NODE_ENV=development`, which gates the TanStack devtools in
`src/routes/__root.tsx`. No credentials belong in `.env` — they live in the
encrypted vault. See [provider-vault](02-provider-vault.md).

## Relations

- `operates` → [architecture](01-architecture.md)
- `extends` → [provider-vault](02-provider-vault.md), [s3-client](03-s3-client.md), [cdn-purge](07-cdn-purge.md), [cache-control](11-cache-control.md)
