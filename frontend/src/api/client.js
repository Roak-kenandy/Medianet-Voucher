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

  const data = await response.json();

  if (!response.ok || !data.success) {
    const error = new Error(data.message || 'Request failed');
    error.code = data.code;
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
  getPackages: () => apiRequest('/admin/packages').then((data) => data.packages),
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
    return res.text();
  },
};

export const operatorApi = {
  getStats: () => apiRequest('/operator/stats'),
  getAccounts: (params = {}) => apiRequest(`/operator/accounts${buildQuery(params)}`),
  createAccount: (payload) =>
    apiRequest('/operator/accounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createBulkAccounts: (accounts) =>
    apiRequest('/operator/accounts/bulk', {
      method: 'POST',
      body: JSON.stringify({ accounts }),
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
    return res.text();
  },
};
