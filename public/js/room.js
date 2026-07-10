/* ============================================================
   room.js — Logique de la salle de visioconférence
   - Appel vidéo multi-utilisateurs en mesh WebRTC (P2P)
   - Signalisation via Socket.io
   - Partage d'écran (remplacement de piste vidéo)
   - Partage de fichiers (upload HTTP + notification temps réel)
   - Tableau blanc collaboratif (canvas synchronisé)
   ============================================================ */

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let socket = null;
let localStream = null;
let cameraTrack = null;
let screenStream = null;
let isScreenSharing = false;
let micOn = true;
let camOn = true;

const peers = {};          // socketId -> RTCPeerConnection
const participants = {};   // socketId -> { name, micOn, camOn }
let roomId = null;
let currentUser = null;

/* ---------------------- Initialisation ---------------------- */

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireLogin("Connectez-vous pour rejoindre une salle.")) return;

  currentUser = getCurrentUser();
  const params = new URLSearchParams(window.location.search);
  roomId = params.get('room');

  if (!roomId) {
    window.location.href = 'index.html';
    return;
  }

  document.getElementById('room-id-label').textContent = roomId;
  setupControlBar();
  setupPanelTabs();
  setupFileSharing();
  setupWhiteboard();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    cameraTrack = localStream.getVideoTracks()[0];
  } catch (err) {
    alert("Impossible d'accéder à la caméra/micro : " + err.message + "\nVous pouvez tout de même rejoindre en audio/vidéo désactivés si le navigateur le permet.");
    localStream = new MediaStream();
  }

  renderLocalTile();
  connectSocket();
});

/* ---------------------- Connexion Socket.io ---------------------- */

function connectSocket() {
  const token = localStorage.getItem('token');
  socket = io({ auth: { token } });

  socket.on('connect_error', (err) => {
    console.error('Erreur de connexion socket:', err.message);
  });

  socket.on('room-users', (users) => {
    // Liste des participants déjà présents : on initie une offre vers chacun
    users.forEach(u => {
      participants[u.socketId] = { name: u.name, micOn: true, camOn: true };
      renderParticipants();
      createPeerConnection(u.socketId, true);
    });
  });

  socket.on('user-joined', (u) => {
    participants[u.socketId] = { name: u.name, micOn: true, camOn: true };
    renderParticipants();
    addSystemFileNotice(`${u.name} a rejoint la salle.`);
  });

  socket.on('user-left', (u) => {
    closePeerConnection(u.socketId);
    delete participants[u.socketId];
    renderParticipants();
    addSystemFileNotice(`${u.name} a quitté la salle.`);
  });

  socket.on('signal', async ({ from, description, candidate }) => {
    let pc = peers[from];
    if (!pc) pc = createPeerConnection(from, false);

    if (description) {
      await pc.setRemoteDescription(new RTCSessionDescription(description));
      if (description.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { to: from, description: pc.localDescription });
      }
    } else if (candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { /* ignorer */ }
    }
  });

  socket.on('media-state', ({ from, micOn: mOn, camOn: cOn }) => {
    if (participants[from]) {
      participants[from].micOn = mOn;
      participants[from].camOn = cOn;
      renderParticipants();
      updateTileMicIcon(from, mOn);
    }
  });

  socket.on('file-shared', (file) => {
    addFileToList(file);
    addSystemFileNotice(`${file.uploadedBy} a partagé "${file.originalName}".`);
  });

  socket.on('whiteboard-init', (strokes) => {
    strokes.forEach(s => drawStroke(s, false));
  });

  socket.on('whiteboard-stroke', (stroke) => {
    drawStroke(stroke, false);
  });

  socket.on('whiteboard-clear', () => {
    clearCanvas(false);
  });

  socket.emit('join-room', { roomId, name: currentUser.name });
  socket.emit('request-files', { roomId });
}

/* ---------------------- WebRTC : Peer connections ---------------------- */

function createPeerConnection(peerId, initiator) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  peers[peerId] = pc;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('signal', { to: peerId, candidate: e.candidate });
    }
  };

  pc.ontrack = (e) => {
    renderRemoteTile(peerId, e.streams[0]);
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      // La déconnexion propre est gérée via l'event 'user-left'
    }
  };

  if (initiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('signal', { to: peerId, description: pc.localDescription });
      } catch (err) { console.error(err); }
    };
  }

  return pc;
}

function closePeerConnection(peerId) {
  const pc = peers[peerId];
  if (pc) {
    pc.close();
    delete peers[peerId];
  }
  const tile = document.getElementById(`tile-${peerId}`);
  if (tile) tile.remove();
}

