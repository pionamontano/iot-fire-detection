// Who a resident should call in an emergency, shown on the resident Dashboard
// (fire alert panel and Emergency Contacts card).
//
// Kept here rather than read from station_settings: that table is still
// seeded with placeholder values (+639000000000), and Responder Settings
// reads/writes station_name and email columns no migration creates, so it
// can't be trusted for a number people will actually dial.

export interface EmergencyContact {
  name: string;
  /** As displayed, e.g. "0995 186 0370". */
  phone: string;
  detail?: string;
}

/** Philippine national emergency hotline. */
export const EMERGENCY_HOTLINE: EmergencyContact = {
  name: 'Emergency Hotline',
  phone: '911',
  detail: 'Police, fire and ambulance, nationwide',
};

/** The BFP station responsible for the deployment area (City of Malolos). */
export const LOCAL_FIRE_STATION: EmergencyContact = {
  name: 'Malolos City Fire Station',
  phone: '0995 186 0370',
  detail: 'BFP · Brgy. Mojon, Malolos',
};

/** tel: link for a displayed number ("0995 186 0370" -> "tel:09951860370"). */
export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;
