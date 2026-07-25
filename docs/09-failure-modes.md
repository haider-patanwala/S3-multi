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
   whether anything sits in front of the endpoint.
3. **Query cache.** If the listing shows a stale size but reopening the file
   shows the new content, a mutation forgot to invalidate. See
   [caching-layers](08-caching-layers.md).

### Save wipes an object's Cache-Control or custom metadata

`PutObject` replaces all metadata. `putObjectText` heads the object first and
carries `CacheControl`, `ContentDisposition`, `ContentLanguage`, and `Metadata`
forward. If metadata is disappearing, that head is failing (silently — it is
`.catch(() => undefined)`) or a new caller is issuing `PutObject` directly instead
of going through `putObjectText`.

### Save succeeds but end users still see the old file

The CDN edge cache — layer ④. In-app auto-purge only runs for AWS
(`canPurge(provider)`). For R2 the save reports `"CDN not purged — open Purge
cache for the command to run."` — run it. See [cdn-purge](07-cdn-purge.md).

### Saved file is truncated or garbled with non-ASCII content

Should not happen: the SDK computes `Content-Length` via
`TextEncoder().encode(body).byteLength`. If it does, something replaced the string
body with a manual length calculation.

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

## Relations

- `troubleshoots` → [text-editing](06-text-editing.md), [cdn-purge](07-cdn-purge.md), [s3-client](03-s3-client.md), [browsing](04-browsing.md), [transfers](05-transfers.md), [provider-vault](02-provider-vault.md)
- `depends-on` → [caching-layers](08-caching-layers.md)
