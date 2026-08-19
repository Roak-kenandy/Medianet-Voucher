import { z } from 'zod';

const emailSchema = z.string().email('Invalid email address').max(255);
const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must not exceed 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ''))
  .pipe(
    z
      .string()
      .length(7, 'Phone number must be exactly 7 digits')
      .regex(/^[79][0-9]{6}$/, 'Maldives mobile numbers must start with 7 or 9')
  );

const packageIdSchema = z.coerce.number().int().positive('Package is required');
const packageIdsSchema = z
  .array(packageIdSchema)
  .min(1, 'At least one package is required')
  .max(20, 'Cannot assign more than 20 packages');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});

export const createAdminSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['admin', 'sales', 'finance']).optional().default('admin'),
});

export const createOperatorSchema = z.object({
  clientName: z.string().trim().min(2, 'Client name is required').max(200),
  packageIds: packageIdsSchema,
  email: emailSchema,
  password: passwordSchema,
  accountQuota: z
    .number({ invalid_type_error: 'Account quota must be a number' })
    .int('Account quota must be a whole number')
    .min(1, 'Account quota must be at least 1')
    .max(100000, 'Account quota cannot exceed 100,000'),
  notes: z.string().trim().max(2000).optional().default(''),
});

export const updateOperatorSchema = z.object({
  clientName: z.string().trim().min(2, 'Client name is required').max(200),
  packageIds: packageIdsSchema,
  email: emailSchema,
  password: z
    .string()
    .max(128)
    .optional()
    .refine(
      (value) =>
        !value ||
        (value.length >= 12 &&
          /[A-Z]/.test(value) &&
          /[a-z]/.test(value) &&
          /[0-9]/.test(value) &&
          /[^A-Za-z0-9]/.test(value)),
      'Password must be at least 12 characters with uppercase, lowercase, number, and special character'
    ),
  accountQuota: z
    .number({ invalid_type_error: 'Account quota must be a number' })
    .int('Account quota must be a whole number')
    .min(1, 'Account quota must be at least 1')
    .max(100000, 'Account quota cannot exceed 100,000'),
  isActive: z.boolean(),
  notes: z.string().trim().max(2000).optional().default(''),
});

export const createPackageSchema = z.object({
  name: z.string().trim().min(2, 'Package name is required').max(200),
  sku: z.string().trim().max(100).optional(),
  productId: z.string().uuid('Invalid CRM product ID'),
  priceTermId: z.string().uuid('Invalid CRM price term ID'),
  priceAmount: z.coerce.number().min(0, 'Price must be zero or greater'),
  currencyCode: z.string().trim().length(3).default('MVR'),
  description: z.string().trim().max(2000).optional(),
});

export const updateQuotaSchema = z.object({
  accountQuota: z
    .number({ invalid_type_error: 'Account quota must be a number' })
    .int()
    .min(1)
    .max(100000),
});

export const reportQuerySchema = z.object({
  operatorId: z.coerce.number().int().positive().optional(),
  packageType: z.string().max(100).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reportType: z.enum(['client_summary', 'accounts_by_period', 'package_breakdown']).default('client_summary'),
});

export const createAccountSchema = z.object({
  fullName: z.string().trim().min(2, 'Name is required').max(200),
  phoneNumber: phoneSchema,
});

export const bulkAccountsSchema = z.object({
  accounts: z
    .array(createAccountSchema)
    .min(1, 'At least one account is required')
    .max(10, 'Maximum 10 accounts per bulk upload'),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional().default(''),
});

export const operatorReportQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
