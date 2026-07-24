import {
	CloudFrontClient,
	CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import type { ProviderConfig } from "./types";

// ponytail: purges the whole distribution/zone. Per-file purge upgrade path —
// CloudFront accepts `/${key}` paths; Cloudflare needs full CDN URLs the app
// doesn't track. Add per-file when a CDN base URL is stored per provider.
export async function purgeCache(provider: ProviderConfig): Promise<string> {
	if (provider.type === "aws") {
		if (!provider.cloudFrontDistributionId) {
			throw new Error("Add a CloudFront Distribution ID to purge.");
		}
		const client = new CloudFrontClient({
			region: provider.region || "us-east-1",
			credentials: {
				accessKeyId: provider.accessKeyId,
				secretAccessKey: provider.secretAccessKey,
			},
		});
		await client.send(
			new CreateInvalidationCommand({
				DistributionId: provider.cloudFrontDistributionId,
				InvalidationBatch: {
					CallerReference: `s3m-${Date.now()}`,
					Paths: { Quantity: 1, Items: ["/*"] },
				},
			}),
		);
		return "CloudFront invalidation created for /*.";
	}

	if (provider.type === "r2") {
		if (!(provider.cloudflareZoneId && provider.cloudflareApiToken)) {
			throw new Error("Add a Cloudflare Zone ID and API Token to purge.");
		}
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/zones/${provider.cloudflareZoneId}/purge_cache`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${provider.cloudflareApiToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ purge_everything: true }),
			},
		).catch(() => {
			throw new Error(
				"Cloudflare request blocked (likely browser CORS). Cloudflare's purge API cannot be called directly from a browser — route it through a proxy.",
			);
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(
				`Cloudflare purge failed (${response.status}). ${detail}`.trim(),
			);
		}
		return "Cloudflare zone cache purged.";
	}

	throw new Error(
		"Cache purge is only available for AWS (CloudFront) and Cloudflare R2 providers.",
	);
}
