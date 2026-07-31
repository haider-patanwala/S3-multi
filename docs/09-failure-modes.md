---
id: failure-modes
type: reference
owns: (cross-cutting)
---

# Failure modes

Symptom → cause → fix. Ordered roughly by how often each one bites.

## Saving

### "It saves, but the change is gone after refresh"

Historically three stacked defects; all fixed. If it recurs, check in this order:

1. **The status banner.** Errors render as a red banner that stays until
   dismissed. If a save failed, it says so. If you see no banner at all, the
   render path was broken again — see *Silent failures* below.
2. **Read-back.** `putObjectText` reads the object back and throws
   `"Save did not stick: …"` on mismatch. Seeing that message means the write was
   accepted but a reader gets different bytes: check bucket write permissions and
   whether anything sits in front of the endpoint. **Before believing it, confirm
   the write really failed** — see the next entry.
3. **Query cache.** If the listing shows a stale size but reopening the file
   shows the new content, a mutation forgot to invalidate. See
   [caching-layers](08-caching-layers.md).

### Every save says "Save did not stick" but the file list shows the new size

The write landed; the **read-back** is stale. This was a real bug: the browser
served `putObjectText`'s verification `GET` from its HTTP cache, so the new text
was compared against the pre-write body.

Tell-tale: the object list shows the new byte count and modified time at the same
moment the save reports failure. Reopening the file also shows the old content.

Fixed by `ResponseCacheControl: "no-cache"` on every content/metadata read. If it
recurs, a new read path was added without it — see
[cache-control](11-cache-control.md). Do not "fix" it with a fetch `cache` mode
(invariant 2), and do not add a cache-busting param globally: that breaks
`ListObjectsV2` silently.

Ground truth when unsure whether a write landed: check the **object list's byte
count**, or re-fetch with `{ cache: "reload" }` in the console. Both bypass the
path that lies.

### Save wipes an object's Cache-Control or custom metadata

`PutObject` replaces all metadata. `putObjectText` heads the object first and
carries `CacheControl`, `ContentDisposition`, `ContentLanguage`, and `Metadata`
forward. If metadata is disappearing, that head is failing (silently — it is
`.catch(() => undefined)`) or a new caller is issuing `PutObject` directly instead
of going through `putObjectText`.

### Save succeeds but end users still see the old file

The CDN edge cache — layer ④. In-app auto-purge only runs for AWS
(`canPurge(provider)`). For R2 the save reports `"CDN not purged — copy the
command from the save drawer and run it."` — run it. See
[cdn-purge](07-cdn-purge.md).

### Saved file is truncated or garbled with non-ASCII content

Should not happen: the SDK computes `Content-Length` via
`TextEncoder().encode(body).byteLength`. If it does, something replaced the string
body with a manual length calculation.

## Editing

### The rich-text editor reformatted my Markdown

Expected. Rich text is a round trip through a Markdown parser and serialiser, so
it normalises: `*` bullets become `-`, setext headings become ATX, wrapping is
redone. Nothing is *lost*, but the diff is larger than the edit.

Use the **Code** tab for byte-exact edits. See
[text-editing](06-text-editing.md) § Rich text is Markdown-only.

### There is no rich-text tab for my HTML / JSON / YAML file

Deliberate. A ProseMirror schema cannot represent an HTML document — `<head>`,
attributes and scripts would be dropped on save — and structured data has no
rich form. Those get the code editor with syntax diagnostics instead.

### The editor shows no syntax error on a file I know is broken

Diagnostics are **syntax** only — JSON/YAML via Prettier, HTML via htmlhint,
nothing for Markdown or plain text. There is no language server, so a valid file
that is *wrong* (bad schema, dead link, unknown key) reports nothing by design.

If it is genuinely malformed HTML and nothing fires, check the rule list:
`HTML_RULES` in `src/lib/richtext.ts` is a syntax-only subset, and htmlhint's
style rules are switched off on purpose. See
[text-editing](06-text-editing.md) § Diagnostics.

### The editor flags valid HTML

A regression in the rule list — a style rule got switched on, or the default
ruleset is being used instead of `HTML_RULES`. Void elements (`<br>`, `<img>`),
unquoted attributes, missing doctype and bare fragments are all legal and must
stay quiet. `richtext.check.ts` asserts exactly this; run it.

### The error underline is on the wrong character, or missing entirely

