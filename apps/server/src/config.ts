import { DEFAULT_SCENARIOS, SimClock, SystemClock, zonedTimeToUtc, type Clock } from '@cleangrid/shared';
import { z } from 'zod';

/** All runtime configuration in one place, validated once at startup. */

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())));

export const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: bool(true),
  DEV_AUTH: bool(true),
  REPO: z.enum(['memory', 'supabase']).default('memory'),
  SCENARIO: z.string().default(DEFAULT_SCENARIOS),
  /** Simulated clock start: an ISO instant, "scenario" to use the scenario's own start, or unset for real time. */
  SIM_START: z.string().default('scenario'),
  SIM_TIME_SCALE: z.coerce.number().positive().max(10_000).default(1),
  SCHEDULER: z.enum(['lp', 'greedy']).default('lp'),
  /**
   * off turns the optimiser into a bystander: it plans nothing, dispatches nothing, and no safety
   * profile is installed, so every car charges flat out from the moment it plugs in. This is the
   * "dumb charger" baseline, and it is the only honest way to show what the optimiser prevents.
   */
  OPTIMISER: z.enum(['on', 'off']).default('on'),
  FORECAST: z.enum(['live', 'synthetic']).default('synthetic'),
  RESOLVE_INTERVAL_MIN: z.coerce.number().positive().max(120).default(5),
  RESOLVE_DEBOUNCE_MS: z.coerce.number().int().min(0).max(60_000).default(2_000),
  LOOKAHEAD_PERIODS: z.coerce.number().int().min(1).max(96).default(3),
  SLOT_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  HORIZON_HOURS: z.coerce.number().positive().max(48).default(24),
  /** Only re-send a charging profile when the limit moves by at least this much. */
  DISPATCH_HYSTERESIS_W: z.coerce.number().int().min(0).max(10_000).default(250),
  /**
   * Plan to this far below the grid connection. No control loop reacts instantly, so a car that
   * plugs in between solves draws for a moment before the next plan reaches the chargers. The
   * margin keeps that moment inside the connection, which is how site load management is done.
   */
  CONNECTION_MARGIN_PCT: z.coerce.number().min(0).max(20).default(2),
  /**
   * Whether the site honours a flexibility request automatically, as a site under a flexibility
   * contract would. Off means an operator has to accept each request by hand.
   */
  AUTO_ACCEPT_FLEX: bool(true),
  /** Unlocks measured carbon intensity outside Great Britain; without it those grids are modelled. */
  ELECTRICITY_MAPS_TOKEN: z.string().optional(),
  /** The zone that token is granted for, if it is not the one the site's grid would ask for. */
  ELECTRICITY_MAPS_ZONE: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  /**
   * Turns on access codes for the deployed demo. Every seeded account's code is derived from this
   * secret (print them with scripts/access-codes.ts), every API call and console socket must carry
   * one, and the code alone decides which account is signing in. Keep it private: whoever has it can
   * work out every code.
   */
  ACCESS_CODE_SECRET: z.string().trim().min(24, 'ACCESS_CODE_SECRET must be at least 24 characters').optional(),
  /**
   * The key a charger presents to connect, as OCPP 1.6 security profile 1 describes: HTTP Basic on
   * the WebSocket upgrade, the charger's identity as the user and this key as the password. Unset,
   * any charger may connect, which is right on a laptop and wrong on the internet, so a server with
   * ACCESS_CODE_SECRET refuses to start without it.
   */
  OCPP_AUTH_KEY: z.string().trim().min(16, 'OCPP_AUTH_KEY must be at least 16 characters').optional(),
  /**
   * How many proxies stand in front of the server, so the client address is read from the entry the
   * nearest proxy appended to X-Forwarded-For. On a host like Render every request arrives from the
   * proxy, and without this one visitor guessing codes would lock out all of them. A count, not a
   * switch: trusting the whole header would let a guesser write a fresh address on every attempt.
   * 0 by default, because a server with no proxy must not believe the header at all.
   */
  TRUST_PROXY: z.coerce.number().int('TRUST_PROXY is the number of proxies in front, such as 1').min(0).max(5).default(0),
  /** Browser origins allowed to call the API, comma separated. Unset allows any origin. */
  CORS_ORIGINS: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const config = parsed.data;
  if (config.REPO === 'supabase' && !(config.SUPABASE_URL && config.SUPABASE_SERVICE_KEY)) {
    throw new Error('REPO=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY');
  }
  if (!config.DEV_AUTH && !config.ACCESS_CODE_SECRET && !config.SUPABASE_JWT_SECRET) {
    throw new Error('DEV_AUTH=0 needs ACCESS_CODE_SECRET (per-account demo codes) or SUPABASE_JWT_SECRET to let anyone in');
  }
  if (config.ACCESS_CODE_SECRET && !config.OCPP_AUTH_KEY) {
    throw new Error('ACCESS_CODE_SECRET needs OCPP_AUTH_KEY too, or anyone could connect to the public server as one of its chargers');
  }
  return config;
}

export interface ClockOptions {
  readonly simStart: string;
  readonly timeScale: number;
  /** Fallback start when SIM_START is "scenario". */
  readonly scenarioStartMs?: number;
  readonly timezone?: string;
}

/**
 * Real time unless a simulated start or a time scale above 1 is configured.
 * The whole process shares one clock so plans, meter values and reports agree on "now".
 */
export function createClock(options: ClockOptions): Clock {
  const { simStart, timeScale, scenarioStartMs, timezone = 'UTC' } = options;
  const wantsSim = timeScale !== 1 || (simStart !== '' && simStart !== 'real');
  if (!wantsSim) return new SystemClock();

  const startMs = resolveStartMs(simStart, scenarioStartMs, timezone);
  if (startMs === null) return new SystemClock();
  return new SimClock({ startMs, scale: timeScale });
}

function resolveStartMs(simStart: string, scenarioStartMs: number | undefined, timezone: string): number | null {
  if (simStart === 'scenario') return scenarioStartMs ?? null;
  if (simStart === 'now') return Date.now();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(simStart)) return zonedTimeToUtc(simStart, timezone);
  const parsed = Date.parse(simStart);
  if (Number.isNaN(parsed)) throw new Error(`SIM_START "${simStart}" is not an instant, "scenario", "now" or "real"`);
  return parsed;
}
