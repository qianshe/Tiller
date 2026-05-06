export function buildMissionEffectsSource(ctx: any) {
  return {
    ...ctx.runtimeState,
    ...ctx.deckData,
    ...ctx.missionView,
    ...ctx.helmConnection,
    ...ctx.controllers,
    ...ctx.history,
    ...ctx.route,
    ...ctx,
  };
}
