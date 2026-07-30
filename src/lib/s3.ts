import {
	CopyObjectCommand,
	CreateMultipartUploadCommand,
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListBucketsCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { suggestCacheControl } from "./cache-control";
import { cdnUrlForKey } from "./cdn";
import type {
	ObjectEntry,
	ObjectPreview,
	ProviderConfig,
	ProviderTestResult,
} from "./types";
import { extensionForKey, isPreviewableKey } from "./utils";

const DEFAULT_REGION = "us-east-1";

export function resolveObjectContentType(key: string, rawContentType?: string) {
	if (
		rawContentType &&
		rawContentType !== "application/octet-stream" &&
		rawContentType !== "binary/octet-stream"
	) {
		return rawContentType;
	}

	switch (extensionForKey(key)) {
		case "txt":
		case "log":
			return "text/plain";
		case "md":
			return "text/markdown";
		case "yml":
		case "yaml":
			return "application/yaml";
		case "json":
			return "application/json";
		case "xml":
			return "application/xml";
		case "csv":
			return "text/csv";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "png":
			return "image/png";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "avif":
			return "image/avif";
		case "svg":
			return "image/svg+xml";
		case "mp4":
			return "video/mp4";
		case "webm":
			return "video/webm";
		case "mov":
			return "video/quicktime";
		default:
			return rawContentType ?? "application/octet-stream";
	}
}

/**
 * `fetch` rejects with a bare `TypeError: Failed to fetch` for every network-layer
 * failure — CORS preflight rejected, DNS miss, connection refused, bad endpoint —
 * with no indication of which request died or why. That is unusable both for the
 * operator and for anyone debugging this.
 *
 * One middleware at the point every command already routes through turns it into
 * something actionable. It only rewrites the error; the request is untouched.
 * Credentials are never included — hostname and path only.
 */
function attachFailureContext(client: S3Client) {
	client.middlewareStack.add(
		(next) => async (args) => {
			try {
				return await next(args);
			} catch (error) {
				const request = (args as { request?: unknown }).request as
					| {
							method?: string;
							protocol?: string;
							hostname?: string;
							path?: string;
					  }
					| undefined;
				/*
				 * Discriminator: anything that actually reached the service carries
				 * $metadata.httpStatusCode. Its absence means the request never got a
				 * response — CORS rejection, DNS miss, refused connection, timeout.
				 * Matching on error.message instead would be brittle: browsers say
				 * "Failed to fetch", Node says "fetch failed" or "getaddrinfo ENOTFOUND".
				 */
				const reachedService =
					typeof (error as { $metadata?: { httpStatusCode?: number } })
						?.$metadata?.httpStatusCode === "number";

				if (!reachedService && request?.hostname) {
					const url = `${request.protocol ?? "https:"}//${request.hostname}${request.path ?? ""}`;
					throw new Error(
						`Blocked before reaching the server: ${request.method ?? "GET"} ${url}. ` +
							"The browser refused it — almost always a CORS preflight rejection, " +
							"otherwise an unreachable endpoint. Open DevTools → Network → the " +
							"OPTIONS request to this URL to see which header or method the bucket " +
							"policy is missing.",
						{ cause: error },
					);
				}
				throw error;
			}
		},
		{ step: "finalizeRequest", name: "describeFetchFailure" },
	);
	return client;
}

export function createClient(provider: ProviderConfig) {
	return attachFailureContext(
		new S3Client({
			region:
				provider.type === "r2"
					? provider.region || "auto"
					: provider.region || DEFAULT_REGION,
			endpoint: provider.endpoint || undefined,
			forcePathStyle:
				provider.type === "r2"
					? true
					: provider.type === "custom"
						? Boolean(provider.forcePathStyle)
						: false,
			credentials: {
				accessKeyId: provider.accessKeyId,
				secretAccessKey: provider.secretAccessKey,
			},
			/*
			 * Do NOT add `requestHandler: { cache: "no-store" }` here. It looks like a
			 * harmless freshness fix, but per the Fetch spec the browser then appends
			 * `Pragma: no-cache` and `Cache-Control: no-cache` REQUEST headers. Neither
			 * is CORS-safelisted, so both land in the preflight's
			 * Access-Control-Request-Headers — and any bucket whose CORS policy
			 * enumerates AllowedHeaders instead of using "*" starts failing every
			 * request with an opaque "Failed to fetch".
			 *
			 * Freshness is handled instead by ResponseCacheControl on the reads that
			 * need it — a real, signed S3 query parameter, so it changes the cache
			 * key without adding anything to the CORS preflight.
			 */
		}),
	);
}

export function buildObjectUrl(
	provider: ProviderConfig,
	bucket: string,
	key: string,
) {
	// A configured public domain is the URL the operator actually shares;
	// endpoint URLs are the fallback for buckets without one.
	const cdnUrl = cdnUrlForKey(provider, key, bucket);
	if (cdnUrl) {
		return cdnUrl;
	}

	const encodedKey = key
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");

	if (provider.endpoint) {
		const endpoint = provider.endpoint.replace(/\/$/, "");
		if (provider.forcePathStyle || provider.type === "custom") {
			return `${endpoint}/${bucket}/${encodedKey}`;
		}
		return `${endpoint}/${bucket}/${encodedKey}`;
	}

	if (!provider.region) {
		return undefined;
	}

	return `https://${bucket}.s3.${provider.region}.amazonaws.com/${encodedKey}`;
}

export async function testConnection(
	provider: ProviderConfig,
): Promise<ProviderTestResult> {
	const client = createClient(provider);
	if (provider.defaultBucket) {
		/*
		 * Probe with the operation the browse view actually depends on, not
		 * HeadBucket. A green HeadBucket proves nothing useful — bucket-scoped
		 * tokens and per-operation CORS rendering mean it can pass while listing
		 * still fails, and (as here) fail while listing works.
		 */
		await client.send(
			new ListObjectsV2Command({
				Bucket: provider.defaultBucket,
				MaxKeys: 1,
			}),
		);
		return {
			buckets: [provider.defaultBucket],
			message: `Connected to ${provider.defaultBucket}`,
		};
	}
	return {
		buckets: [],
		message:
			"Profile is valid, but browser-based bucket listing can be blocked by CORS on account-level S3 endpoints. Set a default bucket or enter one manually in the browser view.",
	};
}

export async function listBuckets(provider: ProviderConfig) {
	const client = createClient(provider);
	try {
		const response = await client.send(new ListBucketsCommand({}));
		const buckets = (response.Buckets ?? [])
			.map((bucket) => bucket.Name)
			.filter(Boolean) as string[];
		if (provider.defaultBucket && !buckets.includes(provider.defaultBucket)) {
			return [provider.defaultBucket, ...buckets];
		}
		return buckets;
	} catch {
		/*
		 * Account-level ListBuckets is best-effort from a browser and its failure says
		 * nothing about whether a given bucket is usable: R2/S3 CORS is per-bucket, so
		 * the preflight on the bare account endpoint has no policy to match and dies,
		 * and bucket-scoped tokens get a 403. Fall back to the buckets we already know
		 * about rather than failing the whole browse view.
		 *
		 * This used to match on error.message (/CORS|Failed to fetch|.../) — which
		 * silently stopped matching the moment describeFetchFailure started rewriting
		 * those messages, never covered 403, and rethrew whenever no default bucket
		 * was set, leaving the operator with an empty picker and no way in.
		 */
		return [
			...new Set([provider.defaultBucket, ...(provider.buckets ?? [])]),
		].filter(Boolean) as string[];
	}
}

export async function listObjects(
	provider: ProviderConfig,
	bucket: string,
	prefix: string,
	search: string,
) {
	const client = createClient(provider);
	const response = await client.send(
		new ListObjectsV2Command({
			Bucket: bucket,
			Prefix: prefix,
			Delimiter: "/",
		}),
	);

	const folders: ObjectEntry[] = (response.CommonPrefixes ?? [])
		.map((entry) => entry.Prefix ?? "")
		.filter(Boolean)
		.map((folderPrefix) => ({
			id: folderPrefix,
			kind: "folder" as const,
			name: folderPrefix.slice(prefix.length).replace(/\/$/, ""),
			key: folderPrefix,
			prefix: folderPrefix,
			size: 0,
			isPreviewable: false,
		}));

	const files: ObjectEntry[] = (response.Contents ?? [])
		.filter((entry) => entry.Key && entry.Key !== prefix)
		.map((entry) => {
			const key = entry.Key as string;
			return {
				id: key,
				kind: "file" as const,
				name: key.slice(prefix.length),
				key,
				prefix,
				size: entry.Size ?? 0,
				lastModified: entry.LastModified?.toISOString(),
				contentType: undefined,
				isPreviewable: isPreviewableKey(key),
			};
		});

	const filterValue = search.trim().toLowerCase();
	const items = [...folders, ...files].filter((item) =>
		filterValue ? item.name.toLowerCase().includes(filterValue) : true,
	);
	return items.sort((left, right) => {
		if (left.kind !== right.kind) {
			return left.kind === "folder" ? -1 : 1;
		}
		return left.name.localeCompare(right.name);
	});
}

export async function createFolder(
	provider: ProviderConfig,
	bucket: string,
	prefix: string,
) {
	const client = createClient(provider);
	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: prefix.endsWith("/") ? prefix : `${prefix}/`,
			Body: "",
		}),
	);
}

