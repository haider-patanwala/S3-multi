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
// Markdown is deliberately not linted — see lintText.
assert.deepEqual(await lintText("# ok\n\n<div><p>", "markdown"), []);

// --- HTML -----------------------------------------------------------------
// The whole reason htmlhint is here: Prettier, lezer and parse5 were all
// measured and none of them report these three.
const strayClose = "<div>hi</span></div>";
const [stray] = await lintText(strayClose, "html");
assert.ok(stray, "a close tag with no open tag must report");
assert.equal(strayClose.slice(stray.from, stray.to), "</span>");

const [unclosed] = await lintText("<html><body><div>hi</body></html>", "html");
assert.ok(unclosed, "an unclosed <div> must report");
assert.match(unclosed.message, /paired/i);

// Multi-line: the offset must follow the line, not restart at 0.
const multi = "<div>\n  hi</span>\n</div>";
const [onLineTwo] = await lintText(multi, "html");
assert.equal(multi.slice(onLineTwo.from, onLineTwo.to), "</span>");

// htmlhint reports every error, unlike Prettier which stops at the first.
assert.ok(
	(await lintText("<p>a</b>\n<div>b</i>", "html")).length >= 2,
	"multiple HTML errors must all be reported",
);

// No false positives on correct HTML5 — void elements, unquoted attributes and
// bare fragments are all legal and must stay quiet, or the lens is noise.
assert.deepEqual(
	await lintText(
		'<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><p>Hi<br>there</p><img src=x alt=y></body></html>',
		"html",
	),
	[],
	"valid HTML5 must not report",
);
assert.deepEqual(
	await lintText("<p>just a <b>fragment</b></p>", "html"),
	[],
	"a fragment with no doctype is not an error",
);

// Every diagnostic must be a usable range, or CodeMirror draws nothing.
for (const lang of ["html", "json", "yaml"] as const) {
	const source =
		lang === "html" ? multi : lang === "json" ? '{"a":,}' : "a: [1,\n";
	for (const issue of await lintText(source, lang)) {
		assert.ok(
			issue.from >= 0 && issue.from < issue.to && issue.to <= source.length,
			`${lang}: bad range ${issue.from}..${issue.to} of ${source.length}`,
		);
	}
}

console.log("richtext.check.ts: ok");
