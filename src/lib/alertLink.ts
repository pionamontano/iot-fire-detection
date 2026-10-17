// Page where a role handles an alert: the responder dashboard scrolled to the fire, the admin device-status row
// for the device, the resident's home page.
export const alertPagePath = (role: string | undefined, alertId: string | undefined, device: string | null): string => {
  if (role === 'bfp_responder') return alertId ? `/responder?alert=${encodeURIComponent(alertId)}` : '/responder';
  if (role === 'admin') return device ? `/admin/status?device=${encodeURIComponent(device)}` : '/admin/status';
  return '/home';
};
