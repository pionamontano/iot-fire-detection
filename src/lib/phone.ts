// Philippine mobile numbers, same rule the register Edge Function enforces.
export const PHONE_PATTERN = /^09\d{9}$/;
export const PHONE_ERROR = 'Enter an 11-digit mobile number that starts with 09.';

/**
 * Normalizes a typed or pasted mobile number to 09XXXXXXXXX: drops spaces,
 * dashes and brackets, and turns +63 / 63 / a bare 9XXXXXXXXX into the
 * local 0 prefix (a +63 landline becomes 0 + area code). Anything else is kept (capped at 11 digits) so the
 * pattern check can flag it.
 */
export const normalizePhone = (raw: string): string => {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length >= 12) digits = `0${digits.slice(2)}`;
  else if (/^63[2-8]\d{8}$/.test(digits)) digits = `0${digits.slice(2)}`; // +63 landline
  else if (digits.startsWith('9') && digits.length === 10) digits = `0${digits}`;
  return digits.slice(0, 11);
};

// PH landline after normalizePhone(): 0 + area code + subscriber number, 10 digits in all.
export const LANDLINE_PATTERN = /^0[2-8]\d{8}$/;

// Device BFP contact (Edit Device): a mobile, or a station landline. The device texts this number,
// and a landline can't receive SMS, so the form warns when one is entered.
export const BFP_PHONE_ERROR = 'Enter a PH mobile (09XXXXXXXXX) or landline with area code (e.g. 02 8555 1234).';
export const isBfpPhone = (normalized: string): boolean =>
  PHONE_PATTERN.test(normalized) || LANDLINE_PATTERN.test(normalized);

// Station hotline (Responder Settings): a fire station usually publishes a landline, so this also accepts
// PH landlines — 0 + area code + subscriber number, 10 digits in all (e.g. 02 8555 1234, 044 791 1234),
// with or without +63 — besides 09XXXXXXXXX mobiles. Only checked, not rewritten: the number is shown as typed.
export const STATION_PHONE_ERROR = 'Enter a PH mobile (09XX XXX XXXX) or landline with area code (e.g. 02 8555 1234).';
export const isStationPhone = (raw: string): boolean => {
  if (/[^\d\s()+-]/.test(raw)) return false;
  let digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+63') || (digits.startsWith('63') && digits.length >= 11)) digits = `0${digits.slice(2)}`;
  return PHONE_PATTERN.test(digits) || LANDLINE_PATTERN.test(digits);
};
