## 1) Product
Client-only React + TanStack web app to manage multiple S3-compatible providers (AWS S3, Cloudflare R2, and “Custom S3”). Users add provider configs (access key, secret, region, endpoint, bucket). Credentials remain in the user’s browser.

## 2) Core user flows
1. Add provider → test connection → save locally  
2. Select provider + bucket → browse objects by prefix  
3. Upload files (resumable) → monitor queue → retry/pause/resume  
4. Preview supported media → download/share/copy key/url (optional)  
5. CRUD: create folder, rename (copy+delete), delete, replace, move/copy  

## 3) Scope (MVP)
### Provider management
- Create / edit / delete provider config.
- Provider selection UI: dropdown (header) + manage screen.
- Support provider types:
  - AWS S3: region required, endpoint optional (default AWS).
  - Cloudflare R2: endpoint required, region optional.
  - Custom S3: endpoint required, region optional, forcePathStyle toggle.
- “Test connection” button (list buckets or head bucket).

### Bucket + object browser
- Bucket picker (if bucket not pinned in provider config).
- List objects with prefix + delimiter “/” for folder simulation.
- Views: list + grid (grid shows thumbnails for previewable types).
- Actions per item: preview (if supported), download, rename, delete, copy key, copy URL (if available).
- Bulk selection + bulk delete and bulk download (optional zip later; MVP can do sequential downloads).

Got it—set “resume downloads” to **best-effort** (resume if possible via HTTP Range, otherwise restart). This is consistent with enforcing encrypted-in-transit HTTPS and not doing anything that requires server-side help like signed streaming proxies. 

### Downloads (replace section)
- Single file download from S3-compatible provider using `GetObject`.
- Show progress when `Content-Length` is available; if not, show indeterminate progress.  
- **Best-effort resume**:
  - If the browser + provider supports `Range` requests and the response includes `Accept-Ranges: bytes`, resume by requesting `Range: bytes=<downloaded>-`.  
  - Otherwise restart from 0 on retry/resume (still keep UI “Retry” and “Resume” buttons, but “Resume” becomes conditional).
- Persist download tasks in IndexedDB (metadata only): `{providerId, bucket, key, bytesDownloaded, totalBytes?, etag?, lastAttemptAt}`.
- On mismatch (ETag changed / size changed / 416), restart and notify user.

### UX wording changes
- In UI labels/tooltips: “Resume (if supported)” to avoid overpromising.
- If resume unsupported for that object/provider, hide Resume and show Retry.

## Minimal implementation notes (agent)
- Determine resumability:
  - Call `HeadObject` first; use `Content-Length` + `ETag` for integrity checks, and treat Range resumable only when the provider responds to Range requests (common for S3-compatible endpoints, but not guaranteed). 
- Security constraints remain unchanged:
  - Require HTTPS for production and enforce encrypted-in-transit connections (TLS) for bucket access. 

### File operations
- Upload:
  - Drag/drop + file picker.
  - Multi-file queue.
  - Progress per file + overall.
  - Multipart for large files; resume after refresh.
  - Pause/resume/cancel.
  - Conflict handling on same key: ask (overwrite / rename / skip).
- Download:
  - Single file download with progress.
  - Resume best-effort: if browser + provider supports range requests; otherwise restart.
- Replace:
  - “Replace” = upload to same key (overwrite).
- Create folder:
  - Create “folder marker” object key ending in “/” (or just rely on prefixes; still provide UI action).
- Rename / Move:
  - Implement as copyObject + deleteObject (since S3 has no rename).
- Delete:
  - Single + bulk, confirm dialog.

### Preview
- Images: thumbnail in grid + full preview modal.
- Video: preview modal uses HTML5 video player.
- Audio (optional MVP): HTML5 audio player.
- Text (optional MVP): show first N KB with monospace.
- Non-previewable: show icon + metadata.

