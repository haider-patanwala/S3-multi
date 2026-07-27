---
id: cdn-purge
type: subsystem
owns: src/lib/cdn.ts, src/routes/browse.tsx:purgeMutation, src/routes/help.tsx (purge section)
---

# CDN purge

Invalidate the CDN in front of a bucket so viewers stop getting the pre-edit copy.

## API — `src/lib/cdn.ts`

| Export | Behaviour |
|---|---|
| `purgeCache(provider, keys?)` | Purge in-app. **AWS only** — throws for R2 with a pointer to the command. |
| `buildPurgeCommand(provider, keys?)` | Build a copy-pasteable terminal command. `undefined` for `custom`. |
| `cdnUrlForKey(provider, key)` | `publicBaseUrl` + per-segment-encoded key, or `undefined` if no `publicBaseUrl` |
| `canPurge(provider)` | Whether `purgeCache` can run in-app. Callers use it to decide whether to try at all. |

`canPurge` is true **only** for `aws` with a `cloudFrontDistributionId`. It is
false for `r2` even with full credentials — that is not an oversight, it is the
CORS wall below, and `cdn.check.ts` asserts it stays false so the save path never
tries. `custom` has no generic purge protocol at all.

## AWS — CloudFront

`CreateInvalidation` via `@aws-sdk/client-cloudfront`, reusing the provider's
existing access keys. Paths are `/${key}` when keys are supplied, `["/*"]`
otherwise.

Requirements and costs:

- The IAM principal needs `cloudfront:CreateInvalidation`.
- The first 1000 paths per month are free; beyond that AWS bills per path. `/*`
  counts as one path — so wildcard purges are cheaper, just blunter.
- Invalidation is asynchronous. `CreateInvalidation` returning success means
  *accepted*, not *complete*; propagation typically takes minutes. The app does
  not poll for completion.

**This path works from the browser with no proxy.** Verified:

```
$ curl -i -X OPTIONS https://cloudfront.amazonaws.com/2020-05-31/distribution/<id>/invalidation \
    -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: POST'

HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: authorization,x-amz-date,content-type
```

The CloudFront API answers preflights. Cloudflare's does not. That asymmetry is
the entire reason this page is complicated.

## Cloudflare R2 — and the CORS wall

**Cloudflare's API cannot be called from a browser.** This is measured, not
assumed:

```
$ curl -i -X OPTIONS https://api.cloudflare.com/client/v4/zones/<id>/purge_cache \
    -H 'Origin: http://localhost:3000' \
    -H 'Access-Control-Request-Method: POST'

HTTP/2 405
{"success":false,"errors":[{"code":7001,"message":"OPTIONS not supported for requested URI."}]}
```

No `Access-Control-Allow-Origin` header, and a 405 on the preflight. The purge
request carries `Authorization` and `Content-Type: application/json`, which makes
a preflight mandatory. The preflight can never succeed, so the request can never
be sent. No amount of client-side code fixes this.

### It is API-wide, and not configurable

Every endpoint behaves the same way — `400` or `405` on `OPTIONS`, and no
`Access-Control-*` header on real responses either:

| `OPTIONS` target | Result |
|---|---|
| `/client/v4/` | `400`, no CORS headers |
| `/client/v4/zones` | `400`, no CORS headers |
| `/client/v4/user/tokens/verify` | `400`, no CORS headers |
| `/client/v4/zones/<id>/purge_cache` | `405`, no CORS headers |

**There is no setting that changes this.** `api.cloudflare.com` is on a zone
Cloudflare owns; Transform Rules, Snippets, Page Rules, and Worker routes only
apply to zones in *your* account. No dashboard toggle, no API call, no support
request enables it.

It is a deliberate security posture: a browser-callable credential API means any
XSS can exfiltrate and use an API token.

The preflight-avoidance tricks are closed too. Making it a "simple request" (no
preflight) requires only CORS-safelisted headers, and `Authorization` is not one;
`mode: "no-cors"` strips it as well, so an authenticated fire-and-forget purge is
not possible either.

Conclusion: the request must originate somewhere that is not a browser. Hence the
approach below.

### The resolution: generate a command, let the operator run it

There is no client-side fix, and a proxy would reintroduce the server component
the product forbids ([product](00-product.md)). So the app stops pretending it can
purge R2 and instead builds the exact `curl` the operator runs themselves.

`buildPurgeCommand(provider, keys?)` in `src/lib/cdn.ts` returns:

```ts
type PurgeCommand = {
  command: string   // ready to paste into a terminal
  scope:   string   // what it will actually purge, in plain words
  notes:   string[] // missing fields, fallbacks taken
}
```

