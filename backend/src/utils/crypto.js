import crypto from 'crypto';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

export function sanitizeUser(user, role) {
  const base = {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
  };

  if (role === 'operator') {
    return {
      ...base,
      clientName: user.client_name,
      packageType: user.package_type,
      accountQuota: user.account_quota,
      accountsCreated: user.accounts_created,
      remainingQuota: Math.max(0, user.account_quota - user.accounts_created),
    };
  }

  return base;
}

export function parseDurationToMs(duration) {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 7 * 24 * 60 * 60 * 1000;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}
