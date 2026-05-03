# License Strategy

This is a product and legal planning note, not legal advice.

## Current status

Tiller is currently **not open source**. The repository uses an all-rights-
reserved `LICENSE`, and the publishable package metadata should remain
`UNLICENSED` until the product and distribution model are stable.

Reasoning:

- The product behavior is still changing.
- npm publishing and GitHub tagging are paused.
- Granting an open source license too early is difficult to undo for already
  published copies.

## Recommended future choices

### Option A: Apache-2.0

Best when the goal is broad adoption with an explicit patent grant.

Pros:

- Familiar to companies.
- Permissive and npm-friendly.
- Includes patent language.

Tradeoff:

- Allows competitors to use the code commercially.

### Option B: MIT

Best when the goal is maximum simplicity and minimal friction.

Pros:

- Very short and widely understood.
- Easy for developers to adopt.

Tradeoff:

- No explicit patent grant.
- Also allows commercial reuse.

### Option C: AGPL-3.0

Best when the goal is strong copyleft, including network-service use.

Pros:

- Forces public modifications to remain open under compatible terms.
- Better aligned with open infrastructure projects that want reciprocity.

Tradeoff:

- Higher adoption friction for companies.
- May conflict with future commercial plans.

### Option D: Source-available / commercial license

Best when the goal is public code visibility without OSI open-source rights.

Pros:

- Preserves commercial control.
- Can be paired with paid licensing later.

Tradeoff:

- Not open source.
- More legal and community communication overhead.

## Suggested path

For now:

1. Keep `LICENSE` as all-rights-reserved.
2. Keep `apps/helm/package.json` license as `UNLICENSED`.
3. Do not publish npm or GitHub releases.
4. Revisit after the release checklist passes.

If Tiller is intended to become a broadly adopted developer tool, Apache-2.0 is
the default recommendation. If commercial defensibility is more important, keep
source closed or use a source-available/commercial model after legal review.
