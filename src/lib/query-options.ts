import { queryOptions } from "@tanstack/react-query";
import {
	getActiveProviderId,
	getRecentBucket,
	listProviders,
} from "./providers";
import { listBuckets, listObjects } from "./s3";
import { listTransfers } from "./transfers";

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
