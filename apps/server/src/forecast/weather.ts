import type { GridProfile } from './synthetic';

/**
 * Turning a weather forecast into a statement about a grid.
 *
 * Open-Meteo answers with irradiance in W/m² and wind in km/h. Neither is a renewable share on its
 * own, and the step between them is where it is easy to be wrong: 400 W/m² is a brilliant winter
 * noon in London and a disappointing one in Surat, so a fixed threshold flatters one site and
 * libels the other. What these functions produce instead is a comparison against what the site
 * could have had — clear sky at that latitude, that day, that hour — which means the same thing
 * everywhere.
 *
 * The output is a multiplier on the grid's modelled renewable share, not a share itself. The model
 * already knows the shape of a normal day on this grid, including when its solar comes and goes;
 * the weather only knows whether today is better or worse than normal. Keeping those two jobs
 * separate is what lets one set of constants serve Gujarat and Great Britain at once.
 */

/** Below this the sun is too low for the clear-sky model to mean anything. */
const MIN_ELEVATION_SIN = 0.05;

/**
 * A normal day, not a perfect one. Clear-sky is the ceiling; most days come in under it through
 * haze, dust and cloud, and the modelled curve already assumes a typical day. Dividing by this
 * makes the multiplier sit near 1 when the weather is ordinary.
 */
const TYPICAL_CLEARNESS = 0.72;
/** A typical onshore capacity factor, against which today's wind is judged. */
const TYPICAL_WIND_FACTOR = 0.3;
/**
 * Bounds on the multiplier. A dead calm under heavy cloud really does take variable output close
 * to nothing, so the floor is low; the ceiling stops one unusually bright hour claiming a grid has
 * doubled its renewables.
 */
const FLOOR = 0.1;
const CEILING = 2;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Days since the start of the year, as a fraction. */
function dayAngle(ms: number): number {
  const date = new Date(ms);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const day = (ms - start) / 86_400_000;
  return (2 * Math.PI * day) / 365.25;
}

/** Declination of the sun, in radians. Spencer's Fourier fit, good to about a tenth of a degree. */
function declination(ms: number): number {
  const g = dayAngle(ms);
  return (
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  );
}

/** The correction between clock time and where the sun actually is, in minutes. */
function equationOfTime(ms: number): number {
  const g = dayAngle(ms);
  return (
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g))
  );
}

/**
 * The sine of the sun's elevation above the horizon: 1 straight overhead, 0 at the horizon,
 * negative at night. Everything solar follows from this one number.
 */
export function solarElevationSin(lat: number, lng: number, ms: number): number {
  const date = new Date(ms);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  // Longitude moves solar noon by four minutes a degree; the equation of time moves it again.
  const solarHours = utcHours + lng / 15 + equationOfTime(ms) / 60;
  const hourAngle = radians(15 * (solarHours - 12));
  const dec = declination(ms);
  const phi = radians(lat);
  return Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle);
}

/**
 * Clear-sky global horizontal irradiance in W/m², by the Haurwitz model: one term for how high the
 * sun is and one for how much atmosphere its light crossed to get here. It is a simple model and
 * an old one, and for this purpose that is a virtue — it needs no inputs beyond position and time,
 * so it cannot itself fail mid-demo.
 */
export function clearSkyIrradiance(lat: number, lng: number, ms: number): number {
  const cosZenith = solarElevationSin(lat, lng, ms);
  if (cosZenith <= MIN_ELEVATION_SIN) return 0;
  return 1098 * cosZenith * Math.exp(-0.059 / cosZenith);
}

/**
 * How much of a perfect solar day this hour is delivering, 0..1.
 *
 * Returns null at night, where the question has no answer: nothing divided by nothing is not zero
 * sun, it is no sun to have. The caller falls back to the wind term rather than reading a false
 * zero as a cloudy midnight.
 */
export function clearnessIndex(lat: number, lng: number, ms: number, irradianceWm2: number): number | null {
  const ceiling = clearSkyIrradiance(lat, lng, ms);
  if (ceiling <= 0) return null;
  // Irradiance can nudge past clear-sky under bright cloud edges; that is real but not useful here.
  return clamp(irradianceWm2 / ceiling, 0, 1.1);
}

/** Where the blades are, against the ten metres a weather station reports from. */
const HUB_HEIGHT_M = 100;
const MEASUREMENT_HEIGHT_M = 10;
/** The usual power-law exponent for open terrain. */
const WIND_SHEAR = 0.143;

/**
 * Wind at hub height, given wind at the height it was measured.
 *
 * A forecast reports ten metres up; a turbine works ninety metres above that, where the ground has
 * stopped slowing the air and the wind runs about forty per cent faster. Since output goes with
 * the cube of speed, skipping this step does not shave the answer, it roughly thirds it.
 */
export function toHubHeight(windSpeedKph: number, measuredAtM = MEASUREMENT_HEIGHT_M): number {
  return windSpeedKph * (HUB_HEIGHT_M / measuredAtM) ** WIND_SHEAR;
}

/**
 * What a turbine makes of this wind, 0..1 of its rating, given wind at hub height. Below the
 * cut-in it makes nothing, above the rated speed it makes everything, and in between output goes
 * with the cube of wind speed, which is why a breeze that feels only slightly stronger is worth so
 * much more.
 */
export function windCapacityFactor(windSpeedKph: number): number {
  const cutInKph = 11;
  const ratedKph = 45;
  const cutOutKph = 90;
  if (windSpeedKph <= cutInKph || windSpeedKph >= cutOutKph) return 0;
  if (windSpeedKph >= ratedKph) return 1;
  return clamp(((windSpeedKph - cutInKph) / (ratedKph - cutInKph)) ** 3, 0, 1);
}

export interface WeatherPoint {
  readonly startMs: number;
  readonly irradianceWm2: number;
  /** At hub height. Pass 10 m readings through toHubHeight first. */
  readonly windSpeedKph: number;
}

/**
 * How today compares with a normal day on this grid, as a multiplier on its **variable** renewable
 * output. 1 means ordinary weather, above 1 a better day than usual, below 1 a worse one.
 *
 * The two terms are weighted by what the grid is actually built out of, which is the whole reason
 * a Gujarat site and a British one cannot share a formula: the same still, bright afternoon is a
 * good day on one system and a poor one on the other.
 *
 * It applies only to sun and wind. A grid's hydro and biomass keep running through a dead calm, so
 * the caller holds that part back before scaling — see applyWeather.
 */
export function weatherFactor(profile: GridProfile, lat: number, lng: number, point: WeatherPoint): number {
  const wind = windCapacityFactor(point.windSpeedKph) / TYPICAL_WIND_FACTOR;
  const clearness = clearnessIndex(lat, lng, point.startMs, point.irradianceWm2);
  const { solar: solarWeight, wind: windWeight } = profile.mix;

  // After dark the solar term has nothing to say, so the wind term carries the whole judgement.
  if (clearness === null) return clamp(wind, FLOOR, CEILING);

  const sun = clearness / TYPICAL_CLEARNESS;
  return clamp(solarWeight * sun + windWeight * wind, FLOOR, CEILING);
}

/**
 * The renewable share a grid is actually running at, given its modelled share for this hour and
 * how the weather compares with normal. The firm part is untouched; only sun and wind move.
 */
export function applyWeather(profile: GridProfile, modelledShare: number, factor: number): number {
  const firm = Math.min(profile.firmShare, modelledShare);
  return clamp(firm + (modelledShare - firm) * factor, 0, 1);
}
