import type { ConnectorStatus } from '@cleangrid/shared';

/** The subset of OCPP 1.6J this project speaks. Field names are the wire names, verbatim. */

export const OCPP_SUBPROTOCOL = 'ocpp1.6';

/** Charge point to central system. */
export const CHARGE_POINT_ACTIONS = [
  'BootNotification',
  'Heartbeat',
  'StatusNotification',
  'Authorize',
  'StartTransaction',
  'StopTransaction',
  'MeterValues',
  'DataTransfer',
] as const;
export type ChargePointAction = (typeof CHARGE_POINT_ACTIONS)[number];

/** Central system to charge point. */
export const CENTRAL_SYSTEM_ACTIONS = [
  'RemoteStartTransaction',
  'RemoteStopTransaction',
  'SetChargingProfile',
  'ClearChargingProfile',
  'Reset',
  'GetConfiguration',
  'ChangeConfiguration',
  'TriggerMessage',
] as const;
export type CentralSystemAction = (typeof CENTRAL_SYSTEM_ACTIONS)[number];

export type RegistrationStatus = 'Accepted' | 'Pending' | 'Rejected';
export type AuthorizationStatus = 'Accepted' | 'Blocked' | 'Expired' | 'Invalid' | 'ConcurrentTx';
export type ChargePointErrorCode =
  | 'ConnectorLockFailure'
  | 'EVCommunicationError'
  | 'GroundFailure'
  | 'HighTemperature'
  | 'InternalError'
  | 'LocalListConflict'
  | 'NoError'
  | 'OtherError'
  | 'OverCurrentFailure'
  | 'OverVoltage'
  | 'PowerMeterFailure'
  | 'PowerSwitchFailure'
  | 'ReaderFailure'
  | 'ResetFailure'
  | 'UnderVoltage'
  | 'WeakSignal';
export type StopReason =
  | 'EmergencyStop'
  | 'EVDisconnected'
  | 'HardReset'
  | 'Local'
  | 'Other'
  | 'PowerLoss'
  | 'Reboot'
  | 'Remote'
  | 'SoftReset'
  | 'UnlockCommand'
  | 'DeAuthorized';

export interface IdTagInfo {
  status: AuthorizationStatus;
  expiryDate?: string;
  parentIdTag?: string;
}

export interface BootNotificationRequest {
  chargePointVendor: string;
  chargePointModel: string;
  chargePointSerialNumber?: string;
  chargeBoxSerialNumber?: string;
  firmwareVersion?: string;
}
export interface BootNotificationResponse {
  status: RegistrationStatus;
  currentTime: string;
  /** Heartbeat interval in seconds. */
  interval: number;
}

export type HeartbeatRequest = Record<string, never>;
export interface HeartbeatResponse {
  currentTime: string;
}

export interface StatusNotificationRequest {
  connectorId: number;
  errorCode: ChargePointErrorCode;
  status: ConnectorStatus;
  timestamp?: string;
  info?: string;
  vendorId?: string;
  vendorErrorCode?: string;
}
export type StatusNotificationResponse = Record<string, never>;

export interface AuthorizeRequest {
  idTag: string;
}
export interface AuthorizeResponse {
  idTagInfo: IdTagInfo;
}

export interface StartTransactionRequest {
  connectorId: number;
  idTag: string;
  /** Meter register at the start of the transaction, Wh. */
  meterStart: number;
  timestamp: string;
  reservationId?: number;
}
export interface StartTransactionResponse {
  transactionId: number;
  idTagInfo: IdTagInfo;
}

export interface StopTransactionRequest {
  transactionId: number;
  idTag?: string;
  /** Meter register at the end of the transaction, Wh. */
  meterStop: number;
  timestamp: string;
  reason?: StopReason;
  transactionData?: MeterValue[];
}
export interface StopTransactionResponse {
  idTagInfo?: IdTagInfo;
}

export type Measurand =
  | 'Energy.Active.Import.Register'
  | 'Power.Active.Import'
  | 'Current.Import'
  | 'Voltage'
  | 'SoC'
  | 'Temperature';
