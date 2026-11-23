# Code style — language-agnostic

Principles independent of language. The TypeScript conventions build on this doc: formatting, linting and strict-mode
rules live in [`CONTRIBUTING.md` § Code style](../../CONTRIBUTING.md#code-style) and
[`eslint.config.js`](../../eslint.config.js), and on conflict they win for TypeScript. Before writing or reviewing tests,
read [`writing-tests.md`](writing-tests.md) for what a test asserts, what it may depend on, how it reads, and what its
data may contain. Code properties only — behavioral directives (push back, resist the minimal fix) live in
[`../../CLAUDE.md`](../../CLAUDE.md).

## Fail loud; never silently degrade

Raise on missing or malformed data; don't paper over it with `x ?? []`, `x ?? {}`, or a bare `if (x)` that skips the
real case — that turns a missing input into a silent wrong answer. Validate and fail early.

An empty result is a valid answer, not a license for code to swallow missing inputs: a variant source with no records in
the transcript's window draws an empty track. A track that draws nothing because a fetch failed or a field was absent
has manufactured that answer from missing data.

## Make the invalid state unrepresentable

Before writing a validation rule, ask why the value it rejects can be expressed at all. A field derived from another
cannot disagree with it. A type that admits only valid values needs no check, and a record nested inside its owner
cannot dangle. Reshaping the type removes the validation rule, the failure it guarded against, and the test that rule
would have needed, for every caller at once rather than only the paths a test reaches. Take a child record that repeats
its parent's identifier and joins to it by reference. That layout admits three errors (the pair disagreeing, the
reference naming nothing, and the repeated name drifting), so it needs three rules and three tests. Nested under the
parent and declaring only what it adds, it admits none.

Fail loud ([above](#fail-loud-never-silently-degrade)) governs the invalid input that can still arrive from a host, a
fetch, or a caller outside the type system. Prefer the shape that cannot hold the error; validate what remains, and test
that validation ([`writing-tests.md`](writing-tests.md)).

## Comments

Default to _no_ comment. Add one only for a non-obvious _mechanism_ or _constraint_ a reader cannot recover from the
code — tersely, one line where possible. The _why_ (why this shape was chosen) belongs in
[`docs/design.md`](../design.md) or the doc comment, not inline; never duplicate what a doc already states. A design-doc
citation (`§8`, `see design.md §8`) _inside_ a comment that also explains the design is the tell you are restating the
doc — cut the explanation; a bare one-line pointer is fine. No history narration ("removed X", "switched from Y"), no
reference to a transient project artifact ("this slice", "this spike", "this PR", "as X lands") — name the durable
behavior, not the moment it arrived — no commented-out code, no persuasion: write as if the current shape always existed.
Self-check: a comment that stays true after the code beneath it is rewritten is describing intent, not mechanism.

```ts
// Bad — rationale, persuasion, and the design doc already states this
const cache = new Map<string, Promise<Data>>(); // a plain map, not an LRU: eviction
// adds complexity we don't need yet, only pays off above N tracks — the whole
// point of staying simple ...

// Good — one non-obvious fact; the why stays in the doc
const cache = new Map<string, Promise<Data>>(); // holds the promise: concurrent loads share one fetch
```

```ts
// Bad — paraphrases the design doc and cites the section; intent, not mechanism
// Motion lives in CSS, not JS (design.md §8): SVG attribute transitions are
// inconsistent across browsers, so we drive a transform on the wrapping <g>
// from CSS custom properties instead of interpolating attributes.
group.style.transform = `translateX(var(--vv-exon-x-${i}))`;

// Good — the one non-obvious mechanism, terse
group.style.transform = `translateX(var(--vv-exon-x-${i}))`; // set on the SVG root by the viewport
```
