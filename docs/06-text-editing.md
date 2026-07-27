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

Plus `editMode` (Preview/Edit tab) and `previewLang`, derived by
`detectTextLang(previewKey, contentType)`.

There is no autosave, no draft persistence, and no lock. Closing the preview
discards the buffer without warning, and two tabs editing the same key is
last-write-wins.

## Rich viewing and formatting

`src/lib/richtext.ts`. Language detection is **extension-first**, content-type
second: buckets are full of JSON and Markdown stored as
`application/octet-stream` or `text/plain`.

| Lang | Preview tab | Formatter |
|---|---|---|
| `markdown` | `marked` → `DOMPurify.sanitize` → `.markdown-body` | Prettier `markdown` |
| `html` | `<iframe sandbox="" srcDoc>` | Prettier `html` |
| `json` | pretty-printed source | Prettier `babel` + `estree` |
| `yaml` | pretty-printed source | Prettier `yaml` |
| `text` | source as-is | none — no Format button |

The rendered preview reads `editText`, the **live buffer**, so it follows edits
without a save round trip.

### Prettier loading

Prettier is dynamically imported, and `formatterByLang[lang].load()` pulls **only
that parser's plugins**. Loading all of them to reformat one JSON file costs
~350 kB gzipped. Each parser is its own Vite chunk; nothing lands in the initial
bundle.

### Auto-format on open

`previewMutation` formats the file into `editText` while leaving `textPreview` as
the **raw bucket bytes**. That asymmetry is deliberate: the diff that drives the
Save button then reflects a real difference against S3, so saving a reformatted
file genuinely persists the reformat, and **Reset** returns the original bytes.
Formatting is best-effort — `formatTextOrKeep` returns the input unchanged when
the file does not parse, so a malformed JSON object is still openable and
editable.

### Sanitization

Markdown may contain raw HTML, so `renderMarkdown` pipes `marked` output through
DOMPurify. HTML files are not sanitized — they are rendered in a
`sandbox=""` iframe, which blocks scripts, forms, popups and same-origin access.
Sanitizing there would misrepresent the file the operator is editing.

## Save pipeline

**Save changes** does not save. It opens the save dialog, which collects a
`Cache-Control` and shows the purge command for the key; its **Save file** button
runs `saveTextMutation(cacheControl)`. See
[cache-control](11-cache-control.md).

`saveTextMutation` → `putObjectText(provider, bucket, previewKey, editText, preview.contentType, cacheControl)`.

`putObjectText` (`src/lib/s3.ts`) does three things, in order:

### 1. Preserve metadata

```ts
const existing = await headObject(provider, bucket, key).catch(() => undefined);
```

A `PutObject` overwrite **replaces all object metadata**. Without this head, every
save silently wipes `Cache-Control`, `Content-Disposition`, `Content-Language`, and
all custom `x-amz-meta-*` headers. So the existing values are read and passed
through.

`CacheControl` is the one field a caller may override: an explicit argument wins,
and the existing header is the fallback. Everything else is preserved
unconditionally.

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

The read-back is worthless if the browser can answer it from its HTTP cache with
the old body — and **for a period it could**, which made every save report
`"Save did not stick"` on a write that had landed.

This page previously argued the cache was harmless because RFC 9111 §4.4
invalidates a stored response after an unsafe method on that URI. The premise
fails: the SDK writes to `?x-id=PutObject` and reads from `?x-id=GetObject`, which
are different cache keys, so the invalidation never fires. Measurement and detail
in [caching-layers](08-caching-layers.md#-browser-http-cache).

What makes it trustworthy now is `ResponseCacheControl: "no-cache"` on
`getObjectText` (and on the other reads). Do **not** substitute
`requestHandler: { cache: "no-store" }` — that was tried and breaks every request
with `Failed to fetch` by adding non-CORS-safelisted request headers. See
[s3-client](03-s3-client.md).

## History

The originally reported bug — "it says it saved, but on refresh the changes are
gone" — was three defects stacked:

1. **No feedback.** The status state was `_statusMessage`: set in a dozen places,
   rendered nowhere. A failing save looked identical to a succeeding one.
2. **No verification.** A 200 from `PutObject` was treated as proof the bytes
   landed.
3. **No purge.** A stale CDN copy outlived a correct write.

A fourth cause — browser HTTP caching — was *diagnosed, mis-fixed, wrongly
dismissed, and finally confirmed*, in that order:

1. Diagnosed by guess; "fixed" with `cache: "no-store"`, which broke every request with `Failed to fetch`.
2. The fix was reverted and the theory dismissed via RFC 9111 §4.4 — a correct citation with a false premise (`x-id` makes the read and write different URIs).
3. Later measured directly and confirmed real; fixed properly with `ResponseCacheControl`.

Three lessons worth keeping. An operation that reports success without verifying
it, in a UI that cannot show failure, is indistinguishable from a no-op. A
plausible mechanism is not a confirmed one. And **a spec citation is not a
measurement** — step 2 replaced an unmeasured theory with an unmeasured
counter-theory and stayed wrong for longer.

## Ceilings

- `<textarea>`, not a code editor: no syntax highlighting, no line numbers, no
  large-file strategy. The Preview tab is the readable view; the Edit tab is plain.
- Whole file in memory, whole file rewritten on every save.
- No conflict detection. A stale `If-Match: ETag` precondition would be the fix.
- No formatter for XML or CSS — `detectTextLang` returns `text`, so they are
  editable but not formattable.
- `.md` files render only CommonMark + GFM as `marked` implements it: no
  front-matter handling, no Mermaid, no syntax highlighting in fenced blocks.

## Runnable check

`node src/lib/cdn.check.ts` covers the purge-target logic the save path depends
on. The S3 round trip itself needs live credentials and is not covered.

## Relations

- `depends-on` → [s3-client](03-s3-client.md), [cache-control](11-cache-control.md)
- `triggers` → [cdn-purge](07-cdn-purge.md)
- `explained-by` → [caching-layers](08-caching-layers.md)
- `hosted-by` → [browsing](04-browsing.md)
- `troubleshot-by` → [failure-modes](09-failure-modes.md)
