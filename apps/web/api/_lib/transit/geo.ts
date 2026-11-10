// Distances and the one map projection the Intendencia's stop file uses.

export interface LatLon {
  lat: number;
  lon: number;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle meters between two points. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A street walk is longer than the straight line; this is the usual allowance. */
export const WALK_DETOUR = 1.3;
/** Walking speed: 4.8 km/h. */
export const WALK_M_PER_MIN = 80;

/** Walking minutes along streets for a straight-line distance, rounded up. */
export const walkMinutes = (meters: number) => Math.ceil((meters * WALK_DETOUR) / WALK_M_PER_MIN);

/** WGS 84 / UTM zone 21S (EPSG:32721, central meridian 57° W) to latitude and longitude. */
export function utm21sToLatLon(easting: number, northing: number): LatLon {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const x = easting - 500000;
  // Southern hemisphere: remove the 10,000,000 m false northing.
  const y = northing - 10_000_000;
  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1);
  const c = Math.cos(phi1);
  const t = Math.tan(phi1);
  const n1 = a / Math.sqrt(1 - e2 * s * s);
  const t1 = t * t;
  const c1 = ep2 * c * c;
  const r1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5;
  const d = x / (n1 * k0);
  const lat =
    phi1 -
    ((n1 * t) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6) / 720);
  const lon =
    rad(-57) +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5) / 120) /
      c;
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}
