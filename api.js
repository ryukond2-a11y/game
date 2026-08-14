// api.js - shared helpers for auth storage, fetch wrapper, and socket setup.
const Api = (() => {
  const TOKEN_KEY = 'speed_token';
  const NAME_KEY = 'speed_username';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function getUsername() { return localStorage.getItem(NAME_KEY); }

  function setSession(token, username) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(NAME_KEY, username);
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NAME_KEY);
  }

  function requireAuthOrRedirect() {
    if (!getToken()) {
      window.location.href = '/index.html';
      return false;
    }
    return true;
  }

  async function request(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(path, Object.assign({}, options, { headers }));
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.message) || 'request_failed');
      err.data = data;
      throw err;
    }
    return data;
  }

  let socketInstance = null;
  function getSocket() {
    if (socketInstance) return socketInstance;
    socketInstance = io({ auth: { token: getToken() } });
    return socketInstance;
  }

  return { getToken, getUsername, setSession, clearSession, requireAuthOrRedirect, request, getSocket };
})();
