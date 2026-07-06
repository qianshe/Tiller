import type { AcpSessionUpdateProjection, AcpSessionUpdateProjectionContext } from "../types";
import { mapCodexCompactionUpdate } from "./compaction-events";
import { mapCodexPlanUpdate } from "./plan-events";

export function mapCodexSessionUpdate(
  context: AcpSessionUpdateProjectionContext,
): AcpSessionUpdateProjection | null {
  const compaction = mapCodexCompactionUpdate(context);
  if (compaction) {
    return compaction;
  }
  return mapCodexPlanUpdate(context);
}
