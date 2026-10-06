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

/** Operator assignment: individual packages may be empty when a package group is given. */
const operatorPackageIdsSchema = z
  .array(packageIdSchema)
  .max(20, 'Cannot assign more than 20 packages')
  .optional()
  .default([]);
/** Customer type key as stored in service_types (e.g. OTT, MEDIANET_TV, HOTEL_TV). */
const serviceTypeKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Invalid customer type');
const serviceTypeKeysSchema = z
  .array(serviceTypeKeySchema)
  .min(1, 'Select at least one customer type')
  .max(30);
const salesModelIdSchema = z.coerce.number().int().positive('Invalid sales model');
const salesModelIdsSchema = z.array(salesModelIdSchema).min(1, 'Select at least one sales model').max(30);

const crmIdSchema = z.string().trim().uuid('Must be a CRM id (UUID)');
const serviceTypeFields = {
  label: z.string().trim().min(2, 'Label is required').max(120),
  shortLabel: z.string().trim().min(1, 'Short label is required').max(40),
  crmTagName: z.string().trim().min(1, 'CRM tag name is required').max(120),
  crmPriceSegmentName: z.string().trim().max(120).optional().default(''),
};

export const createServiceTypeSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Key must be 2-40 characters: letters, digits and underscores'),
  ...serviceTypeFields,
  crmTagId: crmIdSchema,
  crmDeviceProductId: crmIdSchema,
});

/** The two built-in types may leave the CRM ids empty to keep using the .env values. */
export const updateServiceTypeSchema = z.object({
  ...serviceTypeFields,
  crmTagId: z.union([crmIdSchema, z.literal('')]).optional().default(''),
  crmDeviceProductId: z.union([crmIdSchema, z.literal('')]).optional().default(''),
  isActive: z.boolean(),
});

export const appSettingsSchema = z.object({
  timeZone: z.string().trim().min(1, 'Time zone is required').max(64),
  gstRatePercent: z.coerce
    .number()
    .finite()
    .min(0, 'GST rate cannot be negative')
    .max(100, 'GST rate cannot exceed 100%')
    .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, 'GST rate can have at most 2 decimal places'),
  tinNumber: z
    .string()
    .trim()
    .max(50)
    .regex(/^[A-Za-z0-9 ./-]*$/, 'TIN may contain letters, digits, spaces, dots, slashes and dashes')
    .optional()
    .default(''),
  currencyCode: z.string().trim().toUpperCase().length(3, 'Currency must be a 3-letter code'),
});

export const salesModelSchema = z.object({
  name: z.string().trim().min(1, 'Sales model name is required').max(120),
  description: z.string().trim().max(500).optional().default(''),
  isActive: z.boolean().optional().default(true),
});

export const crmCatalogQuerySchema = z.object({
  serviceTag: serviceTypeKeySchema.default('OTT'),
  salesModelId: salesModelIdSchema,
});

const packageGroupIdSchema = z.coerce.number().int().positive('Invalid package group');
const packageGroupIdsSchema = z.array(packageGroupIdSchema).max(20, 'Cannot assign more than 20 package groups');

function validateOperatorPackageSelection(data, ctx) {
  if (!data.packageIds?.length && !data.packageGroupIds?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Select at least one package or package group',
      path: ['packageIds'],
    });
  }
}

export const packageGroupSchema = z.object({
  name: z.string().trim().min(2, 'Group name is required').max(120),
  description: z.string().trim().max(500).optional().default(''),
  packageIds: z.array(packageIdSchema).max(100, 'A group cannot hold more than 100 packages').default([]),
});

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

export const resetAdminPasswordSchema = z.object({
  password: passwordSchema,
});

export const changeOwnPasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, 'Current password is required')
    .max(128)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must not exceed 72 bytes'),
  newPassword: passwordSchema,
});

const MONEY_MAX = 1_000_000;
const WALLET_COMMISSION_MULTIPLIER_MAX = 10;
/** Same ceiling as the multiplier: a 10x multiplier is a 900% bonus. */
const WALLET_COMMISSION_PERCENT_MAX = (WALLET_COMMISSION_MULTIPLIER_MAX - 1) * 100;

/** Finite, positive MVR amount with at most 2 decimal places and a hard ceiling. */
function moneyAmountSchema(label, max = MONEY_MAX) {
  return z.coerce
    .number()
    .finite(`${label} must be a valid number`)
    .positive(`${label} must be greater than zero`)
    .max(max, `${label} cannot exceed ${max} MVR`)
    .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, `${label} can have at most 2 decimal places`);
}

