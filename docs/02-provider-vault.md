---
id: provider-vault
type: subsystem
owns: src/lib/providers.ts, src/lib/crypto.ts, src/lib/idb.ts, src/routes/providers.tsx
---

# Provider vault

Local, encrypted storage for provider credentials and app preferences.

## IndexedDB schema

Database `s3-multi-control-room`, version `1` (`src/lib/idb.ts`).

| Store | keyPath | Holds |
|---|---|---|
| `providers` | `id` | One `ProviderRecord` per configured provider |
| `meta` | `key` | `app-encryption-key`, `active-provider-id`, `recent-bucket:<providerId>` |
| `transfers` | `id` | `TransferRecord` history — see [transfers](05-transfers.md) |

`idb.ts` exposes `idbGet` / `idbGetAll` / `idbPut` / `idbDelete` / `idbClear` over
a single memoized `openDatabase()` promise. Bumping `DB_VERSION` requires
extending `onupgradeneeded`.

## Encryption

`src/lib/crypto.ts`. AES-GCM, 256-bit, random 12-byte IV per value.

The key is generated with `crypto.subtle.generateKey(..., extractable: false, ...)`
and the **`CryptoKey` object itself is stored in IndexedDB** under `meta` /
`app-encryption-key`. IndexedDB can structured-clone a non-extractable
`CryptoKey`, so the raw key bytes are never serialized and never readable from
JS — but they also cannot be exported, backed up, or moved to another browser.

Serialized form of an encrypted value: `JSON.stringify({ iv, ciphertext })`, both
base64.

### Threat model — read this before relying on it

This protects against *casual inspection* of IndexedDB. It does **not** protect
against code running on the origin: any XSS can call `decryptSecret` with the same
key. There is no passphrase and no key derivation, deliberately — a passphrase
would need to be re-entered every session, which the no-backend product shape
makes annoying rather than secure.

Consequences to state plainly to users:
- Clearing site data destroys the vault permanently.
- The vault does not sync between browsers or profiles.
- Anyone with access to the unlocked browser profile has the credentials.

## Types

`src/lib/types.ts`:

- `ProviderConfig` — the in-memory, **decrypted** shape. This is what `lib/s3.ts`
  and `lib/cdn.ts` consume.
- `ProviderRecord` — the at-rest shape: same minus
  `accessKeyId` / `secretAccessKey` / `cloudflareApiToken`, plus
  `accessKeyIdEncrypted` / `secretAccessKeyEncrypted` / `cloudflareApiTokenEncrypted`.
- `ProviderDraft` — `ProviderConfig` with optional `createdAt`, for saves.

Fields: `id`, `name`, `type` (`aws | r2 | custom`), `endpoint`, `region`,
`accessKeyId`, `secretAccessKey`, `buckets`, `defaultBucket`, `forcePathStyle`,
`cloudFrontDistributionId`, `cloudflareZoneId`, `cloudflareApiToken`,
`publicBaseUrl`, `createdAt`, `lastUsedAt`.

`publicBaseUrl` is the public CDN origin serving the bucket (e.g.
`https://cdn.example.com`). It exists so a save can purge one file instead of a
whole zone.

It is also what lets the generated Cloudflare purge command target one file
instead of the whole zone. See [cdn-purge](07-cdn-purge.md).

## API — `src/lib/providers.ts`

| Function | Behaviour |
|---|---|
| `listProviders()` | All providers, decrypted, newest `createdAt` first |
| `getProvider(id)` | One provider, decrypted |
| `saveProvider(draft)` | Trims + encrypts + writes; sets active provider if none is set; returns the decrypted config |
| `removeProvider(id)` | Deletes; clears active pointer if it pointed here |
| `getActiveProviderId()` / `setActiveProviderId(id)` | `meta` pointer |
| `touchProvider(id)` | Refreshes `lastUsedAt` |
| `getRecentBucket(id)` / `setRecentBucket(id, bucket)` | Per-provider last bucket |

`saveProvider` is a full replace, not a patch: it rebuilds the whole record from
the draft. **Passing a partial draft silently drops fields.** Always spread the
existing provider (`{ ...provider, changedField, createdAt: provider.createdAt }`).

`saveProvider` normalizes `publicBaseUrl` by stripping trailing slashes, so URL
construction downstream can assume no trailing slash.

## Provider resolution in `/browse`

`src/routes/browse.tsx` picks the provider in this order:

1. `search.providerId` from the URL
2. the stored active provider id
3. the first provider in the list

and the bucket:

1. `search.bucket`
2. `provider.defaultBucket`
3. the stored recent bucket
4. the first bucket returned by `listBuckets`

Effects then write the resolved values back into the URL with `replace: true`, so
a bare `/browse` self-heals into a fully-qualified location.

## Public domains

`publicBaseUrl` is the provider-wide origin visitors load objects from.
`bucketDomains` (bucket name → origin) overrides it per bucket, which is the
common case when one account serves several buckets on different domains.

`publicBaseUrlFor(provider, bucket)` in `src/lib/cdn.ts` resolves the pair —
bucket domain first, provider default second — and every consumer goes through
it: `cdnUrlForKey`, `buildObjectUrl` (so **Copy URL** shares the real domain,
not the endpoint URL) and the purge-command builder. Both are edited on the
providers page; `saveProvider` trims them and drops empty entries, so a blank
input never persists as a domain with no origin.

`cloudflareZoneId` and `cloudflareApiToken` are also editable there. The token
is encrypted like the access keys (`cloudflareApiTokenEncrypted`); storing them
on the provider is what lets the purge command arrive pre-filled instead of
carrying `<ZONE_ID>` / `<API_TOKEN>` placeholders.

**Adding a provider field means touching three places**: the type in
`src/lib/types.ts`, *and* both directions in `src/lib/providers.ts`
(`toConfig` and the `ProviderRecord` built by `saveProvider`). That mapping is
an explicit whitelist — a field added only to the type is silently dropped on
save.

## Relations
 
- `constrained-by` → [product](00-product.md) — no backend is why this is client-side
- `feeds` → [s3-client](03-s3-client.md) — `ProviderConfig` is the client's only input
- `feeds` → [cdn-purge](07-cdn-purge.md) — holds the CloudFront/Cloudflare credentials
- `extended-by` → [development](10-development.md) — checklist for adding a provider field
