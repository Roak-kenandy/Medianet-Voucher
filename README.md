# Medianet Voucher Portal

Secure full-stack portal for managing voucher account creation with **Admin** and **Operator** roles.

## Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | React 18, Vite, React Router        |
| Backend  | Node.js, Express 4                  |
| Database | MySQL 8                             |

## Features

### Security (Industry Standard)
- JWT access tokens (15 min) + rotating refresh tokens in **httpOnly cookies**
- bcrypt password hashing (12 rounds)
- Account lockout after 5 failed login attempts (15 min)
- Rate limiting on auth and account creation endpoints
- Helmet security headers, CORS, input validation (Zod)
- RBAC enforced on every API route
- Full audit logging

### Admin Portal
- Dashboard with system statistics
- Create operators with client name, email, password, and **account quota**
- Activate/deactivate operators
- Update operator quotas

### Operator Portal
- Dashboard with quota usage visualization
- Create single accounts (name + phone)
- Bulk upload up to **10 accounts at a time**
- Quota enforcement — cannot exceed assigned limit
- CSV import/export template
- View all created accounts

## Project Structure

```
medianet-voucher/
├── backend/          # Node.js API
│   ├── src/
│   ├── sql/schema.sql
│   └── .env.example
└── frontend/         # React SPA
    └── src/
```

## Setup

### 1. Database

Ensure MySQL is running and the database/user exist:

```sql
CREATE DATABASE IF NOT EXISTS Medianet_Voucher;
CREATE USER IF NOT EXISTS 'Medianet_Voucher'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON Medianet_Voucher.* TO 'Medianet_Voucher'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Backend

```bash
cd backend
cp .env.example .env   # Edit with your DB credentials and JWT secrets
npm install
npm run migrate        # Creates tables
npm run seed           # Creates initial admin user
npm run dev            # Starts API on http://localhost:4000
```

Default seed admin (change after first login):
- **Email:** admin@medianet.mv
- **Password:** ChangeMe@Secure123

### 3. Frontend

```bash
cd frontend
npm install
npm run dev            # Starts UI on http://localhost:5173
```

## API Endpoints

### Auth
| Method | Path              | Description        |
|--------|-------------------|--------------------|
| POST   | /api/auth/login   | Login (admin/operator) |
| POST   | /api/auth/refresh | Refresh access token   |
| POST   | /api/auth/logout  | Logout                 |
| GET    | /api/auth/me      | Current user           |

### Admin (requires admin role)
| Method | Path                           | Description          |
|--------|--------------------------------|----------------------|
| GET    | /api/admin/stats               | Dashboard stats      |
| GET    | /api/admin/operators           | List operators       |
| POST   | /api/admin/operators           | Create operator      |
| PATCH  | /api/admin/operators/:id/status| Activate/deactivate  |
| PATCH  | /api/admin/operators/:id/quota | Update quota         |

### Operator (requires operator role)
| Method | Path                        | Description              |
|--------|-----------------------------|--------------------------|
| GET    | /api/operator/stats         | Quota & stats            |
| GET    | /api/operator/accounts      | List accounts (paginated)|
| POST   | /api/operator/accounts      | Create single account    |
| POST   | /api/operator/accounts/bulk | Bulk create (max 10)     |

## External API Integration

Account records are stored with `status: pending`. When you provide the external voucher creation API, wire it in:

```
backend/src/services/operatorService.js → createAccountRecords()
```

Update status to `created` or `failed` based on API response.

## Production Checklist

- [ ] Change JWT secrets to cryptographically random 64+ char strings
- [ ] Change seed admin password immediately
- [ ] Enable HTTPS
- [ ] Set `NODE_ENV=production`
- [ ] Use Redis-backed rate limiting for multi-instance deployments
- [ ] Review CORS origin setting
