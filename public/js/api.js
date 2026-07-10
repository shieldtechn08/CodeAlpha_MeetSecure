const API_BASE = '/api';

async function apiRequest(endpoint, { method = 'GET', body, auth = false, isFormData = false } = {}) {
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = localStorage.getItem('token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined)
  });

  let data = {};
  try { data = await res.json(); } catch (e) { /* réponse vide ou binaire */ }

  if (!res.ok) {
    throw new Error(data.error || 'Une erreur est survenue.');
  }
  return data;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function randomRoomCode() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let code = '';
  for (let block = 0; block < 3; block++) {
    for (let i = 0; i < 3; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (block < 2) code += '-';
  }
  return code;
}
