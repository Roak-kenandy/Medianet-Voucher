import { Router } from 'express';
import { asyncHandler, success, AppError } from '../utils/errors.js';
import { getClientMeta } from '../services/auditService.js';
import { processBmlWebhook } from '../services/bmlWebhookService.js';
import { isBmlEnabled } from '../services/bmlPaymentService.js';
import { webhookLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post(
  '/bml/webhook',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    if (!isBmlEnabled()) {
      throw new AppError('BML payment gateway is disabled', 503, 'BML_DISABLED');
    }

    const result = await processBmlWebhook(req.body, req.headers, getClientMeta(req));
    success(res, { received: true, ...result });
  })
);

export default router;
