import { z } from 'zod';

const emailSchema = z.string().email('Invalid email address').max(255);
const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must not exceed 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character')
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= 72,
    'Password must not exceed 72 bytes (bcrypt limit)'
  );

export const toggleActiveBodySchema = z.object({
  isActive: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((value) => value === true || value === 'true' || value === '1'),
});

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
  password: z
    .string()
    .min(1, 'Password is required')
    .max(128)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= 72,
      'Password must not exceed 72 bytes'
    ),
});

export const createAdminSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['admin', 'sales', 'finance']).optional().default('admin'),
});

const walletCommissionFields = {
  walletCommissionType: z.enum(['none', 'multiplier']).default('none'),
  walletCommissionValue: z.coerce.number().min(0, 'Multiplier cannot be negative').default(1),
};

const operatorPortalPermissionsSchema = z
  .object({
    dashboard: z.boolean().optional(),
    wallet: z.boolean().optional(),
    createAccount: z.boolean().optional(),
    customers: z.boolean().optional(),
    bulkUpload: z.boolean().optional(),
    accounts: z.boolean().optional(),
    transactions: z.boolean().optional(),
    reports: z.boolean().optional(),
  })
  .optional();

const operatorPortalFields = {
  portalRole: z.enum(['supervisor', 'user']).optional().default('supervisor'),
  portalPermissions: operatorPortalPermissionsSchema,
};

function validateWalletCommission(data, ctx) {
  if (data.walletCommissionType === 'multiplier') {
    if (data.walletCommissionValue < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Multiplier must be at least 1',
        path: ['walletCommissionValue'],
      });
    }
  }
}

export const createOperatorSchema = z
  .object({
    clientName: z.string().trim().min(2, 'Client name is required').max(200),
    serviceScope: z.enum(['OTT', 'MEDIANET_TV', 'BOTH']).default('BOTH'),
    packageIds: packageIdsSchema,
    email: emailSchema,
    password: passwordSchema,
    notes: z.string().trim().max(2000).optional().default(''),
    canSelfTopup: z.boolean().optional().default(true),
    ...operatorPortalFields,
    ...walletCommissionFields,
  })
  .superRefine(validateWalletCommission);

export const updateOperatorSchema = z
  .object({
    clientName: z.string().trim().min(2, 'Client name is required').max(200),
    serviceScope: z.enum(['OTT', 'MEDIANET_TV', 'BOTH']).default('BOTH'),
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
    isActive: z.boolean(),
    notes: z.string().trim().max(2000).optional().default(''),
    canSelfTopup: z.boolean().optional().default(true),
    ...operatorPortalFields,
    ...walletCommissionFields,
  })
  .superRefine(validateWalletCommission);

export const walletTopupSchema = z.object({
  amount: z.coerce.number().positive('Top-up amount must be greater than zero'),
});

export const walletTopupStatusQuerySchema = z.object({
  reference: z.string().min(1, 'Reference is required'),
  transactionId: z.string().optional(),
});

export const walletTopupBillQuerySchema = z.object({
  reference: z.string().trim().min(1, 'Reference is required'),
});

const WALLET_ADJUST_MAX = 1_000_000;

export const walletAdjustSchema = z.object({
  amount: z.coerce
    .number()
    .refine((value) => value !== 0, 'Adjustment amount cannot be zero')
    .refine(
      (value) => Math.abs(value) <= WALLET_ADJUST_MAX,
      `Adjustment amount cannot exceed ${WALLET_ADJUST_MAX} MVR`
    ),
  description: z.string().trim().max(500).optional().default(''),
});

export const adminOperatorTopupSchema = z.object({
  amount: z.coerce.number().positive('Wallet credit amount must be greater than zero'),
  trialAccounts: z.coerce.number().int().min(0).max(10000).optional().default(0),
  notes: z.string().trim().min(3, 'Notes are required').max(500),
});

export const createPackageSchema = z.object({
  name: z.string().trim().min(2, 'Package name is required').max(200),
  serviceTag: z.enum(['OTT', 'MEDIANET_TV']).default('OTT'),
  sku: z.string().trim().max(100).optional(),
  productId: z.string().uuid('Invalid product ID'),
  priceTermId: z.string().uuid('Invalid price term ID'),
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
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().max(200).optional(),
  reportType: z
    .enum([
      'client_summary',
      'customer_summary',
      'accounts_by_period',
      'package_breakdown',
      'dealer_topup',
      'sales_report',
    ])
    .default('client_summary'),
});