export async function deleteKeys(
	provider: ProviderConfig,
	bucket: string,
	keys: string[],
) {
	const client = createClient(provider);
	if (keys.length === 1) {
		await client.send(
			new DeleteObjectCommand({ Bucket: bucket, Key: keys[0] }),
		);
		return;
	}

	await client.send(
		new DeleteObjectsCommand({
			Bucket: bucket,
			Delete: {
				Objects: keys.map((key) => ({ Key: key })),
			},
		}),
	);
}

export async function renameKey(
	provider: ProviderConfig,
	bucket: string,
	fromKey: string,
	toKey: string,
) {
	const client = createClient(provider);
	await client.send(
		new CopyObjectCommand({
			Bucket: bucket,
			Key: toKey,
			CopySource: `${bucket}/${encodeURIComponent(fromKey)}`,
		}),
	);
	await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: fromKey }));
}

/**
 * `no-cache` on reads is load-bearing, not defensive. The SDK tags each
 * operation with its own `x-id`, so a write goes to `…/key?x-id=PutObject`
 * while a read goes to `…/key?x-id=GetObject` — different cache keys, which
 * means the RFC 9111 §4.4 "an unsafe method invalidates the stored response"
 * rule never fires between them. Without this, putObjectText's read-after-write
 * compares the new text against the browser's cached pre-write body and reports
 * "Save did not stick" on a save that actually landed, and the editor reopens
 * the pre-save copy.
 *
 * It is a real, signed S3 query parameter (`response-cache-control`), so unlike
 * a `cache: "no-store"` request mode it adds nothing to the CORS preflight. It
 * only overrides the Cache-Control on *this response* — the object's own stored
 * Cache-Control, and therefore CDN edge caching, is untouched.
 */
