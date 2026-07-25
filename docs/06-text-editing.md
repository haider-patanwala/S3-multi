---
id: text-editing
type: subsystem
owns: src/lib/s3.ts:putObjectText, src/lib/s3.ts:getObjectText, src/routes/browse.tsx:saveTextMutation
---

# Text editing

Edit markdown, JSON, YAML, XML, CSV, and plain-text objects in place, in the
browser, with no download/re-upload round trip.

## Eligibility

An object is editable when `isEditableTextContentType(preview.contentType)` is
true (`src/lib/utils.ts`): `text/*`, or a content type containing `yaml`, `yml`,
`markdown`, `xml`, or `json`.

`contentType` comes from `resolveObjectContentType`, so an R2 object stored with no
content type is still editable if its extension says text. This matters — R2
uploads frequently arrive as `application/octet-stream`.

## Editor state

Three pieces of state in `src/routes/browse.tsx`:

| State | Meaning |
|---|---|
| `previewKey` | Which key is open. The save target. |
| `textPreview` | The pristine baseline — what is believed to be in the bucket. |
| `editText` | The buffer being typed into. |

Derived: dirty ⇔ `editText !== textPreview`. Both **Reset** and **Save** are
disabled when clean, so the button state is the dirty indicator.

There is no autosave, no draft persistence, and no lock. Closing the preview
discards the buffer without warning, and two tabs editing the same key is
last-write-wins.

## Save pipeline

`saveTextMutation` → `putObjectText(provider, bucket, previewKey, editText, preview.contentType)`.

`putObjectText` (`src/lib/s3.ts`) does three things, in order:

### 1. Preserve metadata

```ts
const existing = await headObject(provider, bucket, key).catch(() => undefined);
```

A `PutObject` overwrite **replaces all object metadata**. Without this head, every
save silently wipes `Cache-Control`, `Content-Disposition`, `Content-Language`, and
all custom `x-amz-meta-*` headers. So the existing values are read and passed
through.

`ContentEncoding` is deliberately **not** carried forward: the browser already
decoded the body on read, so re-declaring `gzip` would describe bytes that are no
longer gzipped. Restoring it would corrupt the object.

The head is best-effort (`.catch(() => undefined)`) so creating a brand-new key
still works.

### 2. Write

`PutObject` with the buffer as a string body. Content type precedence: caller's
override → existing content type → `resolveObjectContentType(key)`.

String bodies are UTF-8 safe here: the SDK computes `Content-Length` with
`TextEncoder().encode(body).byteLength`, so multi-byte content (emoji, CJK,
accents) is not truncated.

### 3. Read back — the reliability guarantee

```ts
const written = await getObjectText(provider, bucket, key);
if (written !== text) throw new Error("Save did not stick: ...");
```

**A 200 from `PutObject` is not proof that a reader gets the bytes back.** The
read-back is what turns "the request succeeded" into "the file is changed". It
catches stale caches, write-through oddities, and permission configurations that
accept a write without persisting it.

It lives in `lib/s3.ts`, not in the route, so every current and future caller of
`putObjectText` inherits it.

Cost: one extra `GET` per save. For text files that is negligible, and it is the
difference between reporting a save and knowing one.

### 4. Purge, or say it wasn't purged

Back in `saveTextMutation`, branching on `canPurge(provider)`:

- **AWS** — the edited key is invalidated in CloudFront. A purge failure is
  reported as `"Saved, but the CDN purge failed: …"`; it must never read as a
  failed save, because the bucket really was written.
- **R2 with purge credentials** — the app *cannot* purge (Cloudflare's API refuses
  browser calls), so it reports `"CDN not purged — open Purge cache for the command
  to run."` Saying nothing here would recreate the original bug in a new place: the
  operator would believe the change is live when the edge still serves the old
  copy.

Details in [cdn-purge](07-cdn-purge.md).

### 5. Settle

On success: `setTextPreview(saved)` (the new baseline, so the buttons go clean),
a status message naming the bucket, and
`invalidateQueries(["objects", providerId, bucket])` to refresh size and
last-modified in the listing.

On failure: `setErrorMessage(...)`, and the baseline is **not** advanced — the
buffer stays dirty and the user can retry. This is why the read-back must throw
rather than warn.

## Why the read-back is trustworthy

It would be worthless if the browser could answer it from its HTTP cache with the
old body. It cannot: RFC 9111 §4.4 requires a cache to invalidate its stored
response for a URI after a successful unsafe method, and the `PutObject`
immediately precedes the read.

Do **not** try to reinforce this with `requestHandler: { cache: "no-store" }` —
that was tried, and it breaks every request with `Failed to fetch` by adding
non-CORS-safelisted request headers. See [s3-client](03-s3-client.md).

## History

The originally reported bug — "it says it saved, but on refresh the changes are
gone" — was three defects stacked:

1. **No feedback.** The status state was `_statusMessage`: set in a dozen places,
   rendered nowhere. A failing save looked identical to a succeeding one.
2. **No verification.** A 200 from `PutObject` was treated as proof the bytes
   landed.
3. **No purge.** A stale CDN copy outlived a correct write.

A fourth cause — browser HTTP caching — was *diagnosed and was wrong*. The
`cache: "no-store"` added for it broke every request with `Failed to fetch` and has
been removed; see [s3-client](03-s3-client.md).

Two lessons worth keeping. An operation that reports success without verifying it,
in a UI that cannot show failure, is indistinguishable from a no-op. And a
plausible mechanism is not a confirmed one — the cache theory was never measured
before it was shipped.

## Ceilings

- `<textarea>`, not a code editor: no syntax highlighting, no line numbers, no
  large-file strategy.
- Whole file in memory, whole file rewritten on every save.
- No conflict detection. A stale `If-Match: ETag` precondition would be the fix.
- Markdown is edited as raw text; there is no rendered preview.

## Runnable check

`node src/lib/cdn.check.ts` covers the purge-target logic the save path depends
on. The S3 round trip itself needs live credentials and is not covered.

## Relations

- `depends-on` → [s3-client](03-s3-client.md)
- `triggers` → [cdn-purge](07-cdn-purge.md)
- `explained-by` → [caching-layers](08-caching-layers.md)
- `hosted-by` → [browsing](04-browsing.md)
- `troubleshot-by` → [failure-modes](09-failure-modes.md)
