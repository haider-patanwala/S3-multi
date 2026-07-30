---
id: text-editing
type: subsystem
owns: src/routes/edit.tsx, src/components/code-editor.tsx, src/components/rich-markdown-editor.tsx, src/components/rich-text-viewer.tsx, src/lib/richtext.ts, src/lib/s3.ts:putObjectText, src/lib/s3.ts:getObjectText
---

# Text editing

Edit markdown, JSON, YAML, HTML, XML, CSV, and plain-text objects in place, in
the browser, with no download/re-upload round trip.

Editing is a **route, not a modal**: `/edit?providerId&bucket&key&prefix`
(`src/routes/edit.tsx`). The browse preview drawer is a read-only quick look
with an **Open in editor** button; the row overflow menu has an **Edit** entry.
Editing used to live inside that preview, and a full editor does not fit in one.

## Eligibility

An object is editable when `isEditableTextContentType(contentType)` is true
(`src/lib/utils.ts`): `text/*`, or a content type containing `yaml`, `yml`,
`markdown`, `xml`, or `json`.

`contentType` comes from `resolveObjectContentType`, so an R2 object stored with no
content type is still editable if its extension says text. This matters — R2
uploads frequently arrive as `application/octet-stream`. The **Edit** menu entry
is gated on `resolveObjectContentType(item.key)` alone, because the menu opens
before anything has been fetched.

## Editor state

`src/routes/edit.tsx` owns three things; the key itself lives in the URL, so the
editor is linkable and survives a reload.

| State | Meaning |
|---|---|
| `search.key` | Which key is open. The save target. |
| `baseline` | The pristine baseline — the raw bytes `getObjectText` returned. |
| `text` | The buffer being edited, shared by all three tabs. |

Derived: dirty ⇔ `text !== baseline`. **Reset** and **Review & save** are
disabled when clean, and an `Unsaved` badge appears when dirty.

The source is loaded by `objectTextQueryOptions` (`src/lib/query-options.ts`),
which HEADs first for the real content type and cache header. It is
`staleTime: Infinity` **on purpose** — a background refetch that swapped the
baseline under an open editor would silently redefine "unsaved changes". The
save path writes the new body into that cache entry itself.

There is no autosave, no draft persistence, and no lock. Navigating away
discards the buffer without warning, and two tabs editing the same key is
last-write-wins.

## The three tabs

| Tab | Component | Available for |
|---|---|---|
| Rich text | `components/rich-markdown-editor.tsx` (Tiptap) | `markdown` only |
| Code | `components/code-editor.tsx` (CodeMirror 6) | every language |
| Preview | `components/rich-text-viewer.tsx` | every language |

All three read and write the same `text` buffer, so switching tabs mid-edit
keeps the changes and the preview follows the buffer without a save round trip.
Markdown opens in Rich text; everything else opens in Code.

Both editors are `React.lazy` imports. Together they are ~1.1 MB raw and only
this route uses them; the rest of the app must not pay for that.

### Rich text is Markdown-only, deliberately

The document of record is always the text buffer. `tiptap-markdown` parses
Markdown into the ProseMirror document on the way in and serialises it back on
the way out, so `onChange` hands back Markdown and `putObjectText` writes the
same kind of bytes it always did — **the rich editor never produces HTML for a
`.md` file.**

The Notion feel is StarterKit's input rules (`# `, `- `, `> `, ``` , `**bold**`
convert as you type), not a slash-command palette.

HTML, JSON and YAML get **no** rich mode. An HTML document through a ProseMirror
schema loses `<head>`, attributes and scripts — round-tripping it would silently
destroy the file. JSON and YAML have no rich form at all. For those, syntax
safety comes from the code editor's diagnostics instead.

Ceiling: a Markdown round trip through a parser normalises formatting (`*`
bullets become `-`, setext headings become ATX, wrapping is redone). The Code tab
is the byte-exact editor. The editor guards against fighting itself with an
`emitted` ref: incoming `value` that differs from its own last output is an
outside edit (Reset, or a switch back from Code) and gets pushed into the
document; echoing its own output back would reset the cursor on every keystroke.

