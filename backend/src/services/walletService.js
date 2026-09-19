import crypto from 'crypto';
import { config, isProduction } from '../config/index.js';
import { query, getConnection } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { logAudit } from './auditService.js';
import { paginationSql } from '../utils/pagination.js';
import {
  assertBmlPaymentMatchesTopup,
  buildRedirectUrl,
  createPaymentTransaction,
  getPaymentTransaction,
  isBmlEnabled,
  isPaymentConfirmed,
  isPaymentFailed,
} from './bmlPaymentService.js';

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function generateReference(prefix = 'WT') {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${suffix}`;
}

export function calculateTopupCredit(
  paidAmount,
  { commissionType = 'none', commissionValue = 0, gstRate = config.wallet.gstRate } = {}
) {
  const amountPaid = roundMoney(paidAmount);
  const rate = Math.max(0, Math.min(1, Number(gstRate) || 0));
  const gstAmount = roundMoney(amountPaid * rate);
  const afterGst = roundMoney(amountPaid - gstAmount);

  let commission = 0;
  if (commissionType === 'fixed') {
    commission = roundMoney(commissionValue);
  } else if (commissionType === 'percent') {
    commission = roundMoney(afterGst * (Number(commissionValue) / 100));
  }

  const net = roundMoney(afterGst + commission);

  return {
    amount: amountPaid,
    amountPaid,
    gstRate: rate,
    gstRatePercent: roundMoney(rate * 100),
    gstAmount,
    afterGst,
    commission,
    net,
    commissionType,
    commissionValue: Number(commissionValue) || 0,
  };
}

function buildTopupDescription(breakdown, currencyCode = config.wallet.currencyCode) {
  const { amountPaid, gstRatePercent, gstAmount, commission, net } = breakdown;
  let description = `Wallet top-up — paid ${amountPaid} ${currencyCode}, GST ${gstRatePercent}% (${gstAmount} ${currencyCode})`;

  if (commission > 0) {
    description += `, bonus +${commission} ${currencyCode}, credited ${net} ${currencyCode}`;
  } else {
    description += `, credited ${net} ${currencyCode}`;
  }

  return description;
}

function buildTopupMetadata(breakdown, commissionSettings) {
  return {
    activity: 'wallet_topup',
    amountPaid: breakdown.amountPaid,
    gstRate: breakdown.gstRate,
    gstRatePercent: breakdown.gstRatePercent,
    gstAmount: breakdown.gstAmount,
    afterGst: breakdown.afterGst,
    commissionType: commissionSettings.commissionType,
    commissionValue: commissionSettings.commissionValue,
    commissionAmount: breakdown.commission,
    creditedAmount: breakdown.net,
  };
}

export function formatOperatorCommission({ commissionType, commissionValue }) {
  if (commissionType === 'fixed') {
    return { commissionType, commissionValue: roundMoney(commissionValue) };
  }
  if (commissionType === 'percent') {
    return { commissionType, commissionValue: roundMoney(commissionValue) };
  }
  return { commissionType: 'none', commissionValue: 0 };
}

async function getOperatorCommissionSettings(operatorId, connection = null) {
  const runner = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows[0])
    : async (sql, params) => {
        const rows = await query(sql, params);
        return rows[0];
      };

  const operator = await runner(
    `SELECT wallet_commission_type, wallet_commission_value
     FROM operators WHERE id = ? LIMIT 1`,
    [operatorId]
  );

  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  return formatOperatorCommission({
    commissionType: operator.wallet_commission_type || 'none',
    commissionValue: operator.wallet_commission_value,
  });
}

export async function getOperatorWallet(operatorId, connection = null) {
  const runner = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows[0])
    : async (sql, params) => {
        const rows = await query(sql, params);
        return rows[0];
      };

  const operator = await runner(
    `SELECT id, wallet_balance, accounts_created, client_name, is_active,
            wallet_commission_type, wallet_commission_value
     FROM operators WHERE id = ? LIMIT 1`,
    [operatorId]
  );

  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  const commission = formatOperatorCommission({
    commissionType: operator.wallet_commission_type,
    commissionValue: operator.wallet_commission_value,
  });

  return {
    operatorId: operator.id,
    clientName: operator.client_name,
    balance: roundMoney(operator.wallet_balance),
    accountsCreated: Number(operator.accounts_created) || 0,
    currencyCode: config.wallet.currencyCode,
    walletCommissionType: commission.commissionType,
    walletCommissionValue: commission.commissionValue,
    gstRate: config.wallet.gstRate,
    gstRatePercent: roundMoney(config.wallet.gstRate * 100),
    minTopupAmount: config.wallet.minTopupAmount,
    maxTopupAmount: config.wallet.maxTopupAmount,
  };
}

async function insertTransaction(connection, row) {
  const [result] = await connection.execute(
    `INSERT INTO wallet_transactions
       (operator_id, type, status, amount, commission_amount, net_amount,
        balance_before, balance_after, currency_code, reference, payment_ref,
        voucher_account_id, description, metadata, created_by_type, created_by_id, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.operatorId,
      row.type,
      row.status,
      row.amount,
      row.commissionAmount,
      row.netAmount,
      row.balanceBefore,
      row.balanceAfter,
      row.currencyCode || config.wallet.currencyCode,
      row.reference,
      row.paymentRef || null,
      row.voucherAccountId || null,
      row.description || null,
      row.metadata ? JSON.stringify(row.metadata) : null,
      row.createdByType || null,
      row.createdById || null,
      row.status === 'completed' ? new Date() : null,
    ]
  );

  return result.insertId;
}

