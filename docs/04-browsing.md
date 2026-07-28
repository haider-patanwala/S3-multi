---
id: browsing
type: subsystem
owns: src/routes/browse.tsx, src/lib/query-options.ts, src/lib/utils.ts (path helpers)
---

# Browsing

## Prefixes, not directories

Object storage is flat. Folders are an illusion built from
`ListObjectsV2(Delimiter: "/")`:

- `CommonPrefixes` → rendered as folders
- `Contents` → rendered as files, with the current prefix stripped from the name
- the entry whose key equals the prefix itself is filtered out (that's the
  zero-byte folder marker `createFolder` writes)

Path math lives in `src/lib/utils.ts`: `joinPrefix`, `normalizeFolderPrefix`,
`parentPrefix`. Use them; hand-rolled slash juggling is how trailing-slash bugs
get in.

Consequences of flatness:

- An "empty folder" only exists if a marker object exists.
- Deleting the last file in a folder makes the folder disappear.
- Renaming a folder is not supported — it would mean copying every key under it.

## Listing scope

`listObjects` does **one** `ListObjectsV2` call and does not paginate. Buckets
with more than 1000 entries under a single prefix are silently truncated. Search
filters only what that page returned — it is a client-side `includes()` on the
name, not a server-side query.

This is a known ceiling, not a mystery. Fixing it means looping on
`ContinuationToken`.

## Query keys and invalidation

From `src/lib/query-options.ts`:

```
["objects", providerId, bucket, prefix, search]
["buckets", providerId]
```

Mutations invalidate the `["objects", providerId, bucket]` prefix, which covers
every cached prefix and search term in that bucket. Both queries are `enabled`
only when their inputs exist, so a provider-less first render does not fire
requests.

## Location is the URL

`searchSchema` (Zod) validates `providerId`, `bucket`, `prefix` (default `""`),
`view` (`list | grid`). Two effects reconcile resolved provider/bucket back into
the URL with `replace: true`, and persist the bucket via `setRecentBucket`.

So: a `/browse` URL is a shareable, reload-safe location, and navigation is just a
search-param update.

## Rendering

`@tanstack/react-virtual` virtualizes list rows (`estimateSize: 56`,
`overscan: 8`) against the scroll container in `parentRef`. Grid view is not
virtualized.

`estimateSize` must match the row's real height: `EntryRow` is `h-14` (56px). The
two are not linked by anything but this line — change the class and rows overlap
or leave gaps. The row's column track (`ENTRY_GRID` in `src/routes/browse.tsx`)
is shared with the header above the scroll container, and drops its three middle
columns below 900px; both halves must change together or the header stops lining
up with the rows.

Search input is wrapped in `useDeferredValue`, so typing does not block the list;
the deferred value is part of the query key, so each settled term is cached
separately.

## Selection

`selectedKeys: string[]`. An effect prunes it whenever `objects` changes, so keys
that scrolled out of the current listing (or were deleted) cannot linger and
target a stale bulk delete.

## Mutations on this page

`downloadMutation`, `previewMutation`, `saveTextMutation`, `purgeMutation`,
`deleteMutation`, `renameMutation`, upload/replace handlers, `createFolder`.

Each one reports through `setStatusMessage` (success) or `setErrorMessage`
(failure), and both are rendered — see [failure-modes](09-failure-modes.md) for
why that sentence needs saying.

## Preview

`previewMutation` calls `previewObject`, which returns a blob URL. For editable
text types it also reads the text into `textPreview` (the pristine baseline) and
`editText` (the buffer).

Blob URLs are revoked in three places: on cleanup effect, on replacing an existing
preview, and on Close. Adding a fourth exit path from the preview means adding a
fourth revoke, or leaking memory.

Renderers, by content type: `image/*` → `<img>`; `video/*` → `<video>` (with an
empty VTT captions track so the element is accessible); editable text → the
editor, see [text-editing](06-text-editing.md); everything else → `<iframe>`.

## Relations

- `depends-on` → [s3-client](03-s3-client.md)
- `hosts` → [text-editing](06-text-editing.md), [cdn-purge](07-cdn-purge.md) (the purge dialog lives here)
- `depends-on` → [provider-vault](02-provider-vault.md)