### Diagnostics — the error lens

`lintText(text, lang)` in `src/lib/richtext.ts`. No language server; two
checkers, each chosen because it answers the question an editor actually asks.

| Lang | Checker | Reports |
|---|---|---|
| `json`, `yaml` | Prettier (already a dependency) | first parse error |
| `html` | `htmlhint`, dynamically imported | every error |
| `markdown`, `text` | none | — |

**JSON and YAML: the syntax check is the formatter.** Prettier already parses
both, so "it does not format" and "it does not parse" are the same question and
the answer costs nothing new.

**HTML needed its own checker, and the obvious candidates were measured and
rejected** — this is the part to not re-litigate from first principles:

| Candidate | Why not |
|---|---|
| Prettier `html` parser | Error-tolerant. Silent on `<div><p>hi</div>` and on a stray `</span>`. |
| lezer (`@codemirror/lang-html`, already installed) | Same. Error nodes only for an unterminated attribute string. |
| `parse5` | Reports HTML5 *spec* parse errors — a different question. Fires `missing-doctype` on every fragment, and still says nothing about an unclosed `<div>`, because the spec tolerates one. |
| `html-validate` | A whole rule engine. Far too heavy for one lens. |

`htmlhint` catches unclosed tags, stray close tags and duplicate ids with exact
positions, stays silent on valid HTML5 (void elements, unquoted attributes, bare
fragments), and is a 12.6 kB gzipped chunk loaded only when an HTML file opens.

Its **default ruleset is not used**: that carries style opinions (lowercase tag
names, double-quoted attributes, doctype required, `<title>` required) which
would light up correct files pulled out of a bucket. `HTML_RULES` is syntax
only.

Every checker's position is normalised to a document offset. Prettier reports
`cause.index` (babel), `loc.start.offset` (yaml) or only line/column; htmlhint
reports 1-based line/column plus the offending `raw` text. `clampStart` keeps
every range at least one character wide — **a parse failure at EOF produces a
zero-width range, and CodeMirror draws nothing for it**, so the error would be
invisible. `richtext.check.ts` covers this.

CodeMirror renders a diagnostic as a wavy underline on the offending token plus
a gutter marker with the message on hover; the page header shows a red badge and
the save drawer lists the messages. The squiggle is
`text-decoration: underline wavy` rather than CodeMirror's stock SVG background
image — drawn by the text engine, so it stays crisp at any zoom and tracks the
font. `text-decoration-skip-ink: none` keeps it continuous under descenders.

A syntax error **never blocks a save**. Sometimes the point of an edit is to
hand-fix a file the parser hates. It must never be invisible either.

## Language detection and formatting

`src/lib/richtext.ts`. Language detection is **extension-first**, content-type
second: buckets are full of JSON and Markdown stored as
`application/octet-stream` or `text/plain`.

| Lang | Preview tab | Formatter | Diagnostics |
|---|---|---|---|
| `markdown` | `marked` → `DOMPurify.sanitize` → `.markdown-body` | Prettier `markdown` | none |
| `html` | `<iframe sandbox="" srcDoc>` | Prettier `html` | htmlhint |
| `json` | source as-is | Prettier `babel` + `estree` | Prettier |
| `yaml` | source as-is | Prettier `yaml` | Prettier |
| `text` | source as-is | none — no Format button | none |

Markdown is deliberately **not** linted: Prettier's markdown parser accepts
anything, so linting it would load a 270 kB plugin on every keystroke to always
return `[]`.

### Prettier loading

Prettier is dynamically imported, and `formatterByLang[lang].load()` pulls **only
that parser's plugins**. Loading all of them to reformat one JSON file costs
~350 kB gzipped. Each parser is its own Vite chunk; nothing lands in the initial
bundle.

### Auto-format on open

