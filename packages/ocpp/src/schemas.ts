import { CONNECTOR_STATUSES } from '@cleangrid/shared';
import { z } from 'zod';

/** Validation for the payloads we accept off the wire. Anything else gets a CALLERROR. */

const ciString = (max: number) => z.string().min(1).max(max);
const isoTimestamp = z.string().min(4).max(40);
const connectorId = z.number().int().min(0).max(64);

export const bootNotificationSchema = z.object({
  chargePointVendor: ciString(20),
  chargePointModel: ciString(20),
  chargePointSerialNumber: z.string().max(25).optional(),
  chargeBoxSerialNumber: z.string().max(25).optional(),
  firmwareVersion: z.string().max(50).optional(),
});

export const heartbeatSchema = z.object({}).loose();

export const statusNotificationSchema = z.object({
  connectorId,
  errorCode: z.string().min(1).max(50),
  status: z.enum(CONNECTOR_STATUSES),
  timestamp: isoTimestamp.optional(),
  info: z.string().max(50).optional(),
  vendorId: z.string().max(255).optional(),
  vendorErrorCode: z.string().max(50).optional(),
});

export const authorizeSchema = z.object({ idTag: ciString(20) });

export const startTransactionSchema = z.object({
  connectorId: connectorId.min(1),
  idTag: ciString(20),
  meterStart: z.number().int().nonnegative(),
  timestamp: isoTimestamp,
  reservationId: z.number().int().optional(),
});

export const stopTransactionSchema = z.object({
  transactionId: z.number().int(),
  idTag: ciString(20).optional(),
  meterStop: z.number().int().nonnegative(),
  timestamp: isoTimestamp,
  reason: z.string().max(30).optional(),
  transactionData: z.array(z.unknown()).optional(),
});

export const sampledValueSchema = z.object({
  value: z.string(),
  context: z.string().optional(),
  format: z.string().optional(),
  measurand: z.string().optional(),
  phase: z.string().optional(),
  location: z.string().optional(),
  unit: z.string().optional(),
});

export const meterValueSchema = z.object({
  timestamp: isoTimestamp,
  sampledValue: z.array(sampledValueSchema).min(1),
});

export const meterValuesSchema = z.object({
  connectorId,
  transactionId: z.number().int().optional(),
  meterValue: z.array(meterValueSchema).min(1),
});

export const dataTransferSchema = z.object({
  vendorId: ciString(255),
  messageId: z.string().max(50).optional(),
  data: z.string().optional(),
});

const chargingSchedulePeriodSchema = z.object({
  startPeriod: z.number().int().nonnegative(),
  limit: z.number(),
  numberPhases: z.number().int().min(1).max(3).optional(),
});

export const chargingProfileSchema = z.object({
  chargingProfileId: z.number().int(),
  transactionId: z.number().int().optional(),
  stackLevel: z.number().int().nonnegative(),
  chargingProfilePurpose: z.enum(['ChargePointMaxProfile', 'TxDefaultProfile', 'TxProfile']),
  chargingProfileKind: z.enum(['Absolute', 'Recurring', 'Relative']),
  recurrencyKind: z.enum(['Daily', 'Weekly']).optional(),
  validFrom: isoTimestamp.optional(),
  validTo: isoTimestamp.optional(),
  chargingSchedule: z.object({
    duration: z.number().int().optional(),
    startSchedule: isoTimestamp.optional(),
    chargingRateUnit: z.enum(['A', 'W']),
    chargingSchedulePeriod: z.array(chargingSchedulePeriodSchema).min(1),
    minChargingRate: z.number().optional(),
  }),
});

export const setChargingProfileSchema = z.object({
  connectorId,
  csChargingProfiles: chargingProfileSchema,
});

export const clearChargingProfileSchema = z.object({
  id: z.number().int().optional(),
  connectorId: connectorId.optional(),
  chargingProfilePurpose: z.enum(['ChargePointMaxProfile', 'TxDefaultProfile', 'TxProfile']).optional(),
  stackLevel: z.number().int().optional(),
});

export const remoteStartTransactionSchema = z.object({
  connectorId: connectorId.optional(),
  idTag: ciString(20),
  chargingProfile: chargingProfileSchema.optional(),
});

export const remoteStopTransactionSchema = z.object({ transactionId: z.number().int() });

export const resetSchema = z.object({ type: z.enum(['Hard', 'Soft']) });

export const getConfigurationSchema = z.object({ key: z.array(z.string()).optional() });

export const changeConfigurationSchema = z.object({ key: ciString(50), value: z.string().max(500) });

export const triggerMessageSchema = z.object({
  requestedMessage: z.enum(['BootNotification', 'Heartbeat', 'MeterValues', 'StatusNotification']),
  connectorId: connectorId.optional(),
});
