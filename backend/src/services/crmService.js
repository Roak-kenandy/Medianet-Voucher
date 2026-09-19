import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { getPlanByPackageId } from './packageService.js';
import { getServiceTagConfig, assertServiceTag } from '../constants/serviceTags.js';

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

  async fetchProductCatalog(serviceTag = 'OTT') {
    this.assertConfigured();
    const tagConfig = getServiceTagConfig(assertServiceTag(serviceTag));
    const products = await this.fetchAllProductsByTag(tagConfig.crmTagName);

    const entries = await Promise.all(
      products.map(async (product) => {
        const prices = await this.fetchProductPrices(
          product.id,
          tagConfig.crmPriceSegmentName,
          config.crm.salesModelName
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

      const response = await fetch(`${this.baseUrl}/products?${params}`, {
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
    const response = await fetch(`${this.baseUrl}/products/${productId}/prices`, {
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

    const response = await fetch(`${this.baseUrl}/contacts?${queryParams}`, {
      method: 'GET',
      headers: this.headers,
    });

    return this.handleResponse(response, 'Fetch contacts');
  }

  async fetchContactTags(contactId) {
    const response = await fetch(`${this.baseUrl}/contacts/${contactId}/tags`, {
      method: 'GET',
      headers: this.headers,
    });

    return this.handleResponse(response, `Fetch tags for contact ${contactId}`);
  }

  async fetchContactAccounts(contactId) {
    const response = await fetch(`${this.baseUrl}/contacts/${contactId}/accounts`, {
      method: 'GET',
      headers: this.headers,
    });

    return this.handleResponse(response, `Fetch accounts for contact ${contactId}`);
  }

  async fetchContactSubscriptions(contactId) {
    const url = `${this.baseUrl}/contacts/${contactId}/subscriptions?size=100&page=1&include_terms=true&include_billing_info=true&include_future_info=true`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
    });

    return this.handleResponse(response, `Fetch subscriptions for contact ${contactId}`);
  }

  async addContactTag(contactId, tags) {
    const response = await fetch(`${this.baseUrl}/contacts/${contactId}/tags`, {
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

    const response = await fetch(`${this.baseUrl}/contacts`, {
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

  async createDevice(contactId, serviceTag = 'OTT') {
    const tagConfig = getServiceTagConfig(assertServiceTag(serviceTag));
    const payload = {
      serial_number: uuidv4(),
      electronic_id: null,
      contact_id: contactId,
      product_id: tagConfig.crmDeviceProductId,
    };

    const response = await fetch(`${this.baseUrl}/devices`, {
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

    const response = await fetch(`${this.baseUrl}/contacts/${contactId}/accounts`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    return this.handleResponse(response, 'Account creation');
  }

  async createPayment(contactId, accountId, amount, maxAttempts = 3) {
    let lastFailureMessage = 'Payment API failed';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const paymentRef = `DHIOTT${Date.now()}${uuidv4().slice(0, 8)}`;
      const payload = {
        contact_id: contactId,
        account_id: accountId,
        amount,
        currency_code: 'MVR',
        notes: 'OTT Payment',
        payment_method: { type: 'ELECTRONIC_TRANSFER' },
        state: 'POSTED',
        backoffice_code: paymentRef,
        type_id: this.paymentTypeId,
        external_payable: ['OTT Payment'],
      };

      try {
        const response = await fetch(`${this.baseUrl}/payments`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
          lastFailureMessage = data?.message || `Payment API failed with status ${response.status}`;
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
            continue;
          }
          return { success: false, message: lastFailureMessage };
        }

        return { success: true, data };
      } catch (error) {
        lastFailureMessage = error.message;
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          continue;
        }
        return { success: false, message: error.message };
      }
    }

    return { success: false, message: lastFailureMessage };
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

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/contacts/${contactId}/services`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(payload),
        });

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
          await delay(750 * attempt);
          continue;
        }

        return { success: false, error: errorMessage };
      } catch (error) {
        lastError = error.message;
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          continue;
        }
        return { success: false, error: error.message };
      }
    }

    return { success: false, error: lastError };
  }

  async getSubscriptionDetails(contactId) {
    try {
      const response = await fetch(`${this.baseUrl}/contacts/${contactId}/subscriptions`, {
        method: 'GET',
        headers: this.headers,
      });

      const data = await this.handleResponse(response, 'Get subscriptions');

      if (data.content?.length) {
        const subscription = data.content[data.content.length - 1];
        return { subscription_id: subscription.id };
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
    let url = `${this.baseUrl}/contacts/${contactId}/services?size=100&page=1&include_future_info=true`;
    if (subscriptionId) {
      url += `&subscription_id=${subscriptionId}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
    });

    return this.handleResponse(response, `Fetch services for contact ${contactId}`);
  }

  async assignDevicesToService(serviceId, deviceIds) {
    const payload = deviceIds.map((device) => ({
      device_id: device.device_id,
      action: 'ENABLE',
    }));

    const response = await fetch(`${this.baseUrl}/services/${serviceId}/devices`, {
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
    const response = await fetch(`${this.baseUrl}/subscriptions/${subscriptionId}/devices`, {
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
      const response = await fetch(
        `${this.baseUrl}/subscriptions/${subscriptionId}/allowed_devices`,
        {
          method: 'GET',
          headers: this.headers,
        }
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

      const fallbackResponse = await fetch(
        `${this.baseUrl}/subscriptions/${subscriptionId}/devices`,
        {
          method: 'GET',
          headers: this.headers,
        }
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

  async setupSubscription(contactId, accountId, plans, preferredDeviceId = null) {
    const totalAmount = plans.reduce(
      (sum, plan) => sum + (Number(plan.priceAmount) || 0),
      0
    );

    const paymentResult = await this.createPayment(contactId, accountId, totalAmount);
    if (!paymentResult.success) {
      throw new Error(`Payment failed: ${paymentResult.message}`);
    }

    // CRM rejects price_terms_id immediately after payment until the account balance settles.
    await delay(1500);

    const subscription = await this.createSubscription(contactId, accountId, plans);
    if (!subscription?.success) {
      throw new Error(
        `Subscription creation failed: ${subscription?.error || 'Unknown error'}`
      );
    }

    const subscriptionDetails = await this.getSubscriptionDetails(contactId);
    let deviceSetup = { deviceIds: [] };

    if (subscriptionDetails.subscription_id) {
      deviceSetup = await this.setupSubscriptionDevices(
        contactId,
        subscriptionDetails.subscription_id,
        preferredDeviceId,
        { plans, subscriptionCreateData: subscription.data }
      );
    }

    return {
      subscriptionId: subscriptionDetails.subscription_id,
      paymentId: paymentResult.data?.id || null,
      deviceIds: deviceSetup.deviceIds || [],
    };
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

  async registerNewUser(phoneNumber, fullName, packageIds) {
    const serviceTag = await this.resolveServiceTagFromPackageIds(packageIds);
    const plans = await this.resolvePlans(packageIds);
    const registration = await this.registerCustomer(phoneNumber, fullName, serviceTag, {
      forceNew: true,
    });
    const subscription = await this.setupSubscription(
      registration.contactId,
      registration.accountId,
      plans,
      registration.deviceId
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

  async addSubscriptionForExisting(contactId, accountId, packageIds) {
    const plans = await this.resolvePlans(packageIds);
    const subscription = await this.setupSubscription(contactId, accountId, plans);

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
    const contacts = contactsData.content || [];

    const customers = (
      await Promise.all(
        contacts.map(async (contact) => {
          try {
            const tagsData = await this.fetchContactTags(contact.id);
            if (!this.contactHasServiceTag(tagsData, tagConfig)) {
              return null;
            }

            const crmTags = (tagsData.content || [])
              .map((tag) => tag.name)
              .filter(Boolean);

            return {
              id: contact.id,
              code: contact.code || null,
              name: contact.name || 'Unknown',
              type: contact.type || null,
              phone: contact.phone?.number || normalizedPhone,
              serviceTag: normalizedTag,
              serviceTagLabel: tagConfig.label,
              serviceTypeShort: normalizedTag === 'MEDIANET_TV' ? 'TV' : 'Mobile',
              crmTags,
            };
          } catch (err) {
            console.error(`[CRM] Tag lookup failed for contact ${contact.id}:`, err.message);
            return null;
          }
        })
      )
    ).filter(Boolean);

    return {
      customers,
      paging: contactsData.paging || null,
      serviceTag: normalizedTag,
    };
  }

  async postCustomerPayment(contactId, amount) {
    this.assertConfigured();
    const normalizedAmount = Number(amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      throw new AppError('Top-up amount must be greater than zero', 400, 'VALIDATION_ERROR');
    }

    const accountId = await this.ensureContactAccount(contactId);
    const paymentResult = await this.createPayment(contactId, accountId, normalizedAmount);
    if (!paymentResult.success) {
      throw new Error(`Payment failed: ${paymentResult.message}`);
    }

    return {
      contactId,
      accountId,
      paymentId: paymentResult.data?.id || null,
      amount: normalizedAmount,
    };
  }

  async activatePackagesForContact(contactId, packageIds) {
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

    return this.addSubscriptionForExisting(contactId, accountId, packageIds);
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
  async provisionOttAccount(phoneNumber, fullName, packageIds) {
    this.assertConfigured();
    await this.resolvePlans(packageIds);

    const normalizedPhone = normalizePhone(phoneNumber);
    if (!normalizedPhone) {
      throw new AppError('Phone number is required', 400, 'VALIDATION_ERROR');
    }

    return this.registerNewUser(normalizedPhone, fullName, packageIds);
  }
}

export const crmService = new CRMService();
