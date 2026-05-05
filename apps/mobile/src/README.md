# Mobile Source Placeholder

Future source root for the native/mobile Command Deck.

## Planned source layout

```text
src/
  app/
    shell/
    routing/
    composition/
    state/
  features/
    mission/
    approvals/
    pairing/
    settings/
  shared/
    ui/
    utils/
  store/
```

## Rules carried from Deck
- `app` only owns composition and route wiring.
- `app` imports feature behavior through `features/<feature>/index.ts` only.
- Feature-owned UI, hooks, actions, utils, and types stay inside the owning feature.
- Shared code is added only after real reuse exists.

Suggested first screens:
- mission inbox
- pending approvals
- mission detail
- workspace selector
- settings / device pairing