/* ---------------------- Rendu des tuiles vidéo ---------------------- */

function renderLocalTile() {
  const grid = document.getElementById('video-grid');
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = 'tile-local';
  tile.innerHTML = `
    <video id="local-video" autoplay playsinline muted></video>
    <span class="tile-label">${escapeHtml(currentUser.name)} (vous) <span id="local-mic-icon"></span></span>
  `;
  grid.appendChild(tile);
  document.getElementById('local-video').srcObject = localStream;
}

function renderRemoteTile(peerId, stream) {
  let tile = document.getElementById(`tile-${peerId}`);
  const name = participants[peerId]?.name || 'Participant';
  if (!tile) {
    const grid = document.getElementById('video-grid');
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = `tile-${peerId}`;
    tile.innerHTML = `
      <video autoplay playsinline></video>
      <span class="tile-label">${escapeHtml(name)} <span class="tile-mic-icon" id="mic-icon-${peerId}"></span></span>
    `;
    grid.appendChild(tile);
  }
  tile.querySelector('video').srcObject = stream;
}

function updateTileMicIcon(peerId, mOn) {
  const icon = document.getElementById(`mic-icon-${peerId}`);
  if (icon) icon.innerHTML = mOn ? '' : '<span class="mic-off-icon">🔇</span>';
}

/* ---------------------- Barre de contrôle ---------------------- */

function setupControlBar() {
  document.getElementById('toggle-mic').addEventListener('click', toggleMic);
  document.getElementById('toggle-cam').addEventListener('click', toggleCam);
  document.getElementById('toggle-screen').addEventListener('click', toggleScreenShare);
  document.getElementById('leave-btn').addEventListener('click', leaveRoom);
}

function toggleMic() {
  micOn = !micOn;

  localStream.getAudioTracks().forEach(t => t.enabled = micOn);

  const btn = document.getElementById('toggle-mic');
  const icon = btn.querySelector("i");

  icon.classList.toggle("fa-microphone", micOn);
  icon.classList.toggle("fa-microphone-slash", !micOn);

  btn.classList.toggle("off", !micOn);

  document.getElementById("local-mic-icon").innerHTML =
      micOn ? "" : '<span class="mic-off-icon">🔇</span>';

  socket?.emit("media-state", { roomId, micOn, camOn });
}

function toggleCam() {
  camOn = !camOn;

  localStream.getVideoTracks().forEach(t => t.enabled = camOn);

  const btn = document.getElementById('toggle-cam');
  const icon = btn.querySelector("i");

  icon.classList.toggle("fa-video", camOn);
  icon.classList.toggle("fa-video-slash", !camOn);

  btn.classList.toggle("off", !camOn);

  socket?.emit("media-state", { roomId, micOn, camOn });
}

async function toggleScreenShare() {
  const btn = document.getElementById('toggle-screen');
  if (!isScreenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch (err) {
      return; // annulé par l'utilisateur
    }
    const screenTrack = screenStream.getVideoTracks()[0];
    await replaceOutgoingVideoTrack(screenTrack);
    document.getElementById('local-video').srcObject = screenStream;
    document.getElementById('tile-local').classList.add('screen-share');
    isScreenSharing = true;
    btn.classList.add('active-share');

    screenTrack.onended = () => stopScreenShare();
  } else {
    stopScreenShare();
  }
}

async function stopScreenShare() {
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  await replaceOutgoingVideoTrack(cameraTrack);
  document.getElementById('local-video').srcObject = localStream;
  document.getElementById('tile-local').classList.remove('screen-share');
  isScreenSharing = false;
  document.getElementById('toggle-screen').classList.remove('active-share');
}

async function replaceOutgoingVideoTrack(newTrack) {
  for (const pc of Object.values(peers)) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) await sender.replaceTrack(newTrack);
  }
}

function leaveRoom() {
  Object.keys(peers).forEach(closePeerConnection);
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  socket?.disconnect();
  window.location.href = 'index.html';
}

/* ---------------------- Panneau latéral (onglets) ---------------------- */