The edit route formats the file into `text` while leaving `baseline` as the
**raw bucket bytes**. That asymmetry is deliberate: the diff that drives the
Save button then reflects a real difference against S3, so saving a reformatted
file genuinely persists the reformat, and **Reset** returns the original bytes.
Formatting is best-effort — `formatTextOrKeep` returns the input unchanged when
the file does not parse, so a malformed JSON object is still openable and
editable.

### Sanitization

Markdown may contain raw HTML, so `renderMarkdown` pipes `marked` output through
DOMPurify. HTML files are not sanitized — they are rendered in a
`sandbox=""` iframe, which blocks scripts, forms, popups and same-origin access.
Sanitizing there would misrepresent the file the operator is editing.

## Save pipeline

**Review & save** does not save. It opens the save drawer, which is the
last-look-before-writing step:

- the rendered preview of the buffer, plus the exact raw bytes behind a
  `<details>`, its encoded size and line count;
- any syntax error, as a destructive alert — you may still save;
- the `Cache-Control` to write (see [cache-control](11-cache-control.md));
- the purge command for the key.

Its **Save file** button runs `saveMutation(cacheControl)` →
`putObjectText(provider, bucket, key, text, contentType, cacheControl)`.

`putObjectText` (`src/lib/s3.ts`) does three things, in order:

### 1. Preserve metadata

```ts
const existing = await headObject(provider, bucket, key).catch(() => undefined);
```

A `PutObject` overwrite **replaces all object metadata**. Without this head, every
save silently wipes `Cache-Control`, `Content-Disposition`, `Content-Language`, and
all custom `x-amz-meta-*` headers. So the existing values are read and passed
through.

`CacheControl` is the one field a caller may override: an explicit argument wins,
and the existing header is the fallback. Everything else is preserved
unconditionally.

`ContentEncoding` is deliberately **not** carried forward: the browser already
decoded the body on read, so re-declaring `gzip` would describe bytes that are no
longer gzipped. Restoring it would corrupt the object.

The head is best-effort (`.catch(() => undefined)`) so creating a brand-new key
still works.

### 2. Write

`PutObject` with the buffer as a string body. Content type precedence: caller's
override → existing content type → `resolveObjectContentType(key)`.

String bodies are UTF-8 safe here: the SDK computes `Content-Length` with
`TextEncoder().encode(body).byteLength`, so multi-byte content (emoji, CJK,
accents) is not truncated.

### 3. Read back — the reliability guarantee

```ts
const written = await getObjectText(provider, bucket, key);
if (written !== text) throw new Error("Save did not stick: ...");
```

**A 200 from `PutObject` is not proof that a reader gets the bytes back.** The
read-back is what turns "the request succeeded" into "the file is changed". It
catches stale caches, write-through oddities, and permission configurations that
accept a write without persisting it.

It lives in `lib/s3.ts`, not in the route, so every current and future caller of
`putObjectText` inherits it.

Cost: one extra `GET` per save. For text files that is negligible, and it is the
difference between reporting a save and knowing one.

### 4. Purge, or say it wasn't purged

Back in `saveMutation`, branching on `canPurge(provider)`:

- **AWS** — the edited key is invalidated in CloudFront. A purge failure is
  reported as `"Saved, but the CDN purge failed: …"`; it must never read as a
  failed save, because the bucket really was written.
- **R2 with purge credentials** — the app *cannot* purge (Cloudflare's API refuses
  browser calls), so it reports `"CDN not purged — open Purge cache for the command
  to run."` Saying nothing here would recreate the original bug in a new place: the
  operator would believe the change is live when the edge still serves the old
  copy.

Details in [cdn-purge](07-cdn-purge.md).

### 5. Settle

On success: `setBaseline(saved)` (the new baseline, so the buttons go clean), the
`["object-text", …]` cache entry is rewritten with the saved body so a return
visit does not read back the pre-save copy, a status message naming the bucket,
and `invalidateQueries(["objects", providerId, bucket])` to refresh size and
last-modified in the listing.

On failure: `setErrorMessage(...)`, and the baseline is **not** advanced — the
buffer stays dirty and the user can retry. This is why the read-back must throw
rather than warn.

## Why the read-back is trustworthy

