/**
 * node src/lib/richtext.check.ts
 *
 * Covers the two things in richtext.ts that can be wrong silently: the language
 * guess, and the offset a syntax error is reported at (an off-by-one there puts
 * the error lens on the wrong character).
 */
import assert from "node:assert/strict";
import { detectTextLang, lintText } from "./richtext.ts";

assert.equal(detectTextLang("a/b/notes.md"), "markdown");
assert.equal(detectTextLang("x.json", "application/octet-stream"), "json");
assert.equal(detectTextLang("noext", "application/x-yaml"), "yaml");
assert.equal(detectTextLang("page.htm", "text/plain"), "html");
assert.equal(detectTextLang("notes.txt", "text/plain"), "text");

const clean = await lintText('{\n  "a": 1\n}', "json");
assert.deepEqual(clean, [], "valid JSON must not report a diagnostic");

// The second comma is at offset 8.
const badJson = '{"a": 1,,}';
const [jsonError] = await lintText(badJson, "json");
assert.ok(jsonError, "invalid JSON must report a diagnostic");
assert.equal(badJson.slice(jsonError.from, jsonError.to), ",");

// yaml reports loc.start.offset instead — same normalisation must hold.
const badYaml = "a: 1\nb: [1,\n";
const [yamlError] = await lintText(badYaml, "yaml");
assert.ok(yamlError, "invalid YAML must report a diagnostic");
assert.ok(
	yamlError.from >= 0 && yamlError.to <= badYaml.length,
	`offset ${yamlError.from}..${yamlError.to} out of range`,
);

// Unformattable languages have no parser, so they never report.
assert.deepEqual(await lintText("anything at all", "text"), []);
assert.deepEqual(
	await lintText("   ", "json"),
	[],
	"blank text is not an error",
);

console.log("richtext.check.ts: ok");
