// Who a resident should call in an emergency, shown on the resident Dashboard
// (Emergency Contacts card). Empty during testing - see LOCAL_FIRE_STATION.
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

/**
 * The BFP station for the deployment area. Deliberately null during testing,
 * so no tap-to-call number shows on the dashboard: a tester tapping a real
 * number on a simulated fire alert would actually place the call. Set it
 * (e.g. { name: 'Malolos City Fire Station', phone: '...', detail: 'BFP · ...' })
 * only at go-live. Add any other go-live numbers to EMERGENCY_CONTACTS.
 */
export const LOCAL_FIRE_STATION: EmergencyContact | null = null;

/** Contacts the dashboard lists, in order; the card is hidden while this is empty. */
export const EMERGENCY_CONTACTS: EmergencyContact[] = LOCAL_FIRE_STATION ? [LOCAL_FIRE_STATION] : [];

/** tel: link for a displayed number ("0912 345 6789" -> "tel:09123456789"). */
export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;