The offset normalisation in `lintText`. The three parsers report a position three
different ways (`cause.index`, `loc.start.offset`, 1-based line/column), and a
range that ends where it starts draws **nothing** — which is why `clampStart`
exists, and why an error reported at EOF was invisible before it did.
`node src/lib/richtext.check.ts` is the regression check; add the failing case.

### The editor opens with the file already modified

Not modified — reformatted. The buffer opens Prettier-formatted while the
baseline stays the raw bucket bytes, so the dirty state reflects a real
difference against S3. **Reset** returns the original bytes.

## Purging

### There is no in-app purge button for R2

By design, not a missing feature. `api.cloudflare.com` sends no CORS headers and
405s on preflight, so a browser can never call it — and no Cloudflare setting
changes that. The dialog generates a `curl` command to run yourself instead. See
[cdn-purge](07-cdn-purge.md).

### The generated command says `purge_everything` when I wanted one file

`publicBaseUrl` is not set, so no public URL could be built for the key.
Cloudflare can only purge a named file by its public URL. Set **Public CDN URL**
in the purge dialog; the note under the command says exactly this.

### The generated command has `<ZONE_ID>` or `<API_TOKEN>` in it

Those fields are empty in the dialog. Fill them in — the command rebuilds as you
type — or replace the placeholders by hand before running.

### Running the command returns `"success": false, "Authentication error"`

The token is wrong, expired, or lacks `Zone · Cache Purge` on that zone. Note
Cloudflare returns HTTP 200 with `success: false` for some errors, so check the
body, not just the status.

### AWS purge fails — is it also a CORS problem?

No. The CloudFront API answers preflights with `Access-Control-Allow-Origin: *`
(verified in [cdn-purge](07-cdn-purge.md)). An AWS purge failure is IAM,
a wrong distribution ID, or credentials — never CORS.

### CloudFront purge fails with AccessDenied

The IAM principal needs `cloudfront:CreateInvalidation`. The app reuses the
provider's S3 access keys, which commonly have no CloudFront permissions.

### Purge "succeeds" but nothing is purged

`publicBaseUrl` does not match the domain users actually request. The purge hit
URLs nobody asks for. Also check that objects are being served through the CDN at
all rather than direct from the bucket.

## Connectivity

### "Failed to fetch" on every operation

Always CORS — the preflight failed, so the real request was never sent. Two causes,
in order of likelihood:

1. **Something added a non-safelisted request header.** Check that nothing sets a
   fetch `cache` mode in `createClient` (`src/lib/s3.ts`). `no-store`/`reload` make
   the browser append `Pragma: no-cache` and `Cache-Control: no-cache`, which must
   then appear in the bucket's `AllowedHeaders`. This exact change once broke every
   request in a previously-working setup. See [s3-client](03-s3-client.md).
2. **Bucket CORS is wrong.** The origin must be allowed and `AllowedMethods` must
   include the verb in use. Minimum policy in [s3-client](03-s3-client.md).

Diagnostic: open DevTools → Network → the failing request → the preflight
`OPTIONS`. Compare its `Access-Control-Request-Headers` against the bucket's
`AllowedHeaders`. Anything in the former and missing from the latter is the cause.

`AllowedHeaders: ["*"]` makes this class of bug impossible.

### Saving fails with "Failed to fetch" but listing works

`putObjectText` sends `Cache-Control`, `Content-Disposition`, `Content-Language`,
and `x-amz-meta-*` request headers when the existing object has them, to avoid
wiping metadata on overwrite. A CORS policy that enumerates `AllowedHeaders` has to
permit those. Use `"*"`.

### Bucket list is empty but a known bucket works when typed in

`ListBuckets` against an account-level endpoint is frequently CORS-blocked with no
fix available. `listBuckets` catches CORS-shaped errors and returns
`[defaultBucket]`. Set a default bucket per provider.

### R2 requests fail with signature or path errors

R2 requires `forcePathStyle: true` and region `auto`, both forced in
`createClient` for `type: "r2"`. If a custom provider is actually R2, set its type
to `r2` rather than fighting the config.

### Uploads fail only for large files

Multipart. `ExposeHeaders` must include `ETag`, or `lib-storage` cannot assemble
the parts.

## Listing

### Files exist in the bucket but not in the app

`listObjects` issues one `ListObjectsV2` with no pagination — capped at 1000 entries
per prefix. Search filters only what that page returned. Fix: loop on
`ContinuationToken`.

### A folder vanished

Object storage has no directories. A folder exists only while an object shares its
prefix (or a zero-byte marker does). Deleting the last file removes the folder.

