import crypto from 'crypto';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

import { isStaffRole } from '../constants/permissions.js';

export function sanitizeUser(user, role) {
  const base = {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
  };

  if (isStaffRole(role)) {
    return base;
  }

  if (role === 'operator') {
    const packages = (user.operator_packages || []).map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
    }));
    const packageNames = packages.map((pkg) => pkg.name);
    return {
      ...base,
      clientName: user.client_name,
      packageType: user.package_name || user.package_type,
      packageNames,
      packages,
      packageIds: packages.map((pkg) => pkg.id),
      packageId: user.package_id,
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
