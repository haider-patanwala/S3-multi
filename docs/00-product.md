---
id: product
type: concept
owns: README.md, PRD.md, USER_GUIDE.md
---

# Product

## What it is

A browser-only control room for S3-compatible object storage. One app, many
providers: AWS S3, Cloudflare R2, and any custom S3-compatible endpoint. Browse
buckets, move files, edit text files in place, and purge the CDN in front of them.

## Who it is for

An operator who already holds the credentials — a developer or ops engineer
managing their own buckets. Not a multi-tenant SaaS, not an end-user file share.
There is no sign-up, no account, no sharing model, and no permission system
beyond whatever the IAM/API keys already grant.

## Hard constraints

These are load-bearing. Do not "improve" past them without an explicit decision.

| Constraint | Consequence |
|---|---|
| **No backend, no proxy, no server-side code** | Every API call is a cross-origin browser request, so every provider must be CORS-configured. Anything a browser cannot call directly cannot be a feature. |
| **No user accounts** | Credentials are per-browser-profile. Clearing site data destroys the vault. |
| **Credentials stay client-side** | They are AES-GCM encrypted in IndexedDB and used to sign requests in the browser. See [provider-vault](02-provider-vault.md). |
| **Static deployable** | `vite build` output must work on any static host. Anything that needs the dev server is a dev-only affordance and must say so out loud. |

The one place these constraints actively break a feature is Cloudflare cache
purge — see [cdn-purge](07-cdn-purge.md).

## Capabilities

- Provider vault with switching between AWS S3 / R2 / custom endpoints
- Prefix-based bucket browsing, list and grid views, virtualized rows
- Upload, replace, rename, delete, download, create folder
- Preview: images, video, and text-like files
- **Edit-in-place** for text files (markdown, JSON, YAML, XML, CSV, plain text)
- **CDN purge**: CloudFront invalidation, Cloudflare zone/file purge
- Persisted transfer history

## Non-goals

Multi-user access control, server-side thumbnailing, bucket lifecycle/policy
editing, cross-provider sync, versioning UI, and anything requiring a server.

## Relations

- `elaborated-by` → [architecture](01-architecture.md)
- `constrains` → [cdn-purge](07-cdn-purge.md) — the no-backend rule is why Cloudflare purge needs a proxy
- `constrains` → [provider-vault](02-provider-vault.md) — why credentials live in IndexedDB
