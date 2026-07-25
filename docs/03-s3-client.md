---
id: s3-client
type: subsystem
owns: src/lib/s3.ts
---

# S3 client

Every request to object storage goes through `src/lib/s3.ts`. Nothing else
constructs an `S3Client`.

## Client construction — `createClient(provider)`

```ts
new S3Client({
  region:         r2 ? (provider.region || "auto") : (provider.region || "us-east-1"),
  endpoint:       provider.endpoint || undefined,
  forcePathStyle: r2 ? true : custom ? Boolean(provider.forcePathStyle) : false,
  credentials:    { accessKeyId, secretAccessKey },
})
```

Per-provider decisions:

| Provider | region | forcePathStyle | endpoint |
|---|---|---|---|
| `aws` | provider region, else `us-east-1` | `false` (virtual-hosted) | none |
| `r2` | provider region, else `auto` | **always `true`** | required: `https://<account>.r2.cloudflarestorage.com` |
| `custom` | provider region, else `us-east-1` | operator's choice | required |

A new client is constructed per call. That is cheap (no connection pooling in the
browser) and keeps credential changes from going stale. Do not add a module-level
client cache without keying it on the full credential set.

### Never set a fetch `cache` mode here

A `requestHandler: { cache: "no-store" }` was added once to force fresh reads and
**broke every request** with an opaque `Failed to fetch`. Do not re-add it.

Per the Fetch spec, cache modes `no-store` and `reload` make the browser append
`Pragma: no-cache` and `Cache-Control: no-cache` **request** headers (`no-cache`
mode appends `Cache-Control: max-age=0`). Verified:

```
default    extra headers vs default: (none)
no-store   extra headers: pragma: no-cache | cache-control: no-cache
reload     extra headers: pragma: no-cache | cache-control: no-cache
no-cache   extra headers: cache-control: max-age=0
```

Neither `Pragma` nor `Cache-Control` is a CORS-safelisted request header, so both
land in the preflight's `Access-Control-Request-Headers`. Any bucket whose CORS
policy enumerates `AllowedHeaders` rather than using `"*"` then fails the
preflight, and the real request is never sent.

It was also unnecessary. RFC 9111 §4.4 requires a cache to invalidate its stored
response for a URI after a successful unsafe method, so the `PutObject` in
`putObjectText` already evicts the stale `GET` before the read-back runs — the
save-verification guarantee holds without it.

If stale *listings* ever appear, bust them with a cache-busting query parameter
added in a middleware before signing (changes the cache key, adds no headers),
never with a fetch cache mode.

## Operations

| Function | Command(s) | Notes |
|---|---|---|
| `testConnection` | `HeadBucket` | Only meaningful with a `defaultBucket`; otherwise returns an advisory message |
| `listBuckets` | `ListBuckets` | Swallows CORS-shaped errors and falls back to `[defaultBucket]` |
| `listObjects` | `ListObjectsV2` (`Delimiter: "/"`) | Returns folders (`CommonPrefixes`) then files, filtered by search, folders first |
| `createFolder` | `PutObject` with empty body and trailing `/` | S3 has no directories; this is a zero-byte marker |
| `deleteKeys` | `DeleteObject` (1 key) / `DeleteObjects` (many) | |
| `renameKey` | `CopyObject` + `DeleteObject` | Not atomic — a failure between the two leaves both copies |
| `headObject` | `HeadObject` | Metadata only |
| `previewObject` | `HeadObject` + `GetObject` | Returns a blob URL; **caller must `URL.revokeObjectURL`** |
| `getObjectText` | `GetObject` | Body decoded via `transformToString()` |
| `putObjectText` | `HeadObject` + `PutObject` + read-back | See [text-editing](06-text-editing.md) |
| `downloadObject` | `HeadObject` + `GetObject` | Streams with progress |
| `uploadObject` | `@aws-sdk/lib-storage` `Upload` | 8 MiB parts, queue 3, `leavePartsOnError: false` |

`bodyToBlob` (module-private) prefers `transformToWebStream` for progress
reporting and falls back to `transformToByteArray`.

`startMultipartUpload` issues a bare `CreateMultipartUploadCommand` and never
completes or aborts it. It is unused by the UI and leaks an incomplete multipart
upload if called. Treat it as dead code; delete it rather than build on it.

## Content types

`resolveObjectContentType(key, rawContentType?)` trusts a provided content type
unless it is absent or a generic octet-stream, then falls back to an
extension→MIME table. This is what makes R2 objects uploaded without a content
type still preview and edit correctly.

Paired helpers in `src/lib/utils.ts`:
`extensionForKey`, `isPreviewableKey`, `isEditableTextContentType`, `objectIcon`.

`isEditableTextContentType` gates the editor: `text/*` or a type containing
`yaml` / `yml` / `markdown` / `xml` / `json`.

## `buildObjectUrl`

Builds a *storage endpoint* URL for "copy link". For a provider with an endpoint
it returns `${endpoint}/${bucket}/${encodedKey}`; for AWS without one,
`https://${bucket}.s3.${region}.amazonaws.com/${key}`.

This is **not** the public CDN URL. It is not necessarily publicly readable, and
purging it is meaningless. The CDN URL is `provider.publicBaseUrl` + key, built by
`cdnUrlForKey` in `src/lib/cdn.ts`.

Known wart: both branches of the `forcePathStyle` check in `buildObjectUrl` return
the same string.

## CORS is a hard prerequisite

Every call is a cross-origin browser request. The bucket must allow the app's
origin. Minimum viable R2/S3 CORS policy:

```json
[{
  "AllowedOrigins": ["http://localhost:3000"],
  "AllowedMethods": ["GET", "HEAD", "PUT", "POST", "DELETE"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag", "Content-Length", "Content-Type", "Last-Modified"]
}]
```

Missing `PUT` breaks uploads and saves. Missing `ExposeHeaders: ETag` breaks
multipart uploads. `ListBuckets` against an account-level endpoint is frequently
CORS-blocked with no way to fix it — hence the `defaultBucket` fallback.

## Relations

- `consumes` → [provider-vault](02-provider-vault.md)
- `used-by` → [browsing](04-browsing.md), [transfers](05-transfers.md), [text-editing](06-text-editing.md)
- `explains` → [caching-layers](08-caching-layers.md)
- `troubleshot-by` → [failure-modes](09-failure-modes.md)