Properties that matter:

- **Nothing is transmitted.** The string is built locally; only the operator's
  terminal ever contacts Cloudflare.
- **Live form state, not saved state.** `/browse` rebuilds the command from the
  dialog inputs on every keystroke, so it is correct before Save is pressed.
- **Two scopes offered.** One command for the open file, one for everything.
- **Shell-quoted.** Credentials go into an operator's shell, so `shellQuote` does
  POSIX single-quoting (`'` → `'\''`). A quote in a token cannot terminate the
  string and chain a command. Verified in `cdn.check.ts` by expanding the built
  argument through a real `/bin/sh` and comparing it to the input.
- **Placeholders, never a broken command.** A missing zone or token yields
  `<ZONE_ID>` / `<API_TOKEN>` plus a note, not a malformed line.

Verified end to end: a generated command with a deliberately invalid token,
executed for real, returns
`{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}` —
which only a well-formed request reaching Cloudflare's auth check can produce.

### Why not a proxy

Earlier revisions shipped a Vite dev proxy (`/__cf`) and a Cloudflare Worker CORS
shim. Both worked. Both were removed: the dev proxy only functioned under
`pnpm dev`, and the Worker required deploying and maintaining a server component
for a tool whose entire premise is not having one. A copy-paste command has no
deployment, no failure mode, and no attack surface.

If you later want automation back, the Worker approach is in git history — but
prefer the `Cache-Control` route below, which removes the need entirely.

### The no-proxy alternative

Purge exists to fix a stale edge copy. Writing a short `Cache-Control` (e.g.
`max-age=60, must-revalidate`) onto files you actively edit makes the edge
revalidate on its own and removes the need to purge them at all — fully
client-side. The tradeoff is edge hit rate on those objects. `putObjectText`
already **preserves** whatever `Cache-Control` an object has; it deliberately does
not invent one, because cache policy on an operator's objects is their call. Not
currently exposed in the UI.

### Single-file vs whole-zone

Cloudflare's `purge_cache` takes either `{ files: [<absolute URLs>] }` or
`{ purge_everything: true }`. Single-file purge therefore needs the **public** URL,
not the R2 S3-API URL — which is why `ProviderConfig.publicBaseUrl` exists.

`buildCloudflareCommand` emits `{ files }` only when every requested key resolved
to a URL; if any did not, it falls back to `purge_everything` **and pushes a note
saying so**, rather than quietly doing something bigger than asked. Without
`publicBaseUrl` set, every command is a whole-zone purge and `scope` says so in
capitals.

Set `publicBaseUrl` to the domain your visitors actually load objects from.
Getting it wrong means the purge succeeds against URLs nobody requests, and the
stale copy stays cached.

## Credentials and UI

The purge dialog lives in `/browse` (`purgeOpen` in `src/routes/browse.tsx`) and
collects, per provider type: CloudFront Distribution ID (AWS), Zone ID + API Token
(R2), and Public CDN URL (both). Below the fields it renders the generated
command(s) with a Copy button, the scope line, and any notes.

`purgeMutation` takes `{ purge?: boolean }`. Saving settings and purging are now
separate acts — R2 can never purge in-app, so **Save settings** has to stand on
its own for the command builder to have credentials to work with. **Save & purge
now** appears for AWS only. The API token is encrypted at rest like any other secret
(`cloudflareApiTokenEncrypted`) — see [provider-vault](02-provider-vault.md).

Cloudflare token scope: `Zone · Cache Purge` on the relevant zone. Zone ID comes
from the Cloudflare dashboard → domain → Overview → API panel.

## After a save

`saveTextMutation` branches on `canPurge(provider)` after a verified write:

- **AWS** — purges the edited key in-app. Failure is caught and folded into the
  success message (`"Saved, but the CDN purge failed: …"`). A stale CDN is not a
  failed save, and conflating them would make the operator re-edit a file that is
  already correct.
- **R2 with purge credentials configured** — reports
  `"CDN not purged — open Purge cache for the command to run."` The app cannot
  purge, so it says so instead of silently leaving a stale edge copy.
- **Anything else** — nothing; there is no CDN configured to purge.

Deletes, renames, uploads, and replaces neither purge nor prompt. That is a gap,
not a decision.

## Relations

- `constrained-by` → [product](00-product.md) — no-backend is the entire reason for the CORS wall
- `consumes` → [provider-vault](02-provider-vault.md)
- `triggered-by` → [text-editing](06-text-editing.md)
- `explained-by` → [caching-layers](08-caching-layers.md)
- `troubleshot-by` → [failure-modes](09-failure-modes.md)