### Renaming half-worked, leaving two copies

`renameKey` is `CopyObject` then `DeleteObject`, not atomic. A failure between them
leaves both keys. Re-run the delete manually.

### Replacing a file created a new key instead of overwriting

`keyForReplacement` adopts the incoming file's extension. Replacing `notes.txt`
with `readme.md` writes `notes.md` and leaves `notes.txt`. By design; see
[transfers](05-transfers.md).

## Silent failures — the meta-lesson

The original bug's real cause was not S3 or caching. It was
`const [_statusMessage, setStatusMessage] = useState(...)`: a status state set from
a dozen call sites and **rendered nowhere**. Every error in `/browse` was
invisible, so a failed save was indistinguishable from a successful one.

Guard rules:

- An underscore-prefixed state variable with a used setter is a bug, not a lint
  workaround. If the linter complains a value is unused, either render it or delete
  the state — do not rename it.
- `setErrorMessage` for failures, `setStatusMessage` for successes. Errors persist
  until dismissed; successes auto-clear after 5 s.
- `.catch()` that discards an error must have a comment explaining why the failure
  is genuinely acceptable. There are two legitimate ones today: the metadata head
  in `putObjectText`, and the purge in `saveTextMutation`.

## Vault

### All providers disappeared

Clearing site data destroys the IndexedDB vault, including the non-extractable
`CryptoKey`. There is no backup and no recovery. Credentials must be re-entered.

### A provider field reverted after editing something else

`saveProvider` is a full replace, not a patch. Always spread the existing provider.
See [provider-vault](02-provider-vault.md).

Hit for real: the Providers page rebuilt the provider from its own form via
`toDraft`, which knew nothing about the CDN fields set in `/browse`'s purge dialog.
Saving connection settings silently erased the CloudFront/Cloudflare/public-URL
config. Fixed by carrying them through `FormState.cdn` untouched. Any form that
edits a *subset* of a record must round-trip the rest.

### A new provider field saves "successfully" but is gone on reload

`saveProvider` builds `ProviderRecord` field by field. A field missing there is
dropped on write, and one missing from `toConfig` is dropped on read — in both
cases the UI still reports success, because the save genuinely succeeded for every
field it knew about.

Hit for real by `defaultCacheControl`. The 4-file recipe in
[development](10-development.md) exists precisely for this and was still missed;
the only reliable check is reading the record back out of IndexedDB.

## UI / overlays

### A dialog opened from the preview modal is invisible

Stacking order. The preview is now a shadcn `Dialog` like every other overlay, and
Base UI portals mount in the order the dialogs open — so the save and purge
dialogs, opened from inside the preview, land *after* it in the portal order and
paint above it. The transfer toasts are `z-60`, above the whole Dialog layer
(`z-50`), so a running transfer stays visible over an open dialog.

Do not reach for a native `<dialog>` + `showModal()` here: it joins the top layer,
which beats every z-index and puts the preview *above* dialogs opened from it.
That was tried and reverted.

### Dialog content overflows its own box

Two independent causes, and the purge dialog hit both at once.

*Sideways:* `DialogContent` is a grid, and a grid item defaults to
`min-width: auto`, so a wide `<pre>` stretches the track past the dialog instead
of scrolling inside it. Add `min-w-0` to the wrapping column — **and** to every
column between it and the `<pre>`. One missing `min-w-0` anywhere in that chain
re-opens the whole thing.

*Downwards:* `DialogContent` has no height cap of its own. A dialog that grows
with its content (a purge command block, a list of notes) runs off the top and
bottom of the viewport, taking its footer buttons with it, because the popup is
centred with `top-1/2 -translate-y-1/2`. Add `max-h-[85vh] overflow-y-auto`.

The X button is `absolute` inside that scroll container, so on a long dialog it
scrolls out of view — which is why every dialog here also has an explicit
Close/Cancel in its footer.

Prose is what makes a dialog tall in the first place. Long "how to find your API
token" instructions belong in a `Popover` behind a `?` (`LabelWithHelp` in
`src/routes/browse.tsx`), not inline.

## Relations

- `troubleshoots` → [text-editing](06-text-editing.md), [cdn-purge](07-cdn-purge.md), [s3-client](03-s3-client.md), [browsing](04-browsing.md), [transfers](05-transfers.md), [provider-vault](02-provider-vault.md), [cache-control](11-cache-control.md)
- `depends-on` → [caching-layers](08-caching-layers.md)
