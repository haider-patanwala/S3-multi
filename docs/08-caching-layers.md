---
id: caching-layers
type: concept
owns: (cross-cutting)
---

# Caching layers

Four independent caches sit between a byte in a bucket and a byte on screen. "My
change didn't show up" is always one of them. Identify which before changing code.

```
   bucket
     │  ① browser HTTP cache      (fetch-level, per-URL, invalidated by PUT)
     │  ② TanStack Query cache    (in-memory, per query key)
     │  ③ blob URL / preview state(a snapshot, frozen at open time)
     │  ④ CDN edge cache          (CloudFront / Cloudflare, shared, global)
   screen
```

## ① Browser HTTP cache

**Where:** the browser, under `fetch`. JavaScript cannot read or clear it.

S3 and R2 GET responses carry `Last-Modified` but no `Cache-Control`, which makes
them eligible for *heuristic freshness* (RFC 9111 §4.2.2) in the browser's private
cache. The HTTP cache keys on URL, and the SDK's request URL is stable
(`.../bucket/key?x-id=GetObject`), so a `GET` can be served from cache.

**This did corrupt the edit flow, and it is now fixed by
`ResponseCacheControl: "no-cache"` on every content/metadata read** —
`getObjectText`, `previewObject`, `headObject`, `downloadObject`. See
[cache-control](11-cache-control.md).

### The RFC 9111 §4.4 argument this page used to make — and why it is wrong

This page previously claimed the cache could not corrupt a save, because RFC 9111
§4.4 requires a cache to invalidate its stored response for a URI after a
successful unsafe method, so the `PutObject` would evict the cached `GET`.

**The premise fails on "for a URI."** The AWS SDK tags every operation with its own
`x-id`, so the two requests are not the same URI:

```
write  PUT  .../bucket/key?x-id=PutObject
read   GET  .../bucket/key?x-id=GetObject     ← different cache key
```

The invalidation never fires between them. Measured symptom: `putObjectText`'s
read-back compared the new text against the browser's **pre-write cached body**,
mismatched, and threw `"Save did not stick: …"` on a save that had actually
landed. The object list showed the new byte count at the same moment. Reopening
the file also served the pre-save copy.

Confirming it took a direct comparison, because both requests return `200` and
look identical in a network log:

```js
// same URL, twice — the second bypasses the browser cache
await fetch(url).then(r => r.text())                    // stale pre-write body
await fetch(url, { cache: "reload" }).then(r => r.text())
```

The lesson is the same one this page already recorded once, in the other
direction: **a plausible spec citation is not a measurement.** The §4.4 argument
was correct about the RFC and wrong about this code, because nobody checked that
the two URLs matched.

### Do not "fix" this with a fetch cache mode

This page previously claimed the browser cache was the root cause of vanished
edits, and `createClient` set `requestHandler: { cache: "no-store" }` to force
fresh reads. **That broke every request** with an opaque `Failed to fetch`: cache
modes `no-store`/`reload` make the browser append `Pragma: no-cache` and
`Cache-Control: no-cache` request headers, neither of which is CORS-safelisted, so
the preflight fails against any bucket whose CORS policy enumerates
`AllowedHeaders`. Full detail and the measurement in
[s3-client](03-s3-client.md).

The correct instrument is `ResponseCacheControl` — a signed S3 query parameter,
invisible to the CORS preflight. See [cache-control](11-cache-control.md).

Also rejected: a middleware appending a unique query param to every `GET`/`HEAD`.
It defeated the cache and silently broke `ListObjectsV2` (empty listing, no
error). Scope any such param to `GetObject`/`HeadObject` by command.

The original "vanished edits" bug had two further causes — invisible errors and no
write-verification — see [text-editing](06-text-editing.md).

## ② TanStack Query cache

**Where:** memory, keyed by query key (`src/lib/query-options.ts`).

**Behaviour:** listings are served from the cache until invalidated. Mutations call
`invalidateQueries(["objects", providerId, bucket])`, which covers every prefix and
search term in that bucket.

**Symptom if wrong:** the file list shows a stale size or last-modified after a
write, but reopening the file shows correct content. Cause: a mutation that forgot
to invalidate, or invalidated too narrow a key prefix.

## ③ Preview / blob URL state

**Where:** `preview.blobUrl`, `textPreview`, `editText` in `src/routes/browse.tsx`.

A preview is a **snapshot taken when the file was opened**. Nothing refreshes it.
If the object changes elsewhere while your preview is open, you will not see it,
and saving will overwrite that change — there is no conflict detection.

After a successful save, `setTextPreview(saved)` advances the baseline so the
snapshot matches reality without a refetch.

**Symptom if wrong:** the editor keeps showing stale text even though a fresh GET
returns new bytes. Close and reopen the preview.

## ④ CDN edge cache

**Where:** CloudFront or Cloudflare, in front of `publicBaseUrl`. Shared across all
your visitors.

**Not the same as ①.** The in-app preview reads the **S3-API endpoint**
(`https://<account>.r2.cloudflarestorage.com/...`), which does not pass through the
CDN. So a stale CDN copy is invisible inside the app and visible to everyone else.

**Fix:** purge. See [cdn-purge](07-cdn-purge.md). `saveTextMutation` purges the
edited key automatically when the provider has purge credentials.

## Diagnostic decision tree

```
Change not visible?
├─ Not visible in the app's own preview, after reopening it
│  ├─ File list shows the old size too      → ② stale Query cache
│  └─ File list shows the new size          → the write failed
│     └─ check the status banner: a failed save now says so
├─ Not visible in the app, but only in an already-open preview → ③ snapshot
└─ Visible in the app, stale for end users / on the public URL → ④ CDN, purge it
```

Fastest disambiguation between a cache and a failed write: open the object's
public or signed URL in a fresh incognito window. If the new content is there, the
write landed and something downstream is serving a stale copy.

## Object `Cache-Control` (layer ④'s input)

Uploads now write a `Cache-Control`, and the save dialog offers one — without it a
CDN picks its own TTL and keeps re-fetching from the bucket, which is the billing
problem. `putObjectText` still never *invents* one: an explicit choice wins,
otherwise the object's existing header is preserved. See
[cache-control](11-cache-control.md).

## Deliberately not cached

- No service worker.
- No offline mode.
- No metadata-only edit path: changing an object's `Cache-Control` means rewriting
  its content.

## Relations

- `explains` → [text-editing](06-text-editing.md), [cdn-purge](07-cdn-purge.md), [cache-control](11-cache-control.md)
- `implemented-in` → [s3-client](03-s3-client.md)
- `feeds` → [failure-modes](09-failure-modes.md)
