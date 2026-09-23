const API_BASE = '/api';

let accessToken = null;
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.success) {
          clearAccessToken();
          throw new Error(data.message || 'Session expired');
        }
        setAccessToken(data.data.accessToken);
        return data.data.accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && accessToken && !options.skipRefresh) {
    try {
      await refreshAccessToken();
      headers.Authorization = `Bearer ${accessToken}`;
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        credentials: 'include',
      });
    } catch {
      throw new Error('Session expired. Please log in again.');
    }
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.success) {
    const error = new Error(data.message || 'Request failed');
    error.code = data.code;
    error.status = response.status;
    error.errors = data.errors;
    throw error;
  }

  return data.data;
}

function buildQuery(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== '')
  ).toString();
  return qs ? `?${qs}` : '';
}

export const authApi = {
  login: (payload) =>
    apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipRefresh: true,
    }),
  logout: () =>
    apiRequest('/auth/logout', { method: 'POST', skipRefresh: true }),
  me: () => apiRequest('/auth/me'),
};

export const adminApi = {
  getStats: () => apiRequest('/admin/stats'),
  getAdmins: (params = {}) => apiRequest(`/admin/admins${buildQuery(params)}`),
  createAdmin: (payload) =>
    apiRequest('/admin/admins', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAdminStatus: (id, isActive) =>
    apiRequest(`/admin/admins/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
  getOperators: (params = {}) => apiRequest(`/admin/operators${buildQuery(params)}`),
  getPackages: () => apiRequest('/admin/packages/active').then((data) => data.packages),
  getPackagesList: (params = {}) => apiRequest(`/admin/packages${buildQuery(params)}`),
  getCrmRecommendations: (serviceTag = 'OTT') =>
    apiRequest(`/admin/packages/crm-recommendations${buildQuery({ serviceTag })}`).then(
      (data) => data.recommendations
    ),
  createPackage: (payload) =>
    apiRequest('/admin/packages', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePackageStatus: (id, isActive) =>
    apiRequest(`/admin/packages/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
  createOperator: (payload) =>
    apiRequest('/admin/operators', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateOperatorStatus: (id, isActive) =>
    apiRequest(`/admin/operators/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
  updateOperatorQuota: (id, accountQuota) =>
    apiRequest(`/admin/operators/${id}/quota`, {
      method: 'PATCH',
      body: JSON.stringify({ accountQuota }),
    }),
  getOperatorWallet: (id) => apiRequest(`/admin/operators/${id}/wallet`),
  adjustOperatorWallet: (id, payload) =>
    apiRequest(`/admin/operators/${id}/wallet/adjust`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  topupOperator: (id, payload) =>
    apiRequest(`/admin/operators/${id}/wallet/topup`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getOperatorActivations: (params = {}) =>
    apiRequest(`/admin/operator-activations${buildQuery(params)}`),
  exportOperatorActivations: async (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(
      `${API_BASE}/admin/operator-activations/export${qs ? `?${qs}` : ''}`,
      { credentials: 'include', headers }
    );
    if (!res.ok) throw new Error('Export failed');
    return res.text();
  },
  completeOperatorTopup: (operatorId, transactionId, paymentRef) =>
    apiRequest(`/admin/operators/${operatorId}/wallet/topups/${transactionId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ paymentRef }),
    }),
  updateOperator: (id, payload) =>
    apiRequest(`/admin/operators/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  generateReport: (params) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    return apiRequest(`/admin/reports?${qs}`);
  },
  getMarketingAds: () => apiRequest('/admin/marketing-ads').then((data) => data.ads),
  createMarketingAd: async (formData) => {
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${API_BASE}/admin/marketing-ads`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to create ad');
    }
    return data.data;
  },
  updateMarketingAd: async (id, formData) => {
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${API_BASE}/admin/marketing-ads/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to update ad');
    }
    return data.data;
  },
  deleteMarketingAd: (id) =>
    apiRequest(`/admin/marketing-ads/${id}`, { method: 'DELETE' }),
  getKnowledgeDocuments: () =>
    apiRequest('/admin/knowledge-documents').then((data) => data.documents),
  createKnowledgeDocument: async (formData) => {
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${API_BASE}/admin/knowledge-documents`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to upload document');
    }
    return data.data;
  },
  updateKnowledgeDocument: async (id, formData) => {
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${API_BASE}/admin/knowledge-documents/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to update document');
    }
    return data.data;
  },
  deleteKnowledgeDocument: (id) =>
    apiRequest(`/admin/knowledge-documents/${id}`, { method: 'DELETE' }),
  exportReport: async (params) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${API_BASE}/admin/reports/export?${qs}`, {
      credentials: 'include',
      headers,
    });
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },
};

export const operatorApi = {
  getStats: () => apiRequest('/operator/stats'),
  getMarketingAds: () => apiRequest('/operator/marketing-ads').then((data) => data.ads),
  getKnowledgeDocuments: () =>
    apiRequest('/operator/knowledge-documents').then((data) => data.documents),
  downloadKnowledgeDocument: async (id, filename) => {
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${API_BASE}/operator/knowledge-documents/${id}/download`, {
      credentials: 'include',
      headers,
    });
    if (!res.ok) {
      let message = 'Download failed';
      try {
        const data = await res.json();
        message = data.message || message;
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'document';
    a.click();
    URL.revokeObjectURL(url);
  },
  getWallet: () => apiRequest('/operator/wallet'),
  getWalletTransactions: (params = {}) => apiRequest(`/operator/wallet/transactions${buildQuery(params)}`),
  previewWalletTopup: (amount) =>
    apiRequest('/operator/wallet/topup/preview', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  getPendingWalletTopup: () => apiRequest('/operator/wallet/topup/pending'),
  initiateWalletTopup: (amount) =>
    apiRequest('/operator/wallet/topup', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  getWalletTopupStatus: (reference, transactionId) =>
    apiRequest(
      `/operator/wallet/topup/status${buildQuery({ reference, transactionId })}`
    ),
  getWalletTopupBill: (reference) =>
    apiRequest(`/operator/wallet/topup/bill${buildQuery({ reference })}`),
  searchCustomers: (phone, serviceTag) =>
    apiRequest(`/operator/customers/search${buildQuery({ phone, serviceTag })}`),
  crmTopupCustomer: (payload) =>
    apiRequest('/operator/customers/crm-topup', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  subscribeCustomer: (payload) =>
    apiRequest('/operator/customers/subscribe', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateTransactionReport: (params) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    return apiRequest(`/operator/wallet/transactions/report?${qs}`);
  },
  exportTransactionReport: async (params) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${API_BASE}/operator/wallet/transactions/export?${qs}`, {
      credentials: 'include',
      headers,
    });
    if (!res.ok) throw new Error('Export failed');
    return res.text();
  },
  getAccounts: (params = {}) => apiRequest(`/operator/accounts${buildQuery(params)}`),
  exportAccounts: async (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${API_BASE}/operator/accounts/export${qs ? `?${qs}` : ''}`, {
      credentials: 'include',
      headers,
    });
    if (!res.ok) throw new Error('Export failed');
    return res.text();
  },
  createAccount: (payload) =>
    apiRequest('/operator/accounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createBulkAccounts: (accounts, packageIds) =>
    apiRequest('/operator/accounts/bulk', {
      method: 'POST',
      body: JSON.stringify({ accounts, packageIds }),
    }),
  generateReport: (params) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    return apiRequest(`/operator/reports?${qs}`);
  },
  exportReport: async (params) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${API_BASE}/operator/reports/export?${qs}`, {
      credentials: 'include',
      headers,
    });
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },
};
