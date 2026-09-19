# Medianet Voucher Portal

Full-stack portal for managing operator wallets, customer accounts, and voucher provisioning. Supports **staff** (admin, finance, sales) and **operator** roles.

## Stack

| Layer    | Technology                   |
|----------|------------------------------|
| Frontend | React 18, Vite, React Router |
| Backend  | Node.js, Express 4           |
| Database | MySQL 8                      |

## Features

### Security
- JWT access tokens + rotating refresh tokens in **httpOnly cookies**
- bcrypt password hashing
- Account lockout after repeated failed logins
- Rate limiting on auth, account creation, and wallet top-up endpoints
- Helmet security headers, CORS, input validation (Zod)
- Role-based access control on API routes
- Audit logging for sensitive actions

### Staff portal (Admin / Finance / Sales)
- Dashboard and system statistics
- Operator management (packages, wallet multiplier, activation)
- **Operator Topup** — activate operator wallets after finance confirmation (mandatory notes, audit trail)
- Package management
- Staff user management with permissions
- Reports with CSV export (operator top-up, client summary, account activity, and more)

### Operator portal
- Wallet balance with **Bank of Maldives (BML)** online top-up
- GST-inclusive payment breakdown and top-up multiplier bonus
- Payment receipt / bill after successful BML payment (print & download)
- Create account, bulk upload (max 10), customer top-up & subscribe
- Free trial account quota (staff-granted; no wallet charge until quota is used)
- Accounts list with date filters and CSV export
- Transaction and activity reports with CSV export
- Dark / light theme

## Project structure

```
medianet-voucher/
├── backend/
│   ├── src/           # API, services, routes
│   ├── sql/           # Versioned migrations
│   └── .env.example # Environment template (copy to .env — never commit .env)
└── frontend/
    └── src/           # React SPA
```

## Setup

### Prerequisites
- Node.js 18+
- MySQL 8+
- CRM API credentials (for live account provisioning)
- BML merchant credentials (optional; for wallet card payments)

### 1. Database

Create a database and user in MySQL, then grant privileges. Use your own names and a strong password:

```sql
CREATE DATABASE IF NOT EXISTS your_database_name;
CREATE USER IF NOT EXISTS 'your_db_user'@'localhost' IDENTIFIED BY 'your_strong_password';
GRANT ALL PRIVILEGES ON your_database_name.* TO 'your_db_user'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your values. **Do not commit `.env` or share it publicly.** Required settings include database connection, JWT secrets, CRM integration, and (optionally) BML payment gateway — see `.env.example` for all variables.

```bash
npm install
npm run migrate   # Apply SQL migrations
npm run seed      # Create initial admin from SEED_ADMIN_* in .env
npm run dev       # API at http://localhost:4000
```

After seeding, log in with the admin email and password you set in `.env` (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`). Change the seed password before any shared or production use.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev       # UI at http://localhost:5173
```

The dev server proxies `/api` to the backend (port 4000).

## Environment variables

All configuration lives in `backend/.env`. Copy from `backend/.env.example` only — never paste real secrets into documentation, issues, or commit messages.

| Area | Examples (see `.env.example`) |
|------|-------------------------------|
| Database | `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| Auth | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` |
| CRM | `CRM_API_KEY`, `CRM_BASE_URL`, product/tag UUIDs |
| Wallet | `WALLET_GST_RATE`, `WALLET_MIN_TOPUP` |
| BML | `BML_ENABLED`, `BML_AUTH_TOKEN`, `BML_REDIRECT_URL`, `BML_WEBHOOK_URL` |
| Seed | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` |

## API overview

Base path: `/api`

| Group | Path prefix | Description |
|-------|-------------|-------------|
| Auth | `/auth/*` | Login, refresh, logout, current user |
| Admin | `/admin/*` | Staff: operators, packages, reports, operator top-up, activations |
| Operator | `/operator/*` | Wallet, accounts, customers, reports, BML top-up |
| Payments | `/payments/*` | BML webhook (server-to-server) |

Detailed route definitions are in `backend/src/routes/`.

## CRM integration

Customer accounts are provisioned through the CRM API (`backend/src/services/crmService.js`). Voucher rows move from `pending` → `created` or `failed` based on the CRM response.

## Production checklist

- [ ] Strong, unique JWT secrets (64+ random characters)
- [ ] Unique admin password; disable or rotate seed credentials
- [ ] HTTPS everywhere; secure `CORS_ORIGIN`
- [ ] `NODE_ENV=production`
- [ ] BML webhook URL configured and verified
- [ ] CRM and BML keys stored only in environment / secret manager — not in git
- [ ] `.env` listed in `.gitignore` and never pushed to GitHub
- [ ] Review rate limits and staff permissions for your deployment

## License

Proprietary — Medianet. All rights reserved.
