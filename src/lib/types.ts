export type ProviderType = "aws" | "r2" | "custom";

export type ProviderConfig = {
	id: string;
	name: string;
	type: ProviderType;
	endpoint?: string;
	region?: string;
	accessKeyId: string;
	secretAccessKey: string;
	defaultBucket?: string;
	forcePathStyle?: boolean;
	createdAt: number;
	lastUsedAt?: number;
};

export type ProviderDraft = Omit<ProviderConfig, "createdAt"> & {
	createdAt?: number;
};

export type ProviderRecord = Omit<
	ProviderConfig,
	"accessKeyId" | "secretAccessKey"
> & {
	accessKeyIdEncrypted: string;
	secretAccessKeyEncrypted: string;
};

export type BrowserLocation = {
	providerId: string;
	bucket: string;
	prefix: string;
};

export type ObjectKind = "file" | "folder";
export type BrowserView = "list" | "grid";

export type ObjectEntry = {
	id: string;
	kind: ObjectKind;
	name: string;
	key: string;
	prefix: string;
	size: number;
	lastModified?: string;
	contentType?: string;
	resumeSupported?: boolean;
	isPreviewable: boolean;
};

export type TransferKind = "upload" | "download";
export type TransferStatus =
	| "queued"
	| "running"
	| "paused"
	| "failed"
	| "completed";

export type TransferRecord = {
	id: string;
	kind: TransferKind;
	status: TransferStatus;
	providerId: string;
	bucket: string;
	key: string;
	fileName: string;
	totalBytes?: number;
	transferredBytes: number;
	errorMessage?: string;
	resumeSupported?: boolean;
	createdAt: number;
	updatedAt: number;
};

export type ProviderTestResult = {
	buckets: string[];
	message: string;
};

export type ObjectPreview = {
	blobUrl: string;
	contentType: string;
	fileName: string;
};
