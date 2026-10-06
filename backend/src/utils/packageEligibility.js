/*
 * Decides what a customer can be sold, given the services they already have. Pure logic with
 * no I/O, so the portal, the partner API and the tests all get the same answer.
 *
 * Package roles:
 *   base        a main plan; belongs to an upgrade family and has a tier within it
 *   addon       only with one of its required base packages
 *   standalone  always sellable
 *
 * Actions returned per package:
 *   subscribe   add it as a new service
 *   renew       the customer already has it; extend the existing service
 *   upgrade     replace a lower-tier base in the same family (no downgrades)
 */

/** Service states that count as "the customer has this" (terminated services are not listed by CRM). */
const CURRENT_STATES = new Set(['EFFECTIVE', 'NOT_EFFECTIVE', 'PAUSED', 'PENDING_VERIFICATION']);

function normaliseRole(role) {
  return role === 'base' || role === 'addon' ? role : 'standalone';
}

/**
 * @param {Array} catalog   every package of this customer type: { id, name, role, family, tier,
 *                          productId, requiredPackageIds }. Used to recognise what the customer
 *                          already holds, including packages this operator cannot sell.
 * @param {Array} services  the customer's services: { id, productId, state, name }
 * @param {Array} offered   the packages this operator may sell (a subset of the catalog shape)
 * @param {Array} alsoAdding package ids being bought in the same request, so an add-on can be
 *                          bought together with the base it needs
 */
export function evaluatePackageOptions({ catalog = [], services = [], offered = [], alsoAdding = [] }) {
  const byId = new Map(catalog.map((pkg) => [Number(pkg.id), pkg]));
  const byProduct = new Map();
  for (const pkg of catalog) {
    if (pkg.productId && !byProduct.has(pkg.productId)) byProduct.set(pkg.productId, pkg);
  }

  // What the customer holds, matched to packages through the CRM product.
  const held = (services || [])
    .filter((service) => CURRENT_STATES.has(service.state) && service.productId)
    .map((service) => ({ service, pkg: byProduct.get(service.productId) || null }));
  const heldByProduct = new Map(held.map((item) => [item.service.productId, item]));
  const heldBases = held.filter((item) => item.pkg && normaliseRole(item.pkg.role) === 'base');
  const heldAddons = held.filter((item) => item.pkg && normaliseRole(item.pkg.role) === 'addon');

  const productsOf = (packageIds = []) =>
    new Set(packageIds.map((id) => byId.get(Number(id))?.productId).filter(Boolean));
  const requirementNames = (pkg) =>
    (pkg.requiredPackageIds || []).map((id) => byId.get(Number(id))?.name).filter(Boolean);

  // Bases being bought in this same request also satisfy an add-on's requirement.
  const addingBaseProducts = new Set(
    alsoAdding
      .map((id) => byId.get(Number(id)))
      .filter((pkg) => pkg && normaliseRole(pkg.role) === 'base')
      .map((pkg) => pkg.productId)
  );

  return offered.map((pkg) => {
    const role = normaliseRole(pkg.role);
    const option = {
      packageId: Number(pkg.id),
      role,
      action: null,
      eligible: false,
      reason: null,
      // renew: the service to extend. upgrade: the base service being replaced.
      serviceId: null,
      subscriptionId: null,
      replaces: null,
      // upgrade only: add-ons the customer has that are not valid with the new base.
      cancels: [],
      // blocked add-on only: offered base packages that unlock it when bought together.
      requiresOneOf: [],
    };
    const allow = (action, extra = {}) => ({ ...option, ...extra, action, eligible: true });
    const deny = (reason) => ({ ...option, reason });

    const already = heldByProduct.get(pkg.productId);
    if (already) {
      return allow('renew', { serviceId: already.service.id });
    }

    if (role === 'standalone') {
      return allow('subscribe');
    }

    if (role === 'addon') {
      const required = productsOf(pkg.requiredPackageIds);
      if (!required.size) {
        return deny('This add-on has no base package configured yet');
      }
      const hasBase =
        heldBases.some((item) => required.has(item.pkg.productId)) ||
        [...addingBaseProducts].some((productId) => required.has(productId));
      if (hasBase) return allow('subscribe');
      const names = requirementNames(pkg);
      // Bases the customer could buy in the same request to unlock this add-on.
      const requiresOneOf = (pkg.requiredPackageIds || [])
        .map(Number)
        .filter((id) => !heldBases.length && offered.some((item) => Number(item.id) === id));
      return {
        ...deny(`Requires ${names.length ? names.join(' or ') : 'a base package'}`),
        requiresOneOf,
      };
    }

    // role === 'base'
    if (!heldBases.length) {
      return allow('subscribe');
    }

    const sameFamily = heldBases.filter(
      (item) => pkg.family && item.pkg.family && item.pkg.family === pkg.family
    );
    if (!sameFamily.length) {
      return deny(`Customer already has ${heldBases.map((item) => item.pkg.name).join(', ')}`);
    }

    const tier = Number(pkg.tier) || 0;
    const lower = sameFamily
      .filter((item) => (Number(item.pkg.tier) || 0) < tier)
      .sort((a, b) => (Number(b.pkg.tier) || 0) - (Number(a.pkg.tier) || 0));
    if (!lower.length) {
      return deny(`Not an upgrade from ${sameFamily.map((item) => item.pkg.name).join(', ')}`);
    }

    const from = lower[0];
    const cancels = heldAddons
      .filter((item) => !productsOf(item.pkg.requiredPackageIds).has(pkg.productId))
      .map((item) => ({ serviceId: item.service.id, packageId: Number(item.pkg.id), name: item.pkg.name }));

    return allow('upgrade', {
      serviceId: from.service.id,
      subscriptionId: from.service.subscriptionId || null,
      replaces: { serviceId: from.service.id, packageId: Number(from.pkg.id), name: from.pkg.name },
      cancels,
    });
  });
}

/**
 * Checks one purchase request. A request is one or more renewals, one or more new
 * subscriptions, or one upgrade; the kinds cannot be mixed because each is a different CRM operation.
 * Returns { action, options } or throws via `fail(message)`.
 */
export function resolvePurchase({ catalog, services, offered, packageIds }, fail) {
  const requested = [...new Set((packageIds || []).map(Number))];
  const options = evaluatePackageOptions({ catalog, services, offered, alsoAdding: requested });
  const chosen = requested.map((id) => options.find((option) => option.packageId === id));

  if (chosen.some((option) => !option)) {
    return fail('Selected package is not available for this customer');
  }
  const blocked = chosen.find((option) => !option.eligible);
  if (blocked) {
    const name = catalog.find((pkg) => Number(pkg.id) === blocked.packageId)?.name || 'This package';
    return fail(`${name} cannot be sold to this customer: ${blocked.reason}`);
  }

  const actions = new Set(chosen.map((option) => option.action));
  if (actions.size > 1) {
    return fail('Renewals, upgrades and new packages must be done one at a time');
  }
  const action = chosen[0].action;
  // Several packages can be added or renewed together; a base package is upgraded on its own.
  if (action === 'upgrade' && chosen.length > 1) {
    return fail('Upgrade one package at a time');
  }

  return { action, options: chosen };
}
