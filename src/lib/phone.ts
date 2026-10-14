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
