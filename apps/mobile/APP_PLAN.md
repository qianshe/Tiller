# Mobile App Scaffold Plan

## Suggested future shape

```text
apps/mobile/
  README.md
  APP_PLAN.md
  package.json
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
    README.md
  assets/
    .gitkeep
```

## Frontend architecture defaults
- Use the same `app / features / shared / store` layering as `apps/deck`.
- `app` composes routes, providers, and store wiring only.
- `app` must import feature behavior through `features/<feature>/index.ts` only.
- Feature-owned UI, hooks, actions, utils, and types stay inside the owning feature until there is proven reuse.
- Reuse protocol/types from `packages/shared` and `packages/sync-protocol`, but do not couple mobile to Deck-only UI or shell code.

## Recommended stack later
- Expo + React Native
- shared protocol/types from `packages/shared` and `packages/sync-protocol`
- mobile-first session inbox, approval center, and session detail views

## Not done yet
- no dependency install
- no runtime entrypoint
- no navigation/runtime implementation
