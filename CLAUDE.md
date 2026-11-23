# gene-glyph development notes

## Orientation

[`README.md`](README.md) says what the library is and how a host uses it. [`docs/design.md`](docs/design.md) is the
architecture and the reasoning behind it; read it before proposing a design or a plan.
[`CONTRIBUTING.md`](CONTRIBUTING.md) holds setup, the test layers, the release flow, the architecture conventions and the
code style. Where this file and `CONTRIBUTING.md` disagree, `CONTRIBUTING.md` wins.

## Working norms

Operating directives for Claude (and any agent) in this repo; they counteract default model dispositions.

- **Resist the minimal-diff reflex.** Don't reach for the smallest change that hides the symptom (special-casing,
  papering over root causes). Aim for the correct fix at the right complexity level — not the smallest, not gold-plated.
- **Fail loudly and early.** Raise on a missing expected input or precondition; never fall back to a default/placeholder
  to limp along. A placeholder is an explicit caller input, never a code default.
- **Never instruct around a defect — fix the defect.** Don't write prose telling readers to work around broken code —
  "pass the variants pre-sorted, the track doesn't sort them". Prose is untested, and callers who didn't read it stay
  broken.
- **Push back; don't just comply.** When a design, name, or approach seems worse — including a shortcut you're asked to
  take — say so with reasoning, unprompted. The author owns the final call.
- **Offer better alternatives with trade-offs.** When a materially better approach than the proposed one exists, present
  it and the trade-offs — don't just execute the ask.
- **Investigate before producing.** Read the code and verify constraints first. Don't treat a training-pattern
  convention as load-bearing unchecked; don't speculate about what you can read.
- **Explain non-obvious changes first.** For a change whose rationale isn't self-evident, give the why before showing or
  applying the diff.
- **Ask when unsure** rather than assume intent.
- **No intensifiers or emphasis filler.** Drop words and phrases that add emphasis but no information — "that's the
  key", "crucially", "importantly", "the key insight", "it's worth noting". State the point plainly. Applies to all
  prose: chat replies, PR/review comments, commit messages, and docs.

## Code style

@docs/style/general.md

## Versioning

The package follows strict semver from 1.0 ([`CONTRIBUTING.md` § Releases](CONTRIBUTING.md#releases)). Before changing
an export, a prop, a track config or rendered behaviour a host relies on, check whether the change breaks an existing
caller. A breaking change needs a 2.0: raise it with the author rather than shipping it under a minor or patch
changeset.

## Committing

- **Stage explicit paths**, not `git add -A` / `.`, so an untracked scratch file or capture never rides along.
- **Every user-facing change to the published package carries a changeset** (`npm run changeset`), committed with the
  change it describes.
- **Never bypass a hook with `--no-verify`.**
- **Correct a pushed branch with a new commit on top**, not amend + force-push. Reserve force-push for rebasing a branch
  onto `main`.

## Worktrees

Worktrees go in `.claude/worktrees/` (gitignored), never `../` siblings.

- **New branch** → the Claude Code worktree command.
- **Existing branch** → `git worktree add .claude/worktrees/<name> <branch>` (the command only cuts fresh branches).

## CI and review

- **Adversarially review before opening a PR.** For any change with non-trivial code or logic, run adversarial review
  passes in subagents with fresh context — the reviewer sees only the diff, not the authoring conversation — and fix the
  findings autonomously; repeat until a pass surfaces only diminishing findings, then open the PR. Exempt: trivial
  changes, doc-only changes, resource/asset changes.
- **A PR description is written for the human reviewer**: what the change is and why, the take-aways, and where to look.
  In an interactive session, a question, an uncertainty or a dropped option meant for the author goes to them in the
  conversation, not the body. Keep the prose under about 200 words; when it runs over, cut topics, not words. The diff
  carries the detail; don't narrate it.
- **A change to the rendered figure or its chrome ships with screenshots** in the PR description — the playground
  scenario before and after, or after alone when it is new. A reviewer cannot see layout, spacing, or state in a diff,
  and prose describing them is unfalsifiable. Start the playground (`npm run dev:playground`), drive the scenario to the
  state under review, and screenshot it. Say so explicitly when a change is not capturable.
- **Pin third-party GitHub Actions to the latest stable release**: the moving major tag (`@v3`) where the action
  publishes one, else the exact latest version (`@v8.2.0`). Verify against the action's releases when adding or bumping
  one.