The read-back is worthless if the browser can answer it from its HTTP cache with
the old body — and **for a period it could**, which made every save report
`"Save did not stick"` on a write that had landed.

This page previously argued the cache was harmless because RFC 9111 §4.4
invalidates a stored response after an unsafe method on that URI. The premise
fails: the SDK writes to `?x-id=PutObject` and reads from `?x-id=GetObject`, which
are different cache keys, so the invalidation never fires. Measurement and detail
in [caching-layers](08-caching-layers.md#-browser-http-cache).

What makes it trustworthy now is `ResponseCacheControl: "no-cache"` on
`getObjectText` (and on the other reads). Do **not** substitute
`requestHandler: { cache: "no-store" }` — that was tried and breaks every request
with `Failed to fetch` by adding non-CORS-safelisted request headers. See
[s3-client](03-s3-client.md).

## History

The originally reported bug — "it says it saved, but on refresh the changes are
gone" — was three defects stacked:

1. **No feedback.** The status state was `_statusMessage`: set in a dozen places,
   rendered nowhere. A failing save looked identical to a succeeding one.
2. **No verification.** A 200 from `PutObject` was treated as proof the bytes
   landed.
3. **No purge.** A stale CDN copy outlived a correct write.

A fourth cause — browser HTTP caching — was *diagnosed, mis-fixed, wrongly
dismissed, and finally confirmed*, in that order:

1. Diagnosed by guess; "fixed" with `cache: "no-store"`, which broke every request with `Failed to fetch`.
2. The fix was reverted and the theory dismissed via RFC 9111 §4.4 — a correct citation with a false premise (`x-id` makes the read and write different URIs).
3. Later measured directly and confirmed real; fixed properly with `ResponseCacheControl`.

Three lessons worth keeping. An operation that reports success without verifying
it, in a UI that cannot show failure, is indistinguishable from a no-op. A
plausible mechanism is not a confirmed one. And **a spec citation is not a
measurement** — step 2 replaced an unmeasured theory with an unmeasured
counter-theory and stayed wrong for longer.

## Ceilings

- No slash-command menu in the rich editor — Markdown input rules and a fixed
  toolbar only. A Tiptap `suggestion` extension would be the upgrade.
- Rich text is Markdown-only, and normalises formatting. See above.
- No large-file strategy: whole file in memory, whole file rewritten on save,
  and CodeMirror gets the entire document.
- No conflict detection. A stale `If-Match: ETag` precondition would be the fix.
- Diagnostics are syntax only, not a language server. JSON and YAML report one
  error at a time (Prettier stops at the first); HTML reports all of them. No
  semantic checks anywhere: no JSON Schema, no "does this `href` resolve", no
  cross-file anything. Markdown and plain text get nothing.
- No formatter for XML or CSS — `detectTextLang` returns `text`, so they are
  editable, highlight-free and not formattable.
- `.md` files *preview* only CommonMark + GFM as `marked` implements it: no
  front-matter handling, no Mermaid, no syntax highlighting in fenced blocks.
  Front matter also has no special handling in the rich editor.

## Runnable checks

`node src/lib/richtext.check.ts` covers language detection, the diagnostic offset
normalisation for all three parsers, that every range is at least one character
wide, and — the case that matters most — that **valid** HTML5 and bare fragments
report nothing. A lens with false positives is worse than no lens.
`node src/lib/cdn.check.ts` covers the purge-target logic the save path depends
on.

Not covered, and needing a browser plus a scratch bucket: the S3 round trip, and
the Tiptap Markdown round trip (open a `.md` file with lists, code fences and
inline HTML, save it, and confirm the bytes that come back are Markdown).

## Relations

- `depends-on` → [s3-client](03-s3-client.md), [cache-control](11-cache-control.md)
- `triggers` → [cdn-purge](07-cdn-purge.md)
- `explained-by` → [caching-layers](08-caching-layers.md)
- `hosted-by` → [browsing](04-browsing.md)
- `troubleshot-by` → [failure-modes](09-failure-modes.md)
