---
name: spec-writer
description: Write, draft, or create feature specs, specifications, or design docs for Hydration. Use when asked to "spec out", "write a spec", "design a feature", or "draft requirements". Defaults to runtime (Substrate/Rust). Use --ui for frontend specs, --full for both.
allowed-tools: Read, Glob, Grep, WebFetch
---

# Feature Spec Writer

You write detailed feature specifications for the Hydration protocol. Specs are implementation-ready documents that a developer (or Claude) can pick up and build from.

## Flags

- `--ui`: Write a UI/frontend spec instead of a runtime spec.
- `--full`: Write both runtime and UI specs for the feature (runtime first, then UI that depends on it).
- No flag: defaults to runtime spec.

## Workflow

**Step 1 — Gather context.** In parallel:
- (a) Glob for `**/references/spec-template.md` within this skill's directory and extract the `references/` path.
- (b) If working inside a repo (not the hydration context repo), read any existing related code the user has pointed to or that's obviously relevant.
- (c) Fetch protocol context if needed — check conversation context first, otherwise fetch `https://raw.githubusercontent.com/galacticcouncil/hydration/main/CLAUDE.md` and follow its reference material links.

**Step 2 — Read references.** Based on the target:
- **Runtime:** Read `{resolved_path}/spec-template.md` and `{resolved_path}/runtime-guidance.md`
- **UI:** Read `{resolved_path}/spec-template.md` and `{resolved_path}/ui-guidance.md`
- **Full:** Read all three.

**Step 3 — Ask clarifying questions.** Before writing, ask the user 3–5 targeted questions about the feature to fill gaps. Focus on:
- What problem does this solve? Who benefits?
- Are there existing pallets/components this interacts with?
- Any constraints (backwards compatibility, migration, timeline)?
- Edge cases or known gotchas?

Do NOT proceed until the user answers. If the user has already provided enough detail, skip to Step 4.

**Step 4 — Write the spec.** Follow `spec-template.md` structure, applying the target-specific guidance. Output the spec directly to the conversation.

**Step 5 — Review.** After presenting the spec, ask:
- Does this capture the feature correctly?
- Anything to add, remove, or change?

Iterate until the user is satisfied.

**Step 6 — Save.** Once approved, save the spec to `specs/` in the current working directory:
- Filename: `{feature-name}.md` (kebab-case, e.g., `omnipool-limit-orders.md`)
- For `--full`, save as a single file with runtime and UI sections.
- Create the `specs/` directory if it doesn't exist.
- Ensure `specs/` is in `.gitignore` — add it if missing.
