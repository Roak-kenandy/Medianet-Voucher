#!/usr/bin/env node
/**
 * Regression checks for issues raised in the security audits.
 * Run before every deploy: `npm run verify:security` (no database needed).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.DB_NAME ||= 'verify';
process.env.DB_USER ||= 'verify';
process.env.DB_PASSWORD ||= 'verify';
process.env.JWT_ACCESS_SECRET ||= 'v'.repeat(72);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
function readSource(rel) {
  return fs.readFileSync(path.join(src, rel), 'utf8');
}
function listSources(dir = src) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

const { calculateTopupCredit } = await import('../src/services/walletService.js');
const { csvEscape } = await import('../src/utils/csv.js');
const { parseIdParam } = await import('../src/utils/params.js');
const { classifyCrmFailure, CrmPaymentError, CrmBillableError, AppError } = await import(
  '../src/utils/errors.js'
);
const schemas = await import('../src/validators/schemas.js');
const { formatOperatorCommission } = await import('../src/services/walletService.js');
const { clientIpKey } = await import('../src/middleware/rateLimit.js');
const { contactMatchesPhone } = await import('../src/services/crmService.js');

console.log('Wallet arithmetic');
{
  const plain = calculateTopupCredit(100, { gstRate: 0.08 });
  check('no commission: gross equals paid', plain.grossTotal === 100);
  check('no commission: net + gst equals gross', Math.abs(plain.net + plain.gstAmount - plain.grossTotal) < 0.005);
  const mult = calculateTopupCredit(100, { commissionType: 'multiplier', commissionValue: 1.5, gstRate: 0 });
  check('multiplier 1.5 credits 150', mult.net === 150);
  const below = calculateTopupCredit(100, { commissionType: 'multiplier', commissionValue: 0.2, gstRate: 0 });
  check('multiplier below 1 never reduces credit', below.net === 100);
  const cents = calculateTopupCredit(0.1 + 0.2, { gstRate: 0 });
  check('amounts are rounded to cents', cents.net === 0.3);
  const percent = calculateTopupCredit(100, { commissionType: 'percent', commissionValue: 15, gstRate: 0.08 });
  const ratio = calculateTopupCredit(100, { commissionType: 'multiplier', commissionValue: 1.15, gstRate: 0.08 });
  check('15 percent equals a 1.15 multiplier', percent.net === ratio.net && percent.commission === 15);
  check(
    'stored percent commission is honoured',
    formatOperatorCommission({ commissionType: 'percent', commissionValue: 12.5 }).commissionType === 'percent'
  );
}

console.log('Rate-limit keys and CRM lookup binding');
check('IPv4 keys on the address', clientIpKey({ ip: '203.0.113.9' }) === '203.0.113.9');
check('IPv4-mapped IPv6 keys on the IPv4 address', clientIpKey({ ip: '::ffff:203.0.113.9' }) === '203.0.113.9');
check(
  'IPv6 addresses in one /64 share a key',
  clientIpKey({ ip: '2001:db8:1:2::1' }) === clientIpKey({ ip: '2001:db8:1:2:aaaa:bbbb:cccc:dddd' })
);
check(
  'different /64 networks get different keys',
  clientIpKey({ ip: '2001:db8:1:2::1' }) !== clientIpKey({ ip: '2001:db8:1:3::1' })
);
check('contact with the requested phone matches', contactMatchesPhone({ phone: { number: '9607771234' } }, '7771234'));
check('contact with another phone is rejected', !contactMatchesPhone({ phone: { number: '7770000' } }, '7771234'));
check('contact without phone data is rejected', !contactMatchesPhone({ id: 'x' }, '7771234'));

console.log('CSV formula injection');
check('=cmd() is neutralised', csvEscape('=HYPERLINK("x")').startsWith(`"'=`));
check('+ prefix is neutralised', csvEscape('+1+1') === "'+1+1");
check('@ prefix is neutralised', csvEscape('@SUM(A1)') === "'@SUM(A1)");
check('negative numbers stay numeric', csvEscape(-5) === '-5' && csvEscape('-12.50') === '-12.50');
check('quotes and commas are escaped', csvEscape('a,"b"') === '"a,""b"""');

console.log('Route id parsing');
check('accepts 42', parseIdParam('42') === 42);
for (const bad of ['0', '-1', '1e3', '12abc', '', '99999999999', '2147483648', ' 1']) {
  check(`rejects ${JSON.stringify(bad)}`, throws(() => parseIdParam(bad)));
}

console.log('CRM failure classification');
check('definite rejection releases the charge', classifyCrmFailure(new CrmPaymentError('x', 'rejected')) === 'not_charged');
check('timeout keeps the charge for reconciliation', classifyCrmFailure(new CrmPaymentError('x', 'ambiguous')) === 'ambiguous');
check('failure after payment keeps the charge', classifyCrmFailure(new CrmBillableError('x')) === 'billable');
check('validation error before CRM releases the charge', classifyCrmFailure(new AppError('x', 400)) === 'not_charged');

console.log('Input validation limits');
const topup = (amount) => schemas.adminOperatorTopupSchema.safeParse({ amount, notes: 'verify' }).success;
check('rejects Infinity', !topup('Infinity'));
check('rejects NaN', !topup('NaN'));
check('rejects negative', !topup(-1));
check('rejects 3 decimal places', !topup(10.555));
check('rejects above cap', !topup(10_000_000));
check('accepts 100.50', topup(100.5));
check(
  'rejects password over 72 bytes',
  !schemas.resetOperatorUserPasswordSchema.safeParse({ password: `Aa1!${'é'.repeat(40)}` }).success
);
check(
  'operator user update must state the role',
  !schemas.updateOperatorUserSchema.safeParse({ name: 'Verify', email: 'verify@example.com', isActive: true }).success
);

const operatorInput = {
  clientName: 'Verify',
  packageIds: [1],
  serviceTypeKeys: ['OTT'],
  salesModelIds: [1],
  email: 'verify@example.com',
  password: 'Verify@Password123',
};
check(
  'operator needs at least one customer type and sales model',
  !schemas.createOperatorSchema.safeParse({ ...operatorInput, serviceTypeKeys: [] }).success &&
    !schemas.createOperatorSchema.safeParse({ ...operatorInput, salesModelIds: [] }).success
);
check(
  'customer type keys cannot carry SQL or path characters',
  !schemas.customerSearchQuerySchema.safeParse({ phone: '7771234', serviceTag: "OTT' OR 1=1" }).success
);
check(
  'accepts a percent top-up commission',
  schemas.createOperatorSchema.safeParse({ ...operatorInput, walletCommissionType: 'percent', walletCommissionValue: 12.5 }).success
);
check(
  'rejects a zero percent commission',
  !schemas.createOperatorSchema.safeParse({ ...operatorInput, walletCommissionType: 'percent', walletCommissionValue: 0 }).success
);
check(
  'rejects a multiplier above the cap',
  !schemas.createOperatorSchema.safeParse({ ...operatorInput, walletCommissionType: 'multiplier', walletCommissionValue: 11 }).success
);
check(
  'API key is not generated unless asked for',
  schemas.createOperatorSchema.parse(operatorInput).generateApiKey === false
);

console.log('Source invariants');
const sources = listSources().map((file) => ({ file: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }));
const offenders = (regex) => sources.filter(({ text }) => regex.test(text)).map(({ file }) => file);

check('trust proxy is never blanket true', offenders(/set\(\s*['"]trust proxy['"]\s*,\s*true/).length === 0);
check('no separate refresh-token JWT secret in code', offenders(/JWT_REFRESH_SECRET|refreshSecret/).length === 0);
check('no SQL string interpolation of request input', offenders(/\$\{\s*req\.(query|body|params)/).length === 0);

const operatorService = readSource('services/operatorService.js');
{
  // CRM calls must never run while a DB transaction holds wallet row locks.
  const txBlocks = operatorService.split(/beginTransaction\(\)/).slice(1).map((chunk) => chunk.split(/\.commit\(\)/)[0]);
  const crmInsideTx = txBlocks.some((block) => /crm\w*\.(registerNewUser|addSubscriptionForExisting|activatePackagesForContact|provisionOttAccount|postCustomerPayment|createPayment)\(/i.test(block));
  check('no CRM call inside a wallet transaction', !crmInsideTx);
}
check('CRM top-ups are serialised per operator', /withCrmSlot\(/.test(operatorService));
check('CRM payments carry a unique reference', /paymentReference/.test(readSource('services/crmService.js')));

const walletService = readSource('services/walletService.js');
check('top-up completion binds the BML payment reference', /BML_PAYMENT_ALREADY_USED/.test(walletService));

const authService = readSource('services/authService.js');
check('refresh reuse detection is limited to rotated tokens', /revoked_reason/.test(authService));
check('access tokens carry a credentials version', /\bcv\b/.test(authService));
check(
  'refresh tokens are bound to the credentials version',
  /stored\.credentials_version/.test(authService) && /credentials_changed/.test(authService)
);
check('reuse detection is scoped to one login session', /WHERE family_id = \?/.test(authService));
check(
  'login lock is written with the attempt counter',
  /failed_login_attempts = failed_login_attempts \+ 1,\s*locked_until = IF\(/.test(authService)
);
const adminService = readSource('services/adminService.js');
check(
  'deactivation ends the account sessions',
  /endAdminSessions\(connection, targetId, 'deactivated'\)/.test(adminService) &&
    /endAllOperatorSessions\(connection, targetId, 'deactivated'\)/.test(adminService)
);
const operatorUserService = readSource('services/operatorUserService.js');
check(
  'operator user lookups are scoped to their operator',
  /WHERE u\.id = \? AND u\.operator_id = \?/.test(operatorUserService)
);
check(
  'operator user password reset ends that user\'s sessions',
  /endOperatorUserSessions\(connection, userId, 'password_reset'\)/.test(operatorUserService)
);
check(
  'operator token must belong to the operator it names',
  /Number\(user\.id\) !== Number\(req\.user\.id\)/.test(readSource('middleware/auth.js'))
);
check(
  'BML-verified completion is not blocked by the manual gate',
  /!bmlVerifiedByCaller && isProduction/.test(walletService)
);
check(
  'operator transaction list does not spread stored metadata',
  /const \{ metadata: rawMetadata, \.\.\.publicRow \}/.test(walletService)
);
check(
  'outbound CRM and BML calls never follow redirects',
  /redirect: 'error'/.test(readSource('services/crmService.js')) &&
    /redirect: 'error'/.test(readSource('services/bmlPaymentService.js'))
);
check(
  'API keys are stored only as a hash',
  /hashToken\(key\)/.test(readSource('services/operatorApiKeyService.js'))
);

const partnerRoutes = readSource('routes/partnerApiRoutes.js');
check(
  'every partner API route sits behind API key authentication and takes no input from the URL query',
  /router\.use\(apiAuthFailureLimiter, authenticateApiKey/.test(partnerRoutes) &&
    partnerRoutes.indexOf('router.use(apiAuthFailureLimiter, authenticateApiKey') < partnerRoutes.indexOf('router.get(') &&
    !/req\.query/.test(partnerRoutes)
);
check(
  'every partner API money route requires an Idempotency-Key',
  ['topup', 'subscribe', 'renew', 'upgrade'].every((name) =>
    new RegExp(`'/customers/${name}',\\s+apiWriteLimiter,\\s+moneyRoute\\('${name}'`).test(partnerRoutes)
  ) && /const key = idempotencyKey\(req\);/.test(partnerRoutes)
);
check(
  'API keys only match active keys and report one generic failure',
  /k\.key_hash = \? AND k\.revoked_at IS NULL/.test(readSource('middleware/apiKeyAuth.js'))
);
check(
  'partner API lookups are always scoped to the key\'s operator',
  !/operator_id = \?(?![\s\S]{0,200}apiClient\.operatorId)/.test(
    readSource('services/partnerApiService.js').replace(/DELETE FROM api_idempotency_keys WHERE created_at[\s\S]*$/, '')
  )
);

check(
  'sold packages are snapshotted on the account',
  /INSERT INTO voucher_account_packages\s+\(voucher_account_id, package_id, package_name, price_amount/.test(operatorService)
);
check(
  'reports read the package name recorded at the time of sale',
  !/GROUP_CONCAT\(DISTINCT p\.name/.test(operatorService) &&
    !/GROUP_CONCAT\(DISTINCT p\.name/.test(readSource('services/reportService.js'))
);

const sqlDir = path.join(root, 'sql');
const migrations = fs.readdirSync(sqlDir).filter((f) => /^\d{3}_.+\.sql$/.test(f));
const numbers = migrations.map((f) => f.slice(0, 3));
check('migration numbers are unique', new Set(numbers).size === numbers.length, numbers.join(','));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll security invariants hold');
process.exit(failures ? 1 : 0);
