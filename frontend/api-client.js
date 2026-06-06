(function () {
  'use strict';

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

  function getToken() {
    return localStorage.getItem('token');
  }

  function authHeaders(extraHeaders) {
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

  function apiFetch(path, options) {
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
    requestOptions.headers = headers;
    return fetch(resolveApiUrl(path), requestOptions);
  }

  window.RouteOnApi = Object.freeze({
    base: apiBase(),
    wsBase: websocketBase(),
    getToken,
    authHeaders,
    fetch: apiFetch,
  });
})();
