import { queryOptions } from "@tanstack/react-query";
import {
	getActiveProviderId,
	getRecentBucket,
	listProviders,
} from "./providers";
import {
	getObjectText,
	headObject,
	listBuckets,
	listObjects,
	resolveObjectContentType,
} from "./s3";
import { listTransfers } from "./transfers";
import type { ProviderConfig } from "./types";

export const providerQueryOptions = queryOptions({
	queryKey: ["providers"],
	queryFn: listProviders,
});

export const activeProviderQueryOptions = queryOptions({
	queryKey: ["providers", "active"],
	queryFn: getActiveProviderId,
});

export function recentBucketQueryOptions(providerId?: string) {
	return queryOptions({
		queryKey: ["providers", providerId, "recent-bucket"],
		queryFn: () =>
			providerId ? getRecentBucket(providerId) : Promise.resolve(undefined),
		enabled: Boolean(providerId),
	});
}

export const transferQueryOptions = queryOptions({
	queryKey: ["transfers"],
	queryFn: listTransfers,
});

export function bucketQueryOptions(
	provider: Parameters<typeof listBuckets>[0] | undefined,
) {
	return queryOptions({
		queryKey: ["buckets", provider?.id],
		queryFn: () => {
			if (!provider) {
				return Promise.resolve([]);
			}
			return listBuckets(provider);
		},
		enabled: Boolean(provider),
	});
}

/**
 * Source of an editable object, for the /edit page.
 *
 * `headObject` first because the object's declared Content-Type is frequently
 * wrong or missing (R2 uploads land as application/octet-stream), and the editor
 * has to know the real type to pick a language and to write the same type back.
 *
 * `staleTime: Infinity` on purpose: the editor buffer is derived from this, and
 * a background refetch that swapped the baseline under an open editor would
 * silently redefine what "unsaved changes" means. The save path updates this
 * cache entry itself.
 */
export function objectTextQueryOptions(args: {
	provider: ProviderConfig | undefined;
	bucket?: string;
	key?: string;
}) {
	return queryOptions({
		queryKey: ["object-text", args.provider?.id, args.bucket, args.key],
		queryFn: async () => {
			if (!(args.provider && args.bucket && args.key)) {
				throw new Error("Choose a provider, bucket and object first.");
			}
			const metadata = await headObject(
				args.provider,
				args.bucket,
				args.key,
			).catch(() => undefined);
			return {
				text: await getObjectText(args.provider, args.bucket, args.key),
				contentType: resolveObjectContentType(args.key, metadata?.ContentType),
				cacheControl: metadata?.CacheControl,
			};
		},
		enabled: Boolean(args.provider && args.bucket && args.key),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}

export function objectQueryOptions(args: {
	provider: Parameters<typeof listObjects>[0] | undefined;
	bucket?: string;
	prefix: string;
	search: string;
}) {
	return queryOptions({
		queryKey: [
			"objects",
			args.provider?.id,
			args.bucket,
			args.prefix,
			args.search,
		],
		queryFn: () => {
			if (!(args.provider && args.bucket)) {
				return Promise.resolve([]);
			}
			return listObjects(args.provider, args.bucket, args.prefix, args.search);
		},
		enabled: Boolean(args.provider && args.bucket),
	});
}
