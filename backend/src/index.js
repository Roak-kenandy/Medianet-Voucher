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
import { purgeExpiredRefreshTokens, warnIfDefaultAdminPassword } from './services/authService.js';

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

app.set('trust proxy', config.trustProxy);

let proxyWarningLogged = false;
if (isProduction) {
  // Behind nginx, a loopback req.ip means X-Forwarded-For is missing or not trusted, which
  // collapses every per-IP rate limit into a single shared bucket.
  app.use((req, _res, next) => {
    if (!proxyWarningLogged && /^(::1|127\.|::ffff:127\.)/.test(req.ip || '')) {
      proxyWarningLogged = true;
      console.warn(
        '[Security] Client IP resolves to loopback. Ensure nginx sets X-Forwarded-For and TRUST_PROXY matches your proxy.'
      );
    }
    next();
  });
}

app.use(
  helmet({
    hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
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

const marketingAdsStaticDir = path.join(__dirname, '../uploads/marketing-ads');
const marketingAdsStatic = express.static(marketingAdsStaticDir, {
  maxAge: isProduction ? '7d' : 0,
  fallthrough: false,
  dotfiles: 'deny',
  index: false,
});
// Only marketing ad images are public; knowledge documents are stored outside uploads/.
app.use('/api/uploads/marketing-ads', marketingAdsStatic);
app.use('/uploads/marketing-ads', marketingAdsStatic);

app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Auth routes carry their own per-route limiters (login per IP and per account+IP,
// refresh per cookie) and are not counted against the general API bucket.
app.use('/api/auth', authRoutes);
app.use(globalLimiter);
app.use('/api/admin', adminRoutes);
app.use('/api/operator', operatorRoutes);
app.use('/api/payments', paymentRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Route not found' });
});

app.use(errorHandler);

const REFRESH_TOKEN_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
function scheduleMaintenance() {
  const purge = () =>
    purgeExpiredRefreshTokens().catch((err) =>
      console.error('[Maintenance] Refresh token purge failed:', err.message)
    );
  purge();
  setInterval(purge, REFRESH_TOKEN_PURGE_INTERVAL_MS).unref();
}

app.listen(config.port, () => {
  console.log(`Medianet Voucher API running on http://localhost:${config.port}`);
  scheduleMaintenance();
  warnIfDefaultAdminPassword().catch((err) =>
    console.error('[Security] Default password check failed:', err.message)
  );
});
