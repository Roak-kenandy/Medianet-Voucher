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
| Auth | `JWT_ACCESS_SECRET` |
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

## Staff passwords and account recovery

- Any staff member can change their own password from **Staff → Change My Password** (ends all of their sessions).
- An Admin can reset another staff member's password from the Staff list.
- If nobody can sign in, or the seed admin still has the default password, set one from the server:

  ```bash
  cd backend
  ADMIN_NEW_PASSWORD='<strong password>' npm run admin:set-password -- admin@example.com
  ```

  In production the API refuses to start while any active staff account still uses the default seed password.

## Operator users

An operator is a company (wallet, packages, customers). It can have several portal users, each with their own login email, password, role (Supervisor or Normal user) and permissions.

- Creating an operator also creates its first user from the email and password on the form.
- Staff with the *manage operators* permission manage users from **Operators → Manage Users**: view users (role, status, last login, active sessions, locked or not), add, edit, activate or deactivate, and reset passwords.
- Resetting a password, changing a login email or deactivating a user signs that user out everywhere. Deactivating the operator signs out all of its users.
- Migration `028_operator_users.sql` turns each existing operator login into that operator's first user, keeping the same email, password, role and sessions.

## Operator commission and API keys

- **Wallet top-up commission** is set per operator as a percent (`15`) or a ratio (`1.15`); both add the same bonus to the payment total before GST. Customer sales earn no commission.
- **Operator API keys** are issued by staff with the *manage operators* permission, either when creating the operator or later from Edit Operator. A key is shown once; only its SHA-256 hash is stored (`operator_api_keys`). Keys can be revoked at any time. The operator API that consumes them is not built yet.

## Operator API (v1)

Operators can integrate their own systems through `/api/v1`, authenticated with an operator
API key (`Authorization: Bearer mtvop_…`). It covers customer search by service code or phone,
balance, current subscriptions, offers, packages, top-up, subscribe, renew, upgrade, and
transaction lookup. It runs on the same services as the portal, so an operator's customer
types, sales models, packages and eligibility rules apply identically. Money requests require
an `Idempotency-Key` and are safe to retry. Every request that takes input is a POST with a JSON
body, lookups included, so phone numbers and service codes stay out of URLs and access logs.

The guide is shown in the portal under **Developer API**: to all staff, and to an operator's
users only while **API access** is turned on for that operator (Operators → Edit Operator).
It is served through signed-in routes only and is not in any public directory.

- Guide for partners: [`backend/docs/partner-api.md`](backend/docs/partner-api.md)
- OpenAPI description: [`backend/docs/partner-api.openapi.yaml`](backend/docs/partner-api.openapi.yaml)

## Customer types and sales models

Both are managed by Admins under **CRM Settings** instead of being fixed in code and `.env`.

- **Customer types** (Mobile, TV, and any you add) each have a CRM tag name and id, a device product id and an optional price segment. An operator can only look up and create customers of the types it is allowed, and new customers get that type's CRM tag.
- **Sales models** are the CRM price tiers. Each package records the sales model its price belongs to, and an operator can only be given packages from the sales models it is allowed.
- Operators get both allow-lists in Create/Edit Operator. Package groups respect them: a group's packages outside an operator's types or sales models are simply not offered to that operator.
- The built-in Mobile and TV types keep using `DEFAULT_TAG_ID`, `DEVICE_PRODUCT_ID`, `MEDIANET_TV_TAG_ID` and `MEDIANET_TV_DEVICE_PRODUCT_ID` from `.env` until ids are entered in CRM Settings. `CRM_SALES_MODEL_NAME` only seeds the first sales model.

## CRM integration

Customer accounts are provisioned through the CRM API (`backend/src/services/crmService.js`). Voucher rows move from `pending` → `created` or `failed` based on the CRM response.

## Production checklist

- [ ] Strong, unique JWT secrets (64+ random characters)
- [ ] Unique admin password; disable or rotate seed credentials (the API will not start in production with the default)
- [ ] HTTPS everywhere; secure `CORS_ORIGIN`
- [ ] `NODE_ENV=production`
- [ ] BML webhook URL configured and verified
- [ ] CRM and BML keys stored only in environment / secret manager — not in git
- [ ] `.env` listed in `.gitignore` and never pushed to GitHub
- [ ] Review rate limits and staff permissions for your deployment

## License

Proprietary — Medianet. All rights reserved.
