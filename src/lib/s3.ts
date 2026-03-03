import {
	CopyObjectCommand,
	CreateMultipartUploadCommand,
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadBucketCommand,
	HeadObjectCommand,
	ListBucketsCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
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

export function createClient(provider: ProviderConfig) {
	return new S3Client({
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
	});
}

export function buildObjectUrl(
	provider: ProviderConfig,
	bucket: string,
	key: string,
) {
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
		await client.send(
			new HeadBucketCommand({ Bucket: provider.defaultBucket }),
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
	if (provider.defaultBucket) {
		return [provider.defaultBucket];
	}
	const client = createClient(provider);
	try {
		const response = await client.send(new ListBucketsCommand({}));
		return (response.Buckets ?? [])
			.map((bucket) => bucket.Name)
			.filter(Boolean) as string[];
	} catch (error) {
		if (
			error instanceof Error &&
			/CORS|Failed to fetch|preflight|Access-Control-Allow-Origin/i.test(
				error.message,
			)
		) {
			return [];
		}
		throw error;
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

export async function headObject(
	provider: ProviderConfig,
	bucket: string,
	key: string,
) {
	const client = createClient(provider);
	return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
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
		new GetObjectCommand({ Bucket: bucket, Key: key }),
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
	};
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
		new GetObjectCommand({ Bucket: bucket, Key: key }),
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
