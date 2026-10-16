// Where an alert push notification opens. trigger-alert sends every recipient the same link, /alert?device=<id>,
// and the app sends each role to its own page for that alert (the /alert route in App.tsx).

export const ALERT_LINK_PATH = '/alert';

type Role = 'admin' | 'bfp_responder' | 'resident';

/** The page a signed-in user lands on from an alert notification for `deviceId`. */
export const alertDestination = (role: Role, deviceId: string | null): string => {
  switch (role) {
    case 'admin':
      // Device Status is the admin alerts page (/admin/alerts redirects there); ?device= highlights the device's row.
      return deviceId ? `/admin/status?device=${encodeURIComponent(deviceId)}` : '/admin/status';
    case 'bfp_responder':
      return '/responder';   // the dashboard lists every open fire, oldest first
    default:
      return '/home';        // the resident's own device and its open alert
  }
};
