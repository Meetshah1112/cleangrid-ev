/** Re-exports so simulator modules import one local path instead of reaching across packages. */
export { MS_PER_HOUR, MS_PER_MINUTE, accessCodeFor, clamp, round, SimClock, realDelayMs } from '@cleangrid/shared';
export type { Clock, ChargingMode, Scenario, ResolvedArrival } from '@cleangrid/shared';
export {
  OCPP_SUBPROTOCOL,
  OcppCallError,
  OcppRpc,
  buildMeterValue,
  ocppSchemas,
} from '@cleangrid/ocpp';
export type {
  ChargingProfile,
  Payload,
  SetChargingProfileRequest,
  StartTransactionResponse,
} from '@cleangrid/ocpp';
