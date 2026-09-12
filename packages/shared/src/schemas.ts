import { z } from 'zod';
import { SESSION_STATUSES } from './domain';
import { CHARGING_MODES } from './modes';

/** Request validation shared by the API and its clients. */

export const chargingModeSchema = z.enum(CHARGING_MODES);
const isoDateTime = z.iso.datetime({ offset: true });
const energyKwh = z.number().positive().max(250);

export const sessionPreviewSchema = z.object({
  siteId: z.string().min(1),
  energyKwh,
  deadlineAt: isoDateTime,
  maxPowerKw: z.number().positive().max(350),
});

export const createSessionSchema = z.object({
  chargerId: z.string().min(1),
  connectorId: z.number().int().min(1).default(1),
  vehicleId: z.string().min(1).optional(),
  energyKwh,
  deadlineAt: isoDateTime,
  mode: chargingModeSchema.default('balanced'),
});

export const updateSessionSchema = z
  .object({
    deadlineAt: isoDateTime.optional(),
    energyKwh: energyKwh.optional(),
    mode: chargingModeSchema.optional(),
  })
  .refine((value) => value.deadlineAt !== undefined || value.energyKwh !== undefined || value.mode !== undefined, {
    message: 'provide at least one of deadlineAt, energyKwh, mode',
  });

export const createVehicleSchema = z.object({
  label: z.string().min(1).max(60),
  batteryKwh: z.number().positive().max(250),
  maxChargeKw: z.number().positive().max(350),
});

/** What a driver may change about themselves. */
export const updateProfileSchema = z
  .object({
    defaultMode: chargingModeSchema.optional(),
    defaultDwellHours: z.number().positive().max(72).optional(),
    defaultEnergyKwh: z.number().positive().max(500).optional(),
  })
  .refine(
    (value) =>
      value.defaultMode !== undefined ||
      value.defaultDwellHours !== undefined ||
      value.defaultEnergyKwh !== undefined,
    { message: 'provide at least one setting' },
  );

export const siteSettingsSchema = z
  .object({
    defaultMode: chargingModeSchema.optional(),
    gridConnectionKw: z.number().positive().max(100_000).optional(),
    demandChargePerKwMonth: z.number().nonnegative().max(1000).optional(),
  })
  .refine(
    (value) =>
      value.defaultMode !== undefined ||
      value.gridConnectionKw !== undefined ||
      value.demandChargePerKwMonth !== undefined,
    { message: 'provide at least one setting' },
  );

export const createFlexEventSchema = z
  .object({
    siteId: z.string().min(1),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    capKw: z.number().nonnegative().max(100_000),
    reason: z.string().max(200).optional(),
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export const flexResponseSchema = z.object({ accept: z.boolean() });

export const clockControlSchema = z
  .object({
    scale: z.number().positive().max(10_000).optional(),
    nowAt: isoDateTime.optional(),
  })
  .refine((value) => value.scale !== undefined || value.nowAt !== undefined, {
    message: 'provide scale and/or nowAt',
  });

export const listSessionsQuerySchema = z.object({
  status: z.enum(SESSION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type SessionPreviewInput = z.infer<typeof sessionPreviewSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type SiteSettingsInput = z.infer<typeof siteSettingsSchema>;
export type CreateFlexEventInput = z.infer<typeof createFlexEventSchema>;
export type ClockControlInput = z.infer<typeof clockControlSchema>;