export async function creditWallet(
  connection,
  {
    operatorId,
    type,
    netAmount,
    grossAmount = netAmount,
    commissionAmount = 0,
    description,
    paymentRef = null,
    reference = generateReference(type === 'topup' ? 'TOP' : 'ADJ'),
    status = 'completed',
    createdByType = 'system',
    createdById = null,
    metadata = null,
  }
) {
  const [rows] = await connection.execute(
    `SELECT wallet_balance FROM operators WHERE id = ? FOR UPDATE`,
    [operatorId]
  );

  const operator = rows[0];
  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  const balanceBefore = roundMoney(operator.wallet_balance);
  const credit = roundMoney(netAmount);
  const balanceAfter = roundMoney(balanceBefore + credit);

  await connection.execute(`UPDATE operators SET wallet_balance = ? WHERE id = ?`, [
    balanceAfter,
    operatorId,
  ]);

  const transactionId = await insertTransaction(connection, {
    operatorId,
    type,
    status,
    amount: roundMoney(grossAmount),
    commissionAmount: roundMoney(commissionAmount),
    netAmount: credit,
    balanceBefore,
    balanceAfter,
    reference,
    paymentRef,
    description,
    createdByType,
    createdById,
    metadata,
  });

  return { transactionId, reference, balanceBefore, balanceAfter, credit };
}

export async function debitWallet(
  connection,
  {
    operatorId,
    amount,
    voucherAccountId = null,
    description,
    createdByType = 'operator',
    createdById = null,
    metadata = null,
  }
) {
  const debit = roundMoney(amount);
  if (debit <= 0) {
    throw new AppError('Debit amount must be greater than zero', 400, 'VALIDATION_ERROR');
  }

  const [rows] = await connection.execute(
    `SELECT wallet_balance FROM operators WHERE id = ? FOR UPDATE`,
    [operatorId]
  );

  const operator = rows[0];
  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  const balanceBefore = roundMoney(operator.wallet_balance);
  if (balanceBefore < debit) {
    throw new AppError(
      `Insufficient wallet balance. Required ${debit} ${config.wallet.currencyCode}, available ${balanceBefore} ${config.wallet.currencyCode}.`,
      403,
      'INSUFFICIENT_WALLET_BALANCE'
    );
  }

  const balanceAfter = roundMoney(balanceBefore - debit);

  await connection.execute(`UPDATE operators SET wallet_balance = ? WHERE id = ?`, [
    balanceAfter,
    operatorId,
  ]);

  const transactionId = await insertTransaction(connection, {
    operatorId,
    type: 'debit',
    status: 'completed',
    amount: debit,
    commissionAmount: 0,
    netAmount: debit,
    balanceBefore,
    balanceAfter,
    reference: generateReference('DBT'),
    voucherAccountId,
    description,
    createdByType,
    createdById,
    metadata,
  });

  return { transactionId, balanceBefore, balanceAfter, debit };
}

function readTransactionMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function getPendingWalletTopup(operatorId) {
  const rows = await query(
    `SELECT id, reference, amount, net_amount AS netAmount, metadata, created_at AS createdAt
     FROM wallet_transactions
     WHERE operator_id = ? AND type = 'topup' AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [operatorId]
  );

  const row = rows[0];
  if (!row) return null;

  const metadata = readTransactionMetadata(row.metadata);
  const shortPaymentUrl = metadata.shortPaymentUrl || null;
  const paymentUrl = metadata.paymentUrl || shortPaymentUrl;

  if (!paymentUrl) return null;

  return {
    transactionId: row.id,
    reference: row.reference,
    amount: roundMoney(row.amount),
    netAmount: roundMoney(row.netAmount),
    paymentUrl,
    shortPaymentUrl: shortPaymentUrl || paymentUrl,
    qrImageUrl: metadata.qrImageUrl || null,
    bmlTransactionId: metadata.bmlTransactionId || null,
    createdAt: row.createdAt,
  };
}

function buildPendingTopupResponse(pending, breakdown, commissionSettings) {
  const { amount: gross, commission, net, gstAmount, afterGst } = breakdown;
  return {
    transactionId: pending.transactionId,
    reference: pending.reference,
    status: 'pending',
    amount: gross,
    amountPaid: gross,
    gstRate: breakdown.gstRate,
    gstRatePercent: breakdown.gstRatePercent,
    gstAmount,
    afterGst,
    commissionAmount: commission,
    netAmount: net,
    currencyCode: config.wallet.currencyCode,
    walletCommissionType: commissionSettings.commissionType,
    walletCommissionValue: commissionSettings.commissionValue,
    paymentUrl: pending.paymentUrl,
    shortPaymentUrl: pending.shortPaymentUrl,
    qrImageUrl: pending.qrImageUrl,
    bmlTransactionId: pending.bmlTransactionId,
    resumed: true,
    message: `Continue your pending payment of ${gross} ${config.wallet.currencyCode}.`,
  };
}

export async function initiateTopup(operatorId, amount, reqMeta = {}) {
  const commissionSettings = await getOperatorCommissionSettings(operatorId);
  const breakdown = calculateTopupCredit(amount, {
    commissionType: commissionSettings.commissionType,
    commissionValue: commissionSettings.commissionValue,
    gstRate: config.wallet.gstRate,
  });
  const { amount: gross, commission, net, gstAmount, afterGst } = breakdown;

  if (gross < config.wallet.minTopupAmount) {
    throw new AppError(
      `Minimum top-up amount is ${config.wallet.minTopupAmount} ${config.wallet.currencyCode}`,
      400,
      'TOPUP_TOO_LOW'
    );
  }

  if (gross > config.wallet.maxTopupAmount) {
    throw new AppError(
      `Maximum top-up amount is ${config.wallet.maxTopupAmount} ${config.wallet.currencyCode}`,
      400,
      'TOPUP_TOO_HIGH'
    );
  }

  if (isBmlEnabled() && !config.wallet.autoCompleteTopup) {
    const existingPending = await getPendingWalletTopup(operatorId);
    if (existingPending && existingPending.amount === gross) {
      return buildPendingTopupResponse(existingPending, breakdown, commissionSettings);
    }
  }

  let connection = await getConnection();

  try {
    await connection.beginTransaction();

    const description = buildTopupDescription(breakdown, config.wallet.currencyCode);
    const metadata = buildTopupMetadata(breakdown, commissionSettings);

    if (config.wallet.autoCompleteTopup) {
      const result = await creditWallet(connection, {
        operatorId,
        type: 'topup',
        grossAmount: gross,
        netAmount: net,
        commissionAmount: commission,
        description,
        status: 'completed',
        createdByType: 'operator',
        createdById: operatorId,
        metadata,
      });

      await connection.commit();

      await logAudit({
        actorType: 'operator',
        actorId: operatorId,
        action: 'WALLET_TOPUP_COMPLETED',
        resourceType: 'wallet_transaction',
        resourceId: result.transactionId,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: {
          amount: gross,
          net,
          commission,
          gstAmount,
          afterGst,
          reference: result.reference,
        },
      });

      return {
        transactionId: result.transactionId,
        reference: result.reference,
        status: 'completed',
        amount: gross,
        amountPaid: gross,
        gstRate: breakdown.gstRate,
        gstRatePercent: breakdown.gstRatePercent,
        gstAmount,
        afterGst,
        commissionAmount: commission,
        netAmount: net,
        balance: result.balanceAfter,
        currencyCode: config.wallet.currencyCode,
        walletCommissionType: commissionSettings.commissionType,
        walletCommissionValue: commissionSettings.commissionValue,
        paymentUrl: null,
        message: `You paid ${gross} ${config.wallet.currencyCode}. After ${breakdown.gstRatePercent}% GST (${gstAmount} ${config.wallet.currencyCode}), ${net} ${config.wallet.currencyCode} was added to your wallet.`,
      };
    }

    const [rows] = await connection.execute(
      `SELECT wallet_balance FROM operators WHERE id = ? FOR UPDATE`,
      [operatorId]
    );

    if (!rows[0]) {
      throw new AppError('Operator not found', 404, 'NOT_FOUND');
    }

    const balanceBefore = roundMoney(rows[0].wallet_balance);
    const reference = generateReference('TOP');

    const transactionId = await insertTransaction(connection, {
      operatorId,
      type: 'topup',
      status: 'pending',
      amount: gross,
      commissionAmount: commission,
      netAmount: net,
      balanceBefore,
      balanceAfter: balanceBefore,
      reference,
      description,
      createdByType: 'operator',
      createdById: operatorId,
      metadata,
    });

    await connection.commit();

    await logAudit({
      actorType: 'operator',
      actorId: operatorId,
      action: 'WALLET_TOPUP_INITIATED',
      resourceType: 'wallet_transaction',
      resourceId: transactionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { amount: gross, net, commission, gstAmount, afterGst, reference },
    });

    connection.release();
    connection = null;

    if (!isBmlEnabled()) {
      return {
        transactionId,
        reference,
        status: 'pending',
        amount: gross,
        amountPaid: gross,
        gstRate: breakdown.gstRate,
        gstRatePercent: breakdown.gstRatePercent,
        gstAmount,
        afterGst,
        commissionAmount: commission,
        netAmount: net,
        currencyCode: config.wallet.currencyCode,
        walletCommissionType: commissionSettings.commissionType,
        walletCommissionValue: commissionSettings.commissionValue,
        paymentUrl: null,
        message: `Top-up ${reference} is pending. Payment gateway is not configured yet.`,
      };
    }

    let bmlTransaction;
    try {
      bmlTransaction = await createPaymentTransaction({
        localId: reference,
        amountMvr: gross,
        currency: config.wallet.currencyCode,
        customerReference: `Medianet wallet top-up ${reference}`,
        redirectUrl: buildRedirectUrl(reference),
      });
    } catch (bmlErr) {
      await failTopup(transactionId, bmlErr.message, reqMeta);
      throw bmlErr;
    }

    const shortPaymentUrl = bmlTransaction.shortUrl || null;
    const paymentUrl = shortPaymentUrl || bmlTransaction.url;
    const qrImageUrl = bmlTransaction.qrImageUrl || null;
    if (!paymentUrl) {
      await failTopup(transactionId, 'BML did not return a payment URL', reqMeta);
      throw new AppError('Payment gateway did not return a payment URL', 502, 'BML_ERROR');
    }

    const enrichedMetadata = {
      ...metadata,
      bmlTransactionId: bmlTransaction.id,
      bmlState: bmlTransaction.state,
      paymentUrl,
      shortPaymentUrl,
      qrImageUrl,
    };

    await query(
      `UPDATE wallet_transactions
       SET metadata = ?, payment_ref = ?
       WHERE id = ?`,
      [JSON.stringify(enrichedMetadata), bmlTransaction.id, transactionId]
    );

    return {
      transactionId,
      reference,
      status: 'pending',
      amount: gross,
      amountPaid: gross,
      gstRate: breakdown.gstRate,
      gstRatePercent: breakdown.gstRatePercent,
      gstAmount,
      afterGst,
      commissionAmount: commission,
      netAmount: net,
      currencyCode: config.wallet.currencyCode,
      walletCommissionType: commissionSettings.commissionType,
      walletCommissionValue: commissionSettings.commissionValue,
      paymentUrl,
      shortPaymentUrl,
      qrImageUrl,
      bmlTransactionId: bmlTransaction.id,
      message: `Complete payment of ${gross} ${config.wallet.currencyCode} with Bank of Maldives. After GST, ${net} ${config.wallet.currencyCode} will be credited to your wallet.`,
    };
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }
    throw err;
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

export async function failTopup(transactionId, reason = null, reqMeta = {}) {
  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    const [txRows] = await connection.execute(
      `SELECT id, status, reference FROM wallet_transactions WHERE id = ? FOR UPDATE`,
      [transactionId]
    );

    const tx = txRows[0];
    if (!tx || tx.status !== 'pending') {
      await connection.commit();
      return { transactionId, status: tx?.status || 'unknown' };
    }

    await connection.execute(
      `UPDATE wallet_transactions
       SET status = 'failed', description = CONCAT(IFNULL(description, ''), ?)
       WHERE id = ?`,
      [reason ? ` — Payment failed: ${reason}` : '', transactionId]
    );

    await connection.commit();

    await logAudit({
      actorType: 'system',
      actorId: null,
      action: 'WALLET_TOPUP_FAILED',
      resourceType: 'wallet_transaction',
      resourceId: transactionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { reason, reference: tx.reference },
    });

    return { transactionId, reference: tx.reference, status: 'failed' };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function syncTopupFromBml({
  bmlTransactionId,
  localId = null,
  reqMeta = {},
  actor = {},
}) {
  const bmlTxn = await getPaymentTransaction(bmlTransactionId);
  const state = String(bmlTxn.state || '').toUpperCase();

  const rows = await query(
    `SELECT id, operator_id AS operatorId, reference, status, amount,
            net_amount AS netAmount, balance_after AS balanceAfter
     FROM wallet_transactions
     WHERE type = 'topup'
       AND (
         reference = ?
         OR payment_ref = ?
         OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.bmlTransactionId')) = ?
       )
     LIMIT 1`,
    [localId || bmlTxn.localId, bmlTransactionId, bmlTransactionId]
  );

  const tx = rows[0];
  if (!tx) {
    return {
      status: 'error',
      reference: localId || bmlTxn.localId || null,
      message: 'wallet_transaction_not_found',
      bmlState: state,
    };
  }

  if (tx.status === 'completed') {
    return {
      reference: tx.reference,
      status: 'completed',
      amount: roundMoney(tx.amount),
      amountPaid: roundMoney(tx.amount),
      netAmount: roundMoney(tx.netAmount),
      credited: roundMoney(tx.netAmount),
      balance: roundMoney(tx.balanceAfter),
      alreadyCompleted: true,
      bmlState: state,
    };
  }

  if (isPaymentConfirmed(state)) {
    assertBmlPaymentMatchesTopup(tx, bmlTxn);
    const result = await completeTopup(tx.id, bmlTransactionId, reqMeta, actor, {
      skipBmlVerification: true,
    });
    return {
      reference: tx.reference,
      status: 'completed',
      amount: roundMoney(tx.amount),
      amountPaid: roundMoney(tx.amount),
      netAmount: roundMoney(result.credited),
      credited: roundMoney(result.credited),
      balance: roundMoney(result.balance),
      bmlState: state,
    };
  }

  if (isPaymentFailed(state)) {
    await failTopup(tx.id, `BML state: ${state}`, reqMeta);
    return {
      reference: tx.reference,
      status: state === 'CANCELLED' ? 'cancelled' : 'failed',
      amount: roundMoney(tx.amount),
      amountPaid: roundMoney(tx.amount),
      bmlState: state,
    };
  }

  return {
    reference: tx.reference,
    status: 'pending',
    amount: roundMoney(tx.amount),
    amountPaid: roundMoney(tx.amount),
    bmlState: state,
  };
}

export async function completeTopup(
  transactionId,
  paymentRef = null,
  reqMeta = {},
  actor = {},
  options = {}
) {
  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    const [txRows] = await connection.execute(
      `SELECT * FROM wallet_transactions WHERE id = ? FOR UPDATE`,
      [transactionId]
    );

    const tx = txRows[0];
    if (!tx) {
      throw new AppError('Wallet transaction not found', 404, 'NOT_FOUND');
    }

    if (tx.type !== 'topup') {
      throw new AppError('Transaction is not a top-up', 400, 'INVALID_TRANSACTION');
    }

    if (tx.status === 'completed') {
      await connection.commit();
      return {
        transactionId: tx.id,
        reference: tx.reference,
        status: 'completed',
        balance: roundMoney(tx.balance_after),
        credited: roundMoney(tx.net_amount),
      };
    }

    if (tx.status !== 'pending') {
      throw new AppError(`Cannot complete top-up with status ${tx.status}`, 400, 'INVALID_TRANSACTION');
    }

    const metadata = readTransactionMetadata(tx.metadata);
    const resolvedPaymentRef = paymentRef || metadata.bmlTransactionId || tx.payment_ref;

    if (isBmlEnabled() && !options.skipBmlVerification) {
      if (!resolvedPaymentRef) {
        throw new AppError(
          'Cannot complete top-up without verified Bank of Maldives payment',
          400,
          'BML_VERIFICATION_REQUIRED'
        );
      }
      const bmlTxn = await getPaymentTransaction(resolvedPaymentRef);
      assertBmlPaymentMatchesTopup(tx, bmlTxn);
    } else if (isProduction && !config.wallet.allowManualTopupComplete) {
      throw new AppError('Manual top-up completion is disabled', 403, 'FORBIDDEN');
    }

    const [operatorRows] = await connection.execute(
      `SELECT wallet_balance FROM operators WHERE id = ? FOR UPDATE`,
      [tx.operator_id]
    );

    const balanceBefore = roundMoney(operatorRows[0].wallet_balance);
    const balanceAfter = roundMoney(balanceBefore + tx.net_amount);

    await connection.execute(`UPDATE operators SET wallet_balance = ? WHERE id = ?`, [
      balanceAfter,
      tx.operator_id,
    ]);

    await connection.execute(
      `UPDATE wallet_transactions
       SET status = 'completed', balance_before = ?, balance_after = ?,
           payment_ref = ?, completed_at = NOW()
       WHERE id = ?`,
      [balanceBefore, balanceAfter, resolvedPaymentRef, transactionId]
    );

    await connection.commit();

    await logAudit({
      actorType: actor.type || 'system',
      actorId: actor.id || null,
      action: 'WALLET_TOPUP_COMPLETED',
      resourceType: 'wallet_transaction',
      resourceId: transactionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { paymentRef: resolvedPaymentRef, reference: tx.reference, credited: tx.net_amount },
    });

    return {
      transactionId: tx.id,
      reference: tx.reference,
      status: 'completed',
      balance: balanceAfter,
      credited: roundMoney(tx.net_amount),
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function adminAdjustWallet(adminId, operatorId, amount, description, reqMeta = {}) {
  const adjustment = roundMoney(amount);
  if (!adjustment) {
    throw new AppError('Adjustment amount cannot be zero', 400, 'VALIDATION_ERROR');
  }

  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    let result;
    if (adjustment > 0) {
      result = await creditWallet(connection, {
        operatorId,
        type: 'adjustment',
        grossAmount: adjustment,
        netAmount: adjustment,
        commissionAmount: 0,
        description: description || 'Manual wallet adjustment',
        createdByType: 'admin',
        createdById: adminId,
      });
    } else {
      result = await debitWallet(connection, {
        operatorId,
        amount: Math.abs(adjustment),
        description: description || 'Manual wallet adjustment',
        createdByType: 'admin',
        createdById: adminId,
      });
    }

    await connection.commit();

    await logAudit({
      actorType: 'admin',
      actorId: adminId,
      action: 'WALLET_ADJUSTED',
      resourceType: 'operator',
      resourceId: operatorId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { amount: adjustment, description },
    });

    return {
      balance: result.balanceAfter,
      transactionId: result.transactionId,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function formatActivityLabel(metadata = {}) {
  if (metadata.activity === 'create_account') return 'Create Account';
  if (metadata.activity === 'customer_crm_topup') return 'Customer Top-up';
  if (metadata.activity === 'customer_subscribe') return 'Customer Subscribe';
  if (metadata.activity === 'customer_topup') return 'Customer Top-up';
  if (metadata.activity === 'bulk_create') return 'Bulk Create';
  return null;
}

export async function listWalletTransactions(
  operatorId,
  { page = 1, limit = 20, startDate, endDate, type } = {}
) {
  const { page: pageNum, limit: limitNum, clause } = paginationSql(page, limit);
  const filters = ['operator_id = ?'];
  const params = [operatorId];

  if (startDate) {
    filters.push('DATE(created_at) >= ?');
    params.push(startDate);
  }
  if (endDate) {
    filters.push('DATE(created_at) <= ?');
    params.push(endDate);
  }
  if (type) {
    filters.push('type = ?');
    params.push(type);
  }

  const where = `WHERE ${filters.join(' AND ')}`;

  const rows = await query(
    `SELECT id, type, status, amount, commission_amount AS commissionAmount,
            net_amount AS netAmount, balance_before AS balanceBefore,
            balance_after AS balanceAfter, currency_code AS currencyCode,
            reference, payment_ref AS paymentRef, description, metadata,
            voucher_account_id AS voucherAccountId, created_at AS createdAt,
            completed_at AS completedAt
     FROM wallet_transactions
     ${where}
     ORDER BY created_at DESC
     ${clause}`,
    params
  );

  const transactions = rows.map((row) => {
    const metadata = parseMetadata(row.metadata);
    const activity = formatActivityLabel(metadata) || (row.type === 'topup' ? 'Wallet Top-up' : row.type);
    return {
      ...mapTransactionRow(row),
      activity,
      customerName: metadata.customerName || null,
      phoneNumber: metadata.phoneNumber || null,
      serviceTag: metadata.serviceTag || null,
      packageNames: metadata.packageNames || [],
      packageIds: metadata.packageIds || [],
      amountPaid: metadata.amountPaid ?? null,
      gstRatePercent: metadata.gstRatePercent ?? null,
      gstAmount: metadata.gstAmount ?? null,
      afterGst: metadata.afterGst ?? null,
      creditedAmount: metadata.creditedAmount ?? null,
    };
  });

  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM wallet_transactions ${where}`,
    params
  );

  const total = Number(countRow.total) || 0;

  return {
    transactions,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
  };
}

export function mapTransactionRow(row) {
  return {
    ...row,
    amount: roundMoney(row.amount),
    commissionAmount: roundMoney(row.commissionAmount),
    netAmount: roundMoney(row.netAmount),
    balanceBefore: roundMoney(row.balanceBefore),
    balanceAfter: roundMoney(row.balanceAfter),
  };
}
