function renderHeader() {
  const headerEl = document.getElementById('site-header');
  if (!headerEl) return;

  const user = getCurrentUser();

  headerEl.innerHTML = `
    <a class="logo" href="index.html">MeetSecure</a>
    <nav id="nav-area"></nav>
  `;

  const navArea = document.getElementById('nav-area');
  if (user) {
    navArea.innerHTML = `
      <span> ${escapeHtml(user.name)}</span>
      <a href="#" id="logout-link">Déconnexion</a>
    `;
    document.getElementById('logout-link').addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  } else {
    navArea.innerHTML = `
      <a href="login.html">Connexion</a>
      <a href="register.html">Inscription</a>
    `;
  }
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('user'));
  } catch (e) {
    return null;
  }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = 'index.html';
}

function requireLogin(redirectMsg) {
  const user = getCurrentUser();
  if (!user) {
    if (redirectMsg) sessionStorage.setItem('login-message', redirectMsg);
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

document.addEventListener('DOMContentLoaded', () => renderHeader());
