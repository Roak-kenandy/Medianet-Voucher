import crypto from 'crypto';
import { config, isProduction } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { consumeWebhookNonce } from './webhookNonceStore.js';

const CONFIRMED_STATES = new Set(['CONFIRMED']);
const FAILED_STATES = new Set(['FAILED', 'CANCELLED', 'EXPIRED', 'VOIDED']);

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function isBmlEnabled() {
  return Boolean(config.bml?.enabled);
}

export function toMinorUnits(amountMvr) {
  return Math.round(Number(amountMvr) * 100);
}

export function fromMinorUnits(amountMinor) {
  return Math.round(Number(amountMinor)) / 100;
}

/**
 * V1 request signature (legacy /public/transactions endpoint).
 * SHA-1 hex digest of amount={minor}&currency={code}&apiKey={secret}
 */
export function generateV1RequestSignature(amountMinor, currency, apiKey, signMethod = 'sha1') {
  const signString = `amount=${amountMinor}&currency=${currency}&apiKey=${apiKey}`;

  if (signMethod === 'md5') {
    return crypto.createHash('md5').update(signString, 'utf8').digest('base64');
  }

  return crypto.createHash('sha1').update(signString, 'utf8').digest('hex');
}

const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * V2 webhook verification: SHA-256 hex of "{nonce}{timestamp}{api_key}".
 * Rejects stale timestamps and replays (nonce store).
 */
export function verifyWebhookHeaders(headers, apiKey = config.bml.apiKey) {
  if (!apiKey) return false;

  const nonce = headers['x-signature-nonce'] || headers['X-Signature-Nonce'] || '';
  const timestamp = headers['x-signature-timestamp'] || headers['X-Signature-Timestamp'] || '';
  const signature = headers['x-signature'] || headers['X-Signature'] || '';

  if (!nonce || !timestamp || !signature) return false;

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) return false;
  if (Math.abs(Date.now() - timestampMs) > WEBHOOK_TIMESTAMP_TOLERANCE_MS) return false;
  if (!consumeWebhookNonce(nonce)) return false;

  const expected = crypto
    .createHash('sha256')
    .update(`${nonce}${timestamp}${apiKey}`, 'utf8')
    .digest('hex');

  return timingSafeEqual(expected, signature);
}

/**
 * Legacy V1 webhook body verification (originalSignature field).
 */
export function verifyLegacyWebhookPayload(payload, apiKey = config.bml.apiKey) {
  if (!apiKey || !payload) return false;

  const originalSignature = payload.originalSignature;
  const amount = payload.amount;
  const currency = payload.currency;

  if (!originalSignature || amount == null || !currency) return false;

  const signString = `amount=${amount}&currency=${currency}&apiKey=${apiKey}`;
  const expected = crypto.createHash('md5').update(signString, 'utf8').digest('base64');

  return timingSafeEqual(expected, originalSignature);
}

async function bmlRequest(method, path, body = null) {
  const { apiBaseUrl, authToken, apiKey, appId } = config.bml;

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const authorization = authToken || apiKey;
  if (!authorization) {
    throw new AppError('BML payment gateway is not configured', 503, 'BML_NOT_CONFIGURED');
  }

  headers.Authorization = authorization;
  // Match merchant curl: JWT-only auth. X-App-Id is optional (V2 / some portals).
  if (appId && config.bml.sendAppIdHeader) {
    headers['X-App-Id'] = appId;
  }

  const url = `${apiBaseUrl.replace(/\/$/, '')}${path}`;
  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(config.bml.requestTimeoutMs),
  };

  if (body != null) {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    console.error('[BML] Network error:', err.message);
    throw new AppError(
      'Unable to reach the payment gateway. Please try again shortly.',
      502,
      'BML_NETWORK_ERROR'
    );
  }

  let data = {};
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => ({}));
  } else {
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }
  }

  if (!response.ok) {
    throw new AppError(
      data.message || `BML payment request failed (${response.status})`,
      response.status >= 400 && response.status < 500 ? response.status : 502,
      data.code || 'BML_ERROR'
    );
  }

  return data;
}

function normalizeTransactionResponse(data) {
  return {
    id: data.id || data.transactionId || null,
    localId: data.localId || data.local_id || null,
    state: (data.state || data.status || '').toUpperCase(),
    url: data.url || data.paymentUrl || null,
    shortUrl: data.shortUrl || data.short_url || null,
    qrImageUrl: data.qr?.url || null,
    amount: data.amount ?? null,
    currency: data.currency || null,
    raw: data,
  };
}

