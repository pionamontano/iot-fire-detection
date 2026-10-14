// Single source of truth for "where is this device?" on every map/page.
//
// Four distinct states - they must never be conflated or substituted for one another:
//   live         a reading with valid coordinates, gps_valid = true, reported within LIVE_FIX_MAX_AGE_MS
//   last_known   a reading with valid coordinates that is NOT live (gps_valid = false, i.e. the firmware
//                is re-sending its cached position, or the fix is older than the live window)
//   registered   the install pin on the device record: placed by the resident and confirmed by an
//                administrator (`verified`), or not confirmed yet. This is NOT a GPS fix and is never
//                labelled live.
//   unavailable  nothing usable. Callers must show "unavailable" - never invent a position and never
//                place a marker at a default map centre.
//
// TIMESTAMP CAVEAT: `fixAt` is the `recorded_at` of the reading that carried the coordinates (when the
// server received them). For last_known coordinates the device may have acquired the original fix
// earlier; the schema has no separate "fix acquired at" column, so UI text says "reported", not "fixed".

/** Provisional owner-approved threshold: a fix reported more than 15 minutes ago is not "live". */
export const LIVE_FIX_MAX_AGE_MS = 15 * 60 * 1000;

/** Tolerated clock skew for timestamps slightly in the future before a fix stops counting as live. */
export const FUTURE_SKEW_MS = 5 * 60 * 1000;

export type LocationKind = 'live' | 'last_known' | 'registered' | 'unavailable';

export interface ReadingLocationInput {
  latitude?: number | null;
  longitude?: number | null;
  gps_valid?: boolean | null;
  recorded_at?: string | null;
}

export interface RegisteredLocationInput {
  latitude?: number | null;
  longitude?: number | null;
  location_verified?: boolean | null;
}

export interface ResolvedLocation {
  kind: LocationKind;
  lat: number | null;
  lng: number | null;
  /** ISO timestamp of the reading that carried the coordinates (live / last_known only). */
  fixAt: string | null;
  /** registered only: an administrator has confirmed the pin (devices.location_verified). */
  verified?: boolean;
}

/** A coordinate pair is usable only if both are finite numbers in range and not the (0,0) "no fix" sentinel. */
export const isValidCoordinate = (lat: unknown, lng: unknown): lat is number => {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false; // firmware's "no fix ever acquired" sentinel (see ingest-reading)
  return true;
};

const UNAVAILABLE: ResolvedLocation = { kind: 'unavailable', lat: null, lng: null, fixAt: null };

/**
 * @param readings newest first. The first reading with valid coordinates is used.
 * @param device   the device record; only its registered latitude/longitude are read.
 */
export const resolveDeviceLocation = ({
  readings,
  device,
  now = Date.now(),
}: {
  readings?: ReadonlyArray<ReadingLocationInput | null | undefined> | null;
  device?: RegisteredLocationInput | null;
  now?: number;
}): ResolvedLocation => {
  for (const r of readings ?? []) {
    if (!r || !isValidCoordinate(r.latitude, r.longitude)) continue;
    const lat = r.latitude as number;
    const lng = r.longitude as number;
    const ts = r.recorded_at ? Date.parse(r.recorded_at) : NaN;
    const hasTime = Number.isFinite(ts);
    const age = hasTime ? now - ts : NaN;
    const fresh = hasTime && age <= LIVE_FIX_MAX_AGE_MS && age >= -FUTURE_SKEW_MS;
    return {
      kind: r.gps_valid === true && fresh ? 'live' : 'last_known',
      lat,
      lng,
      fixAt: hasTime ? (r.recorded_at as string) : null,
    };
  }
  if (device && isValidCoordinate(device.latitude, device.longitude)) {
    return {
      kind: 'registered',
      lat: device.latitude as number,
      lng: device.longitude as number,
      fixAt: null,
      verified: device.location_verified === true,
    };
  }
  return UNAVAILABLE;
};

export const formatAge = (iso: string | null | undefined, now: number = Date.now()): string => {
  const ts = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ts)) return 'time unknown';
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} h ago`;
  return `${Math.round(hr / 24)} d ago`;
};

export interface LocationDescription {
  label: string;
  detail: string;
  /** true when the position is not a current GPS fix (last_known / registered / unavailable). */
  approximate: boolean;
}

export const describeLocation = (loc: ResolvedLocation, now: number = Date.now()): LocationDescription => {
  const when = loc.fixAt ? `${formatAge(loc.fixAt, now)} (${new Date(loc.fixAt).toLocaleString()})` : 'time unknown';
  switch (loc.kind) {
    case 'live':
      return { label: 'Live GPS', detail: `Fix reported ${when}`, approximate: false };
    case 'last_known':
      return { label: 'Last-known GPS', detail: `Not a current fix - last reported ${when}`, approximate: true };
    case 'registered':
      return loc.verified
        ? { label: 'Registered location', detail: 'Install pin confirmed by an administrator - not a GPS fix', approximate: true }
        : { label: 'Registered location (unverified)', detail: 'Install pin set by the resident, not yet confirmed by an administrator - not a GPS fix', approximate: true };
    default:
      return { label: 'Location unavailable', detail: 'No valid GPS coordinates have been reported and none are registered', approximate: true };
  }
};

/** Marker opacity so non-live positions are visibly distinct on maps. */
export const markerOpacity = (kind: LocationKind): number =>
  kind === 'live' ? 1 : kind === 'last_known' ? 0.75 : 0.6;

/** Address text for display. A device has none until its resident sets it (20261102000000). */
export const LOCATION_NOT_SET = 'Location not set';
export const displayAddress = (desc: string | null | undefined): string => desc?.trim() || LOCATION_NOT_SET;

/** Six decimals (~11 cm); more digits than this is noise from a map click or a phone fix. */
export const roundCoord = (v: number): number => Math.round(v * 1e6) / 1e6;
