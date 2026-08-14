// auth.js
(() => {
  if (Api.getToken()) {
    window.location.href = '/lobby.html';
    return;
  }

  let mode = 'login'; // 'login' | 'register'

  const form = document.getElementById('auth-form');
  const submitBtn = document.getElementById('submit-btn');
  const toggleBtn = document.getElementById('toggle-mode');
  const toggleText = document.getElementById('toggle-text');
  const formSub = document.getElementById('form-sub');
  const errorBox = document.getElementById('error-box');

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add('show');
  }
  function hideError() {
    errorBox.classList.remove('show');
  }

  function applyMode() {
    hideError();
    if (mode === 'login') {
      submitBtn.textContent = 'ログイン';
      toggleText.textContent = 'アカウントがない場合は';
      toggleBtn.textContent = '新規登録';
      formSub.textContent = '友達と部屋コードでつないで、リアルタイムでスピード対決。';
      document.getElementById('password').setAttribute('autocomplete', 'current-password');
    } else {
      submitBtn.textContent = '新規登録してはじめる';
      toggleText.textContent = 'すでにアカウントがある場合は';
      toggleBtn.textContent = 'ログイン';
      formSub.textContent = 'ユーザー名とパスワードを決めて登録してください(パスワードは6文字以上)。';
      document.getElementById('password').setAttribute('autocomplete', 'new-password');
    }
  }

  toggleBtn.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    applyMode();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    submitBtn.disabled = true;
    try {
      const endpoint = mode === 'login' ? '/api/login' : '/api/register';
      const data = await Api.request(endpoint, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      Api.setSession(data.token, data.username);
      window.location.href = '/lobby.html';
    } catch (err) {
      showError((err.data && err.data.message) || '通信に失敗しました。もう一度お試しください。');
    } finally {
      submitBtn.disabled = false;
    }
  });

  applyMode();
})();
