# Medianet Operator API (v1)

The Operator API lets an operator's own systems do what the operator portal does: find a
customer, read their balance and subscriptions, see what they can buy, top up their account,
and sell, renew or upgrade packages.

Everything is scoped to the operator that owns the API key. The customer types, sales models
and packages enabled for the operator by Medianet apply to the API exactly as they do in the
portal, and every sale is charged to the operator's wallet.

A machine-readable description is in [`partner-api.openapi.yaml`](partner-api.openapi.yaml).

## Contents

1. [Basics](#basics)
2. [Authentication](#authentication)
3. [How customers and devices are addressed](#how-customers-and-devices-are-addressed)
4. [Safe retries: the Idempotency-Key](#safe-retries-the-idempotency-key)
5. [Endpoints](#endpoints)
6. [Errors](#errors)
7. [Rate limits](#rate-limits)
8. [Typical flows](#typical-flows)

## Basics

| | |
|---|---|
| Base URL | `https://<portal-host>/api/v1` |
| Format | JSON in, JSON out. Send `Content-Type: application/json` on every POST. |
| Request style | Anything that takes input is a **POST with a JSON body**, including lookups. Nothing is passed in the URL query string. |
| Currency | MVR. Amounts are numbers with at most 2 decimals. |
| Times | ISO 8601, UTC. |

**Why lookups are POST.** Phone numbers and service codes are personal data, and URLs are
written to server and proxy logs. Sending them in the body keeps them out. A lookup changes
nothing, returns `200`, needs no `Idempotency-Key`, and can be repeated as often as you like.
`GET` is used only for the few requests that take no input, or only a reference of your own
in the path.

Every successful response has this envelope:

```json
{ "success": true, "data": { } }
```

Every error has this one:

```json
{ "success": false, "code": "PACKAGE_NOT_ELIGIBLE", "message": "SPORTS cannot be sold to this customer: Requires FAMILY" }
```

Use `code` in your program and show `message` to people. Validation errors also carry an
`errors` array of `{ field, message }`.

## Authentication

Medianet staff create API keys for an operator in the admin portal (Operators → API keys).
The full key is shown once, at creation. A key looks like `mtvop_1a2b3c4d_…`.

Send it on every request, in either header:

```
Authorization: Bearer mtvop_1a2b3c4d_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```
X-API-Key: mtvop_1a2b3c4d_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Keep the key on your servers. Never put it in a mobile app or a web page.
- An operator can have up to 5 active keys, so you can rotate without downtime: create a new
  key, switch over, then ask Medianet to revoke the old one.
- A missing, wrong or revoked key returns `401 UNAUTHORIZED`. An inactive operator returns
  `403 OPERATOR_INACTIVE`, and an operator whose API access is turned off returns
  `403 API_ACCESS_DISABLED`.

## How customers and devices are addressed

**Customer type.** Every customer request names a `serviceType` (for example `OTT` or
`MEDIANET_TV`). `GET /account` lists the types enabled for you. A customer who exists under a
type you are not enabled for is not visible to you.

**Finding a customer.** You find a customer by exactly one of:

- `serviceCode`: the code on the customer's device, or
- `phone`: the customer's 7-digit mobile number.

**One result per device.** A package is always sold to one device. A search therefore returns
one entry per device, each with a `customerId`, a `deviceId` and that device's `serviceCode`,
subscriptions and offers. Searching by `serviceCode` returns only that device. Searching by
`phone` returns every device of the customer for that type, usually one.

**Every later call repeats how you found them.** Requests about a customer send the
`customerId` **and** the same `serviceType` plus `serviceCode` or `phone` in the body. An id on
its own is never enough. If the customer has more than one device and you used `phone`, also
send `deviceId` where a device matters (subscriptions, offers, purchases); otherwise the
request is refused with `DEVICE_REQUIRED`.

## Safe retries: the Idempotency-Key

Every request that moves money (`/customers/topup`, `/customers/subscribe`,
`/customers/renew`, `/customers/upgrade`) **must** carry an `Idempotency-Key` header: a unique string you generate for that
one business operation, 8 to 100 characters from `A-Z a-z 0-9 . _ : -`. A UUID is ideal.

```
Idempotency-Key: 0b6f1c1e-7d0a-4a55-9a0e-2f5f7b1d9c11
```

If you do not get a response (timeout, dropped connection), **send the same request again with
the same key**. The operation runs at most once:

| Situation | What you get |
|---|---|
| First request | It is processed. |
| Same key, same request, already finished | The original response again, with header `Idempotent-Replayed: true`. Nothing is charged again. |
| Same key, same request, still running | `409 IDEMPOTENCY_IN_PROGRESS`. Wait and retry, or check `GET /requests/{key}`. |
| Same key, different request body | `422 IDEMPOTENCY_KEY_REUSED`. |
| The request ended with **nothing charged** (any 4xx, `CRM_BUSY`, `CRM_ERROR`, `CRM_PAYMENT_REJECTED`) | The key is released. You can send the request again with the same key or a new one. |
| The request ended with `CRM_RECONCILIATION_REQUIRED` or an unexpected `500` | The outcome is stored and replayed. **Do not start the sale again.** |

Keys are remembered for 30 days.

**When a money request fails.** Look at `code`:

- Any `4xx`: nothing was charged. Fix the request.
- `CRM_BUSY` (503), `CRM_ERROR` (502): the billing system was busy or unreachable before any
  charge. Retry after a short wait.
- `CRM_PAYMENT_REJECTED` (502): the billing system refused the payment and your wallet was
  refunded. You may retry.
- `CRM_RECONCILIATION_REQUIRED` (502): your wallet **was charged** and the customer side may or
  may not be complete. Do not repeat the sale. Medianet reviews these and either completes the
  sale or refunds you. Track it with `GET /transactions/{reference}` (field `crmState`), or
  contact Medianet with the idempotency key.
- No response at all, or `500`: send the same request with the same key, or call
  `GET /requests/{key}`, to learn what was recorded.

## Endpoints

| Method | Path | Purpose | Idempotency-Key |
|---|---|---|---|
| GET | `/account` | Who the key belongs to, enabled customer types, wallet | |
| GET | `/wallet` | Operator wallet balance and free-account slots | |
| POST | `/packages/list` | Packages you may sell | |
| POST | `/customers/search` | Find customers by service code or phone | |
| POST | `/customers/balance` | Customer account balance only | |
| POST | `/customers/subscriptions` | Current subscriptions on a device | |
| POST | `/customers/offers` | What can be sold to a device, with prices | |
| POST | `/customers/topup` | Add credit to the customer's account | required |
| POST | `/customers/subscribe` | Sell one or more new packages | required |
| POST | `/customers/renew` | Renew a package the customer has | required |
| POST | `/customers/upgrade` | Upgrade the customer's base package | required |
| POST | `/transactions/list` | Your wallet transactions | |
| GET | `/transactions/{reference}` | One transaction | |
| GET | `/requests/{idempotencyKey}` | Outcome of a money request | |

Lookups answer `200`. Money requests answer `201`.

### GET /account

```json
{
  "success": true,
  "data": {
    "operator": { "id": 12, "name": "Island Telecom" },
    "apiKey": { "name": "Billing server", "prefix": "mtvop_1a2b3c4d" },
    "serviceTypes": [
      { "key": "OTT", "label": "Medianet OTT", "isDefault": true },
      { "key": "MEDIANET_TV", "label": "Medianet TV", "isDefault": false }
    ],
    "wallet": {
      "balance": 15250.5,
      "currency": "MVR",
      "freeAccounts": { "limit": 10, "used": 4, "remaining": 6 }
    }
  }
}
```

### GET /wallet

Returns the `wallet` object shown above.

`freeAccounts` are slots Medianet may grant an operator. While slots remain, a **new**
subscription uses a slot instead of charging the wallet. Renewals, upgrades and top-ups are
always charged.

### POST /packages/list

Body: `serviceType` (optional). Without it, packages for all your types are returned.

```json
{ "serviceType": "OTT" }
```

Response:

```json
{
  "success": true,
  "data": {
    "packages": [
      { "id": 4, "name": "FAMILY", "serviceType": "OTT", "price": 200, "currency": "MVR",
        "role": "base", "upgradeFamily": "OTT plans", "upgradeTier": 2,
        "requiresOneOf": [], "salesModel": "Dealer" },
      { "id": 9, "name": "SPORTS", "serviceType": "OTT", "price": 50, "currency": "MVR",
        "role": "addon", "upgradeFamily": null, "upgradeTier": null,
        "requiresOneOf": [3, 4], "salesModel": "Dealer" }
    ]
  }
}
```

`role` explains how a package can be sold:

| role | Meaning |
|---|---|
| `base` | A main plan. A device holds one base plan per `upgradeFamily`. It can be upgraded to a higher `upgradeTier` in the same family. Downgrades are not offered. |
| `addon` | Sold only to a device that has (or is buying in the same request) one of the base packages in `requiresOneOf`. |
| `standalone` | Can always be sold. |

This list is your catalogue. What a **particular** customer can buy right now, and at what
price, comes from `POST /customers/offers`.

### POST /customers/search

Body: `serviceType` (required) and exactly one of `serviceCode` or `phone`.

```json
{ "serviceType": "OTT", "serviceCode": "483920" }
```

```json
{ "serviceType": "OTT", "phone": "7771234" }
```

Response:

```json
{
  "success": true,
  "data": {
    "customers": [
      {
        "customerId": "2b1f6c0a-5a0e-4f0b-9a57-0d7c0a1e3f11",
        "deviceId": "8a4d2f10-0c1b-4c1e-8f55-6d2a9be01c42",
        "serviceCode": "483920",
        "customerCode": "C000123",
        "name": "Aishath Ali",
        "phone": "7771234",
        "serviceType": "OTT",
        "deviceCount": 1,
        "balance": { "balance": -50, "credit": 50, "due": 0, "currency": "MVR", "accountState": "ACTIVE" },
        "subscriptions": [ ],
        "offers": [ ]
      }
    ]
  }
}
```

- An empty `customers` array means no customer of that type matches.
- `balance`, `subscriptions` and `offers` have the same shape as the dedicated endpoints below.
  Each is `null` if that part could not be read from the billing system; nothing can be sold
  to a device while `subscriptions` is `null`.

### POST /customers/balance

Body: `customerId`, `serviceType` and `serviceCode` or `phone`.

```json
{ "customerId": "2b1f6c0a-5a0e-4f0b-9a57-0d7c0a1e3f11", "serviceType": "OTT", "serviceCode": "483920" }
```

Response:

```json
{
  "success": true,
  "data": {
    "customerId": "2b1f6c0a-5a0e-4f0b-9a57-0d7c0a1e3f11",
    "name": "Aishath Ali",
    "balance": -50, "credit": 50, "due": 0, "currency": "MVR", "accountState": "ACTIVE"
  }
}
```

`balance` is the customer's running account balance: **negative means the customer has
credit, positive means they owe money**. `credit` and `due` are the same number split into two
non-negative fields for convenience. The balance belongs to the customer, not to a device.

### POST /customers/subscriptions

Body: `customerId`, `serviceType`, `serviceCode` or `phone`, and `deviceId` when the customer
has several devices and you searched by phone.

```json
{ "customerId": "2b1f6c0a-5a0e-4f0b-9a57-0d7c0a1e3f11", "serviceType": "OTT", "serviceCode": "483920" }
```

Response:

```json
{
  "success": true,
  "data": {
    "customerId": "2b1f6c0a-5a0e-4f0b-9a57-0d7c0a1e3f11",
    "deviceId": "8a4d2f10-0c1b-4c1e-8f55-6d2a9be01c42",
    "serviceCode": "483920",
    "subscriptions": [
      {
        "serviceId": "f3c1…", "name": "FAMILY", "sku": "OTT-FAM", "state": "EFFECTIVE",
        "price": 200, "currency": "MVR",
        "billingPeriod": { "duration": 1, "unit": "MONTH" },
        "autoRenew": false, "inTrial": false,
        "activatedOn": "2026-07-02T08:15:00.000Z",
        "dueDate": "2026-11-02T00:00:00.000Z"
      }
    ]
  }
}
```

`state` is one of `EFFECTIVE` (active), `NOT_EFFECTIVE` (not active, for example unpaid),
`PAUSED`, `PENDING_VERIFICATION`. `dueDate` is the date the customer is paid up to.

### POST /customers/offers

Same body as subscriptions. Returns every package you may sell for that type, with what it
would be for this device.

```json
{
  "success": true,
  "data": {
    "customerId": "2b1f6c0a-…", "deviceId": "8a4d2f10-…", "serviceCode": "483920",
    "offers": [
      { "packageId": 4, "name": "FAMILY", "role": "base", "action": "renew", "available": true,
        "reason": null, "price": 200, "listPrice": 200, "currency": "MVR",
        "upgrade": null, "requiresOneOf": [] },
      { "packageId": 5, "name": "WANTITALL", "role": "base", "action": "upgrade", "available": true,
        "reason": null, "price": 96.4, "listPrice": 300, "currency": "MVR",
        "upgrade": { "mode": "change", "replaces": { "packageId": 4, "name": "FAMILY" },
                     "credit": 187.2, "cancelsAddons": [ { "packageId": 9, "name": "SPORTS" } ] },
        "requiresOneOf": [] },
      { "packageId": 3, "name": "BASIC", "role": "base", "action": null, "available": false,
        "reason": "Not an upgrade from FAMILY", "price": null, "listPrice": 100, "currency": "MVR",
        "upgrade": null, "requiresOneOf": [] }
    ]
  }
}
```

| Field | Meaning |
|---|---|
| `action` | `subscribe` (new), `renew` (they already have it), `upgrade`, or `null` when it cannot be sold. It tells you which purchase endpoint to use. |
| `available` | Whether it can be sold now. When `false`, `reason` says why. |
| `price` | What your wallet is charged if you buy it now. |
| `listPrice` | The package's normal price. |
| `upgrade.mode` | `change`: switched in place; the due date stays the same and `price` is the new package for the remaining days less `credit` for the unused days of the old one. `replace`: the billing system cannot switch it in place, so the old package is cancelled and the new one starts as a new subscription at `listPrice`. |
| `upgrade.cancelsAddons` | Add-ons the device has that are not valid with the new package. They are cancelled as part of the upgrade. |
| `requiresOneOf` | For an unavailable add-on: base packages that make it available when bought in the same `subscribe` request. |

Upgrade prices depend on the days left in the term, so they can change from one day to the
next. Fetch offers shortly before you sell.

### POST /customers/topup

Adds credit to the customer's account. Your wallet is charged the same amount.
Requires `Idempotency-Key`.

```json
{ "customerId": "2b1f6c0a-5a0e-4f0b-9a57-0d7c0a1e3f11", "serviceType": "OTT", "serviceCode": "483920", "amount": 100 }
```

Response `201`:

```json
{
  "success": true,
  "data": {
    "reference": "DBT-MB2K9Q1A-4F0C9A12",
    "status": "completed",
    "customerId": "2b1f6c0a-…",
    "name": "Aishath Ali",
    "amount": 100,
    "currency": "MVR",
    "wallet": { "balanceBefore": 15250.5, "balanceAfter": 15150.5 }
  }
}
```

A top-up adds credit only. It does not start, renew or change any package.

### POST /customers/subscribe

Sells one or more **new** packages to a device. Requires `Idempotency-Key`.

```json
{ "customerId": "2b1f6c0a-5a0e-4f0b-9a57-0d7c0a1e3f11", "serviceType": "OTT", "serviceCode": "483920", "packageIds": [4, 9], "amount": 250 }
```

| Field | |
|---|---|
| `customerId`, `serviceType`, `serviceCode` or `phone` | Required, as everywhere. |
| `deviceId` | Required only when the customer has several devices and you used `phone`. |
| `packageIds` | 1 to 20 package ids. Each must be an offer with `action: "subscribe"`, except an add-on bought together with a base it needs. |
| `amount` | Optional. If sent, it must equal the total price or the request is refused with `AMOUNT_MISMATCH`. Send it to be sure you charge what you showed your customer. |

Response `201`:

```json
{
  "success": true,
  "data": {
    "reference": "DBT-MB2KA7TT-91C2D3E4",
    "status": "completed",
    "action": "subscribe",
    "customerId": "2b1f6c0a-…", "deviceId": "8a4d2f10-…", "serviceCode": "483920",
    "name": "Aishath Ali",
    "packages": [ { "id": 4, "name": "FAMILY" }, { "id": 9, "name": "SPORTS" } ],
    "amountCharged": 250, "listPrice": 250, "currency": "MVR",
    "usedFreeAccount": false,
    "upgrade": null,
    "wallet": { "balanceBefore": 15150.5, "balanceAfter": 14900.5 }
  }
}
```

If `usedFreeAccount` is `true`, a free-account slot paid for the sale and `amountCharged` is 0.

### POST /customers/renew

Renews one package the device already has, for another period at the package price.
Requires `Idempotency-Key`.

```json
{ "customerId": "2b1f6c0a-5a0e-4f0b-9a57-0d7c0a1e3f11", "serviceType": "OTT", "serviceCode": "483920", "packageId": 4 }
```

`amount` is optional and checked the same way as for subscribe. The response has the same
shape, with `"action": "renew"`.

### POST /customers/upgrade

Upgrades the device's base package to a higher tier. Requires `Idempotency-Key`.

```json
{ "customerId": "2b1f6c0a-5a0e-4f0b-9a57-0d7c0a1e3f11", "serviceType": "OTT", "serviceCode": "483920", "packageId": 5, "amount": 96.4 }
```

`amount` is **required** here and must equal the `price` from the offer. Because the price
moves with the days left, this protects you from charging a different amount than you quoted.
If it no longer matches you get `AMOUNT_MISMATCH` with the current price in the message; fetch
the offers again and retry (the same idempotency key is fine).

Response `201` has the same shape, with:

```json
"action": "upgrade",
"amountCharged": 96.4,
"listPrice": 300,
"upgrade": { "mode": "change", "replaced": "FAMILY", "credit": 187.2, "cancelledAddons": ["SPORTS"] }
```

**One kind of purchase per request.** If you call an endpoint that does not match what the
purchase is for that device (for example `/customers/upgrade` for a package the customer already has),
nothing is charged and you get `409 ACTION_MISMATCH`. Use the `action` from the offers.

### POST /transactions/list

Body, all optional: `page` (default 1), `limit` (default 20, max 100), `startDate`, `endDate`
(`YYYY-MM-DD`), `type` (`debit`, `refund`, `topup`, `adjustment`). Send `{}` for the latest 20.

```json
{ "startDate": "2026-10-05", "endDate": "2026-10-05", "limit": 100 }
```

Response:

```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "reference": "DBT-MB2KA7TT-91C2D3E4", "type": "debit", "activity": "customer_subscribe",
        "status": "completed", "crmState": "completed",
        "amount": 250, "currency": "MVR", "balanceBefore": 15150.5, "balanceAfter": 14900.5,
        "description": "Customer subscribe — FAMILY, SPORTS for Aishath Ali (7771234)",
        "customerId": "2b1f6c0a-…", "customerName": "Aishath Ali", "phone": "7771234",
        "serviceCode": "483920", "serviceType": "OTT",
        "packageIds": [4, 9], "packageNames": ["FAMILY", "SPORTS"],
        "channel": "api", "idempotencyKey": "0b6f1c1e-7d0a-4a55-9a0e-2f5f7b1d9c11",
        "createdAt": "2026-10-05T09:12:44.000Z", "completedAt": "2026-10-05T09:12:44.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 134, "totalPages": 7 }
  }
}
```

The list covers the whole operator wallet, including sales made in the portal
(`"channel": "portal"`) and wallet top-ups.

| `activity` | |
|---|---|
| `customer_crm_topup` | Customer top-up |
| `customer_subscribe` | New subscription |
| `customer_renew` | Renewal |
| `customer_upgrade` | Upgrade |
| `create_account`, `bulk_create` | New customer accounts created in the portal |

| `crmState` | |
|---|---|
| `completed` | Done on the customer's side. |
| `pending` | In progress. |
| `needs_reconciliation` | Charged, customer side unconfirmed. Medianet is reviewing it. |
| `refunded` | The sale did not go through and the charge was returned (a matching `refund` transaction exists). |

A sale paid by a free-account slot does not touch the wallet, so it has no transaction; its
`reference` starts with `TRL-`.

### GET /transactions/{reference}

One transaction in the shape above. `404` if it is not yours.

### GET /requests/{idempotencyKey}

What happened to a money request you sent.

```json
{
  "success": true,
  "data": {
    "idempotencyKey": "0b6f1c1e-7d0a-4a55-9a0e-2f5f7b1d9c11",
    "endpoint": "subscribe",
    "state": "completed",
    "httpStatus": 201,
    "response": { "success": true, "data": { "reference": "DBT-MB2KA7TT-91C2D3E4" } },
    "createdAt": "2026-10-05T09:12:41.000Z",
    "completedAt": "2026-10-05T09:12:44.000Z"
  }
}
```

- `state: "processing"`: still running. Ask again shortly.
- `404`: no such request is recorded. Either it never reached the API, or it ended with nothing
  charged. You can send it again.

## Errors

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | A field is missing, malformed, or not one this endpoint accepts. See `errors`. |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | A money request without the header. |
| 400 | `DEVICE_REQUIRED` | The customer has several devices; send `deviceId`. |
| 400 | `PACKAGE_NOT_ELIGIBLE` | The package cannot be sold to this device. The message says why. |
| 400 | `PACKAGE_NOT_ALLOWED`, `PACKAGE_NOT_ASSIGNED` | The package is not one of yours. |
| 400 | `AMOUNT_MISMATCH` | `amount` differs from the current price. |
| 401 | `UNAUTHORIZED` | Missing, wrong or revoked API key. |
| 403 | `OPERATOR_INACTIVE` | The operator account is disabled. |
| 403 | `API_ACCESS_DISABLED` | Medianet has turned API access off for the operator. |
| 403 | `SERVICE_NOT_ALLOWED` | That customer type is not enabled for you. |
| 403 | `INSUFFICIENT_WALLET_BALANCE` | Your wallet cannot cover the charge. |
| 404 | `CUSTOMER_NOT_FOUND`, `DEVICE_NOT_FOUND`, `NOT_FOUND` | No such customer, device, transaction or request for you. |
| 409 | `ACTION_MISMATCH` | Wrong endpoint for this purchase (see offers `action`). |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | The same request is still running. |
| 422 | `IDEMPOTENCY_KEY_REUSED` | The key was used for a different request. |
| 429 | `RATE_LIMIT` | Slow down and retry after a short wait. |
| 503 | `CRM_BUSY` | Too many of your requests are being processed at once. Nothing was charged. Retry shortly. |
| 502 | `CRM_ERROR` | The billing system could not be read. Nothing was charged. Retry. |
| 502 | `CRM_PAYMENT_REJECTED`, `CRM_PROVISION_FAILED` | The billing system refused the sale. Your wallet was refunded. |
| 502 | `CRM_RECONCILIATION_REQUIRED` | **You were charged**; the customer side is unconfirmed. Do not repeat the sale. |
| 500 | `INTERNAL_ERROR` | Unexpected. For money requests check `GET /requests/{key}` before retrying. |

## Rate limits

Limits are per API key, per minute:

| Requests | Limit |
|---|---|
| `/account`, `/wallet`, `/packages/list`, `/transactions/…`, `/requests/…` | 300 |
| `/customers` lookups (search, balance, subscriptions, offers) | 120 |
| Money requests (top-up, subscribe, renew, upgrade) | 60 |

A `429` response carries the standard `RateLimit-*` headers. Customer lookups are the
expensive ones: each reads live data from the billing system and typically takes one to three
seconds. `POST /customers/search` already returns balance, subscriptions and offers, so one search is
usually all you need before a sale.

Requests for one operator are processed a few at a time; under a burst you may see
`503 CRM_BUSY`. Nothing was charged; retry with the same idempotency key.

## Typical flows

**Top up a customer**

1. `POST /customers/search` with the service code → take `customerId`, show `name` and
   `balance` to confirm.
2. `POST /customers/topup` with a new `Idempotency-Key`.
3. On a timeout, repeat step 2 with the same key.

**Renew, upgrade or add a package**

1. `POST /customers/search` → take `customerId`, `deviceId` and `offers`.
2. Show the offers where `available` is `true`, with `price`.
3. Call the endpoint matching the chosen offer's `action`:
   `subscribe` → `/customers/subscribe`, `renew` → `/customers/renew`,
   `upgrade` → `/customers/upgrade`, sending the offer `price` as `amount`.
4. On `AMOUNT_MISMATCH`, fetch the offers again and confirm the new price.

**Reconcile at end of day**

`POST /transactions/list` with `startDate` and `endDate`, and match on `idempotencyKey`.
Anything with `crmState: "needs_reconciliation"` is with Medianet for review.

**Example (curl)**

```bash
BASE=https://<portal-host>/api/v1
KEY=mtvop_1a2b3c4d_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

curl -s -X POST "$BASE/customers/search" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"serviceType":"OTT","serviceCode":"483920"}'

curl -s -X POST "$BASE/customers/topup" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"customerId":"2b1f6c0a-5a0e-4f0b-9a57-0d7c0a1e3f11","serviceType":"OTT","serviceCode":"483920","amount":100}'
```
