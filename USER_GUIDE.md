# S3 Multi User Guide

This guide is based on the target workflows in [PRD.md](./PRD.md), but it describes how to use the current app as it exists in this repository today.

## What S3 Multi Does

S3 Multi is a browser-based control room for S3-compatible object storage. You can:

- save multiple provider profiles locally
- switch between AWS S3, Cloudflare R2, and custom S3 endpoints
- browse buckets and folders by prefix
- upload and download files
- preview supported files
- rename, replace, and delete objects
- review transfer activity from the Transfers page

There is no backend. Your credentials are used directly in the browser and stored locally in encrypted form.

## Before You Start

Make sure you have:

- an access key and secret key for your provider
- permission to list or access the bucket you want to browse
- bucket CORS rules that allow browser requests from this app
- HTTPS when using the app outside local development

Recommended: set a default bucket in the provider form if your provider does not allow browser-based account bucket listing.

## Provider Setup

Open the Providers page and create a profile.

### AWS S3

Fill in:

- Name
- Region
- Access key
- Secret key
- Optional default bucket

Endpoint is usually left empty for standard AWS S3.

### Cloudflare R2

Fill in:

- Name
- Endpoint
- Access key
- Secret key
- Optional region
- Optional default bucket

Use the R2 S3 API endpoint for your account.

### Custom S3

Fill in:

- Name
- Endpoint
- Access key
- Secret key
- Optional region
- Optional default bucket
- `Force path style` when required by your provider

This is the usual configuration for MinIO and similar S3-compatible services.

## Testing and Saving a Provider

1. Enter the provider details.
2. Click `Test connection`.
3. Review the status message.
4. Click `Save` to store the profile locally.
5. Mark it active if you want it to become the default provider in the browser.

Notes:

- If a default bucket is set, the test checks that bucket directly.
- If no default bucket is set, the app can validate the profile but bucket listing may still be unavailable in the browser because of CORS.

## Browsing Buckets and Prefixes

Open the Browser page.

### Choose a Provider

Use the provider dropdown to switch profiles. The active provider is remembered locally.

### Open a Bucket

- Pick a bucket from suggestions if available.
- If no suggestions appear, type the bucket name manually and click `Open`.

This manual flow is expected for providers that block `ListBuckets` in browser contexts.

### Navigate Folders

- Click a folder to open its prefix.
- Use the breadcrumb path to move back up the hierarchy.
- Use search to filter only the currently visible items.

### Switch Views

- `List` is better for dense browsing and actions.
- `Grid` is better for visual browsing and quick preview of supported files.

## Uploading Files

You can upload in two ways:

- Click `Upload` and select one or more files.
- Drag files into the browser area and drop them on the active prefix.

Uploads are written into the currently open prefix.

Current behavior:

- uploads show progress
- transfer metadata is stored locally
- multipart upload is handled by the AWS SDK client

Current limitation:

- the PRD describes richer pause/resume and refresh recovery flows, but those controls are not fully exposed in the current UI yet

## Creating a Folder

Click `New folder` and enter a folder name.

The app creates an S3 object key ending in `/` so the prefix appears like a folder in the browser.

## Previewing Files

The current app supports preview for:

- images
- video
- text and log files
- JSON and some similar text-like formats

Preview behavior:

- grid view is optimized for quick preview
- list view shows a `View` action only when preview is supported
- unsupported file types can still be downloaded

## Downloading Files

Click `Download` on a file to save it locally.

The Transfers page records:

- progress
- completion status
- failure state
- whether the endpoint reported range support

Important note:

- the PRD defines best-effort resume for downloads
- the current implementation records whether range support exists, but retry/resume controls are not fully surfaced as interactive actions yet

## Renaming, Replacing, and Deleting

### Rename

Use `Rename` on a file and enter a new name.

Behind the scenes this is implemented as copy then delete, because S3 does not support a native rename operation.

### Replace

Use `Replace` to upload a new local file over an existing object.

If the incoming file extension differs, the resulting object key may be adjusted so the final file name remains consistent with the replacement file type.

### Delete

- delete a single object from its action menu
- select multiple items and use the bulk `Delete` button

Be careful with bulk delete. Deleted objects are removed immediately from the provider after confirmation.

## Direct URLs

Some files expose a `Share` or direct URL action that copies an object URL to the clipboard.

This works best when:

- the provider has a predictable public object URL pattern
- the bucket or object is already accessible through that URL

If the app cannot build a direct URL for the current provider configuration, it will show a status message instead.

## Transfers Page

Open the Transfers page to review persisted upload and download activity.

You can:

- inspect recent transfers
- see bytes transferred and timestamps
- clear completed entries
- clear all entries
- dismiss individual transfer records

The Transfers page is a local ledger. It does not manage server-side jobs.

## Security and Privacy

The app follows the PRD's client-only direction:

- credentials stay in the browser
- secrets are encrypted before being written to IndexedDB
- no server stores your keys
- no user account is required

Operational reminder:

- anyone with access to the same browser profile on the same machine may still access locally stored app data

## Troubleshooting

### Test connection passes, but bucket suggestions are empty

This usually means account-level bucket listing is blocked by CORS or policy. Enter the bucket name manually or configure a default bucket in the provider profile.

### Browser requests fail with CORS or `Failed to fetch`

Update the bucket or endpoint CORS rules so the app origin is allowed for the required S3 operations.

### Preview does not open

The object may be an unsupported type, or the provider may not allow the required `HeadObject` and `GetObject` requests from the browser.

### Rename appears slow

Rename is a copy-plus-delete workflow, so large objects can take longer than a metadata-only rename in a traditional file system.

### Download resume is not available

Resume support depends on provider behavior. Some endpoints support HTTP range requests, others do not. The current UI does not yet expose the full resume flow described in the PRD.

## Recommended First Run

1. Add one provider on the Providers page.
2. Set a default bucket if your provider is strict about browser bucket listing.
3. Test the connection.
4. Save the provider and make it active.
5. Open the Browser page.
6. Browse into a prefix.
7. Upload a sample file.
8. Preview or download it.
9. Open Transfers to verify the ledger entry.
