// Who a resident should call in an emergency, shown on the resident Dashboard
// (fire alert panel and Emergency Contacts card).
//
// Kept here rather than read from station_settings: that table is still
// seeded with placeholder values (+639000000000), and Responder Settings
// reads/writes station_name and email columns no migration creates, so it
// can't be trusted for a number people will actually dial.

export interface EmergencyContact {
  name: string;
  /** As displayed, e.g. "0912 345 6789". */
  phone: string;
  detail?: string;
}

/** Philippine national emergency hotline. */
export const EMERGENCY_HOTLINE: EmergencyContact = {
  name: 'Emergency Hotline',
  phone: '911',
  detail: 'Police, fire and ambulance, nationwide',
};

/**
 * The BFP station for the deployment area, shown next to 911 once set.
 * Deliberately null during testing: a tester tapping a real station number
 * on a simulated fire alert would actually call the station. Set it (e.g.
 * { name: 'Malolos City Fire Station', phone: '...', detail: 'BFP · ...' })
 * only at go-live.
 */
export const LOCAL_FIRE_STATION: EmergencyContact | null = null;

/** Every contact to list, in order (911 first; the station once set). */
export const EMERGENCY_CONTACTS: EmergencyContact[] = [EMERGENCY_HOTLINE, ...(LOCAL_FIRE_STATION ? [LOCAL_FIRE_STATION] : [])];

/** tel: link for a displayed number ("0912 345 6789" -> "tel:09123456789"). */
export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;
