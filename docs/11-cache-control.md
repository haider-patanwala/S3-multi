---
id: cache-control
type: subsystem
owns: src/lib/cache-control.ts, src/lib/s3.ts:putObjectText, src/lib/s3.ts:uploadObject, src/routes/browse.tsx:saveTextMutation
---

# Cache-Control

Two opposite requirements meet here, and conflating them is the trap this page
exists to prevent:

| Requirement | Applies to | Mechanism |
|---|---|---|
| **Objects must cache at the CDN edge** — otherwise every viewer costs a Class B operation plus egress | the object's *stored* `Cache-Control` | `PutObject`'s `CacheControl` param |
| **This app must always read the current bytes** — a stale read corrupts an edit | *one HTTP response* to this browser | `GetObject`'s `ResponseCacheControl` param |

They do not fight. The first is metadata written onto the object and served to
everyone. The second is a per-request override that changes only the response
this browser just received. Setting a one-year TTL and always reading fresh are
simultaneously true.

## Writing cache headers

`src/lib/cache-control.ts` holds the vocabulary:

- `CACHE_PRESETS` — four presets (`immutable` 1 year, 1 day, 5 minutes, `no-store`), each with a `hint` explaining when it applies.
- `suggestCacheControl(key)` — the default when nothing is configured. Media, fonts and archives get `max-age=31536000, immutable`; everything else gets `max-age=300, must-revalidate`.
- `maxAgeOf(cc)` / `isCached(cc)` — parse the header. `s-maxage` wins over `max-age` because a CDN edge *is* a shared cache. `no-store` and `no-cache` both return 0.
- `describeCacheControl(cc)` — the human sentence shown in the save drawer.

### Why editable text does not get a long TTL

`suggestCacheControl` deliberately splits on file type. Text is what this app
rewrites **in place under the same name**, so an `immutable` TTL strands the old
bytes at the edge until someone purges. Media is where the bandwidth savings
actually are and it is rarely edited. A single global default would have to pick
one failure mode; the split avoids both.

A provider-level `defaultCacheControl` overrides the suggestion when set.

### Where it is applied

| Path | Value used |
|---|---|
| `uploadObject` | `cacheControl` arg → `provider.defaultCacheControl` → `suggestCacheControl(key)` |
| `putObjectText` | explicit arg → the object's **existing** header |
| Replace-file flow (`browse.tsx`) | `provider.defaultCacheControl` — a replace is a new object under an old name, so it does not inherit |

`putObjectText` falling back to the existing header is what keeps
[invariant 6](index.md) true: an overwrite never invents or drops metadata.

## The save drawer

`saveTextMutation` no longer fires on the Save button. The button opens a dialog
(`saveOpen` / `saveCacheControl` in `src/routes/browse.tsx`) which shows:

1. The header currently stored on the object (`preview.cacheControl`, read from the `HeadObject` in `previewObject`).
2. Presets plus a free-text field, pre-filled with **the object's existing header** → provider default → suggestion. Pre-filling from the object means the common case is one click and the header never changes silently.
3. `describeCacheControl(...)` in plain language.
4. The shell purge command for that exact key, from `buildPurgeCommand(provider, [key])`.

The purge block only renders when `isCached(existing) || isCached(chosen)`. An
object nobody caches needs no purge, and offering one implies a staleness risk
that does not exist.

On AWS the save also runs the invalidation in-app; the command is still shown for
scripting and for when the in-app call fails. On R2 the command is the only route
— see [cdn-purge](07-cdn-purge.md) for why.

## Reading fresh — `ResponseCacheControl`

Every read of object *content or metadata* sends `ResponseCacheControl: "no-cache"`:
`getObjectText`, `previewObject`, `headObject`, `downloadObject`.

This is load-bearing, not defensive. See
[caching-layers](08-caching-layers.md#-browser-http-cache) for the measurement
and the reason the previously-documented RFC 9111 §4.4 argument does not hold.

Why this parameter and not a fetch cache mode: `response-cache-control` is a real,
**signed** S3 query parameter. It changes the response's headers without adding
anything to the CORS preflight. `cache: "no-store"` appends non-CORS-safelisted
*request* headers and breaks every request — see [s3-client](03-s3-client.md).

`ListObjectsV2` has no equivalent parameter. Listing freshness is TanStack Query's
job (layer ② in [caching-layers](08-caching-layers.md)).

### Rejected: a global cache-busting middleware

An earlier attempt added a unique `x-cache-bust` query param to every `GET`/`HEAD`
via a `build`-step middleware. It was signed and it did defeat the cache — and it
**broke bucket listing entirely**: `ListObjectsV2` returned an empty result, so the
browser showed "This folder is empty" with no error. Reverted.

If a cache-busting param is ever needed again, scope it to `GetObject`/`HeadObject`
by command, never to every request through `createClient`.

## Ceilings

- No way to set `Cache-Control` on an existing object without editing its content — there is no metadata-only edit path (S3 needs `CopyObject` with `MetadataDirective: REPLACE`).
- No bulk "apply this header to every object under this prefix".
- `maxAgeOf` does not parse `stale-while-revalidate` or `stale-if-error`.
- The preset list is not user-editable; `defaultCacheControl` free text is the escape hatch.

## Relations

- `depends-on` → [s3-client](03-s3-client.md)
- `explained-by` → [caching-layers](08-caching-layers.md)
- `triggers` → [cdn-purge](07-cdn-purge.md)
- `used-by` → [text-editing](06-text-editing.md), [transfers](05-transfers.md)
- `configured-in` → [provider-vault](02-provider-vault.md)
- `troubleshot-by` → [failure-modes](09-failure-modes.md)