function setupPanelTabs() {
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.panel}`).classList.add('active');
    });
  });

  document.getElementById('toggle-panel-btn').addEventListener('click', () => {
    document.getElementById('side-panel').classList.toggle('collapsed');
  });
}

function renderParticipants() {
  const list = document.getElementById('participants-list');
  const entries = Object.entries(participants);
  if (entries.length === 0) {
    list.innerHTML = '<p class="empty-state">Vous êtes seul(e) pour le moment. Partagez le code de la salle !</p>';
    return;
  }
  list.innerHTML = entries.map(([id, p]) => `
    <div class="participant-row">
      <span class="avatar">${initials(p.name)}</span>
      <span>${escapeHtml(p.name)}</span>
      ${p.micOn === false ? '<span class="mic-off-icon">🔇</span>' : ''}
    </div>
  `).join('');
}

/* ---------------------- Partage de fichiers ---------------------- */

function setupFileSharing() {
  const dropZone = document.getElementById('file-drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) uploadFile(fileInput.files[0]);
    fileInput.value = '';
  });

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; });
  dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '';
    if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
  });
}

async function uploadFile(file) {
  if (file.size > 20 * 1024 * 1024) {
    alert('Fichier trop volumineux (20 Mo max).');
    return;
  }
  const formData = new FormData();
  formData.append('file', file);
  try {
    await apiRequest(`/rooms/${encodeURIComponent(roomId)}/files`, {
      method: 'POST',
      body: formData,
      auth: true,
      isFormData: true
    });
    // La confirmation d'ajout arrive via l'event socket 'file-shared'
  } catch (err) {
    alert("Échec de l'envoi : " + err.message);
  }
}

function addFileToList(file) {
  const list = document.getElementById('files-list');
  const emptyState = list.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const row = document.createElement('a');
  row.href = `/api/rooms/${encodeURIComponent(roomId)}/files/${file.id}?token=${encodeURIComponent(localStorage.getItem('token') || '')}`;
  row.className = 'file-row';
  row.download = file.originalName;
  row.innerHTML = `
    <span class="file-icon">📄</span>
    <span class="file-meta">
      <span class="file-name">${escapeHtml(file.originalName)}</span>
      <span class="file-size">${formatBytes(file.size)} · par ${escapeHtml(file.uploadedBy)}</span>
    </span>
  `;
  list.appendChild(row);
}

function addSystemFileNotice(text) {
  const list = document.getElementById('files-list');
  const emptyState = list.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  const notice = document.createElement('p');
  notice.className = 'empty-state';
  notice.style.padding = '4px 0';
  notice.textContent = text;
  list.appendChild(notice);
  list.scrollTop = list.scrollHeight;
}

/* ---------------------- Tableau blanc ---------------------- */

let wbCanvas, wbCtx, wbDrawing = false, wbLast = null;
let wbColor = '#1a1d29';
let wbWidth = 3;

function setupWhiteboard() {
  wbCanvas = document.getElementById('whiteboard-canvas');
  wbCtx = wbCanvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  document.getElementById('wb-color').addEventListener('input', (e) => wbColor = e.target.value);
  document.getElementById('wb-width').addEventListener('input', (e) => wbWidth = Number(e.target.value));
  document.getElementById('wb-clear').addEventListener('click', () => clearCanvas(true));

  wbCanvas.addEventListener('pointerdown', (e) => {
    wbDrawing = true;
    wbLast = getCanvasPoint(e);
  });
  wbCanvas.addEventListener('pointermove', (e) => {
    if (!wbDrawing) return;
    const point = getCanvasPoint(e);
    const stroke = { x0: wbLast.x, y0: wbLast.y, x1: point.x, y1: point.y, color: wbColor, width: wbWidth };
    drawStroke(stroke, true);
    wbLast = point;
  });
  ['pointerup', 'pointerleave'].forEach(evt =>
    wbCanvas.addEventListener(evt, () => { wbDrawing = false; })
  );
}

function resizeCanvas() {
  const rect = wbCanvas.parentElement.getBoundingClientRect();
  wbCanvas.width = rect.width;
  wbCanvas.height = Math.max(320, rect.height);
}

// Coordonnées normalisées (0..1) pour rester cohérentes entre écrans de tailles différentes
function getCanvasPoint(e) {
  const rect = wbCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height
  };
}

function drawStroke(stroke, emit) {
  wbCtx.strokeStyle = stroke.color;
  wbCtx.lineWidth = stroke.width;
  wbCtx.lineCap = 'round';
  wbCtx.beginPath();
  wbCtx.moveTo(stroke.x0 * wbCanvas.width, stroke.y0 * wbCanvas.height);
  wbCtx.lineTo(stroke.x1 * wbCanvas.width, stroke.y1 * wbCanvas.height);
  wbCtx.stroke();

  if (emit) socket?.emit('whiteboard-stroke', { roomId, stroke });
}

function clearCanvas(emit) {
  wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
  if (emit) socket?.emit('whiteboard-clear', { roomId });
}

/* ---------------------- Nettoyage ---------------------- */

window.addEventListener('beforeunload', () => {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
});