export type UnitOfMeasure = 'Wh' | 'kWh' | 'W' | 'kW' | 'A' | 'V' | 'Percent' | 'Celsius';
export type ReadingContext =
  | 'Interruption.Begin'
  | 'Interruption.End'
  | 'Sample.Clock'
  | 'Sample.Periodic'
  | 'Transaction.Begin'
  | 'Transaction.End'
  | 'Trigger'
  | 'Other';

export interface SampledValue {
  value: string;
  context?: ReadingContext;
  format?: 'Raw' | 'SignedData';
  measurand?: Measurand;
  phase?: string;
  location?: string;
  unit?: UnitOfMeasure;
}

export interface MeterValue {
  timestamp: string;
  sampledValue: SampledValue[];
}

export interface MeterValuesRequest {
  connectorId: number;
  transactionId?: number;
  meterValue: MeterValue[];
}
export type MeterValuesResponse = Record<string, never>;

export type ChargingRateUnit = 'A' | 'W';
export type ChargingProfilePurpose = 'ChargePointMaxProfile' | 'TxDefaultProfile' | 'TxProfile';
export type ChargingProfileKind = 'Absolute' | 'Recurring' | 'Relative';

export interface ChargingSchedulePeriod {
  /** Seconds from the start of the schedule. */
  startPeriod: number;
  /** Power or current limit, in chargingRateUnit. */
  limit: number;
  numberPhases?: number;
}

export interface ChargingSchedule {
  duration?: number;
  startSchedule?: string;
  chargingRateUnit: ChargingRateUnit;
  chargingSchedulePeriod: ChargingSchedulePeriod[];
  minChargingRate?: number;
}

export interface ChargingProfile {
  chargingProfileId: number;
  transactionId?: number;
  stackLevel: number;
  chargingProfilePurpose: ChargingProfilePurpose;
  chargingProfileKind: ChargingProfileKind;
  recurrencyKind?: 'Daily' | 'Weekly';
  validFrom?: string;
  validTo?: string;
  chargingSchedule: ChargingSchedule;
}

export interface SetChargingProfileRequest {
  connectorId: number;
  csChargingProfiles: ChargingProfile;
}
export interface SetChargingProfileResponse {
  status: 'Accepted' | 'Rejected' | 'NotSupported';
}

export interface ClearChargingProfileRequest {
  id?: number;
  connectorId?: number;
  chargingProfilePurpose?: ChargingProfilePurpose;
  stackLevel?: number;
}
export interface ClearChargingProfileResponse {
  status: 'Accepted' | 'Unknown';
}

export interface RemoteStartTransactionRequest {
  connectorId?: number;
  idTag: string;
  chargingProfile?: ChargingProfile;
}
export interface RemoteStartTransactionResponse {
  status: 'Accepted' | 'Rejected';
}

export interface RemoteStopTransactionRequest {
  transactionId: number;
}
export interface RemoteStopTransactionResponse {
  status: 'Accepted' | 'Rejected';
}

export interface ResetRequest {
  type: 'Hard' | 'Soft';
}
export interface ResetResponse {
  status: 'Accepted' | 'Rejected' | 'Scheduled';
}

export interface GetConfigurationRequest {
  key?: string[];
}
export interface GetConfigurationResponse {
  configurationKey?: { key: string; readonly: boolean; value?: string }[];
  unknownKey?: string[];
}

export interface ChangeConfigurationRequest {
  key: string;
  value: string;
}
export interface ChangeConfigurationResponse {
  status: 'Accepted' | 'Rejected' | 'RebootRequired' | 'NotSupported';
}

export interface TriggerMessageRequest {
  requestedMessage: 'BootNotification' | 'Heartbeat' | 'MeterValues' | 'StatusNotification';
  connectorId?: number;
}
export interface TriggerMessageResponse {
  status: 'Accepted' | 'Rejected' | 'NotImplemented';
}

export interface DataTransferRequest {
  vendorId: string;
  messageId?: string;
  data?: string;
}
export interface DataTransferResponse {
  status: 'Accepted' | 'Rejected' | 'UnknownMessageId' | 'UnknownVendorId';
  data?: string;
}
