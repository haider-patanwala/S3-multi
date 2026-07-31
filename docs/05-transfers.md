---
id: transfers
type: subsystem
owns: src/lib/transfers.ts, src/routes/transfers.tsx
---

# Transfers

## Record

`TransferRecord` (`src/lib/types.ts`): `id`, `kind` (`upload | download`),
`status` (`queued | running | paused | failed | completed`), `providerId`,
`bucket`, `key`, `fileName`, `totalBytes?`, `transferredBytes`, `errorMessage?`,
`resumeSupported?`, `createdAt`, `updatedAt`.

Persisted in the IndexedDB `transfers` store, so history survives reload.

## Dual write

Every progress tick goes through `syncTransfer` in `src/routes/browse.tsx`, which
does two things:

1. `updateTransferCache` — `queryClient.setQueryData(["transfers"], ...)` for
   instant UI
2. `saveTransfer` — writes to IndexedDB for durability

Progress callbacks are throttled to ~160 ms (`performance.now()` gate), with the
final tick always allowed through, so IndexedDB is not hammered on a fast upload.

## Upload

`uploadObject` uses `@aws-sdk/lib-storage`'s `Upload`: 8 MiB parts, `queueSize: 3`,
`leavePartsOnError: false`. Progress comes from the `httpUploadProgress` event.

Content type precedence: explicit override → `file.type` → `resolveObjectContentType(key)`.

**Replace** uses `keyForReplacement(targetKey, incomingFileName)`, which keeps the
target's directory and base name but adopts the incoming file's extension. So
replacing `docs/notes.txt` with `readme.md` writes `docs/notes.md` — a *new* key,
leaving the old object in place. That is deliberate (the extension must match the
bytes) and surprising; expect it.

## Download

`downloadObject` heads the object for `ContentLength` and `AcceptRanges`, gets the
body, streams it through `bodyToBlob` for progress, and returns
`{ blob, contentType, totalBytes, resumeSupported, etag }`. The route then creates
a blob URL, clicks a synthetic `<a download>`, and revokes the URL.

The whole object is buffered in memory. Downloading a file larger than available
memory will fail. There is no streaming-to-disk path.

## Status truth

`resumeSupported` reflects only whether the server advertises `Accept-Ranges:
bytes`. **Nothing in the app resumes anything.** `paused` and `queued` exist in the
type but are never set by any code path — an interrupted transfer becomes `failed`.

Do not build UI that promises resume until a resume path exists.

## History management

`src/lib/transfers.ts`: `listTransfers` (newest `updatedAt` first),
`saveTransfer`, `deleteTransfer`, `clearCompletedTransfers`, `clearAllTransfers`.

`/transfers` renders the history as shadcn `Card`s with a `Progress` bar each;
`/browse` renders running transfers as a fixed `z-60` stack of the same cards in
its bottom-right corner.

## Relations

- `depends-on` → [s3-client](03-s3-client.md), [provider-vault](02-provider-vault.md) (IndexedDB layer)
- `sibling-of` → [text-editing](06-text-editing.md) — both write objects, but edits are not tracked as transfers
