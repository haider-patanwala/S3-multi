import { decryptSecret, encryptSecret } from "./crypto";
import {
	idbDelete,
	idbGet,
	idbGetAll,
	idbPut,
	STORE_META,
	STORE_PROVIDERS,
} from "./idb";
import type { ProviderConfig, ProviderDraft, ProviderRecord } from "./types";

const ACTIVE_PROVIDER_KEY = "active-provider-id";
const RECENT_BUCKET_PREFIX = "recent-bucket:";

async function toConfig(record: ProviderRecord): Promise<ProviderConfig> {
	const [accessKeyId, secretAccessKey] = await Promise.all([
		decryptSecret(record.accessKeyIdEncrypted),
		decryptSecret(record.secretAccessKeyEncrypted),
	]);

	return {
		id: record.id,
		name: record.name,
		type: record.type,
		endpoint: record.endpoint,
		region: record.region,
		accessKeyId,
		secretAccessKey,
		buckets: record.buckets,
		defaultBucket: record.defaultBucket,
		forcePathStyle: record.forcePathStyle,
		createdAt: record.createdAt,
		lastUsedAt: record.lastUsedAt,
	};
}

export async function listProviders() {
	const records = await idbGetAll<ProviderRecord>(STORE_PROVIDERS);
	const configs = await Promise.all(records.map((record) => toConfig(record)));
	return configs.sort((left, right) => right.createdAt - left.createdAt);
}

export async function getProvider(providerId: string) {
	const record = await idbGet<ProviderRecord>(STORE_PROVIDERS, providerId);
	return record ? toConfig(record) : undefined;
}

export async function saveProvider(draft: ProviderDraft) {
	const createdAt = draft.createdAt ?? Date.now();
	const record: ProviderRecord = {
		id: draft.id,
		name: draft.name.trim(),
		type: draft.type,
		endpoint: draft.endpoint?.trim() || undefined,
		region: draft.region?.trim() || undefined,
		buckets: draft.buckets?.length ? draft.buckets : undefined,
		defaultBucket: draft.defaultBucket?.trim() || undefined,
		forcePathStyle: draft.forcePathStyle ?? false,
		createdAt,
		lastUsedAt: Date.now(),
		accessKeyIdEncrypted: await encryptSecret(draft.accessKeyId.trim()),
		secretAccessKeyEncrypted: await encryptSecret(draft.secretAccessKey.trim()),
	};

	await idbPut(STORE_PROVIDERS, record);
	const active = await getActiveProviderId();
	if (!active) {
		await setActiveProviderId(record.id);
	}
	return toConfig(record);
}

export async function removeProvider(providerId: string) {
	await idbDelete(STORE_PROVIDERS, providerId);
	const active = await getActiveProviderId();
	if (active === providerId) {
		await idbDelete(STORE_META, ACTIVE_PROVIDER_KEY);
	}
}

export async function getActiveProviderId() {
	const record = await idbGet<{ key: string; value: string }>(
		STORE_META,
		ACTIVE_PROVIDER_KEY,
	);
	return record?.value;
}

export async function setActiveProviderId(providerId: string) {
	await idbPut(STORE_META, {
		key: ACTIVE_PROVIDER_KEY,
		value: providerId,
	});
}

export async function touchProvider(providerId: string) {
	const provider = await getProvider(providerId);
	if (!provider) {
		return;
	}
	await saveProvider({
		...provider,
		createdAt: provider.createdAt,
		lastUsedAt: Date.now(),
	});
}

export async function getRecentBucket(providerId: string) {
	const record = await idbGet<{ key: string; value: string }>(
		STORE_META,
		`${RECENT_BUCKET_PREFIX}${providerId}`,
	);
	return record?.value;
}

export async function setRecentBucket(providerId: string, bucket: string) {
	await idbPut(STORE_META, {
		key: `${RECENT_BUCKET_PREFIX}${providerId}`,
		value: bucket,
	});
}
