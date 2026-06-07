function apiBase() {
  const host = location.hostname;
  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:8000';
  }
  if (location.port && location.port !== '80' && location.port !== '443') {
    return `${location.protocol}//${host}:8000`;
  }
  return `${location.protocol}//${location.host}/api`;
}

function websocketBase() {
  const host = location.hostname;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return `${protocol}//localhost:8000`;
  }
  if (location.port && location.port !== '80' && location.port !== '443') {
    return `${protocol}//${host}:8000`;
  }
  return `${protocol}//${location.host}`;
}

export function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token) {
  localStorage.setItem('token', token);
}

export function removeToken() {
  localStorage.removeItem('token');
}

export function authHeaders(extraHeaders) {
  const headers = new Headers(extraHeaders || {});
  const token = getToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return Object.fromEntries(headers.entries());
}

function resolveApiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`;
}

export function apiFetch(path, options) {
  const requestOptions = { ...(options || {}) };
  const useAuth = requestOptions.auth !== false;
  delete requestOptions.auth;

  const headers = new Headers(requestOptions.headers || {});
  if (useAuth) {
    const token = getToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  if (typeof requestOptions.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  requestOptions.headers = Object.fromEntries(headers.entries());
  return fetch(resolveApiUrl(path), requestOptions);
}

export async function apiGet(path, options = {}) {
  const res = await apiFetch(path, { ...options, method: 'GET' });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPost(path, body, options = {}) {
  const res = await apiFetch(path, {
    ...options,
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPatch(path, body, options = {}) {
  const res = await apiFetch(path, {
    ...options,
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiDelete(path, options = {}) {
  const res = await apiFetch(path, { ...options, method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  return res.json();
}

export const apiClient = Object.freeze({
  base: apiBase(),
  wsBase: websocketBase(),
  getToken,
  setToken,
  removeToken,
  authHeaders,
  fetch: apiFetch,
  get: apiGet,
  post: apiPost,
  patch: apiPatch,
  del: apiDelete,
});