## 4) Non-goals (explicit)
- No server / no proxy / no user accounts.
- No sharing credentials with anyone.
- No collaborative/team features.
- No advanced bucket policy editing in MVP.

## 5) Security & storage (client-only)
- Store provider configs locally (IndexedDB recommended).
- Encrypt secrets at rest using Web Crypto (AES-GCM).
- Optional: master password to derive encryption key (PBKDF2/Argon2 if available; PBKDF2 acceptable MVP).
- Never log secrets; redact in errors.
- Require HTTPS in production.
- App must handle CORS errors clearly (show setup hint).

## 6) UX / UI requirements
- Theme: dark + orange accents; modern typography.
- Layout:
  - Header: provider dropdown, bucket selector, breadcrumb/path, search, view toggle.
  - Main: file list/grid.
  - Right panel or bottom drawer: upload/download queue.
- Must feel “fast”: skeleton loading, optimistic UI where safe.
- Keyboard: basic navigation + delete + rename (F2) optional.

## 7) Technical implementation (agent instructions)
### Stack
- React + TypeScript + Vite.
- TanStack Query: data fetching/caching; invalidate on mutations.
- TanStack Router: routes.
- TanStack Virtual: large lists.
- AWS SDK v3 S3 client for all providers (endpoint override).

### Key modules
- `providers/`
  - CRUD provider configs
  - encryption/decryption
  - active provider selection
- `s3/`
  - `createClient(provider)`
  - operations: listBuckets, listObjects, headObject, getObject, putObject, multipartUpload, abortMultipart, completeMultipart, delete, deleteMany, copy
- `uploads/`
  - upload queue state (persist resumable sessions)
  - multipart state persisted: uploadId, partETags, uploaded parts, file fingerprint
- `previews/`
  - content-type detection
  - presigned URL generation or direct GET stream (prefer presigned for preview)
- `ui/`
  - theme tokens, components, dialogs, toasts

### Resumable upload (required)
- Multipart upload:
  - Persist per file: `{uploadId, key, bucket, providerId, partSize, completedParts}`.
  - On resume: listParts (if implemented) or rely on stored parts, then continue remaining parts.
  - Support pause: stop scheduling new parts.
- Concurrency: configurable (default 3).
- Chunk size: 5–10 MB default.

### Object listing
- Use `ListObjectsV2` with `Prefix` and `Delimiter: '/'`.
- Combine `CommonPrefixes` (folders) and `Contents` (files) into one list model.

## 8) Data model (minimal)
```ts
type ProviderType = 'aws' | 'r2' | 'custom';

type ProviderConfig = {
  id: string;
  name: string;
  type: ProviderType;
  endpoint?: string;      // required for r2/custom
  region?: string;        // required for aws
  accessKeyId: string;    // encrypted at rest
  secretAccessKey: string;// encrypted at rest
  defaultBucket?: string;
  forcePathStyle?: boolean;
  createdAt: number;
  lastUsedAt?: number;
};

type BrowserLocation = {
  providerId: string;
  bucket: string;
  prefix: string; // "folder/sub/"
};

type UploadPersisted = {
  id: string;
  providerId: string;
  bucket: string;
  key: string;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  partSize: number;
  uploadId: string;
  completedParts: { partNumber: number; etag: string }[];
  status: 'queued'|'uploading'|'paused'|'failed';
};
```

## 9) Routes (minimal)
- `/providers` manage providers
- `/browse` main browser (provider + bucket + prefix in URL/search params)
- `/transfers` optional (queue view)

## 10) Acceptance criteria (MVP done)
- Can add ≥ 2 providers, switch instantly, persists selection.
- Can browse bucket objects + folders reliably.
- Upload large file with multipart; refresh page and resume to completion.
- Replace/overwrite file works.
- Delete and rename (copy+delete) works.
- Preview image/video in modal with thumbnail in grid.
- All secrets stored only in browser storage, encrypted.