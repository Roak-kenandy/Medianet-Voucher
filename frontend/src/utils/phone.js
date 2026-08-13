export const MALDIVES_PHONE_LENGTH = 7;

/**
 * Reserved-style examples for docs/templates only (like NANP 555-xxxx).
 * Not intended for live subscriber assignment.
 */
export const PHONE_TEMPLATE_EXAMPLES = ['9000001', '9000002'];

export const PHONE_HINT =
  '';

export function sanitizePhoneInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, MALDIVES_PHONE_LENGTH);
}

export function isValidMaldivesPhone(value) {
  const digits = sanitizePhoneInput(value);
  return /^[79]\d{6}$/.test(digits);
}

export function getPhoneValidationMessage(value) {
  const digits = sanitizePhoneInput(value);
  if (!digits) return 'Phone number is required';
  if (digits.length !== MALDIVES_PHONE_LENGTH) {
    return `Phone number must be exactly ${MALDIVES_PHONE_LENGTH} digits`;
  }
  if (!/^[79]/.test(digits)) {
    return 'Maldives mobile numbers must start with 7 or 9';
  }
  return '';
}

export function formatPhoneDisplay(value) {
  const digits = sanitizePhoneInput(value);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}
