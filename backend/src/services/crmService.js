import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { getPlanByPackageId } from './packageService.js';

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

class CRMService {
  constructor() {
    this.apiKey = config.crm.apiKey;
    this.baseUrl = config.crm.baseUrl;
    this.defaultTagId = config.crm.defaultTagId;
    this.deviceProductId = config.crm.deviceProductId;
    this.classificationId = config.crm.classificationId;
    this.currencyCode = config.crm.currencyCode;
    this.paymentTermsId = config.crm.paymentTermsId;
    this.paymentTypeId = config.crm.paymentTypeId;
    this.mobileTagName = 'OTT';
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

  async fetchOttProductCatalog() {
    this.assertConfigured();

    const ottProducts = await this.fetchAllProductsByTag(this.mobileTagName);

    const entries = await Promise.all(
      ottProducts.map(async (product) => {
        const prices = await this.fetchOttSegmentPrices(product.id);
        if (!prices.length) return null;

        return {
          productId: product.id,
          name: product.name,
          sku: product.sku || null,
          description: product.description || null,
          tags: (product.tags || []).map((tag) => tag.name),
          prices,
        };
      })
    );

    return entries.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** @deprecated alias kept for route compatibility */
  async fetchServiceRecommendations() {
    return this.fetchOttProductCatalog();
  }

  productHasTag(product, tagName) {
    return (product.tags || []).some((tag) => tag.name === tagName);
  }

  priceGroupHasOttSegment(priceGroup) {
    return (priceGroup.segments || []).some((segment) => segment.name === this.mobileTagName);
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

  async fetchOttSegmentPrices(productId) {
    const response = await fetch(`${this.baseUrl}/products/${productId}/prices`, {
      method: 'GET',
      headers: this.headers,
    });

    const priceGroups = await this.handleResponse(response, 'Fetch CRM product prices');
    const groups = Array.isArray(priceGroups) ? priceGroups : [];
    const prices = [];

    for (const group of groups) {
      if (!this.priceGroupHasOttSegment(group)) continue;

      for (const priceEntry of group.prices || []) {
        prices.push({
          priceTermId: priceEntry.id,
          price: Number(priceEntry.price) || 0,
          currencyCode: priceEntry.currency_code || this.currencyCode,
          isDefault: Boolean(group.is_default),
          label: group.label || null,
          segmentName: this.mobileTagName,
          billingModel: group.price_terms?.billing_model || null,
          billingPeriod: group.price_terms?.billing_period || null,
        });
      }
    }

    return prices;
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
      throw new Error(`${context} failed: ${text}`);
    }

    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`${context} failed: Response is not valid JSON`);
    }
  }

  contactHasOttTag(tagsData) {
    const tags = tagsData?.content || [];
    return tags.some(
      (tag) =>
        tag.name === this.mobileTagName || tag.id === this.defaultTagId
    );
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

  async fetchContactsByPhone(phoneNumber) {
    const queryParams = new URLSearchParams({ phone_number: phoneNumber }).toString();
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

  async createContact(firstName, lastName, phoneNumber) {
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

    await this.addContactTag(contactData.id, [this.defaultTagId]);

    return { id: contactData.id };
  }

  async createDevice(contactId) {
    const payload = {
      serial_number: uuidv4(),
      electronic_id: null,
      contact_id: contactId,
      product_id: this.deviceProductId,
    };

    const response = await fetch(`${this.baseUrl}/devices`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    return this.handleResponse(response, 'Device creation');
  }

  async createAccount(contactId) {
    const payload = {
      classification_id: this.classificationId,
      credit_limit: '',
      currency_code: this.currencyCode,
      is_primary: false,
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
      scheduled_date: plans[0]?.schedule_date || null,
      services,
    };

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

        const errorMessage = data?.message || data?.error || `HTTP ${response.status}`;
        lastError = errorMessage;

        const shouldRetry =
          response.status >= 500 ||
          String(errorMessage).toLowerCase().includes('internal server error');

        if (shouldRetry && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
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
      const device = await this.createDevice(contactId);
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

    const subscription = await this.createSubscription(contactId, accountId, plans);
    if (!subscription?.success) {
      throw new Error(
        `Subscription creation failed: ${subscription?.error || 'Unknown CRM error'}`
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

  async registerNewUser(phoneNumber, fullName, packageIds) {
    const plans = await this.resolvePlans(packageIds);
    const { firstName, lastName } = splitFullName(fullName);
    const contact = await this.createContact(firstName, lastName, phoneNumber);
    const device = await this.createDevice(contact.id);
    const account = await this.createAccount(contact.id);
    const subscription = await this.setupSubscription(
      contact.id,
      account.id,
      plans,
      device.id
    );

    return {
      contactId: contact.id,
      accountId: account.id,
      deviceId: device.id,
      subscriptionId: subscription.subscriptionId,
      paymentId: subscription.paymentId,
      deviceIds: subscription.deviceIds,
      message: 'User registered successfully in CRM',
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

  /**
   * Returns OTT-tagged contact rows for a phone number.
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
