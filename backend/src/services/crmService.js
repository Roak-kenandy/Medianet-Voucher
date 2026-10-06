import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { AppError, CrmBillableError, CrmPaymentError } from '../utils/errors.js';
import { getPlanByPackageId } from './packageService.js';
import { getServiceTagConfig, assertServiceTag } from '../constants/serviceTags.js';

const UNDELIVERED_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** True only when the HTTP request provably never reached CRM (safe to retry / nothing posted). */
function isUndeliveredRequestError(error) {
  const code = error?.cause?.code || error?.code;
  return Boolean(code && UNDELIVERED_ERROR_CODES.has(code));
}

/** 4xx answers mean CRM refused the request; 408/409 and 5xx leave the outcome unknown. */
function isDefiniteRejectionStatus(status) {
  return status >= 400 && status < 500 && status !== 408 && status !== 409;
}

function normalizePhone(phoneNumber) {
  const digits = String(phoneNumber || '').replace(/\D/g, '');
  if (!/^[79]\d{6}$/.test(digits)) {
    throw new AppError(
      'Phone number must be a 7-digit Maldives mobile number starting with 7 or 9',
      400,
      'VALIDATION_ERROR'
    );
  }
  return digits;
}

function splitFullName(fullName) {
  const trimmed = String(fullName || '').trim();
  if (!trimmed) {
    return { firstName: 'Customer', lastName: '' };
  }

  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCrmError(data = {}) {
  const message = data.message || data.error || 'Unknown error';
  const parameters = (data.parameters || []).filter(Boolean);
  if (!parameters.length) {
    return message;
  }
  return `${message} (${parameters.join(', ')})`;
}

const CONTACT_LOOKUP_CONCURRENCY = 3;

/** CRM dates are epoch seconds; the portal API uses ISO strings. */
function epochToIso(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

/** One CRM subscription service reduced to what an operator needs to see. */
function mapCustomerService(service) {
  const terms = service.terms || {};
  // The date the customer is paid up to: the termed period for recurring services, the
  // access period for one-time services, otherwise the last billed-to date.
  const dueDate =
    epochToIso(terms.termed_period?.end_date) ||
    epochToIso(terms.access_period?.end_date) ||
    epochToIso(service.billing?.billed_to);
  return {
    id: service.id,
    name: service.product?.name || 'Service',
    sku: service.product?.sku || null,
    productId: service.product?.id || null,
    classification: service.product?.classification || null,
    state: service.state || null,
    subscriptionId: service.subscription?.id || null,
    subscriptionState: service.subscription?.state || null,
    price: service.price?.price != null ? Number(service.price.price) : null,
    currencyCode: service.price?.currency_code || null,
    billingPeriod: service.price?.billing_period
      ? { duration: service.price.billing_period.duration, unit: service.price.billing_period.uot }
      : null,
    billingModel: terms.billing_model || null,
    autoRenew: terms.auto_renew ?? null,
    inTrial: service.trial_period?.trial_state === 'IN_TRIAL',
    activatedOn: epochToIso(service.first_activated_on),
    dueDate,
  };
}

/** Key of the device custom field that holds the customer's service code. */
const SERVICE_CODE_FIELD_KEY = 'code';

/** Service codes are short alphanumeric values; anything else cannot be a code (and `;` would break the CRM filter). */
function normalizeServiceCode(serviceCode) {
  const code = String(serviceCode ?? '').trim();
  if (!/^[A-Za-z0-9-]{3,32}$/.test(code)) {
    throw new AppError('Enter a valid service code', 400, 'VALIDATION_ERROR');
  }
  return code;
}

/** Runs `worker` over `items` with at most `limit` in flight; results keep input order. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function lastSevenDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-7) : null;
}

/**
 * True when one of the contact's own phone numbers is the requested 7-digit number
 * (country code prefixes are ignored). A contact that carries no phone data at all cannot
 * be bound to the requested number and is rejected.
 */
export function contactMatchesPhone(contact, normalizedPhone) {
  const candidates = [contact?.phone?.number, contact?.phone_number, contact?.phoneNumber];
  for (const entry of Array.isArray(contact?.phones) ? contact.phones : []) {
    candidates.push(entry?.number ?? entry);
  }
  return candidates.some((candidate) => lastSevenDigits(candidate) === normalizedPhone);
}

function extractDeviceCodeFromDevices(devicesData) {
  const devices = devicesData?.content || [];
  for (const device of devices) {
    const fields = device.custom_fields || [];
    const codeField = fields.find((field) => String(field?.key || '').toLowerCase() === 'code');
    if (codeField?.value != null && String(codeField.value).trim() !== '') {
      // Shown in full: operators use it to confirm they have the right customer.
      return String(codeField.value).trim();
    }
  }
  return null;
}

function deviceServiceCode(device) {
  const field = (device?.custom_fields || []).find(
    (item) => String(item?.key || '').toLowerCase() === 'code'
  );
  const value = field?.value != null ? String(field.value).trim() : '';
  return value || null;
}

function isRetryableSubscriptionError(status, data = {}) {
  if (status >= 500) {
    return true;
  }

  const message = String(data.message || data.error || '').toLowerCase();
  if (message.includes('internal server error')) {
    return true;
  }

  if (status !== 400) {
    return false;
  }

  const parameters = (data.parameters || []).map((value) => String(value).toLowerCase());
  return (
    message.includes('invalid value') &&
    parameters.some((value) => value.includes('price term'))
  );
}

class CRMService {
  constructor() {
    this.apiKey = config.crm.apiKey;
    this.baseUrl = config.crm.baseUrl;
    this.defaultTagId = config.crm.defaultTagId;
    this.classificationId = config.crm.classificationId;
    this.currencyCode = config.crm.currencyCode;
    this.paymentTermsId = config.crm.paymentTermsId;
    this.paymentTypeId = config.crm.paymentTypeId;
  }

  async resolveServiceTagFromPackageIds(packageIds = []) {
    const firstId = [...new Set(packageIds.map((id) => Number(id)).filter(Boolean))][0];
    if (!firstId) {
      throw new AppError('At least one package is required', 400, 'PACKAGE_REQUIRED');
    }

    const plan = await getPlanByPackageId(firstId);
    if (!plan?.serviceTag) {
      throw new AppError('Package service tag is not configured', 400, 'PACKAGE_NOT_CONFIGURED');
    }

    const tags = new Set(
      (
        await Promise.all(
          [...new Set(packageIds.map((id) => Number(id)).filter(Boolean))].map((id) =>
            getPlanByPackageId(id)
          )
        )
      )
        .filter(Boolean)
        .map((planItem) => planItem.serviceTag)
    );

    if (tags.size > 1) {
      throw new AppError('All selected packages must use the same service tag', 400, 'PACKAGE_TAG_MISMATCH');
    }

    return assertServiceTag(plan.serviceTag);
  }

  /** `salesModelName` picks which CRM price tier is offered (defaults to the .env model). */
  async fetchProductCatalog(serviceTag = 'OTT', salesModelName = config.crm.salesModelName) {
    this.assertConfigured();
    const tagConfig = getServiceTagConfig(assertServiceTag(serviceTag));
    const products = await this.fetchAllProductsByTag(tagConfig.crmTagName);

    const entries = await Promise.all(
      products.map(async (product) => {
        const prices = await this.fetchProductPrices(
          product.id,
          tagConfig.crmPriceSegmentName,
          salesModelName
        );
        if (!prices.length) return null;

        return {
          productId: product.id,
          name: product.name,
          sku: product.sku || null,
          description: product.description || null,
          serviceTag: tagConfig.key,
          serviceTagLabel: tagConfig.label,
          tags: (product.tags || []).map((tag) => tag.name),
          prices,
        };
      })
    );

    return entries.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  async fetchOttProductCatalog() {
    return this.fetchProductCatalog('OTT');
  }

  async resolvePlan(packageId) {
    const plan = await getPlanByPackageId(packageId);
    if (!plan) {
      throw new AppError(
        'Selected package is not configured for CRM provisioning.',
        400,
        'PACKAGE_NOT_CONFIGURED'
      );
    }
    return plan;
  }

  async resolvePlans(packageIds = []) {
    const uniqueIds = [...new Set(packageIds.map((id) => Number(id)).filter(Boolean))];
    if (!uniqueIds.length) {
      throw new AppError('At least one package is required', 400, 'PACKAGE_REQUIRED');
    }

    const plans = [];
    for (const packageId of uniqueIds) {
      plans.push(await this.resolvePlan(packageId));
    }
    return plans;
  }

  /** @deprecated alias kept for route compatibility */
  async fetchServiceRecommendations(serviceTag = 'OTT') {
    return this.fetchProductCatalog(serviceTag);
  }

  productHasTag(product, tagName) {
    return (product.tags || []).some((tag) => tag.name === tagName);
  }

  priceGroupHasSegment(priceGroup, segmentName) {
    return (priceGroup.segments || []).some((segment) => segment.name === segmentName);
  }

  priceGroupHasOttSegment(priceGroup) {
    return this.priceGroupHasSegment(priceGroup, 'OTT');
  }

  priceGroupMatchesSalesModel(priceGroup, salesModelName) {
    if (!salesModelName) return true;
    return (priceGroup.sales_model?.name || '') === salesModelName;
  }

  async fetchAllProductsByTag(tagName) {
    const pageSize = 100;
    let page = 1;
    let hasMore = true;
    const matched = [];

    while (hasMore) {
      const params = new URLSearchParams({
        is_variant: 'false',
        size: String(pageSize),
        page: String(page),
        include_tags: 'true',
        include_total: 'true',
      });

      const response = await this.crmFetch(`/products?${params}`, {
        method: 'GET',
        headers: this.headers,
      });

      const data = await this.handleResponse(response, 'Fetch CRM products');
      const content = data.content || [];

      for (const product of content) {
        if (this.productHasTag(product, tagName)) {
          matched.push(product);
        }
      }

      hasMore = Boolean(data.paging?.has_more);
      page += 1;

      if (page > 100) break;
    }

    return matched;
  }

  mapPriceGroupEntries(group, segmentName = null) {
    const resolvedSegmentName =
      segmentName ||
      (group.segments || []).map((segment) => segment.name).filter(Boolean).join(', ') ||
      null;

    return (group.prices || []).map((priceEntry) => ({
      priceTermId: priceEntry.id,
      price: Number(priceEntry.price) || 0,
      currencyCode: priceEntry.currency_code || this.currencyCode,
      isDefault: Boolean(group.is_default),
      label: group.label || null,
      segmentName: resolvedSegmentName,
      salesModelName: group.sales_model?.name || null,
      billingModel: group.price_terms?.billing_model || null,
      billingPeriod: group.price_terms?.billing_period || null,
    }));
  }

  async fetchProductPrices(productId, segmentName = null, salesModelName = null) {
    const response = await this.crmFetch(`/products/${productId}/prices`, {
      method: 'GET',
      headers: this.headers,
    });

    const priceGroups = await this.handleResponse(response, 'Fetch CRM product prices');
    const groups = Array.isArray(priceGroups) ? priceGroups : [];
    const prices = [];

    for (const group of groups) {
      if (segmentName && !this.priceGroupHasSegment(group, segmentName)) continue;
      if (!this.priceGroupMatchesSalesModel(group, salesModelName)) continue;
      prices.push(...this.mapPriceGroupEntries(group, segmentName));
    }

    return prices;
  }

  async fetchSegmentPrices(productId, segmentName, salesModelName = null) {
    return this.fetchProductPrices(productId, segmentName, salesModelName);
  }

  async fetchOttSegmentPrices(productId) {
    return this.fetchProductPrices(productId, 'OTT', config.crm.salesModelName);
  }

  get headers() {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      api_key: this.apiKey,
    };
  }

  crmFetch(relativePath, options = {}) {
    const base = String(this.baseUrl || '').replace(/\/$/, '');
    const pathPart = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
    const url = `${base}${pathPart}`;
    const { headers: extraHeaders, ...rest } = options;
    return fetch(url, {
      ...rest,
      // Never follow redirects: the api_key header and request body would be re-sent to
      // whatever origin the response points at.
      redirect: 'error',
      headers: { ...this.headers, ...extraHeaders },
      signal: rest.signal ?? AbortSignal.timeout(config.crm.requestTimeoutMs),
    });
  }

  assertConfigured() {
    if (!this.apiKey || !this.baseUrl) {
      throw new AppError(
        'CRM integration is not configured. Set CRM_API_KEY and CRM_BASE_URL.',
        503,
        'CRM_NOT_CONFIGURED'
      );
    }
  }

  async handleResponse(response, context) {
    const text = await response.text();

    if (!response.ok) {
      console.error(`[CRM] ${context} failed (${response.status}):`, text.slice(0, 500));
      throw new AppError(
        'CRM operation failed. Please try again or contact support.',
        response.status >= 500 ? 502 : 400,
        'CRM_ERROR'
      );
    }

    try {
      return text ? JSON.parse(text) : {};
    } catch {
      console.error(`[CRM] ${context} returned invalid JSON`);
      throw new AppError(
        'CRM operation failed. Please try again or contact support.',
        502,
        'CRM_ERROR'
      );
    }
  }

  contactHasServiceTag(tagsData, tagConfig) {
    const tags = tagsData?.content || [];
    return tags.some(
      (tag) => tag.name === tagConfig.crmTagName || tag.id === tagConfig.crmTagId
    );
  }

  contactHasOttTag(tagsData) {
    return this.contactHasServiceTag(tagsData, getServiceTagConfig('OTT'));
  }

  isActiveSubscriptionState(state = '') {
    const normalized = String(state).toUpperCase();
    return ['ACTIVE', 'EFFECTIVE'].includes(normalized);
  }

  formatDate(dateValue) {
    if (!dateValue) return null;

    try {
      const timestamp =
        typeof dateValue === 'number' ? dateValue * 1000 : Date.parse(dateValue);
      const date = new Date(timestamp);
      return date.toISOString().split('T')[0];
    } catch {
      return dateValue;
    }
  }

  async fetchContactsByPhone(phoneNumber, { size = 10, page = 1 } = {}) {
    const queryParams = new URLSearchParams({
      size: String(size),
      page: String(page),
      include_metrics: 'true',
      search_value: phoneNumber,
      include_total: 'true',
    }).toString();

    const response = await this.crmFetch(`/contacts?${queryParams}`, {
      method: 'GET',
      headers: this.headers,
    });

    return this.handleResponse(response, 'Fetch contacts');
  }

  async fetchContactTags(contactId) {
    const response = await this.crmFetch(`/contacts/${contactId}/tags`, {
      method: 'GET',
      headers: this.headers,
    });

    return this.handleResponse(response, `Fetch tags for contact ${contactId}`);
  }

  async fetchContactAccounts(contactId) {
    const response = await this.crmFetch(`/contacts/${contactId}/accounts`, {
      method: 'GET',
      headers: this.headers,
    });

    return this.handleResponse(response, `Fetch accounts for contact ${contactId}`);
  }

  async fetchContactSubscriptions(contactId) {
    const response = await this.crmFetch(
      `/contacts/${contactId}/subscriptions?size=100&page=1&include_terms=true&include_billing_info=true&include_future_info=true`,
      { method: 'GET' }
    );

    return this.handleResponse(response, `Fetch subscriptions for contact ${contactId}`);
  }

  async addContactTag(contactId, tags) {
    const response = await this.crmFetch(`/contacts/${contactId}/tags`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({ tags }),
    });

    return this.handleResponse(response, `Tag registration for contact ${contactId}`);
  }

  async createContact(firstName, lastName, phoneNumber, serviceTag = 'OTT') {
    const tagConfig = getServiceTagConfig(assertServiceTag(serviceTag));
    const payload = {
      type: 'PERSON',
      person_name: {
        first_name: firstName,
        last_name: lastName,
      },
      phone: {
        country_code: 'MDV',
        number: phoneNumber,
        type: 'MOBILE',
      },
      address: {
        type: 'ALTERNATIVE',
        name: '',
        is_primary: true,
        address_line_1: 'N/A',
        address_line_2: '',
        town_city: 'Maldives',
        postal_code: '',
        country_code: 'MDV',
      },
    };

    const response = await this.crmFetch(`/contacts`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    const contactData = await this.handleResponse(response, 'Contact creation');

    if (!contactData?.id) {
      throw new Error('Contact ID not returned after creation');
    }

    await this.addContactTag(contactData.id, [tagConfig.crmTagId]);

    return { id: contactData.id };
  }

  async fetchDevicesByContactId(contactId, { size = 10, page = 1 } = {}) {
    const queryParams = new URLSearchParams({
      contact_id: contactId,
      include_wifi: 'true',
      include_application: 'true',
      include_characteristics: 'true',
      include_meter_readings: 'true',
      include_custom_fields: 'true',
      size: String(size),
      page: String(page),
    });

    const response = await this.crmFetch(`/devices?${queryParams}`, {
      headers: this.headers,
    });

    return this.handleResponse(response, 'Fetch contact devices');
  }

  async fetchDeviceCodeForContact(contactId) {
    try {
      const devicesData = await this.fetchDevicesByContactId(contactId);
      return extractDeviceCodeFromDevices(devicesData);
    } catch (err) {
      console.error(`[CRM] Device code lookup failed for contact ${contactId}:`, err.message);
      return null;
    }
  }

  async createDevice(contactId, serviceTag = 'OTT') {
    const tagConfig = getServiceTagConfig(assertServiceTag(serviceTag));
    const payload = {
      serial_number: uuidv4(),
      electronic_id: null,
      contact_id: contactId,
      product_id: tagConfig.crmDeviceProductId,
    };

    const response = await this.crmFetch(`/devices`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    return this.handleResponse(response, 'Device creation');
  }

  async createAccount(contactId, { isPrimary = true } = {}) {
    const payload = {
      classification_id: this.classificationId,
      credit_limit: '',
      currency_code: this.currencyCode,
      is_primary: Boolean(isPrimary),
      payment_terms_id: this.paymentTermsId,
    };

    const response = await this.crmFetch(`/contacts/${contactId}/accounts`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    return this.handleResponse(response, 'Account creation');
  }

  /**
   * POST /payments exactly once per logical operation.
   * `paymentReference` must be unique per operation (the wallet reservation reference) and is
   * sent as `backoffice_code` so CRM staff can match every payment to one portal charge.
   * Only failures where the request provably never reached CRM are retried; anything else that
   * is not a clean success or a definite 4xx rejection is reported as `ambiguous`.
   */
  async createPayment(contactId, accountId, amount, { paymentReference } = {}) {
    if (!paymentReference) {
      throw new AppError('CRM payment reference is required', 500, 'INTERNAL_ERROR');
    }

    const payload = {
      contact_id: contactId,
      account_id: accountId,
      amount,
      currency_code: 'MVR',
      notes: 'MTV & OTT Dealer Payment',
      payment_method: { type: 'ELECTRONIC_TRANSFER' },
      state: 'POSTED',
      backoffice_code: paymentReference,
      type_id: this.paymentTypeId,
      external_payable: ['MTV & OTT Dealer Payment'],
    };

    const maxDeliveryAttempts = 3;
    for (let attempt = 1; attempt <= maxDeliveryAttempts; attempt += 1) {
      let response;
      try {
        response = await this.crmFetch(`/payments`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (isUndeliveredRequestError(error) && attempt < maxDeliveryAttempts) {
          await delay(400 * attempt);
          continue;
        }
        if (isUndeliveredRequestError(error)) {
          throw new CrmPaymentError('CRM is unreachable. No payment was recorded.', 'rejected', {
            paymentReference,
          });
        }
        console.error('[CRM] Payment outcome unknown:', paymentReference, error.message);
        throw new CrmPaymentError(
          'CRM did not confirm the payment in time. It will be reconciled by Medianet.',
          'ambiguous',
          { paymentReference }
        );
      }

      const text = await response.text().catch(() => '');
      let data = null;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = null;
      }

      if (response.ok) {
        return { success: true, data: data || {}, paymentId: data?.id || null, paymentReference };
      }

      console.error(
        `[CRM] Payment ${paymentReference} failed (${response.status}):`,
        String(text).slice(0, 500)
      );
      if (isDefiniteRejectionStatus(response.status)) {
        throw new CrmPaymentError(
          `CRM rejected the payment: ${formatCrmError(data || {})}`,
          'rejected',
          { paymentReference, status: response.status }
        );
      }
      throw new CrmPaymentError(
        'CRM did not confirm the payment. It will be reconciled by Medianet.',
        'ambiguous',
        { paymentReference, status: response.status }
      );
    }

    throw new CrmPaymentError('CRM is unreachable. No payment was recorded.', 'rejected', {
      paymentReference,
    });
  }

  async countMatchingServices(contactId, plans) {
    const productIds = new Set(plans.map((plan) => plan.product_id));
    const servicesData = await this.fetchContactServices(contactId);
    return (servicesData.content || []).filter((service) =>
      productIds.has(this.getServiceProductId(service))
    ).length;
  }

  async createSubscription(contactId, accountId, plans, maxAttempts = 4) {
    const services = plans.map((plan) => ({
      price_terms_id: plan.price_term_id,
      product_id: plan.product_id,
      quantity: 1,
    }));

    const payload = {
      account_id: accountId,
      services,
    };

    if (plans[0]?.schedule_date) {
      payload.scheduled_date = plans[0].schedule_date;
    }

    let lastError = 'Subscription API failed';
    let baselineCount = null;
    try {
      baselineCount = await this.countMatchingServices(contactId, plans);
    } catch {
      baselineCount = null;
    }

    // A timeout or 5xx may still have created the services; only retry once CRM shows it did not.
    const wasCreatedDespiteError = async () => {
      if (baselineCount == null) return null;
      try {
        return (await this.countMatchingServices(contactId, plans)) > baselineCount;
      } catch {
        return null;
      }
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await this.crmFetch(`/contacts/${contactId}/services`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(payload),
        });
      } catch (error) {
        lastError = error.message;
        const created = isUndeliveredRequestError(error) ? false : await wasCreatedDespiteError();
        if (created === true) return { success: true, data: {} };
        if (created === false && attempt < maxAttempts) {
          await delay(500 * attempt);
          continue;
        }
        return { success: false, error: error.message };
      }

      const raw = await response.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { message: raw || 'Non-JSON response' };
      }

      if (response.ok) {
        return { success: true, data };
      }

      const errorMessage = formatCrmError(data);
      lastError = errorMessage;

      if (isRetryableSubscriptionError(response.status, data) && attempt < maxAttempts) {
        if (response.status >= 500) {
          const created = await wasCreatedDespiteError();
          if (created === true) return { success: true, data: {} };
          if (created !== false) return { success: false, error: errorMessage };
        }
        await delay(750 * attempt);
        continue;
      }

      return { success: false, error: errorMessage };
    }

    return { success: false, error: lastError };
  }

  extractSubscriptionId(data = {}) {
    if (!data || typeof data !== 'object') return null;
    const direct = data.subscription_id || data.subscription?.id;
    if (direct) return direct;
    const services = [
      ...(Array.isArray(data.content) ? data.content : []),
      ...(Array.isArray(data.services) ? data.services : []),
    ];
    for (const service of services) {
      const id = service?.subscription_id || service?.subscription?.id;
      if (id) return id;
    }
    return null;
  }

  async getSubscriptionDetails(contactId) {
    try {
      const response = await this.crmFetch(`/contacts/${contactId}/subscriptions`, {
        method: 'GET',
        headers: this.headers,
      });

      const data = await this.handleResponse(response, 'Get subscriptions');

      if (data.content?.length) {
        const createdAt = (sub) =>
          Date.parse(sub.created_date || sub.created_on || sub.created_at || sub.first_activation_date || '') || 0;
        let newest = data.content[data.content.length - 1];
        for (const sub of data.content) {
          if (createdAt(sub) > createdAt(newest)) newest = sub;
        }
        return { subscription_id: newest.id };
      }

      return { subscription_id: null };
    } catch {
      return { subscription_id: null };
    }
  }

  getServiceProductId(service) {
    return service?.product?.id || service?.product_id || null;
  }

  extractServicesFromPayload(data = {}, plans = []) {
    const productIds = new Set(plans.map((plan) => plan.product_id));
    const candidates = [];

    if (Array.isArray(data.content)) candidates.push(...data.content);
    if (Array.isArray(data.services)) candidates.push(...data.services);
    if (data.id && this.getServiceProductId(data)) candidates.push(data);

    return candidates.filter((service) => {
      const productId = this.getServiceProductId(service);
      return productId && productIds.has(productId) && service.id;
    });
  }

  async resolveServicesForDeviceAssignment(contactId, plans = [], subscriptionCreateData = null) {
    const productIds = plans.map((plan) => plan.product_id);
    const expectedCount = productIds.length;

    const fromCreateResponse = this.extractServicesFromPayload(subscriptionCreateData, plans);
    if (fromCreateResponse.length >= expectedCount) {
      return fromCreateResponse;
    }

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const servicesData = await this.fetchContactServices(contactId);
      const matched = (servicesData.content || []).filter((service) =>
        productIds.includes(this.getServiceProductId(service))
      );

      if (matched.length >= expectedCount) {
        return matched;
      }

      await delay(350 * attempt);
    }

    const servicesData = await this.fetchContactServices(contactId);
    const matched = (servicesData.content || []).filter((service) =>
      productIds.includes(this.getServiceProductId(service))
    );

    if (!matched.length) {
      throw new Error('No CRM services found to assign devices');
    }

    return matched;
  }

  async fetchContactServices(contactId, subscriptionId = null) {
    let path = `/contacts/${contactId}/services?size=100&page=1&include_future_info=true`;
    if (subscriptionId) {
      path += `&subscription_id=${subscriptionId}`;
    }

    const response = await this.crmFetch(path, { method: 'GET' });

    return this.handleResponse(response, `Fetch services for contact ${contactId}`);
  }

  async assignDevicesToService(serviceId, deviceIds) {
    const payload = deviceIds.map((device) => ({
      device_id: device.device_id,
      action: 'ENABLE',
    }));

    const response = await this.crmFetch(`/services/${serviceId}/devices`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    return this.handleResponse(response, `Assign devices to service ${serviceId}`);
  }

  async assignDevicesToServices(
    contactId,
    deviceIds,
    { plans = [], subscriptionCreateData = null } = {}
  ) {
    const services = await this.resolveServicesForDeviceAssignment(
      contactId,
      plans,
      subscriptionCreateData
    );

    const results = [];

    for (const service of services) {
      const assigned = await this.assignDevicesToService(service.id, deviceIds);
      results.push({
        serviceId: service.id,
        productId: this.getServiceProductId(service),
        devices: assigned,
      });
    }

    return results;
  }

  async addSubscriptionDevice(
    subscriptionId,
    deviceIds,
    contactId,
    { plans = [], subscriptionCreateData = null } = {}
  ) {
    const response = await this.crmFetch(`/subscriptions/${subscriptionId}/devices`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(deviceIds[0]),
    });

    const data = await this.handleResponse(response, 'Add subscription device');

    if (data.id) {
      return this.assignDevicesToServices(contactId, deviceIds, {
        plans,
        subscriptionCreateData,
      });
    }

    throw new Error('Failed to link device to subscription');
  }

  async getAllowedDevices(subscriptionId, contactId, { plans = [], subscriptionCreateData = null } = {}) {
    let devices = [];
    let source = 'allowed_devices';

    try {
      const response = await this.crmFetch(
        `/subscriptions/${subscriptionId}/allowed_devices`,
        { method: 'GET' }
      );

      const data = await this.handleResponse(response, 'Get allowed devices');
      devices = data.content || [];
    } catch {
      devices = [];
      source = 'subscription_devices';
    }

    const hasValidDeviceId = devices.some((item) => item?.device?.id);

    if (!hasValidDeviceId) {
      source = 'subscription_devices';

      const fallbackResponse = await this.crmFetch(
        `/subscriptions/${subscriptionId}/devices`,
        { method: 'GET' }
      );

      const fallbackData = await this.handleResponse(
        fallbackResponse,
        'Get subscription devices'
      );
      devices = fallbackData.content || [];
    }

    const deviceIds = devices
      .filter((item) => item?.device?.id)
      .map((item) => ({ device_id: item.device.id }));

    if (!deviceIds.length) {
      return { deviceIds: [], assignments: [] };
    }

    if (source === 'allowed_devices') {
      const assignments = await this.addSubscriptionDevice(
        subscriptionId,
        deviceIds,
        contactId,
        { plans, subscriptionCreateData }
      );
      return { deviceIds, assignments };
    }

    const assignments = await this.assignDevicesToServices(contactId, deviceIds, {
      plans,
      subscriptionCreateData,
    });
    return { deviceIds, assignments };
  }

  async setupSubscriptionDevices(
    contactId,
    subscriptionId,
    preferredDeviceId = null,
    { plans = [], subscriptionCreateData = null } = {}
  ) {
    if (preferredDeviceId) {
      const deviceIds = [{ device_id: preferredDeviceId }];
      await this.addSubscriptionDevice(subscriptionId, deviceIds, contactId, {
        plans,
        subscriptionCreateData,
      });
      return { deviceIds };
    }

    let result = await this.getAllowedDevices(subscriptionId, contactId, {
      plans,
      subscriptionCreateData,
    });

    if (!result.deviceIds.length) {
      const serviceTag = plans[0]?.serviceTag || 'OTT';
      const device = await this.createDevice(contactId, serviceTag);
      const deviceIds = [{ device_id: device.id }];
      await this.addSubscriptionDevice(subscriptionId, deviceIds, contactId, {
        plans,
        subscriptionCreateData,
      });
      return { deviceIds };
    }

    return result;
  }

  /**
   * Payment → subscription → devices. Throws:
   * - CrmPaymentError when the payment was rejected (nothing posted) or its outcome is unknown;
   * - CrmBillableError when the payment posted but a later step failed.
   */
  async setupSubscription(
    contactId,
    accountId,
    plans,
    preferredDeviceId = null,
    { paymentReference, beforeActivation = null, targetDeviceId = null } = {}
  ) {
    const totalAmount = Math.round(
      plans.reduce((sum, plan) => sum + (Number(plan.priceAmount) || 0), 0) * 100
    ) / 100;

    let paymentResult = { paymentId: null };
    if (totalAmount > 0) {
      paymentResult = await this.createPayment(contactId, accountId, totalAmount, { paymentReference });
      // CRM rejects price_terms_id immediately after payment until the account balance settles.
      await delay(1500);
    }

    const paymentId = paymentResult.paymentId;
    let subscriptionId = null;

    try {
      // Runs once the payment is in CRM and before the new services are created.
      if (beforeActivation) await beforeActivation();

      // Sale to one specific device: remember what the customer already has, so that only
      // the services created now are enabled, and only on that device.
      let existingServiceIds = null;
      if (targetDeviceId) {
        const current = await this.fetchContactServicesWithSubscription(contactId);
        existingServiceIds = new Set((current.content || []).map((service) => service.id));
      }

      const subscription = await this.createSubscription(contactId, accountId, plans);
      if (!subscription?.success) {
        throw new Error(`Subscription creation failed: ${subscription?.error || 'Unknown error'}`);
      }

      if (targetDeviceId) {
        const enabled = await this.enableNewServicesOnDevice(contactId, targetDeviceId, plans, existingServiceIds);
        return {
          subscriptionId: enabled.subscriptionId,
          paymentId,
          paymentReference: totalAmount > 0 ? paymentReference : null,
          deviceIds: [{ device_id: targetDeviceId }],
        };
      }

      subscriptionId =
        this.extractSubscriptionId(subscription.data) ||
        (await this.getSubscriptionDetails(contactId)).subscription_id;

      let deviceSetup = { deviceIds: [] };
      if (subscriptionId) {
        deviceSetup = await this.setupSubscriptionDevices(
          contactId,
          subscriptionId,
          preferredDeviceId,
          { plans, subscriptionCreateData: subscription.data }
        );
      }

      return {
        subscriptionId,
        paymentId,
        paymentReference: totalAmount > 0 ? paymentReference : null,
        deviceIds: deviceSetup.deviceIds || [],
      };
    } catch (err) {
      if (totalAmount <= 0) throw err;
      throw new CrmBillableError(
        `Payment was recorded in CRM but activation did not finish: ${err.message}`,
        { contactId, accountId, paymentId, paymentReference, subscriptionId, totalAmount }
      );
    }
  }

  async ensureContactAccount(contactId) {
    try {
      const accountsData = await this.fetchContactAccounts(contactId);
      const accountId = accountsData.content?.[0]?.id || null;
      if (accountId) {
        return accountId;
      }
    } catch {
      // Create a billing account below when none exists.
    }

    const account = await this.createAccount(contactId, { isPrimary: true });
    return account.id;
  }

  /**
   * Register a customer in CRM (contact + tag + device + billing account).
   * Does not create a subscription — use Activate for that.
   */
  async registerCustomer(phoneNumber, fullName, serviceTag = 'OTT', { forceNew = false } = {}) {
    this.assertConfigured();
    const normalizedTag = assertServiceTag(serviceTag);
    const tagConfig = getServiceTagConfig(normalizedTag);
    const normalizedPhone = normalizePhone(phoneNumber);
    const { firstName, lastName } = splitFullName(fullName);

    let contactId;
    let alreadyRegistered = false;
    let deviceId = null;

    if (!forceNew) {
      const contactsData = await this.fetchContactsByPhone(normalizedPhone);
      const contacts = contactsData.content || [];

      if (contacts.length) {
        contactId = contacts[0].id;
        alreadyRegistered = true;

        const tagsData = await this.fetchContactTags(contactId);
        if (!this.contactHasServiceTag(tagsData, tagConfig)) {
          await this.addContactTag(contactId, [tagConfig.crmTagId]);
        }
      }
    }

    if (!contactId) {
      const contact = await this.createContact(firstName, lastName, normalizedPhone, normalizedTag);
      contactId = contact.id;
      const device = await this.createDevice(contactId, normalizedTag);
      deviceId = device.id;
    }

    const accountId = await this.ensureContactAccount(contactId);

    return {
      contactId,
      accountId,
      deviceId,
      serviceTag: normalizedTag,
      alreadyRegistered,
      message: alreadyRegistered
        ? 'Customer already exists in CRM'
        : 'Customer registered in CRM',
    };
  }

  async registerNewUser(phoneNumber, fullName, packageIds, { paymentReference } = {}) {
    const serviceTag = await this.resolveServiceTagFromPackageIds(packageIds);
    const plans = await this.resolvePlans(packageIds);
    const registration = await this.registerCustomer(phoneNumber, fullName, serviceTag, {
      forceNew: true,
    });
    const subscription = await this.setupSubscription(
      registration.contactId,
      registration.accountId,
      plans,
      registration.deviceId,
      { paymentReference }
    );

    return {
      contactId: registration.contactId,
      accountId: registration.accountId,
      deviceId: registration.deviceId,
      subscriptionId: subscription.subscriptionId,
      paymentId: subscription.paymentId,
      deviceIds: subscription.deviceIds,
      message: 'New customer account created in CRM',
    };
  }

  async addSubscriptionForExisting(
    contactId,
    accountId,
    packageIds,
    { paymentReference, beforeActivation = null, deviceId = null } = {}
  ) {
    const plans = await this.resolvePlans(packageIds);
    const subscription = await this.setupSubscription(contactId, accountId, plans, null, {
      paymentReference,
      beforeActivation,
      targetDeviceId: deviceId,
    });

    return {
      contactId,
      accountId,
      subscriptionId: subscription.subscriptionId,
      paymentId: subscription.paymentId,
      deviceIds: subscription.deviceIds,
      message: 'Subscription created for existing CRM contact',
    };
  }

  async searchCustomersByPhone(phoneNumber, serviceTag = 'OTT') {
    this.assertConfigured();
    const normalizedTag = assertServiceTag(serviceTag);
    const tagConfig = getServiceTagConfig(normalizedTag);
    const normalizedPhone = normalizePhone(phoneNumber);
    const contactsData = await this.fetchContactsByPhone(normalizedPhone);
    // CRM search_value is a free-text search, so keep only contacts whose own phone number
    // is the one that was asked for.
    const contacts = (contactsData.content || []).filter((contact) =>
      contactMatchesPhone(contact, normalizedPhone)
    );

    const customers = (
      await mapWithConcurrency(contacts, CONTACT_LOOKUP_CONCURRENCY, async (contact) => {
          try {
            const tagsData = await this.fetchContactTags(contact.id);
            if (!this.contactHasServiceTag(tagsData, tagConfig)) {
              return null;
            }

            const crmTags = (tagsData.content || [])
              .map((tag) => tag.name)
              .filter(Boolean);

            const [deviceCode, overview] = await Promise.all([
              this.fetchDeviceCodeForContact(contact.id),
              this.fetchCustomerOverview(contact.id),
            ]);

            return this.expandCustomerByDevice({
              id: contact.id,
              code: contact.code || null,
              name: contact.name || 'Unknown',
              type: contact.type || null,
              phone: contact.phone?.number || normalizedPhone,
              serviceTag: normalizedTag,
              serviceTagLabel: tagConfig.label,
              serviceTypeShort: tagConfig.shortLabel,
              crmTags,
              deviceCode,
              account: overview.account,
              services: overview.services,
            }, tagConfig);
          } catch (err) {
            console.error(`[CRM] Tag lookup failed for contact ${contact.id}:`, err.message);
            return null;
          }
      })
    ).filter(Boolean).flat();

    return {
      customers,
      paging: contactsData.paging || null,
      serviceTag: normalizedTag,
    };
  }

  /** Applies a lifecycle action (RENEW, CHANGE, CANCEL…) to one subscription service. */
  async updateService(serviceId, body, context) {
    const response = await this.crmFetch(`/services/${serviceId}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    return this.handleResponse(response, context);
  }

  /**
   * Shared shape of renew and upgrade: post the customer's payment (tagged with the wallet
   * debit reference), then run the service action(s). Once the payment exists, any failure
   * is reported as "paid but not finished" so the charge is kept and reconciled by staff.
   */
  async payThenUpdateService(contactId, chargeAmount, { paymentReference }, applyActions) {
    this.assertConfigured();
    const accountId = await this.ensureContactAccount(contactId);
    const amount = Math.round((Number(chargeAmount) || 0) * 100) / 100;

    let paymentId = null;
    if (amount > 0) {
      const payment = await this.createPayment(contactId, accountId, amount, { paymentReference });
      paymentId = payment.paymentId;
      // Same settle delay as new subscriptions: CRM needs the payment on the account first.
      await delay(1500);
    }

    try {
      const result = await applyActions();
      return { contactId, accountId, paymentId, paymentReference: amount > 0 ? paymentReference : null, ...result };
    } catch (err) {
      if (amount <= 0) throw err;
      throw new CrmBillableError(
        `Payment was recorded in CRM but the service change did not finish: ${err.message}`,
        { contactId, accountId, paymentId, paymentReference, totalAmount: amount }
      );
    }
  }

  /**
   * Asks CRM what changing a service to another package would cost, without making the change.
   * CRM keeps the current term, invoices the new package for the days that remain and credits
   * the old one for the same days; the difference is what the customer has to pay.
   * Returns { allowed, reason, amount, newCharge, credit }.
   */
  async estimateServiceChange(contactId, { serviceId, subscriptionId }, packageId) {
    this.assertConfigured();
    const plan = await this.resolvePlan(packageId);
    const accountId = await this.ensureContactAccount(contactId);
    const response = await this.crmFetch('/estimates/service_delivery', {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        action: 'CHANGE',
        contact_id: contactId,
        account_id: accountId,
        subscription_id: subscriptionId,
        services_to_change: [
          {
            from_service_id: serviceId,
            to_service_product_id: plan.product_id,
            to_price_terms_id: plan.price_term_id,
          },
        ],
      }),
    });

    const refused = (reason) => ({ allowed: false, reason, amount: null, newCharge: null, credit: null });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (response.status >= 500 || (response.ok && !body)) {
      throw new AppError('CRM could not price this upgrade. Please try again.', 502, 'CRM_ERROR');
    }
    if (!response.ok) {
      // CRM explains a refusal in `parameters`, e.g. ["Change", "No valid tier path is configured"].
      const detail = Array.isArray(body?.parameters) ? body.parameters[body.parameters.length - 1] : null;
      console.error(`[CRM] Change estimate refused (${response.status}):`, text.slice(0, 300));
      return refused(detail ? `CRM does not allow this upgrade: ${detail}` : 'CRM does not allow this upgrade');
    }

    const estimate = (body.service_delivery_estimate || [])[0];
    if (!estimate || estimate.action_allowed === false) {
      return refused('CRM does not allow this upgrade');
    }
    const invoicing = estimate.billing_estimate?.invoicing || [];
    const sum = (rows) => Math.round(rows.reduce((total, row) => total + (Number(row.total_amount) || 0), 0) * 100) / 100;
    const invoices = invoicing.filter((row) => !row.is_credit);
    if (!invoices.length || estimate.billing_estimate?.failure_reason) {
      // A credit with no new invoice means CRM would not bill the new package now; charging
      // nothing (or guessing) would be wrong, so the upgrade is not offered.
      return refused('CRM did not return a price for this upgrade');
    }
    const newCharge = sum(invoices);
    const credit = sum(invoicing.filter((row) => row.is_credit));
    const amount = Math.max(0, Math.round((newCharge - credit) * 100) / 100);
    return { allowed: true, reason: null, amount, newCharge, credit };
  }

  /**
   * Makes sure the contact's service for `plan` is enabled on a device. Does nothing when it
   * already is; otherwise enables the devices CRM lists as available for that service.
   */
  async ensureServiceDevicesEnabled(contactId, plan, deviceId = null) {
    const services = await this.resolveServicesForDeviceAssignment(contactId, [plan]);
    const listDevices = async (service) => {
      const response = await this.crmFetch(`/services/${service.id}/devices`, {
        method: 'GET',
        headers: this.headers,
      });
      const data = await this.handleResponse(response, `List devices of service ${service.id}`);
      return (data.content || []).filter((item) => item?.device?.id);
    };

    if (deviceId) {
      // The upgrade belongs to one device. The customer may hold the same package on another
      // device too, so only a service that is on this device, or on none yet, is touched.
      const unassigned = [];
      for (const service of services) {
        const devices = await listDevices(service);
        const enabled = devices.filter((item) => item.state === 'ENABLED');
        if (enabled.some((item) => item.device.id === deviceId)) return;
        if (!enabled.length) unassigned.push(service);
      }
      if (!unassigned.length) {
        throw new Error('The upgraded package was not found for this device');
      }
      await this.assignDevicesToService(unassigned[0].id, [{ device_id: deviceId }]);
      return;
    }

    for (const service of services) {
      const devices = await listDevices(service);
      if (devices.some((item) => item.state === 'ENABLED')) continue;
      if (!devices.length) {
        throw new Error('The customer has no device to enable the new package on');
      }
      await this.assignDevicesToService(
        service.id,
        devices.map((item) => ({ device_id: item.device.id }))
      );
    }
  }

  /**
   * Enables the services just created for `plans` on one device, and on no other. Services
   * the customer already had (`existingServiceIds`) are left alone, even for the same product.
   */
  async enableNewServicesOnDevice(contactId, deviceId, plans, existingServiceIds) {
    const productIds = new Set(plans.map((plan) => plan.product_id));
    let created = [];
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const data = await this.fetchContactServicesWithSubscription(contactId);
      created = (data.content || []).filter(
        (service) => productIds.has(this.getServiceProductId(service)) && !existingServiceIds.has(service.id)
      );
      if (created.length >= plans.length) break;
      await delay(350 * attempt);
    }
    if (!created.length) {
      throw new Error('The new services were not found in CRM to enable on the device');
    }

    const subscriptionIds = [...new Set(created.map((service) => service.subscription?.id).filter(Boolean))];
    for (const subscriptionId of subscriptionIds) {
      const response = await this.crmFetch(`/subscriptions/${subscriptionId}/devices`, {
        method: 'GET',
        headers: this.headers,
      });
      const linked = await this.handleResponse(response, 'Get subscription devices');
      if ((linked.content || []).some((item) => item?.device?.id === deviceId)) continue;
      const addResponse = await this.crmFetch(`/subscriptions/${subscriptionId}/devices`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ device_id: deviceId }),
      });
      await this.handleResponse(addResponse, 'Add subscription device');
    }

    for (const service of created) {
      await this.assignDevicesToService(service.id, [{ device_id: deviceId }]);
    }
    return { subscriptionId: subscriptionIds[0] || null, serviceIds: created.map((service) => service.id) };
  }

  /**
   * The contact's devices for one customer type, each with its service code and the ids of
   * the services enabled on it. A sale is always made to one of these devices.
   */
  async fetchContactDevices(contactId, services = [], tagConfig = null) {
    const devicesData = await this.fetchDevicesByContactId(contactId, { size: 50 });
    let devices = (devicesData.content || []).filter((device) => device?.id);
    // A customer can hold devices of more than one type (app and TV box); keep this type's.
    if (tagConfig?.crmDeviceProductId) {
      const sameType = devices.filter((device) => device.product?.id === tagConfig.crmDeviceProductId);
      if (sameType.length) devices = sameType;
    }

    const serviceIdsByDevice = new Map();
    const subscriptionIds = [...new Set(services.map((service) => service.subscriptionId).filter(Boolean))];
    for (const subscriptionId of subscriptionIds) {
      const response = await this.crmFetch(`/subscriptions/${subscriptionId}/devices`, {
        method: 'GET',
        headers: this.headers,
      });
      const data = await this.handleResponse(response, 'Get subscription devices');
      for (const item of data.content || []) {
        if (!item?.device?.id) continue;
        const ids = serviceIdsByDevice.get(item.device.id) || new Set();
        for (const service of item.services || []) ids.add(service.id);
        serviceIdsByDevice.set(item.device.id, ids);
      }
    }

    return {
      devices: devices.map((device) => ({
        id: device.id,
        code: deviceServiceCode(device),
        serviceIds: serviceIdsByDevice.get(device.id) || new Set(),
      })),
      // Every service that is on some device, including devices of another type.
      assignedServiceIds: new Set([...serviceIdsByDevice.values()].flatMap((ids) => [...ids])),
    };
  }

  /**
   * One search result per device, because a package is sold to a device: each result carries
   * that device's service code and only the services enabled on it. A service that is not on
   * any device yet is shown on every device, so it is neither hidden nor sold twice.
   */
  async expandCustomerByDevice(customer, tagConfig, { onlyCode = null } = {}) {
    const single = (extra = {}) => [{ ...customer, key: customer.id, deviceId: null, deviceCount: 0, ...extra }];
    if (customer.services == null) {
      return single();
    }
    let devices;
    let assigned;
    try {
      ({ devices, assignedServiceIds: assigned } = await this.fetchContactDevices(
        customer.id,
        customer.services,
        tagConfig
      ));
    } catch (err) {
      console.error(`[CRM] Device lookup failed for contact ${customer.id}:`, err.message);
      // Without the device picture it is not known what is on which device: nothing is offered.
      return single({ services: null });
    }
    if (!devices.length) return single();

    // Searched by service code: only that device, and only if it is a device of this type.
    const wanted = onlyCode
      ? devices.filter((device) => device.code && device.code.toLowerCase() === String(onlyCode).toLowerCase())
      : devices;
    return wanted.map((device) => ({
      ...customer,
      key: `${customer.id}:${device.id}`,
      deviceId: device.id,
      deviceCode: device.code,
      deviceCount: devices.length,
      services: customer.services.filter(
        (service) => device.serviceIds.has(service.id) || !assigned.has(service.id)
      ),
    }));
  }

  /**
   * Continue existing packages: one payment for the total, then each of the customer's
   * current services is renewed for another period. `renewals` is [{ serviceId, packageId }].
   */
  async renewServicesForContact(contactId, renewals, { paymentReference } = {}) {
    const plans = await this.resolvePlans(renewals.map((item) => item.packageId));
    const total = plans.reduce((sum, plan) => sum + (Number(plan.priceAmount) || 0), 0);
    return this.payThenUpdateService(contactId, total, { paymentReference }, async () => {
      const renewed = [];
      for (const { serviceId } of renewals) {
        try {
          await this.updateService(serviceId, { action: 'RENEW' }, `Renew service ${serviceId}`);
        } catch (err) {
          // Say how far it got: staff reconcile from this.
          throw new Error(`${err.message} (renewed ${renewed.length} of ${renewals.length} services)`);
        }
        renewed.push(serviceId);
      }
      return { subscriptionId: null, serviceIds: renewed, message: 'Services renewed' };
    });
  }

  /**
   * Upgrade a base package in place. CRM refuses to change a base service while an add-on that
   * is not valid with the new base is still attached, so those add-ons are cancelled first.
   */
  async upgradeServiceForContact(
    contactId,
    { serviceId, cancelServiceIds = [] },
    packageId,
    { paymentReference, amount, deviceId = null } = {}
  ) {
    const plan = await this.resolvePlan(packageId);
    // `amount` is what CRM estimated for the change (new price less credit for unused days).
    const chargeAmount = amount ?? plan.priceAmount;
    return this.payThenUpdateService(contactId, chargeAmount, { paymentReference }, async () => {
      for (const addonServiceId of cancelServiceIds) {
        await this.updateService(addonServiceId, { action: 'CANCEL' }, `Cancel add-on ${addonServiceId}`);
      }
      await this.updateService(
        serviceId,
        {
          action: 'CHANGE',
          change_to_service: { product_id: plan.product_id, price_terms_id: plan.price_term_id },
        },
        `Change service ${serviceId}`
      );
      // The customer watches through their device, so the upgrade is only finished once the
      // new package is enabled on it. CRM may or may not carry the device over on a change.
      await this.ensureServiceDevicesEnabled(contactId, plan, deviceId);
      return { subscriptionId: null, serviceId, cancelledServiceIds: cancelServiceIds, message: 'Service upgraded' };
    });
  }

  /**
   * Upgrade for when CRM will not change the service in place (no tier path, or it cannot price
   * the change): take the full price, cancel the old base and the add-ons that do not go with
   * the new one, then start the new package as a new subscription.
   */
  async replaceServiceForContact(
    contactId,
    { serviceId, cancelServiceIds = [] },
    packageId,
    { paymentReference, deviceId = null } = {}
  ) {
    const result = await this.activatePackagesForContact(contactId, [packageId], {
      paymentReference,
      deviceId,
      beforeActivation: async () => {
        for (const addonServiceId of cancelServiceIds) {
          await this.updateService(addonServiceId, { action: 'CANCEL' }, `Cancel add-on ${addonServiceId}`);
        }
        await this.updateService(serviceId, { action: 'CANCEL' }, `Cancel replaced service ${serviceId}`);
      },
    });
    return { ...result, replacedServiceId: serviceId, cancelledServiceIds: cancelServiceIds };
  }

  /** Active (non-removed) subscription services of a contact, with their billing terms. */
  async fetchContactServicesWithSubscription(contactId) {
    const queryParams = new URLSearchParams({ include_subscription: 'true', size: '50', page: '1' });
    const response = await this.crmFetch(`/contacts/${contactId}/services?${queryParams}`, {
      headers: this.headers,
    });
    return this.handleResponse(response, `Fetch services for contact ${contactId}`);
  }

  /**
   * What an operator needs to see before topping up or subscribing a customer: the primary
   * account's balance and the customer's current services. Each half is optional: a failed
   * CRM call yields null for that half instead of hiding the customer.
   */
  async fetchCustomerOverview(contactId) {
    const [accountsResult, servicesResult] = await Promise.allSettled([
      this.fetchContactAccounts(contactId),
      this.fetchContactServicesWithSubscription(contactId),
    ]);

    let account = null;
    if (accountsResult.status === 'fulfilled') {
      const accounts = accountsResult.value?.content || [];
      const primary = accounts.find((item) => item.is_primary) || accounts[0];
      if (primary) {
        // CRM running balance: negative means the customer is in credit, positive is owed.
        const balance = Math.round((Number(primary.balance) || 0) * 100) / 100;
        account = {
          state: primary.state || null,
          currencyCode: primary.currency_code || this.currencyCode,
          balance,
          creditAmount: balance < 0 ? Math.abs(balance) : 0,
          dueAmount: balance > 0 ? balance : 0,
        };
      }
    } else {
      console.error(`[CRM] Account lookup failed for contact ${contactId}:`, accountsResult.reason?.message);
    }

    let services = null;
    if (servicesResult.status === 'fulfilled') {
      services = (servicesResult.value?.content || []).map(mapCustomerService);
    } else {
      console.error(`[CRM] Services lookup failed for contact ${contactId}:`, servicesResult.reason?.message);
    }

    return { account, services };
  }

  /**
   * Devices whose "code" custom field (the service code) equals `serviceCode`. CRM silently
   * ignores a custom-field filter it does not recognise and returns unfiltered devices, so
   * every result is checked again here.
   */
  async fetchDevicesByServiceCode(serviceCode) {
    const queryParams = new URLSearchParams({
      custom_fields: `${SERVICE_CODE_FIELD_KEY};${serviceCode}`,
      include_custom_fields: 'true',
      size: '10',
      page: '1',
    });
    const response = await this.crmFetch(`/devices?${queryParams}`, { headers: this.headers });
    const data = await this.handleResponse(response, 'Fetch devices by service code');
    return (data.content || []).filter((device) =>
      (device.custom_fields || []).some(
        (field) =>
          String(field?.key || '').toLowerCase() === SERVICE_CODE_FIELD_KEY &&
          String(field?.value ?? '').trim() === serviceCode
      )
    );
  }

  async fetchContactById(contactId) {
    const response = await this.crmFetch(`/contacts/${contactId}`, { headers: this.headers });
    return this.handleResponse(response, `Fetch contact ${contactId}`);
  }

  /**
   * Finds customers by the service code on their device instead of by phone number. Returns
   * the same shape as searchCustomersByPhone, limited to contacts of the given customer type.
   */
  async searchCustomersByServiceCode(serviceCode, serviceTag = 'OTT') {
    this.assertConfigured();
    const normalizedTag = assertServiceTag(serviceTag);
    const tagConfig = getServiceTagConfig(normalizedTag);
    const code = normalizeServiceCode(serviceCode);

    const devices = await this.fetchDevicesByServiceCode(code);
    const contactIds = [
      ...new Set(
        devices
          .filter((device) => String(device.owner?.type || '').toUpperCase() === 'CONTACT' && device.owner?.id)
          .map((device) => device.owner.id)
      ),
    ];

    const customers = (
      await mapWithConcurrency(contactIds, CONTACT_LOOKUP_CONCURRENCY, async (contactId) => {
        try {
          const tagsData = await this.fetchContactTags(contactId);
          if (!this.contactHasServiceTag(tagsData, tagConfig)) {
            return null;
          }
          const [contact, overview] = await Promise.all([
            this.fetchContactById(contactId),
            this.fetchCustomerOverview(contactId),
          ]);
          const ownerName = devices.find((device) => device.owner?.id === contactId)?.owner?.name;
          const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();

          return this.expandCustomerByDevice({
            id: contactId,
            code: contact.code || null,
            name: contact.name || contact.company_name || fullName || ownerName || 'Unknown',
            type: contact.type || null,
            phone: contact.phone?.number || null,
            serviceTag: normalizedTag,
            serviceTagLabel: tagConfig.label,
            serviceTypeShort: tagConfig.shortLabel,
            crmTags: (tagsData.content || []).map((tag) => tag.name).filter(Boolean),
            deviceCode: code,
            account: overview.account,
            services: overview.services,
          }, tagConfig, { onlyCode: code });
        } catch (err) {
          console.error(`[CRM] Service code lookup failed for contact ${contactId}:`, err.message);
          return null;
        }
      })
    ).filter(Boolean).flat();

    return { customers, paging: null, serviceTag: normalizedTag };
  }

  async postCustomerPayment(contactId, amount, { paymentReference } = {}) {
    this.assertConfigured();
    const normalizedAmount = Number(amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      throw new AppError('Top-up amount must be greater than zero', 400, 'VALIDATION_ERROR');
    }

    const accountId = await this.ensureContactAccount(contactId);
    const paymentResult = await this.createPayment(contactId, accountId, normalizedAmount, {
      paymentReference,
    });

    return {
      contactId,
      accountId,
      paymentId: paymentResult.paymentId,
      paymentReference,
      amount: normalizedAmount,
    };
  }

  async activatePackagesForContact(
    contactId,
    packageIds,
    { paymentReference, beforeActivation = null, deviceId = null } = {}
  ) {
    this.assertConfigured();
    const serviceTag = await this.resolveServiceTagFromPackageIds(packageIds);
    const tagConfig = getServiceTagConfig(serviceTag);
    await this.resolvePlans(packageIds);

    const accountId = await this.ensureContactAccount(contactId);

    try {
      await this.addContactTag(contactId, [tagConfig.crmTagId]);
    } catch {
      // Tag may already exist on the contact
    }

    return this.addSubscriptionForExisting(contactId, accountId, packageIds, {
      paymentReference,
      beforeActivation,
      deviceId,
    });
  }

  /**
   * Only contacts with the OTT tag are included.
   */
  async getOttContactDetails(phoneNumber) {
    const normalizedPhone = normalizePhone(phoneNumber);
    const contactsData = await this.fetchContactsByPhone(normalizedPhone);
    const contacts = contactsData.content || [];

    if (!contacts.length) {
      return [];
    }

    const rows = [];

    for (const contact of contacts) {
      const contactId = contact.id;

      try {
        const tagsData = await this.fetchContactTags(contactId);
        if (!this.contactHasOttTag(tagsData)) {
          continue;
        }

        let accountId = null;
        try {
          const accountsData = await this.fetchContactAccounts(contactId);
          accountId = accountsData.content?.[0]?.id || null;
        } catch {
          accountId = null;
        }

        const subscriptionsData = await this.fetchContactSubscriptions(contactId);
        const subscriptions = subscriptionsData.content || [];

        if (!subscriptions.length) {
          rows.push({
            contact_id: contactId,
            account_id: accountId,
            subscription_id: null,
            state: 'INACTIVE',
            product_name: null,
          });
          continue;
        }

        for (const subscription of subscriptions) {
          rows.push({
            contact_id: contactId,
            account_id: accountId,
            subscription_id: subscription.id,
            state: subscription.state,
            product_name: subscription.name || subscription.sku || null,
            start_date: this.formatDate(subscription.first_activation_date),
            end_date: this.formatDate(subscription.billing_info?.bill_up_date),
          });
        }
      } catch (error) {
        console.error(`Error processing OTT contact ${contactId}:`, error.message);
      }
    }

    return rows;
  }

  hasActiveOttSubscription(rows = []) {
    return rows.some(
      (row) => row.subscription_id && this.isActiveSubscriptionState(row.state)
    );
  }

  /**
   * Main entry: provision OTT packages for a phone number.
   * Always creates a new CRM contact, account, device, and subscription(s).
   */
  async provisionOttAccount(phoneNumber, fullName, packageIds, { paymentReference } = {}) {
    this.assertConfigured();
    await this.resolvePlans(packageIds);

    const normalizedPhone = normalizePhone(phoneNumber);
    if (!normalizedPhone) {
      throw new AppError('Phone number is required', 400, 'VALIDATION_ERROR');
    }

    return this.registerNewUser(normalizedPhone, fullName, packageIds, { paymentReference });
  }
}

export const crmService = new CRMService();
