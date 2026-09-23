import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureUploadDirs } from './config/uploads.js';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config, isProduction } from './config/index.js';
import { validateSecurityConfig } from './config/securityValidation.js';
import { errorHandler } from './utils/errors.js';
import { globalLimiter } from './middleware/rateLimit.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import operatorRoutes from './routes/operatorRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';

try {
  validateSecurityConfig();
} catch (err) {
  console.error('[Startup] API cannot start — fix production .env and restart:');
  console.error(err.message);
  process.exit(1);
}

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

ensureUploadDirs();

app.set('trust proxy', 1);

app.use(
  helmet({
    hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
);
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const uploadsStaticDir = path.join(__dirname, '../uploads');
const uploadsStatic = express.static(uploadsStaticDir, {
  maxAge: isProduction ? '7d' : 0,
});
// /api/uploads — works when nginx only proxies /api to Node (typical production setup)
app.use('/api/uploads', uploadsStatic);
// /uploads — local dev (optional Vite proxy) and nginx configs with a dedicated uploads location
app.use('/uploads', uploadsStatic);

app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Auth routes use dedicated limiters — keep them outside the global API bucket so
// login is not blocked by unrelated traffic on the same IP (common behind nginx).
app.use('/api/auth', authRoutes);
app.use(globalLimiter);
app.use('/api/admin', adminRoutes);
app.use('/api/operator', operatorRoutes);
app.use('/api/payments', paymentRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Route not found' });
});

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Medianet Voucher API running on http://localhost:${config.port}`);
});