const walletCommissionFields = {
  // multiplier: ratio applied to the payment total (1.15). percent: bonus on top (15).
  walletCommissionType: z.enum(['none', 'multiplier', 'percent']).default('none'),
  walletCommissionValue: z.coerce
    .number()
    .finite()
    .min(0, 'Commission cannot be negative')
    .max(WALLET_COMMISSION_PERCENT_MAX, `Commission cannot exceed ${WALLET_COMMISSION_PERCENT_MAX}`)
    .refine(
      (value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6,
      'Commission can have at most 2 decimal places'
    )
    .default(1),
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
    if (data.walletCommissionValue > WALLET_COMMISSION_MULTIPLIER_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Multiplier cannot exceed ${WALLET_COMMISSION_MULTIPLIER_MAX}`,
        path: ['walletCommissionValue'],
      });
    }
  }
  if (data.walletCommissionType === 'percent' && data.walletCommissionValue <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Commission percent must be greater than zero',
      path: ['walletCommissionValue'],
    });
  }
}

export const operatorApiAccessSchema = z.object({ enabled: z.boolean() }).strict();

export const operatorApiKeySchema = z.object({
  name: z.string().trim().max(120).optional().default(''),
});

export const createOperatorSchema = z
  .object({
    clientName: z.string().trim().min(2, 'Client name is required').max(200),
    // Customer types the operator may serve and the sales models it may sell from.
    serviceTypeKeys: serviceTypeKeysSchema,
    defaultServiceTypeKey: serviceTypeKeySchema.optional(),
    salesModelIds: salesModelIdsSchema,
    packageIds: operatorPackageIdsSchema,
    packageGroupIds: packageGroupIdsSchema.optional().default([]),
    // Login of the operator's first user; also stored as the operator's contact email.
    email: emailSchema,
    password: passwordSchema,
    userName: z.string().trim().max(200).optional().default(''),
    notes: z.string().trim().max(2000).optional().default(''),
    canSelfTopup: z.boolean().optional().default(true),
    // Issue an API key for the operator API together with the account.
    generateApiKey: z.boolean().optional().default(false),
    ...operatorPortalFields,
    ...walletCommissionFields,
  })
  .superRefine(validateWalletCommission)
  .superRefine(validateOperatorPackageSelection);

/** Company record only. Logins, passwords and roles are managed per operator user. */
export const updateOperatorSchema = z
  .object({
    clientName: z.string().trim().min(2, 'Client name is required').max(200),
    // Omit either list to keep the operator's current customer types or sales models.
    serviceTypeKeys: serviceTypeKeysSchema.optional(),
    defaultServiceTypeKey: serviceTypeKeySchema.optional(),
    salesModelIds: salesModelIdsSchema.optional(),
    packageIds: operatorPackageIdsSchema,
    // Omit to keep the operator's current package groups.
    packageGroupIds: packageGroupIdsSchema.optional(),
    email: emailSchema,
    isActive: z.boolean(),
    notes: z.string().trim().max(2000).optional().default(''),
    canSelfTopup: z.boolean().optional().default(true),
    ...walletCommissionFields,
  })
  .superRefine(validateWalletCommission);

export const updateOperatorPackagesSchema = z
  .object({
    packageIds: operatorPackageIdsSchema,
    packageGroupIds: packageGroupIdsSchema.optional().default([]),
  })
  .superRefine(validateOperatorPackageSelection);

const operatorUserNameSchema = z.string().trim().min(2, 'Name is required').max(200);

export const createOperatorUserSchema = z.object({
  name: operatorUserNameSchema,
  email: emailSchema,
  password: passwordSchema,
  ...operatorPortalFields,
});

export const updateOperatorUserSchema = z.object({
  name: operatorUserNameSchema,
  email: emailSchema,
  isActive: z.boolean(),
  // Required on update so an omitted role can never silently promote a user to supervisor.
  portalRole: z.enum(['supervisor', 'user']),
  portalPermissions: operatorPortalPermissionsSchema,
});

export const resetOperatorUserPasswordSchema = z.object({
  password: passwordSchema,
});

export const walletTopupSchema = z.object({
  amount: moneyAmountSchema('Top-up amount'),
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
    .finite('Adjustment amount must be a valid number')
    .refine((value) => value !== 0, 'Adjustment amount cannot be zero')
    .refine(
      (value) => Math.abs(value) <= WALLET_ADJUST_MAX,
      `Adjustment amount cannot exceed ${WALLET_ADJUST_MAX} MVR`
    ),
  description: z.string().trim().max(500).optional().default(''),
});

export const adminOperatorTopupSchema = z.object({
  amount: moneyAmountSchema('Wallet credit amount'),
  trialAccounts: z.coerce.number().int().min(0).max(10000).optional().default(0),
  notes: z.string().trim().min(3, 'Notes are required').max(500),
});

/** Change an operator's free account quota: add to it, take unused quota back, or revoke the rest. */
export const trialQuotaAdjustSchema = z
  .object({
    action: z.enum(['add', 'deduct', 'revoke']),
    accounts: z.coerce.number().int().min(1, 'Enter at least 1 account').max(10000).optional(),
    notes: z.string().trim().min(3, 'Notes are required').max(500),
  })
  .superRefine((data, ctx) => {
    if (data.action !== 'revoke' && !data.accounts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter how many free accounts',
        path: ['accounts'],
      });
    }
  });

/** Every package field is editable; the CRM product and price term must stay a unique pair. */
export const updatePackageSchema = z.object({
  name: z.string().trim().min(2, 'Package name is required').max(200),
  serviceTag: serviceTypeKeySchema,
  salesModelId: salesModelIdSchema,
  sku: z.string().trim().max(100).optional().default(''),
  description: z.string().trim().max(1000).optional().default(''),
  productId: z.string().uuid('Invalid product ID'),
  priceTermId: z.string().uuid('Invalid price term ID'),
  priceAmount: z.coerce
    .number()
    .finite()
    .min(0, 'Price must be zero or greater')
    .max(MONEY_MAX, `Price cannot exceed ${MONEY_MAX} MVR`)
    .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, 'Price can have at most 2 decimal places'),
  currencyCode: z.string().trim().toUpperCase().length(3).optional().default('MVR'),
  // Eligibility: base (upgrade family + tier), addon (needs one of the listed base packages) or standalone.
  packageRole: z.enum(['base', 'addon', 'standalone']).optional().default('standalone'),
  upgradeFamily: z.string().trim().max(60).optional().default(''),
  upgradeTier: z.coerce.number().int().min(1).max(999).optional(),
  requiredPackageIds: z.array(packageIdSchema).max(50).optional().default([]),
});

export const createPackageSchema = z.object({
  name: z.string().trim().min(2, 'Package name is required').max(200),
  serviceTag: serviceTypeKeySchema.default('OTT'),
  // The CRM sales model this price belongs to.
  salesModelId: salesModelIdSchema,
  // Eligibility: base (upgrade family + tier), addon (needs one of the listed base packages) or standalone.
  packageRole: z.enum(['base', 'addon', 'standalone']).optional().default('standalone'),
  upgradeFamily: z.string().trim().max(60).optional().default(''),
  upgradeTier: z.coerce.number().int().min(1).max(999).optional(),
  requiredPackageIds: z.array(packageIdSchema).max(50).optional().default([]),
  sku: z.string().trim().max(100).optional(),
  productId: z.string().uuid('Invalid product ID'),
  priceTermId: z.string().uuid('Invalid price term ID'),
  priceAmount: z.coerce
    .number()
    .finite()
    .min(0, 'Price must be zero or greater')
    .max(MONEY_MAX, `Price cannot exceed ${MONEY_MAX} MVR`),
  // Wallets, CRM payments and BML are all MVR-only.
  currencyCode: z.literal('MVR').default('MVR'),
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

// Existence and the operator's allow-list are checked in the services.
const serviceTagSchema = serviceTypeKeySchema;

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

/** Service code as stored on the customer's device in CRM. */
const serviceCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{3,32}$/, 'Enter a valid service code');

/** Search by phone number or by service code (exactly one). */
export const customerSearchQuerySchema = z
  .object({
    phone: phoneSchema.optional(),
    code: serviceCodeSchema.optional(),
    serviceTag: serviceTagSchema.default('OTT'),
  })
  .refine((data) => Boolean(data.phone) !== Boolean(data.code), {
    message: 'Search by phone number or by service code',
    path: ['phone'],
  });

/** A customer found by service code is confirmed by that code, so the phone becomes optional. */
function requirePhoneOrServiceCode(data, ctx) {
  if (!data.phoneNumber && !data.serviceCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Phone number or service code is required',
      path: ['phoneNumber'],
    });
  }
}

const customerAmountSchema = moneyAmountSchema('Amount', 100_000);

export const customerCrmTopupSchema = z
  .object({
    crmContactId: z.string().uuid('Invalid customer reference'),
    fullName: z.string().trim().min(2, 'Customer name is required').max(200),
    phoneNumber: phoneSchema.optional(),
    serviceCode: serviceCodeSchema.optional(),
    serviceTag: serviceTagSchema,
    amount: customerAmountSchema,
  })
  .superRefine(requirePhoneOrServiceCode);

export const subscribeCustomerSchema = z
  .object({
    crmContactId: z.string().uuid('Invalid customer reference'),
    fullName: z.string().trim().min(2, 'Customer name is required').max(200),
    phoneNumber: phoneSchema.optional(),
    serviceCode: serviceCodeSchema.optional(),
    // The device the package is sold to (from the search result).
    deviceId: z.string().uuid('Invalid device reference').optional(),
    serviceTag: serviceTagSchema,
    packageIds: packageIdsSchema,
    amount: customerAmountSchema,
  })
  .superRefine(requirePhoneOrServiceCode);

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

/* ---------------------------------------------------------------- Partner API (v1) */

const partnerCustomerRef = {
  customerId: z.string().uuid('Invalid customerId'),
  serviceType: serviceTagSchema,
  serviceCode: serviceCodeSchema.optional(),
  phone: phoneSchema.optional(),
};

function requireOneCustomerRef(data, ctx) {
  if (!data.serviceCode === !data.phone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Send exactly one of serviceCode or phone',
      path: ['serviceCode'],
    });
  }
}

const partnerDeviceIdSchema = z.string().uuid('Invalid deviceId');
const partnerDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const partnerIdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{8,100}$/, 'Idempotency-Key must be 8 to 100 letters, digits or . _ : -');

/** Search has no customerId yet: it is how one is found. */
export const partnerCustomerSearchSchema = z
  .object({ serviceType: serviceTagSchema, serviceCode: serviceCodeSchema.optional(), phone: phoneSchema.optional() })
  .strict()
  .superRefine(requireOneCustomerRef);

export const partnerCustomerSchema = z.object(partnerCustomerRef).strict().superRefine(requireOneCustomerRef);

export const partnerCustomerDeviceSchema = z
  .object({ ...partnerCustomerRef, deviceId: partnerDeviceIdSchema.optional() })
  .strict()
  .superRefine(requireOneCustomerRef);

export const partnerPackagesSchema = z.object({ serviceType: serviceTagSchema.optional() }).strict();

export const partnerTopupSchema = z
  .object({ ...partnerCustomerRef, amount: customerAmountSchema })
  .strict()
  .superRefine(requireOneCustomerRef);

export const partnerSubscribeSchema = z
  .object({
    ...partnerCustomerRef,
    deviceId: partnerDeviceIdSchema.optional(),
    packageIds: packageIdsSchema,
    amount: customerAmountSchema.optional(),
  })
  .strict()
  .superRefine(requireOneCustomerRef);

/** Renew the listed packages, or everything renewable on the device with `all: true`. */
export const partnerRenewSchema = z
  .object({
    ...partnerCustomerRef,
    deviceId: partnerDeviceIdSchema.optional(),
    packageIds: packageIdsSchema.optional(),
    all: z.literal(true).optional(),
    amount: customerAmountSchema.optional(),
  })
  .strict()
  .superRefine(requireOneCustomerRef)
  .superRefine((data, ctx) => {
    if (!data.packageIds === !data.all) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Send either packageIds or "all": true',
        path: ['packageIds'],
      });
    }
  });

/**
 * `amount` is optional: without it the current CRM price is charged. Callers that quoted a
 * price send it, and the upgrade is refused if the price has moved.
 */
export const partnerUpgradeSchema = z
  .object({
    ...partnerCustomerRef,
    deviceId: partnerDeviceIdSchema.optional(),
    packageId: packageIdSchema,
    // Zero is valid: the credit for the old package can cover the whole upgrade.
    amount: z.coerce
      .number()
      .finite('Amount must be a valid number')
      .min(0, 'Amount cannot be negative')
      .max(100_000, 'Amount cannot exceed 100000 MVR')
      .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, 'Amount can have at most 2 decimal places')
      .optional(),
  })
  .strict()
  .superRefine(requireOneCustomerRef);

export const partnerTransactionsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    startDate: partnerDate.optional(),
    endDate: partnerDate.optional(),
    type: z.enum(['topup', 'debit', 'adjustment', 'refund']).optional(),
  })
  .strict();

export const partnerReferenceSchema = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/, 'Invalid reference');
