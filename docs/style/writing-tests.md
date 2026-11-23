# Writing tests

This guide states what a test asserts, what it may depend on, how it reads, and what its data may contain. The repo has
two test layers. Unit and integration tests run under Vitest with Testing Library on JSDOM, and sit beside the module
under test in `packages/gene-glyph/src/` as `*.test.ts` or `*.test.tsx`. Browser end-to-end tests run under Playwright
and Chromium against the playground, in `apps/playground/tests/e2e/`. The commands and the slice convention are in
[`CONTRIBUTING.md` § Testing](../../CONTRIBUTING.md#testing). Much of the guidance is distilled from Google's
[Testing on the Toilet](https://testing.googleblog.com/) series, and the headings track its post titles closely enough to
search.

## A test earns its place by the regression it catches

Before keeping a test, name the caller-observable change in behaviour that would make it fail. If no such regression
exists, the test is decoration. If the only change that breaks it moves code around without changing what a caller sees,
the test pins internal structure ([below](#test-at-the-surface-a-caller-uses)). If an existing test already catches that
same regression, the new test duplicates coverage without adding signal. Tests that look like coverage commonly fail
this bar in one of three ways:

- Production logic lands with no test that executes it.
- A test exercises the new code path, but its assertion would also pass against the old behaviour.
- The assertion checks something too weak to catch the regression, such as asserting that the return value is defined or
  that a render did not throw when an unexpected exception was never the risk.

Writing the test before the change and watching it fail proves that the assertion catches the bug. When refactoring test
code, invert that loop: break the production code first, confirm that the expected assertions fail, and keep the suite
red while restructuring the tests. Any test that starts passing mid-refactor lost its check during the edit.

Line coverage shows what has no test at all, not whether covered lines are tested. Dividing by one covers a division
without testing zero, and evaluating the left side of a short-circuit condition covers the line without exercising the
right side. Read uncovered lines to find missing scenarios, and never write a test just to raise a coverage percentage
or to pin a detail no caller can observe, such as wording in a console message or a tuning constant. If coverage is
gated at all, gate the lines a change touched rather than a repository-wide threshold.

## Test at the surface a caller uses

Test a unit through the interface its callers use rather than the private functions behind it. For the library, that
surface is what `packages/gene-glyph/src/index.ts` exports: the `<GeneGlyph>` component and its ref, the track
factories, the adapters and the export functions. For the rendered figure, it is the DOM a host and its users see. For a
behaviour that needs real layout, it is a playground scenario driven through Chromium.

Splitting a module into helpers and writing a test per helper produces a large suite without showing that the module
works. First, a helper test has no independent ground truth: the author works out the expected value by mentally running
the helper, which records the same assumption in both the code and the test. At the caller surface, the expected output
follows from what a host asked for instead of the internal decomposition.

Second, helper tests freeze how the code is split up. A refactor that preserves every caller-visible behaviour should
leave assertions untouched even when test setup changes; when a refactor forces rewrites across the suite, the tests
were asserting internal structure. A helper with a single caller whose paths are all reachable through that caller needs
no tests of its own, and testing it in isolation can pass even when the caller wires it up wrongly.

```tsx
// Bad — tests a single-caller helper; nothing renders the track
expect(tickX(exon, 50)).toBe(342);

// Good — renders the track through the viewer and checks what a user can reach
render(
  <GeneGlyph transcript={transcript} tracks={[variantTrack({ id: 'v', source: [variant] })]} />,
);
expect(screen.getByRole('button', { name: /c\.50A>G/ })).toBeInTheDocument();
```

A helper earns direct tests when driving every case through the outer surface is impractical — such as coordinate
conversion with dozens of strand, UTR and intron edge cases, or a lane-packing routine with many branches — or when
several callers share it. Even then, feed it only inputs a caller can actually produce. Warning signs that a suite has
crossed into testing structure include direct tests of single-caller private functions, tests that mock sibling
modules, and test files where nothing reaches the public entry point.

Validation rules also multiply tests, at one test per rejected state. Before writing a rule and its test, check whether
the type can make the invalid state unrepresentable instead
([`general.md`](general.md#make-the-invalid-state-unrepresentable)).

## Assert invariants, not the current shape

A test that pins today's incidental values — such as a whole serialised SVG or the full list of class names on a
feature — is a _change detector_: it breaks on routine additions without catching defects. State the property that
every valid state must satisfy instead. When production code already enforces that property, pass a violating input and
assert that the enforcement raises, rather than re-checking its valid output with an assertion that can never fail.
Moving from a pinned value to an invariant changes what the test asserts, not whether the behaviour has a test.

```ts
// Good — checks a property no new track or attribute invalidates
it('exported SVG resolves every CSS variable', () => {
  const svg = exportSvgString(exportInput);
  expect(svg).toContain('<svg'); // rules out a vacuous pass on an empty string
  expect(svg).not.toContain('var(--');
});

// Good — tests the enforcement, which can regress, rather than restating valid output
it('rejects an alignment block that lies outside its exon', () => {
  const exon: Exon = {
    number: 1,
    cdsStart: 1,
    cdsEnd: 100,
    genomicStart: 1000,
    genomicEnd: 1099,
    chr: 'chr1',
  };
  exon.blocks = [{ cdsStart: 90, genomicStart: 1089, length: 20 }]; // ends at c.109
  expect(() => createCoordinateMapper({ ...transcript, exons: [exon] })).toThrow(/lies outside/);
});

// Bad — change detector: every added attribute or reordered element has to edit this
it('exports the figure', () => {
  expect(exportSvgString(exportInput)).toMatchSnapshot();
});
```

- **Narrow assertions.** Assert only the fields relevant to the behaviour under test. Whole-object equality checks every
  unrelated field as well, so adding a field to a track's `toJSON` output breaks tests about unrelated behaviour. Keep at
  most one whole-object equality check per type to cover basic construction, and narrow the rest.
- **Pin values only when policy freezes them.** Strict semver freezes the public exports within a major version, so a
  test that a 1.0 export still exists catches an accidental removal rather than blocking valid changes. Ask whether a
  valid future change could alter the value; if it can, assert the invariant instead.
- **Reserve visual snapshots for what a DOM assertion cannot express.** A Playwright screenshot comparison is a change
  detector by construction, so use it for appearance — a stroke width under zoom, an overlap — and assert structure and
  text through locators. Regenerate a snapshot only after a deliberate UI change, and look at the new image before
  committing it.
- **Compare computed floats with a tolerance.** Values produced by arithmetic — screen positions, scale factors — carry
  rounding error and should be checked with `toBeCloseTo` rather than `toBe`. Numbers taken directly from a fixture
  without arithmetic compare exactly.
- **Assert results, not call sequences.** Asserting the exact sequence of calls on mocked collaborators repeats the
  implementation and can pass while the output is wrong ([below](#test-doubles-in-order-of-fidelity) covers when
  verifying a call is warranted).
- **Bind cross-cutting enumerations with an exhaustiveness test.** When every member of a union — a variant category, a
  view mode — must be named, styled and serialised across several surfaces, one test iterates over every member so that
  adding a case fails until every consumer handles it.

## One behaviour per test, named for it

Write each test around a single behaviour rather than an entire function. If a click on a variant both selects it and
calls the host's `onFeatureClick`, give those behaviours separate tests; naming a test after the function name alone
usually signals that several cases were bundled together. Acting on the system under test a second time after an
assertion is another warning sign, because a failure in the first check hides whether the second scenario still works.
Multi-step interactions belong in one test only when the sequence itself is the behaviour under test, such as a mode
transition, a drag that starts and ends a brush, or open-edit-confirm in a modal.

Name each test after the scenario and the expected outcome so a failure log states what broke and the test names read as
a specification of the unit. If a test name needs "and" to describe two outcomes, split the test.

Failures should let an engineer diagnose the problem without adding logging and rerunning. Prefer assertions that print
values on failure: `expect(a).toEqual(b)` prints a structural diff whereas `expect(result.ok).toBe(true)` prints only
`expected false to be true`, and `toThrow(/lies outside/)` guards against catching an unrelated error from setup. In
Playwright, a web-first assertion such as `await expect(locator).toHaveAttribute(...)` reports the locator, the last
value it saw and the timeout. When a test depends on an earlier step succeeding (such as a scenario finishing its load
before a feature is inspected), assert that precondition first with a clear message so setup failures are not misread
as assertion failures in the behaviour under test.

## A test reads without its reader leaving it

Because test code has no test suite checking it, readers verify a test by reading it from top to bottom, which requires
keeping everything the assertion depends on in view. Production code avoids duplication, whereas test code favours
explicitness (often called DAMP, for descriptive and meaningful phrases): repeat a few lines of setup rather than hiding
cause and effect behind shared mutable state, a helper that acts and asserts internally, or a `for` loop around
assertions. `it.each` keeps literal inputs paired with literal expected outputs and reports each failing row
independently, whereas a loop inside a single test stops at the first failure.

```ts
// Bad — computes the expected value with the same arithmetic, and relies on a hidden default length
const transcript = makeTranscript();
expect(formatCdsPosition({ cPos: 1205, offset: 0 }, transcript.cdsLength)).toBe(
  `c.*${1205 - transcript.cdsLength}`,
);

// Good — sets the asserted input in the test body and checks against a literal expectation
const transcript = makeTranscript({ cdsLength: 1182 });
expect(formatCdsPosition({ cPos: 1205, offset: 0 }, transcript.cdsLength)).toBe('c.*23');
```

- **Keep logic out of tests.** Write inputs and expected outputs as literals, or reference named constants exported by a
  fixture; computing expectations in the test risks duplicating a production bug. If non-trivial formatting or traversal
  is unavoidable, extract a dedicated test helper and test that helper directly.
- **Set asserted values in the test body.** Leave routine scaffolding to fixtures and builders, and pass every value an
  assertion depends on explicitly in the test body — even when the builder's default happens to match — so a reader
  never has to jump two hundred lines away to see why the expected number is right.
- **Use one builder with overrides rather than a helper per combination.** Provide a zero-argument factory that
  populates required fields with sensible defaults and spreads a partial override over them
  (`makeVariant({ category: 'splice' })`), letting each test override only the fields relevant to its case. Positional
  setup helpers that gain a parameter per new test force churn across unrelated tests whenever a type grows.
- **Pick input values that can expose bugs.** Avoid type defaults such as `0` or `''` where an uninitialised or dropped
  field would produce the same value, and use distinct values for distinct arguments of the same type so swapped
  parameters fail the test: a genomic start of 1000 and a CDS start of 1 cannot be confused, two starts of 100 can.
  Cover empty inputs, boundary values (the first and last base of an exon, a minus-strand transcript), and
  representative complex inputs in separate tests or `it.each` rows.
- **Parametrise inputs to one behaviour, never distinct behaviours.** Adding flags or branches to a parameter table to
  steer different assertions obscures which behaviour broke and introduces branching logic into the test itself.
- **Assert the property when order or wording is incidental.** Tests that break on set iteration order, attribute order,
  or routine wording tweaks in error messages should assert unordered membership, a structural predicate, or a targeted
  substring match instead.

## Deterministic by construction

A flaky test — one that passes and fails on the same commit — erodes trust in the suite faster than a deterministic
failure, because engineers learn to shrug off red runs and cannot trust green ones. Diagnose the root cause rather than
rerunning. CI retries a failed Playwright test, and a test that passes only on retry is reported as flaky; treat that
report as a failure to fix, not a pass. The rules below govern variance inside the test:

- **Never use a fixed sleep to wait for asynchronous work.** `page.waitForTimeout` and a `setTimeout` promise are
  sleeps. Wait on the condition itself instead: a web-first assertion, `expect.poll`, or an attribute the viewer sets
  when a transition or a load finishes. These finish immediately on fast runs and bound failures when work stalls. In
  Vitest, drive timers and debounces with `vi.useFakeTimers()` and advance them explicitly, and block a fake data source
  on a promise the test resolves when it needs to control an interleaving.
- **Pass time, randomness, and environment as explicit inputs.** Code that reads the clock, `Math.random`, or
  `window.matchMedia` directly cannot be tested cleanly at a boundary; accept the value or a callable instead. Playwright
  runs pin the colour scheme and emulate reduced motion explicitly for the same reason.
- **Isolate every test's state.** Suites must tolerate arbitrary execution order and parallel workers, so each unit test
  renders its own tree and builds its own data source, and each Playwright test starts from a fresh page. Restore any
  mutated global — a stubbed `fetch`, fake timers — in the test's teardown.

## Test doubles, in order of fidelity

A test double's fidelity is how closely its behaviour matches the production dependency. Prefer, in descending order:
the real implementation, a _fake_ (a lightweight working implementation such as an in-memory data source), and last a
_stub_ or _mock_ whose responses are scripted for a single test. Use the highest-fidelity option that stays offline. Any
ad-hoc stand-in whose return values are hard-coded inside the test counts as a stub or mock regardless of what it is
called, because it encodes only what the test author assumed the dependency would do.

```tsx
// Bad — scripts a mock and verifies a read call rather than checking the outcome
const query = vi.fn().mockResolvedValue([variant]);
render(
  <GeneGlyph
    transcript={transcript}
    tracks={[variantTrack({ id: 'v', source: { id: 's', query } })]}
  />,
);
expect(query).toHaveBeenCalledWith(
  expect.objectContaining({ transcriptId: 'NM_TEST.1' }),
  expect.anything(),
);

// Good — runs against a working fake and asserts what the user sees
const source = fakeDataSource({ 'NM_TEST.1': [variant] });
render(<GeneGlyph transcript={transcript} tracks={[variantTrack({ id: 'v', source })]} />);
expect(await screen.findByRole('button', { name: /c\.50A>G/ })).toBeInTheDocument();
```

- **Fake at the lowest boundary.** Fake the `DataSource` or the `fetch` an adapter calls rather than every layer above
  it, which runs more real code and maintains fewer doubles.
- **Run a shared contract suite against both the fake and the real implementation.** When a fake stands in for a real
  data source or adapter, write one behavioural suite against the interface and run it against both, so the fake cannot
  drift from what it imitates.
- **Do not mock third-party types directly.** Mocking React, Testing Library or a browser API bakes in today's reading of
  its behaviour; if an upgrade changes it, mocked tests stay green while production breaks. Use the real library, or
  move the test to the layer that has the real thing. JSDOM has no layout, so `getBBox`, `getScreenCTM` and computed
  transforms return nothing useful there; a behaviour that depends on real geometry belongs in a Playwright test rather
  than behind a stubbed geometry API.
- **Verify state-changing commands, never queries.** Asserting that a getter or a data-source query was called proves
  nothing about how its return value was used and breaks if caching or refactoring alters the read path. Stub queries to
  supply inputs and assert on rendered output or returned values, reserving call verification for side effects that
  _are_ the contract — such as calling a host callback once per click, or making one upstream fetch per cache miss.
- **Match only relevant arguments when verifying a call.** Asserting every argument on a verified call couples unrelated
  tests to every parameter addition and obscures which argument matters to the scenario; use `expect.objectContaining`
  and `expect.anything()` for the rest.
- **Watch for over-mocking.** Needing more than one or two mocked collaborators, scripting multi-method call chains, or
  reading production code line by line to understand why a test sets up its mocks indicates that the test is coupled to
  implementation details rather than a clean boundary.

## Tests run with no network

CI runs both layers on every push and pull request, and a test that depends on a live external service fails whenever
that service is slow, rate-limited or changed, for reasons unrelated to the change under test.

- **Adapters** (ClinVar, RMC) are tested against a fake `fetch` that replays recorded or hand-built
  upstream responses, never against the live API.
- **Playwright tests** drive playground scenarios that read committed fixtures. Where a scenario calls an external
  service, the test intercepts the request with `page.route` and fulfils it from a fixture.
- **Unused dependencies fail on contact.** When a scenario should not touch an upstream, wire in a double that throws if
  called, so accidental coupling fails loudly.
- **UI behaviour is tested through the rendered component.** Render, trigger user actions, and assert what appears in the
  DOM rather than calling event handlers directly, since a direct handler call still passes when the element wired to it
  is disabled or covered.

## A fixture is an independent oracle

Generating expected values with the code under test only verifies that the code can read back its own mistakes; any bug
shared by the writer and the reader passes undetected. The same blind spot arises when a helper test's expected output
is derived from reading the helper ([above](#test-at-the-surface-a-caller-uses)). Take expectations from an independent
authority instead: a coordinate conversion is checked against positions worked out by hand from the exon table written
in the test, or against the c. position a reference tool reports for the same variant, and an exported SVG is checked by
parsing it with the browser's own `DOMParser` rather than with the serializer that produced it.

Avoid hand-copying a contract into a fixture for the same reason. A fixture typed as the library's own `Transcript` or
`ViewerVariant` cannot drift from those types silently, whereas an untyped literal can. A fake stays honest by running the
same contract suite as the implementation it imitates ([above](#test-doubles-in-order-of-fidelity)).

## Test data

The repository is public. Test data is synthetic, or drawn from public reference sources such as a published gene model
or a public ClinVar record. Nothing in a fixture may be derived from a patient or an unpublished case.

## Where tests live

Unit tests sit beside the module under test in `packages/gene-glyph/src/`, named `*.test.ts` or `*.test.tsx`; the Vitest
`include` pattern in [`packages/gene-glyph/vite.config.ts`](../../packages/gene-glyph/vite.config.ts) collects them.
Browser tests live in `apps/playground/tests/e2e/` and drive scenarios under `apps/playground/src/scenarios/`; naming
follows the slice convention in [`CONTRIBUTING.md`](../../CONTRIBUTING.md#slice-convention). The published package
never imports test code.