async function enrichTransactionDetails(txn) {
  if (!txn?.id) return txn;

  const needsRefresh = !txn.shortUrl || !txn.qrImageUrl;
  if (!needsRefresh) return txn;

  try {
    const fresh = await getPaymentTransaction(txn.id);
    return {
      ...txn,
      url: fresh.url || txn.url,
      shortUrl: fresh.shortUrl || txn.shortUrl,
      qrImageUrl: fresh.qrImageUrl || txn.qrImageUrl,
      state: fresh.state || txn.state,
    };
  } catch {
    return txn;
  }
}

export async function createPaymentTransaction({
  localId,
  amountMvr,
  currency,
  customerReference,
  redirectUrl,
  webhookUrl,
}) {
  if (!isBmlEnabled()) {
    throw new AppError('BML payment gateway is disabled', 503, 'BML_DISABLED');
  }

  const amountMinor = toMinorUnits(amountMvr);
  const {
    apiMode,
    appVersion,
    deviceId,
    signMethod,
    apiKey,
    provider,
    locale,
  } = config.bml;

  const redirect = redirectUrl || config.bml.redirectUrl;
  if (!redirect) {
    throw new AppError('BML redirect URL is not configured', 500, 'BML_MISCONFIGURED');
  }

  const webhook = webhookUrl || config.bml.webhookUrl || undefined;
  const customerRef = customerReference || `Wallet top-up ${localId}`;

  if (apiMode === 'v2') {
    const payload = {
      amount: amountMinor,
      currency,
      localId,
      customerReference: customerRef,
      redirectUrl: redirect,
    };

    if (webhook) payload.webhook = webhook;
    if (provider) payload.provider = provider;
    if (locale) payload.locale = locale;

    const data = await bmlRequest('POST', '/public/v2/transactions', payload);
    return enrichTransactionDetails(normalizeTransactionResponse(data));
  }

  const payload = {
    localId,
    customerReference: customerRef,
    amount: amountMinor,
    currency,
    redirectUrl: redirect,
    appVersion,
    apiVersion: '2.0',
    deviceId,
  };

  if (webhook) payload.webhook = webhook;
  if (provider) payload.provider = provider;

  // Some merchants use JWT auth only (no separate signing key). Signature is optional.
  if (apiKey) {
    payload.signMethod = signMethod;
    payload.signature = generateV1RequestSignature(amountMinor, currency, apiKey, signMethod);
  }

  const data = await bmlRequest('POST', '/public/transactions', payload);
  return enrichTransactionDetails(normalizeTransactionResponse(data));
}

export async function getPaymentTransaction(transactionId) {
  if (!transactionId) {
    throw new AppError('BML transaction id is required', 400, 'VALIDATION_ERROR');
  }

  const data = await bmlRequest('GET', `/public/transactions/${encodeURIComponent(transactionId)}`);
  return normalizeTransactionResponse(data);
}

export function isPaymentConfirmed(state) {
  return CONFIRMED_STATES.has(String(state || '').toUpperCase());
}

export function isPaymentFailed(state) {
  return FAILED_STATES.has(String(state || '').toUpperCase());
}

export function buildRedirectUrl(reference) {
  const base = config.bml.redirectUrl;
  if (!base) return null;

  const url = new URL(base);
  url.searchParams.set('reference', reference);
  return url.toString();
}

/**
 * Ensures a BML transaction is confirmed and matches the pending local top-up.
 */
export function assertBmlPaymentMatchesTopup(tx, bmlTxn) {
  if (!bmlTxn?.id) {
    throw new AppError('Payment not found at Bank of Maldives', 400, 'BML_PAYMENT_NOT_FOUND');
  }

  const bmlState = String(bmlTxn.state || '').toUpperCase();
  if (!isPaymentConfirmed(bmlState)) {
    throw new AppError(
      'Payment is not confirmed by Bank of Maldives',
      400,
      'BML_PAYMENT_NOT_CONFIRMED'
    );
  }

  const expectedMinor = toMinorUnits(tx.amount);
  const bmlMinor = Math.round(Number(bmlTxn.amount));
  if (!Number.isFinite(bmlMinor) || bmlMinor !== expectedMinor) {
    console.error('[BML] Amount mismatch', {
      reference: tx.reference,
      expectedMinor,
      bmlMinor,
      bmlTransactionId: bmlTxn.id,
    });
    throw new AppError('Payment amount does not match the top-up request', 400, 'BML_AMOUNT_MISMATCH');
  }

  const expectedCurrency = String(tx.currency_code || config.wallet.currencyCode).toUpperCase();
  const bmlCurrency = String(bmlTxn.currency || config.wallet.currencyCode).toUpperCase();
  if (bmlCurrency !== expectedCurrency) {
    throw new AppError('Payment currency does not match', 400, 'BML_CURRENCY_MISMATCH');
  }
}

export function requireWebhookVerificationConfigured() {
  if (isProduction && config.bml.enabled && !config.bml.apiKey) {
    throw new AppError('Payment webhook verification is not configured', 503, 'BML_MISCONFIGURED');
  }
}
