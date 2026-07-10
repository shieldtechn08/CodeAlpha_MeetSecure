function showMsg(el, message) {
  el.textContent = message;
  el.style.display = 'block';
}
function hideMsg(el) {
  el.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  const registerForm = document.getElementById('register-form');
  const loginForm = document.getElementById('login-form');

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('form-error');
      hideMsg(errorEl);

      const name = document.getElementById('name').value.trim();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      try {
        const data = await apiRequest('/auth/register', {
          method: 'POST',
          body: { name, email, password }
        });
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        window.location.href = 'index.html';
      } catch (err) {
        showMsg(errorEl, err.message);
      }
    });
  }

  if (loginForm) {
    const msg = sessionStorage.getItem('login-message');
    if (msg) {
      showMsg(document.getElementById('form-info'), msg);
      sessionStorage.removeItem('login-message');
    }

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('form-error');
      hideMsg(errorEl);

      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      try {
        const data = await apiRequest('/auth/login', {
          method: 'POST',
          body: { email, password }
        });
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));

        const pendingRoom = sessionStorage.getItem('pending-room');
        if (pendingRoom) {
          sessionStorage.removeItem('pending-room');
          window.location.href = `room.html?room=${encodeURIComponent(pendingRoom)}`;
        } else {
          window.location.href = 'index.html';
        }
      } catch (err) {
        showMsg(errorEl, err.message);
      }
    });
  }
});