const serviceTagSchema = z.enum(['OTT', 'MEDIANET_TV']);

export const createAccountSchema = z.object({
  fullName: z.string().trim().min(2, 'Name is required').max(200),
  phoneNumber: phoneSchema,
  serviceTag: serviceTagSchema,
  packageIds: packageIdsSchema,
});

export const bulkAccountsSchema = z.object({
  packageIds: packageIdsSchema.optional(),
  accounts: z
    .array(
      z.object({
        fullName: z.string().trim().min(2, 'Name is required').max(200),
        phoneNumber: phoneSchema,
      })
    )
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

const reportDateRangeSchema = {
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
};

export const operatorActivationsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional().default(''),
  ...reportDateRangeSchema,
});

export const operatorActivationsExportSchema = z.object({
  search: z.string().trim().max(200).optional().default(''),
  ...reportDateRangeSchema,
});

const customerHistoryActivitySchema = z
  .enum(['all', 'new_account', 'subscribe', 'topup'])
  .optional()
  .default('all');

export const operatorAccountsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional().default(''),
  activity: customerHistoryActivitySchema,
  ...reportDateRangeSchema,
});

export const operatorAccountsExportSchema = z.object({
  search: z.string().trim().max(200).optional().default(''),
  activity: customerHistoryActivitySchema,
  ...reportDateRangeSchema,
});

export const operatorReportQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().max(200).optional(),
});

export const customerSearchQuerySchema = z.object({
  phone: phoneSchema,
  serviceTag: serviceTagSchema.default('OTT'),
});

const customerAmountSchema = z.coerce
  .number()
  .positive('Amount must be greater than zero');

export const customerCrmTopupSchema = z.object({
  crmContactId: z.string().uuid('Invalid customer reference'),
  fullName: z.string().trim().min(2, 'Customer name is required').max(200),
  phoneNumber: phoneSchema,
  serviceTag: serviceTagSchema,
  amount: customerAmountSchema,
});

export const subscribeCustomerSchema = z.object({
  crmContactId: z.string().uuid('Invalid customer reference'),
  fullName: z.string().trim().min(2, 'Customer name is required').max(200),
  phoneNumber: phoneSchema,
  serviceTag: serviceTagSchema,
  packageIds: packageIdsSchema,
  amount: customerAmountSchema,
});

/** @deprecated use subscribeCustomerSchema */
export const activateCustomerSchema = subscribeCustomerSchema;

export const walletTransactionQuerySchema = operatorReportQuerySchema.extend({
  type: z.enum(['topup', 'debit', 'adjustment', 'refund']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const marketingAdFormSchema = z.object({
  title: z.string().trim().min(2, 'Title is required').max(200),
  description: z.string().trim().max(5000).optional().default(''),
  displayStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date is required'),
  displayEnd: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .refine((value) => value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value), {
      message: 'End date must be YYYY-MM-DD',
    }),
  linkUrl: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .refine((value) => value === undefined || z.string().url().safeParse(value).success, {
      message: 'Link must be a valid URL',
    })
    .refine(
      (value) => {
        if (value === undefined) return true;
        try {
          const protocol = new URL(value).protocol;
          return protocol === 'http:' || protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'Link must use http or https' }
    ),
  sortOrder: z.coerce.number().int().min(0).max(999).optional().default(0),
  isActive: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === 'true' || value === '1'),
});

export function marketingAdPayloadFromForm(form) {
  const data = marketingAdFormSchema.parse(form);
  return {
    title: data.title,
    description: data.description,
    linkUrl: data.linkUrl || null,
    displayStart: `${data.displayStart} 00:00:00`,
    displayEnd: data.displayEnd ? `${data.displayEnd} 23:59:59` : null,
    sortOrder: data.sortOrder,
    isActive: data.isActive !== false,
  };
}

export const knowledgeDocumentFormSchema = z.object({
  title: z.string().trim().min(2, 'Title is required').max(200),
  description: z.string().trim().max(5000).optional().default(''),
  sortOrder: z.coerce.number().int().min(0).max(999).optional().default(0),
  isActive: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === 'true' || value === '1'),
});

export function knowledgeDocumentPayloadFromForm(form) {
  const data = knowledgeDocumentFormSchema.parse(form);
  return {
    title: data.title,
    description: data.description,
    sortOrder: data.sortOrder,
    isActive: data.isActive !== false,
  };
}
