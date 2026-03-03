# S3 Multi

Client-only React app for managing multiple S3-compatible providers from the browser. The product direction comes from [PRD.md](./PRD.md): AWS S3, Cloudflare R2, and custom S3 endpoints, with credentials stored locally instead of sent through a backend.

The previous `README.md` was still the default TanStack example. This repo is now an S3 browser and transfer workspace built with React, TypeScript, Vite, TanStack Router, TanStack Query, and the AWS SDK v3.

## Current App Scope

The current implementation already includes:

- Local provider vault in IndexedDB
- AES-GCM encryption for stored access keys and secrets
- Provider switching across AWS S3, R2, and custom S3 endpoints
- Bucket selection with manual entry fallback when account-level listing is blocked by CORS
- Prefix-based object browsing with list and grid views
- File upload, replace, rename, delete, download, and folder creation
- Preview support for image, video, text, JSON, and similar text-like files
- Persisted transfer history for uploads and downloads

The PRD also describes broader MVP goals such as richer resumable transfer controls, pause/resume flows, and more advanced queue behavior. Those are useful roadmap references, but they are not all exposed in the current UI yet.

## Tech Stack

- React 19
- TypeScript
- Vite
- TanStack Router
- TanStack Query
- TanStack Virtual
- AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`)
- Tailwind CSS v4
- Biome

## Routes

- `/browse` object browser and main workspace
- `/providers` provider creation, testing, activation, and deletion
- `/transfers` persisted upload/download ledger

## Getting Started

Install dependencies:

```sh
bun install
```

Start the dev server:

```sh
bun run dev
```

Build the app:

```sh
bun run build
```

If you prefer npm:

```sh
npm install
npm run dev
```

## Provider Support

### AWS S3

- `region` required
- `endpoint` optional
- `defaultBucket` optional but recommended when bucket listing is restricted by CORS

### Cloudflare R2

- `endpoint` required
- `region` optional
- Path-style access is handled automatically for the client configuration

### Custom S3

- `endpoint` required
- `region` optional
- `forcePathStyle` available for MinIO and similar providers

## Security Model

- No backend, proxy, or user accounts
- Credentials stay in the browser
- Provider secrets are encrypted before being written to IndexedDB
- The app uses direct S3-compatible API requests from the browser
- Production use should be HTTPS-only

Important limitation: browser access still depends on the target bucket and endpoint allowing the required CORS and object operations.

## Local Storage

IndexedDB stores:

- provider profiles
- encrypted secrets
- active provider selection
- recent bucket per provider
- transfer history metadata

The database name in the current implementation is `s3-multi-control-room`.

## Common Workflows

1. Open `/providers` and add a provider profile.
2. Use `Test connection` before saving.
3. Switch to `/browse`, choose a provider and bucket, then navigate by prefix.
4. Upload files with the picker or drag and drop.
5. Preview, rename, replace, delete, download, or copy a direct object URL where available.
6. Open `/transfers` to review persisted transfer history.

## CORS and Bucket Access Notes

- Bucket suggestions can be empty even when credentials are valid.
- Manual bucket entry is supported for that case.
- Account-level `ListBuckets` is commonly blocked in browser-only environments.
- Setting a `defaultBucket` is the most reliable setup for restrictive providers.

## Documentation

- Product requirements: [PRD.md](./PRD.md)
- End-user instructions: [USER_GUIDE.md](./USER_GUIDE.md)

## Project Structure

```text
src/
  components/   shell and layout
  lib/          IndexedDB, crypto, provider, transfer, and S3 helpers
  routes/       browse, providers, transfers
```
