// Self-check for the CDN URL / purge-command logic. Run: node src/lib/cdn.check.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildPurgeCommand, canPurge, cdnUrlForKey } from "./cdn.ts";
import type { ProviderConfig } from "./types";

const base: ProviderConfig = {
	id: "p1",
	name: "R2",
	type: "r2",
	accessKeyId: "a",
	secretAccessKey: "b",
	createdAt: 0,
};

// ── cdnUrlForKey ──────────────────────────────────────────────────────────────

// No public base URL -> no single-file target, so callers must fall back to a
// whole-zone purge rather than silently purging nothing.
assert.equal(cdnUrlForKey(base, "docs/readme.md"), undefined);

const withCdn: ProviderConfig = {
	...base,
	publicBaseUrl: "https://cdn.example.com/",
};
assert.equal(
	cdnUrlForKey(withCdn, "docs/readme.md"),
	"https://cdn.example.com/docs/readme.md",
);
// Slashes stay as path separators; everything else in a segment is encoded.
assert.equal(
	cdnUrlForKey(withCdn, "my docs/a+b & c.md"),
	"https://cdn.example.com/my%20docs/a%2Bb%20%26%20c.md",
);

// ── canPurge: in-app purge is AWS-only by design ──────────────────────────────

assert.equal(canPurge(base), false);
// R2 with full credentials still cannot purge in-app — Cloudflare's API refuses
// browser calls, so this must stay false or the save path will try and fail.
assert.equal(
	canPurge({ ...base, cloudflareZoneId: "z", cloudflareApiToken: "t" }),
	false,
);
assert.equal(canPurge({ ...base, type: "aws" }), false);
assert.equal(
	canPurge({ ...base, type: "aws", cloudFrontDistributionId: "E1" }),
	true,
);
assert.equal(canPurge({ ...base, type: "custom" }), false);

// ── Cloudflare command ────────────────────────────────────────────────────────

const r2Full: ProviderConfig = {
	...withCdn,
	cloudflareZoneId: "0123456789abcdef0123456789abcdef",
	cloudflareApiToken: "cf-token-value",
};

// Single-file purge when a public URL can be built.
{
	const built = buildPurgeCommand(r2Full, ["docs/readme.md"]);
	assert.ok(built);
	assert.match(built.command, /^curl -X POST /);
	assert.match(
		built.command,
		/zones\/0123456789abcdef0123456789abcdef\/purge_cache/,
	);
	assert.match(built.command, /Authorization: Bearer cf-token-value/);
	assert.match(
		built.command,
		/\{"files":\["https:\/\/cdn\.example\.com\/docs\/readme\.md"\]\}/,
	);
	assert.ok(!built.command.includes("purge_everything"));
	assert.deepEqual(built.notes, []);
}

// Without publicBaseUrl a per-file purge is impossible, so it must fall back to
// the whole zone AND say so — silently purging everything would be worse.
{
	const built = buildPurgeCommand({ ...r2Full, publicBaseUrl: undefined }, [
		"docs/readme.md",
	]);
	assert.ok(built);
	assert.match(built.command, /purge_everything/);
	assert.match(built.scope, /ENTIRE zone/);
	assert.ok(built.notes.some((note) => /Public CDN URL/.test(note)));
}

// Missing credentials produce placeholders plus a note, never a broken command.
{
	const built = buildPurgeCommand(base);
	assert.ok(built);
	assert.match(built.command, /<ZONE_ID>/);
	assert.match(built.command, /<API_TOKEN>/);
	assert.equal(built.notes.length, 2);
}

// Shell-injection guard. These strings land in the operator's terminal, so a
// quote inside a credential must not close the string and chain a new command.
// Asserted against a real shell rather than a regex, with a harmless payload:
// if quoting breaks, `INJECTED` shows up in the output instead of inside the arg.
{
	const payload = "tok'; echo INJECTED; echo '";
	const built = buildPurgeCommand({
		...r2Full,
		cloudflareApiToken: payload,
	});
	assert.ok(built);

	// Pull the quoted Authorization argument straight out of the built command
	// and ask /bin/sh what it actually expands to.
	const quoted = built.command
		.split("\n")
		.find((line) => line.includes("Authorization"))
		?.trim()
		.replace(/^-H /, "")
		.replace(/ \\$/, "");
	assert.ok(quoted);

	const expanded = execFileSync("/bin/sh", ["-c", `printf '%s' ${quoted}`], {
		encoding: "utf8",
	});
	assert.equal(expanded, `Authorization: Bearer ${payload}`);
	assert.ok(!expanded.includes("\nINJECTED"));
}

// ── CloudFront command ────────────────────────────────────────────────────────

const aws: ProviderConfig = {
	...base,
	type: "aws",
	cloudFrontDistributionId: "E1A2B3C4D5",
};

{
	const built = buildPurgeCommand(aws, ["docs/readme.md"]);
	assert.ok(built);
	assert.match(built.command, /^aws cloudfront create-invalidation/);
	assert.match(built.command, /--distribution-id 'E1A2B3C4D5'/);
	assert.match(built.command, /--paths '\/docs\/readme\.md'/);
}
{
	const built = buildPurgeCommand(aws);
	assert.ok(built);
	assert.match(built.command, /--paths '\/\*'/);
	assert.match(built.scope, /every path/);
}

// Custom S3 endpoints have no purge protocol at all.
assert.equal(buildPurgeCommand({ ...base, type: "custom" }), undefined);

console.log("cdn.check.ts ok");
