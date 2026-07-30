// Self-check for redactSecrets. Run: node src/lib/utils.check.ts
import assert from "node:assert/strict";
import { redactSecrets } from "./utils.ts";

const SECRET = "wJalrXUtnFEMI0K7MDENGbPxRfiCYEXAMPLEKEY";
const TOKEN = "cf-token-0123456789abcdefghijklmnop";

// Every occurrence goes, not just the first — the original bug was `replace`.
{
	const message = `PUT failed with ${SECRET}, retried with ${SECRET}`;
	const safe = redactSecrets(message, SECRET);
	assert.ok(!safe.includes(SECRET));
	assert.equal(safe.match(/\[redacted]/g)?.length, 2);
}

// Several secrets in one message, and undefined entries are skipped rather
// than throwing — callers pass optional fields straight from the form.
{
	const safe = redactSecrets(
		`key=${SECRET} token=${TOKEN}`,
		SECRET,
		undefined,
		TOKEN,
	);
	assert.equal(safe, "key=[redacted] token=[redacted]");
}

// Short values are ignored: an 8-character floor stops a one-character or
// empty field from redacting every letter of an ordinary error message.
{
	assert.equal(
		redactSecrets("access denied for bucket a", "a"),
		"access denied for bucket a",
	);
	assert.equal(redactSecrets("nothing to hide", ""), "nothing to hide");
}

// Non-matching input passes through untouched.
assert.equal(redactSecrets("Bucket not found", SECRET), "Bucket not found");

console.log("utils.check.ts ok");
