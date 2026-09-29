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
}

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
  !schemas.updateOperatorSchema.safeParse({
    clientName: 'Verify',
    packageIds: [1],
    email: 'verify@example.com',
    isActive: true,
    password: `Aa1!${'é'.repeat(40)}`,
  }).success
);
check(
  'operator update without portalRole does not reset the role',
  schemas.updateOperatorSchema.parse({
    clientName: 'Verify',
    packageIds: [1],
    email: 'verify@example.com',
    isActive: true,
  }).portalRole === undefined
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

const sqlDir = path.join(root, 'sql');
const migrations = fs.readdirSync(sqlDir).filter((f) => /^\d{3}_.+\.sql$/.test(f));
const numbers = migrations.map((f) => f.slice(0, 3));
check('migration numbers are unique', new Set(numbers).size === numbers.length, numbers.join(','));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll security invariants hold');
process.exit(failures ? 1 : 0);
