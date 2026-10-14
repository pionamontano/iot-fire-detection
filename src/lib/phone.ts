// Philippine mobile numbers, same rule the register Edge Function enforces.
export const PHONE_PATTERN = /^09\d{9}$/;
export const PHONE_ERROR = 'Enter an 11-digit mobile number that starts with 09.';

/**
 * Normalizes a typed or pasted mobile number to 09XXXXXXXXX: drops spaces,
 * dashes and brackets, and turns +63 / 63 / a bare 9XXXXXXXXX into the
 * local 0 prefix. Anything else is kept (capped at 11 digits) so the
 * pattern check can flag it.
 */
export const normalizePhone = (raw: string): string => {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length >= 12) digits = `0${digits.slice(2)}`;
  else if (digits.startsWith('9') && digits.length === 10) digits = `0${digits}`;
  return digits.slice(0, 11);
};

// Station hotline (Responder Settings): a fire station usually publishes a landline, so this also accepts
// PH landlines — 0 + area code + subscriber number, 10 digits in all (e.g. 02 8555 1234, 044 791 1234),
// with or without +63 — besides 09XXXXXXXXX mobiles. Only checked, not rewritten: the number is shown as typed.
export const STATION_PHONE_ERROR = 'Enter a PH mobile (09XX XXX XXXX) or landline with area code (e.g. 02 8555 1234).';
export const isStationPhone = (raw: string): boolean => {
  if (/[^\d\s()+-]/.test(raw)) return false;
  let digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+63') || (digits.startsWith('63') && digits.length >= 11)) digits = `0${digits.slice(2)}`;
  return PHONE_PATTERN.test(digits) || /^0[2-8]\d{8}$/.test(digits);
};
