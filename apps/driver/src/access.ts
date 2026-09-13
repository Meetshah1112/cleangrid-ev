import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Who the phone is signed in as.
 *
 * The deployed demo has no sign-up and no password: each seeded driver has an access code of their
 * own, and entering it signs the phone in as that driver. Kept on the phone until they sign out, so
 * opening the app again goes straight back to their car.
 */

export interface DriverAccess {
  readonly code: string;
  readonly driverId: string;
  readonly driverName: string;
  readonly siteId: string | null;
  /** No server was reachable and the driver chose the built-in snapshot instead. */
  readonly offline?: boolean;
}

const KEY = 'cleangrid.driver.access';

export async function loadAccess(): Promise<DriverAccess | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DriverAccess>;
    if (typeof parsed.code !== 'string' || typeof parsed.driverId !== 'string') return null;
    return {
      code: parsed.code,
      driverId: parsed.driverId,
      driverName: parsed.driverName ?? parsed.driverId,
      siteId: parsed.siteId ?? null,
      offline: parsed.offline === true,
    };
  } catch {
    return null;
  }
}

export async function saveAccess(access: DriverAccess): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(access));
  } catch {
    // Storage unavailable: the choice lasts until the app closes.
  }
}

export async function clearAccess(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}

/** Codes the server sends when the access itself is the problem, rather than the request. */
export const ACCESS_ERRORS: ReadonlySet<string> = new Set(['access_code_required', 'access_code_rejected']);
