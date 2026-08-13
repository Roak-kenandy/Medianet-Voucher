import { Router } from 'express';
import { authController, authenticate } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { loginSchema } from '../validators/schemas.js';

const router = Router();

router.post('/login', authLimiter, (req, res, next) => {
  try {
    req.body = loginSchema.parse(req.body);
    authController.login(req, res, next);
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', authLimiter, authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.me);

export default router;
