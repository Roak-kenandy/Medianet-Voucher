import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import {
  requireWebhookVerificationConfigured,
  verifyLegacyWebhookPayload,
  verifyWebhookHeaders,
} from './bmlPaymentService.js';
import { isProduction } from '../config/index.js';
import { syncTopupFromBml, getWalletTopupBill } from './walletService.js';
import { logAudit } from './auditService.js';

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function findPendingTopup({ localId, bmlTransactionId }) {
  if (localId) {
    const rows = await query(
      `SELECT id, operator_id AS operatorId, reference, status, metadata
       FROM wallet_transactions
       WHERE reference = ? AND type = 'topup'
       LIMIT 1`,
      [localId]
    );
    if (rows[0]) return rows[0];
  }

  if (bmlTransactionId) {
    const rows = await query(
      `SELECT id, operator_id AS operatorId, reference, status, metadata
       FROM wallet_transactions
       WHERE type = 'topup'
         AND (
           payment_ref = ?
           OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.bmlTransactionId')) = ?
         )
       LIMIT 1`,
      [bmlTransactionId, bmlTransactionId]
    );
    if (rows[0]) return rows[0];
  }

  return null;
}

function extractWebhookContext(payload = {}, headers = {}) {
  const eventType = payload.eventType || payload.event || payload.type || null;
  const transactionId =
    payload.transactionId ||
    payload.id ||
    payload.transaction?.id ||
    payload.data?.transactionId ||
    null;
  const localId =
    payload.localId ||
    payload.local_id ||
    payload.transaction?.localId ||
    payload.data?.localId ||
    null;
  const state = (
    payload.state ||
    payload.status ||
    payload.transaction?.state ||
    payload.data?.state ||
    ''
  ).toUpperCase();

  return { eventType, transactionId, localId, state };
}

export async function processBmlWebhook(payload, headers = {}, reqMeta = {}) {
  requireWebhookVerificationConfigured();

  const headerVerified = verifyWebhookHeaders(headers);
  const legacyVerified = isProduction ? false : verifyLegacyWebhookPayload(payload);

  if (!headerVerified && !legacyVerified) {
    throw new AppError('Invalid BML webhook signature', 403, 'BML_WEBHOOK_INVALID');
  }

  const { transactionId, localId } = extractWebhookContext(payload, headers);

  if (transactionId) {
    return syncTopupFromBml({
      bmlTransactionId: transactionId,
      localId,
      reqMeta,
      actor: { type: 'system', id: null },
    });
  }

  if (localId) {
    const tx = await findPendingTopup({ localId });
    if (!tx) {
      return { handled: false, reason: 'transaction_not_found' };
    }

    const metadata = parseMetadata(tx.metadata);
    const bmlId = metadata.bmlTransactionId;
    if (!bmlId) {
      return { handled: false, reason: 'missing_bml_transaction_id' };
    }

    return syncTopupFromBml({
      bmlTransactionId: bmlId,
      localId,
      reqMeta,
      actor: { type: 'system', id: null },
    });
  }

  return { handled: false, reason: 'missing_transaction_identifiers' };
}

export async function reconcileTopupPayment({
  operatorId,
  reference,
  bmlTransactionId = null,
  reqMeta = {},
}) {
  const rows = await query(
    `SELECT id, operator_id AS operatorId, reference, status, amount, net_amount AS netAmount,
            balance_after AS balanceAfter, metadata, payment_ref AS paymentRef
     FROM wallet_transactions
     WHERE reference = ? AND type = 'topup' AND operator_id = ?
     LIMIT 1`,
    [reference, operatorId]
  );

  const tx = rows[0];
  if (!tx) {
    throw new AppError('Wallet top-up not found', 404, 'NOT_FOUND');
  }

  if (tx.status === 'completed') {
    const bill = await getWalletTopupBill(operatorId, reference);
    return {
      reference: tx.reference,
      status: 'completed',
      amount: Number(tx.amount),
      amountPaid: Number(tx.amount),
      netAmount: Number(tx.netAmount),
      credited: Number(tx.netAmount),
      balance: Number(tx.balanceAfter),
      alreadyCompleted: true,
      bill,
    };
  }

  const metadata = parseMetadata(tx.metadata);
  const storedBmlId = metadata.bmlTransactionId || tx.paymentRef || null;
  if (bmlTransactionId && storedBmlId && bmlTransactionId !== storedBmlId) {
    throw new AppError(
      'Bank of Maldives transaction does not match this top-up reference',
      400,
      'BML_REFERENCE_MISMATCH'
    );
  }
  const resolvedBmlId = storedBmlId || bmlTransactionId;

  if (!resolvedBmlId) {
    return {
      reference: tx.reference,
      status: tx.status,
      pending: true,
      message: 'Payment is still being initiated.',
    };
  }

  const result = await syncTopupFromBml({
    bmlTransactionId: resolvedBmlId,
    localId: tx.reference,
    reqMeta,
    actor: { type: 'operator', id: operatorId },
  });

  if (!result.status) {
    return {
      reference: tx.reference,
      status: 'pending',
      amount: Number(tx.amount),
      amountPaid: Number(tx.amount),
      message: result.message || 'Unable to verify payment',
      bmlState: result.bmlState || null,
    };
  }

  if (result.status === 'completed' && result.credited == null) {
    result.amount = Number(tx.amount);
    result.amountPaid = Number(tx.amount);
    result.netAmount = Number(tx.netAmount);
    result.credited = Number(tx.netAmount);
  }

  if (result.status === 'failed' || result.status === 'cancelled') {
    result.amount = Number(tx.amount);
    result.amountPaid = Number(tx.amount);
  }

  if (result.status === 'completed') {
    try {
      result.bill = await getWalletTopupBill(operatorId, reference);
    } catch {
      // Bill enrichment is best-effort after reconciliation.
    }
  }

  await logAudit({
    actorType: 'operator',
    actorId: operatorId,
    action: 'WALLET_TOPUP_RECONCILE',
    resourceType: 'wallet_transaction',
    resourceId: tx.id,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { reference, bmlTransactionId: resolvedBmlId, result },
  });

  return result;
}
