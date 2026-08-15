import {
  applyActivityUpdate,
  applyErrorRaised,
  applyNotificationRaised,
  applyNotificationCleared,
  applyNotificationResult,
} from "./activity-events";
import { applyDeviceResult } from "./device-events";
import { applyInventoryResult } from "./inventory-events";
import { applySessionResult, applySessionUpdate as applySessionStateUpdate } from "./session-events";

export {
  applyDeviceResult,
  applyInventoryResult,
  applySessionResult,
  applyErrorRaised,
  applyNotificationRaised,
  applyNotificationCleared,
  applyNotificationResult,
};

export function applySessionUpdate(params: any, context: any) {
  return applySessionStateUpdate(params, context) || applyActivityUpdate(params, context);
}
