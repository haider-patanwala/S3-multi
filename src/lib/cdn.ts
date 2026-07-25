import {
	CloudFrontClient,
	CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import type { ProviderConfig } from "./types";

/**
 * Two very different stories here, and the difference is not our choice:
 *
 *   AWS  — the CloudFront API answers CORS preflights with
 *          `Access-Control-Allow-Origin: *`, so `purgeCache` invalidates directly
 *          from the browser.
 *   R2   — api.cloudflare.com sends no CORS headers on any endpoint and 405s on
 *          OPTIONS. The Authorization header forces a preflight that can never
 *          succeed, and no Cloudflare setting changes that (the API is on a zone
 *          Cloudflare owns). So instead of pretending, we hand the operator a
 *          ready-to-run curl command via `buildPurgeCommand`.
 */

export function cdnUrlForKey(provider: ProviderConfig, key: string) {
	if (!provider.publicBaseUrl) {
		return undefined;
	}
	const encoded = key
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return `${provider.publicBaseUrl.replace(/\/+$/, "")}/${encoded}`;
}

async function purgeCloudFront(provider: ProviderConfig, keys?: string[]) {
	if (!provider.cloudFrontDistributionId) {
		throw new Error("Add a CloudFront Distribution ID to purge.");
	}
	const paths = keys?.length
		? keys.map((key) => (key.startsWith("/") ? key : `/${key}`))
		: ["/*"];
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
				Paths: { Quantity: paths.length, Items: paths },
			},
		}),
	);
	return `CloudFront invalidation created for ${paths.join(", ")}.`;
}

/**
 * Purge the CDN in front of this bucket, in-app. Pass `keys` to purge only those
 * objects; omit it to purge everything.
 *
 * AWS only — see `buildPurgeCommand` for R2.
 */
export async function purgeCache(
	provider: ProviderConfig,
	keys?: string[],
): Promise<string> {
	if (provider.type === "aws") {
		return purgeCloudFront(provider, keys);
	}
	if (provider.type === "r2") {
		throw new Error(
			"Cloudflare's API cannot be called from a browser. Use the purge command from the Purge cache dialog instead.",
		);
	}
	throw new Error(
		"Cache purge is only available for AWS (CloudFront) and Cloudflare R2 providers.",
	);
}

/** Whether `purgeCache` can run in-app. R2 is always false by design. */
export function canPurge(provider: ProviderConfig) {
	return provider.type === "aws" && Boolean(provider.cloudFrontDistributionId);
}

/**
 * POSIX single-quoting. The values below come from user input and land in the
 * operator's shell, so a stray quote must not be able to terminate the string
 * and start a new command.
 */
function shellQuote(value: string) {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export type PurgeCommand = {
	/** Ready to paste into a terminal. */
	command: string;
	/** What this command will actually purge, in plain words. */
	scope: string;
	/** Non-blocking warnings — missing fields, fallbacks taken. */
	notes: string[];
};

/**
 * Build a copy-pasteable purge command. Nothing here is sent anywhere; the
 * string is generated locally and the operator runs it themselves.
 *
 * `keys` scopes the purge to specific objects. Cloudflare needs the *public* URL
 * of each object to do that, so without `publicBaseUrl` it falls back to purging
 * the whole zone — and says so in `notes` rather than quietly doing something
 * bigger than asked.
 */
export function buildPurgeCommand(
	provider: ProviderConfig,
	keys?: string[],
): PurgeCommand | undefined {
	if (provider.type === "r2") {
		return buildCloudflareCommand(provider, keys);
	}
	if (provider.type === "aws") {
		return buildCloudFrontCommand(provider, keys);
	}
	return undefined;
}

function buildCloudflareCommand(
	provider: ProviderConfig,
	keys?: string[],
): PurgeCommand {
	const notes: string[] = [];
	const zone = provider.cloudflareZoneId?.trim();
	const token = provider.cloudflareApiToken?.trim();

	if (!zone) {
		notes.push(
			"Add your Zone ID above — the command has a placeholder for now.",
		);
	}
	if (!token) {
		notes.push(
			"Add an API token above — the command has a placeholder for now.",
		);
	}

	const urls = keys?.length
		? keys
				.map((key) => cdnUrlForKey(provider, key))
				.filter((url): url is string => Boolean(url))
		: [];

	let body: string;
	let scope: string;
	if (keys?.length && urls.length === keys.length) {
		body = JSON.stringify({ files: urls });
		scope =
			urls.length === 1
				? `Purges 1 file: ${urls[0]}`
				: `Purges ${urls.length} files.`;
	} else {
		body = JSON.stringify({ purge_everything: true });
		scope = "Purges the ENTIRE zone cache — every file on this domain.";
		if (keys?.length) {
			notes.push(
				"Set a Public CDN URL above to purge just this file instead of the whole zone.",
			);
		}
	}

	const command = [
		`curl -X POST ${shellQuote(`https://api.cloudflare.com/client/v4/zones/${zone || "<ZONE_ID>"}/purge_cache`)} \\`,
		`  -H ${shellQuote(`Authorization: Bearer ${token || "<API_TOKEN>"}`)} \\`,
		`  -H 'Content-Type: application/json' \\`,
		`  --data ${shellQuote(body)}`,
	].join("\n");

	return { command, scope, notes };
}

function buildCloudFrontCommand(
	provider: ProviderConfig,
	keys?: string[],
): PurgeCommand {
	const notes: string[] = [];
	const distribution = provider.cloudFrontDistributionId?.trim();
	if (!distribution) {
		notes.push(
			"Add your Distribution ID above — the command has a placeholder for now.",
		);
	}

	const paths = keys?.length
		? keys.map((key) => (key.startsWith("/") ? key : `/${key}`))
		: ["/*"];

	const command = [
		"aws cloudfront create-invalidation \\",
		`  --distribution-id ${shellQuote(distribution || "<DISTRIBUTION_ID>")} \\`,
		`  --paths ${paths.map(shellQuote).join(" ")}`,
	].join("\n");

	return {
		command,
		scope:
			paths[0] === "/*"
				? "Invalidates every path in the distribution."
				: `Invalidates ${paths.length} path${paths.length > 1 ? "s" : ""}: ${paths.join(", ")}`,
		notes,
	};
}
