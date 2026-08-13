import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { errorHandler } from './utils/errors.js';
import { globalLimiter } from './middleware/rateLimit.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import operatorRoutes from './routes/operatorRoutes.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(globalLimiter);

app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/operator', operatorRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Route not found' });
});

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Medianet Voucher API running on http://localhost:${config.port}`);
});
