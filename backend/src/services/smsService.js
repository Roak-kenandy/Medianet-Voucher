import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

export function isSmsConfigured() {
  return Boolean(config.sms.apiUrl && config.sms.username && config.sms.accessKey);
}

/** The gateway token is stored as given; tolerate "Bearer Bearer <token>" and a bare token. */
function authorizationHeader() {
  let value = String(config.sms.authBearer || '').trim();
  if (!value) return null;
  value = value.replace(/^Bearer\s+Bearer\s+/i, 'Bearer ');
  return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`;
}

/** Local 7-digit Maldives mobile number (accepts +960 / 960 prefixes). */
export function toLocalMobile(phoneNumber) {
  const digits = String(phoneNumber || '').replace(/\D/g, '');
  const local = digits.length > 7 && digits.startsWith('960') ? digits.slice(3) : digits;
  if (!/^[79]\d{6}$/.test(local)) {
    throw new AppError('Customer does not have a valid Maldives mobile number', 400, 'INVALID_PHONE');
  }
  return local;
}

/**
 * Sends one SMS through the Ooredoo bulk SMS gateway. The message body is never logged:
 * it can contain login details.
 */
export async function sendSms(phoneNumber, message) {
  if (!isSmsConfigured()) {
    throw new AppError('SMS is not configured on the server', 503, 'SMS_NOT_CONFIGURED');
  }
  const local = toLocalMobile(phoneNumber);

  const headers = { 'Content-Type': 'application/json' };
  const authorization = authorizationHeader();
  if (authorization) headers.Authorization = authorization;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.sms.requestTimeoutMs);
  let response;
  try {
    response = await fetch(config.sms.apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: config.sms.username,
        access_key: config.sms.accessKey,
        message,
        batch: `960${local}`,
      }),
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (err) {
    console.error('[SMS] Gateway request failed:', err.name === 'AbortError' ? 'timeout' : err.message);
    throw new AppError('Could not reach the SMS gateway. Please try again.', 502, 'SMS_FAILED');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`[SMS] Gateway rejected the message (${response.status}): ${body.slice(0, 200)}`);
    throw new AppError('The SMS gateway rejected the message', 502, 'SMS_FAILED');
  }

  return { phone: local };
}