const NO_CACHE = "no-cache";

export async function headObject(
	provider: ProviderConfig,
	bucket: string,
	key: string,
) {
	const client = createClient(provider);
	return client.send(
		new HeadObjectCommand({
			Bucket: bucket,
			Key: key,
			ResponseCacheControl: NO_CACHE,
		}),
	);
}

async function bodyToBlob(
	body:
		| {
				transformToWebStream?: () => ReadableStream<Uint8Array>;
				transformToByteArray?: () => Promise<Uint8Array>;
		  }
		| null
		| undefined,
	contentType: string,
	onProgress?: (loaded: number) => void,
) {
	if (!body) {
		return new Blob([], { type: contentType });
	}

	if (
		"transformToWebStream" in body &&
		typeof body.transformToWebStream === "function"
	) {
		const stream = body.transformToWebStream();
		const reader = stream.getReader();
		const chunks: ArrayBuffer[] = [];
		let loaded = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			if (value) {
				chunks.push(value.slice().buffer);
				loaded += value.length;
				onProgress?.(loaded);
			}
		}
		return new Blob(chunks, { type: contentType });
	}

	if (
		"transformToByteArray" in body &&
		typeof body.transformToByteArray === "function"
	) {
		const bytes = await body.transformToByteArray();
		onProgress?.(bytes.length);
		return new Blob([bytes.slice().buffer], { type: contentType });
	}

	return new Blob([], { type: contentType });
}

export async function previewObject(
	provider: ProviderConfig,
	bucket: string,
	key: string,
): Promise<ObjectPreview> {
	const metadata = await headObject(provider, bucket, key);
	const client = createClient(provider);
	const response = await client.send(
		// Same reason as getObjectText: without it the editor reopens the copy the
		// browser cached before the last save.
		new GetObjectCommand({
			Bucket: bucket,
			Key: key,
			ResponseCacheControl: NO_CACHE,
		}),
	);
	const contentType = resolveObjectContentType(
		key,
		metadata.ContentType ?? response.ContentType,
	);
	const blob = await bodyToBlob(response.Body, contentType);
	return {
		blobUrl: URL.createObjectURL(blob),
		contentType,
		fileName: key.split("/").pop() ?? key,
		cacheControl: metadata.CacheControl,
	};
}

