# Spec Template

## Structure

Every spec follows this structure. Sections marked (optional) can be omitted if not applicable.

```markdown
# Feature: <Name>

## Summary
One paragraph: what this feature does and why it matters.

## Motivation
- What problem does this solve?
- Who are the users/actors?
- What's the current workaround (if any)?

## Design

### Overview
High-level description of how the feature works. Include a diagram if the flow involves multiple components or async steps.

### Interface
Public API surface — extrinsics, RPCs, UI entry points, or SDK methods. For each:
- Name and signature
- Parameters with types and constraints
- Return value / events emitted
- Errors / failure modes

### State Changes (runtime) / State Management (UI)
What new storage items, state atoms, or data structures are introduced? What existing ones are modified?

### Interactions
How does this feature interact with existing components? List every pallet, hook, or component it touches and describe the interaction.

### Migration (optional)
If this changes existing storage or data formats, describe the migration path.

## Constraints
- Backwards compatibility requirements
- Performance / weight budget
- Security considerations
- Governance / parameter configurability

## Edge Cases
Enumerate known edge cases and how each is handled.

## Acceptance Criteria
Bulleted checklist. Each item is a testable statement:
- [ ] Given X, when Y, then Z
- [ ] ...

## Open Questions (optional)
Unresolved decisions that need input before or during implementation.
```

## Guidelines

- Be specific — "handles edge cases" is not a spec, "returns `Error::InsufficientBalance` when free balance < amount + ED" is.
- Acceptance criteria should be directly translatable to test cases.
- Don't spec implementation details (internal function names, variable names) unless they're part of a public API.
- Reference existing Hydration patterns by pallet/component name — the implementer can look them up.
