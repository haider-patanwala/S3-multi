---
id: deployment
type: operations
owns: index.html, vite.config.js, src/main.tsx:secure-context-guard
---

# Deployment

`npm run build` produces a self-contained static bundle in `dist/`. No server,
no compute, no runtime environment variables — it can be hosted from any
S3-compatible bucket. Three requirements make that actually work; all three
have bitten someone already.

## The three hard requirements

### 1. HTTPS is mandatory — an S3 *website* endpoint alone will not do

The vault encrypts with the Web Crypto API, and browsers only expose
`crypto.subtle` in a **secure context**. `crypto.randomUUID` and
`navigator.clipboard` are the same. The S3 static-website endpoint
(`bucket.s3-website-<region>.amazonaws.com`) serves **HTTP only**, so on it the
app cannot store a provider at all.

`src/main.tsx` checks `window.isSecureContext` before mounting and renders a
plain "this app needs HTTPS" page instead of dying with a `TypeError` inside
the vault. If you see that page, the deployment is wrong, not the app.

Put a CDN with TLS in front: CloudFront for S3, Cloudflare for R2, or any
reverse proxy. `localhost` is also a secure context, so local use is fine.

### 2. Client-side routes need an index.html fallback

`/browse`, `/edit`, `/providers`, `/transfers` and `/help` exist only in the
router. A deep link or a refresh asks the bucket for a key that is not there
and gets **404**. (Measured, not assumed: serving `dist/` without a fallback
returns 200 for `/` and 404 for `/browse`.)

- **S3 website hosting** — set both index document and error document to
  `index.html`. Works, but the response still carries HTTP 404.
- **CloudFront** (preferred) — add custom error responses mapping **403 and
  404 → `/index.html` with response code 200**. Use this with an origin access
  control and a private bucket; it also gives you TLS from requirement 1.
- **Cloudflare / R2** — enable SPA-style rewrite, or a Transform Rule serving
  `/index.html` for non-asset paths.

### 3. Assets are served from the domain root

`vite.config.js` sets `base: "/"`. Hosting the bundle under a path prefix (a
subfolder, `/app/`) requires changing that to the prefix and rebuilding.
Relative `"./"` is **not** a fix — a deep route like `/browse` is served
index.html and would resolve assets against `/browse/`.

## Security headers

The bundle ships a `Content-Security-Policy` in a `<meta>` tag (`index.html`),
because a static bucket has no server to set headers. Notes on why it looks
loose in places:

| Directive | Why |
|---|---|
| `connect-src https:` | The storage endpoint is user-configured. The host set is unknowable, so this blocks cleartext and `ws:` and nothing more. |
| `style-src 'unsafe-inline'` | Base UI positions popups by writing inline `style` attributes. |
| `img-src`/`media-src blob:` | Object previews are blob URLs. |
| `script-src 'self'` | No inline scripts in the build. This is the directive that matters. |

**`frame-ancestors` cannot be set from a meta tag.** Set these at the CDN:

```
Content-Security-Policy: frame-ancestors 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), camera=(), microphone=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
```

On CloudFront these belong in a Response Headers Policy; on Cloudflare, in a
Transform Rule. `X-Frame-Options: DENY` is worth adding for older browsers.

## Bucket settings

- `Cache-Control: no-cache` on `index.html` — it names the hashed asset files,
  so a cached copy pins users to an old build.
- `Cache-Control: public, max-age=31536000, immutable` on `/assets/*` — those
  filenames already carry a content hash.
- **The bucket serving the app must be public-read** (or private behind a
  CloudFront OAC). Do not reuse a bucket that holds objects you manage with
  this tool unless you intend both to be public.
- S3 does not compress on the fly. Upload pre-compressed assets with an
  explicit `Content-Encoding: gzip`/`br`, or let CloudFront compress.

## CORS on the buckets you *manage*

Separate from hosting: every bucket this app browses needs a CORS rule
allowing your app's origin, because the browser talks to the storage API
directly. See [s3-client](03-s3-client.md) § CORS.

A bucket reached over `http://` (a self-hosted MinIO, say) will be blocked as
mixed content once the app itself is on HTTPS. Terminate TLS in front of MinIO
too.

## Browser support

`vite.config.js` sets `build.target` to **Chrome 111 / Edge 111 / Firefox 128 /
Safari 16.4**. That floor comes from CSS, not JavaScript: the theme is written
in `oklch()` (Chrome 111, Safari 15.4, Firefox 113) and the UI kit uses
`:has()`, `@container` and `@property` (Firefox 128). Lowering the JS target
below this produces a bundle that runs and renders wrong, which is worse than
one that refuses to build.

Two features degrade rather than break: `field-sizing-content` (auto-growing
textareas, Chrome only) and `scrollbar-gutter` (Safari 18.2+).

## Verifying a deployment

```bash
npm run build
npx serve -s dist          # -s gives the index.html fallback S3 needs configured
```

Then check, in the deployed environment:

1. A hard refresh on `/browse` returns the app, not a 404.
2. The page is on HTTPS and does *not* show the "needs HTTPS" notice.
3. Adding a provider and listing a bucket works — that exercises WebCrypto,
   IndexedDB and CORS in one action.

## Relations

- `operates` → [architecture](01-architecture.md)
- `depends-on` → [provider-vault](02-provider-vault.md), [s3-client](03-s3-client.md)
- `refines` → [development](10-development.md)