export async function getObjectText(
	provider: ProviderConfig,
	bucket: string,
	key: string,
) {
	const client = createClient(provider);
	const response = await client.send(
		new GetObjectCommand({
			Bucket: bucket,
			Key: key,
			ResponseCacheControl: NO_CACHE,
		}),
	);
	return (await response.Body?.transformToString()) ?? "";
}

export async function putObjectText(
	provider: ProviderConfig,
	bucket: string,
	key: string,
	text: string,
	contentType?: string,
	cacheControl?: string,
) {
	const client = createClient(provider);
	// A PutObject overwrite replaces *all* metadata, so carry the existing
	// headers forward instead of silently stripping them. ContentEncoding is
	// deliberately dropped: the browser already decoded the body on read.
	const existing = await headObject(provider, bucket, key).catch(
		() => undefined,
	);
	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: key,
			Body: text,
			ContentType:
				contentType || existing?.ContentType || resolveObjectContentType(key),
			// An explicit value wins so the save drawer can change caching; falling
			// back to the existing header keeps an untouched object untouched.
			CacheControl: cacheControl || existing?.CacheControl,
			ContentDisposition: existing?.ContentDisposition,
			ContentLanguage: existing?.ContentLanguage,
			Metadata: existing?.Metadata,
		}),
	);

	// Read-after-write: a 200 from PutObject is not proof the bytes a reader
	// gets back are the ones we sent. This catches silent write-through
	// failures, stale caches, and permission oddities at the one place that
	// matters — before the UI claims the save landed.
	const written = await getObjectText(provider, bucket, key);
	if (written !== text) {
		throw new Error(
			"Save did not stick: the object read back different content. Check write permissions on the bucket and whether a CDN or proxy sits in front of this endpoint.",
		);
	}
}

export async function downloadObject(
	provider: ProviderConfig,
	bucket: string,
	key: string,
	onProgress?: (loaded: number, total?: number) => void,
) {
	const metadata = await headObject(provider, bucket, key);
	const client = createClient(provider);
	const response = await client.send(
		// A download must be the object as it is now, not the copy the browser
		// kept from the last preview.
		new GetObjectCommand({
			Bucket: bucket,
			Key: key,
			ResponseCacheControl: NO_CACHE,
		}),
	);
	const total = metadata.ContentLength;
	const contentType = resolveObjectContentType(
		key,
		metadata.ContentType ?? response.ContentType,
	);
	const blob = await bodyToBlob(response.Body, contentType, (loaded) =>
		onProgress?.(loaded, total),
	);

	return {
		blob,
		contentType,
		totalBytes: total,
		resumeSupported: metadata.AcceptRanges === "bytes",
		etag: metadata.ETag,
	};
}

export async function uploadObject(
	provider: ProviderConfig,
	bucket: string,
	key: string,
	file: File,
	contentTypeOverride?: string,
	onProgress?: (loaded: number, total?: number) => void,
	cacheControl?: string,
) {
	const client = createClient(provider);
	const uploader = new Upload({
		client,
		params: {
			Bucket: bucket,
			Key: key,
			Body: file,
			ContentType:
				contentTypeOverride || file.type || resolveObjectContentType(key),
			// Without this an uploaded object has no Cache-Control at all, and the
			// CDN falls back to re-fetching from the bucket on its own schedule —
			// which is what shows up on the bill.
			CacheControl: cacheControl || suggestCacheControl(key),
		},
		partSize: 8 * 1024 * 1024,
		queueSize: 3,
		leavePartsOnError: false,
	});

	uploader.on("httpUploadProgress", (progress) => {
		onProgress?.(progress.loaded ?? 0, progress.total);
	});

	await uploader.done();
}

export async function startMultipartUpload(
	provider: ProviderConfig,
	bucket: string,
	key: string,
	file: File,
) {
	const client = createClient(provider);
	await client.send(
		new CreateMultipartUploadCommand({
			Bucket: bucket,
			Key: key,
			ContentType: file.type || undefined,
		}),
	);
}
