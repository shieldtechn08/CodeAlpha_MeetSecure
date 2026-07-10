const jwt = require('jsonwebtoken');
const { readDB } = require('../db');
const { publicFile } = require('../helpers');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';

// État en mémoire des salles actives : roomId -> { users: {socketId: {name}}, whiteboard: [strokes] }
// Volontairement non persisté : les salles sont éphémères (comme un vrai appel vidéo).
// Seuls les fichiers (chiffrés) sont conservés en base après la fin de l'appel.
const roomsState = {};

function initSignaling(io) {
  // Authentification obligatoire pour ouvrir une connexion Socket.io
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentification requise.'));
    try {
      socket.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch (err) {
      next(new Error('Token invalide ou expiré.'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, name }) => {
      if (!roomId) return;
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.name = name || socket.user.name;

      if (!roomsState[roomId]) roomsState[roomId] = { users: {}, whiteboard: [] };
      const room = roomsState[roomId];

      // Envoyer au nouvel arrivant la liste des participants déjà présents (pour qu'il initie les offres WebRTC)
      const existingUsers = Object.entries(room.users).map(([socketId, u]) => ({ socketId, name: u.name }));
      socket.emit('room-users', existingUsers);

      room.users[socket.id] = { name: socket.data.name };
      socket.to(roomId).emit('user-joined', { socketId: socket.id, name: socket.data.name });

      // Synchroniser l'état actuel du tableau blanc pour le nouvel arrivant
      socket.emit('whiteboard-init', room.whiteboard);
    });

    // Relais de signalisation WebRTC (offres/réponses SDP + candidats ICE)
    socket.on('signal', ({ to, description, candidate }) => {
      if (!to) return;
      io.to(to).emit('signal', { from: socket.id, description, candidate });
    });

    // Statut micro/caméra, à répercuter aux autres participants de la salle
    socket.on('media-state', ({ roomId, micOn, camOn }) => {
      if (!roomId) return;
      socket.to(roomId).emit('media-state', { from: socket.id, micOn, camOn });
    });

    // Tableau blanc : un trait dessiné est diffusé et mémorisé pour les futurs arrivants
    socket.on('whiteboard-stroke', ({ roomId, stroke }) => {
      const room = roomsState[roomId];
      if (!room || !stroke) return;
      room.whiteboard.push(stroke);
      if (room.whiteboard.length > 5000) room.whiteboard.shift(); // limite mémoire raisonnable
      socket.to(roomId).emit('whiteboard-stroke', stroke);
    });

    socket.on('whiteboard-clear', ({ roomId }) => {
      const room = roomsState[roomId];
      if (room) room.whiteboard = [];
      socket.to(roomId).emit('whiteboard-clear');
    });

    // Un client qui vient de rejoindre demande la liste des fichiers déjà partagés dans la salle
    socket.on('request-files', ({ roomId }) => {
      if (!roomId) return;
      const db = readDB();
      db.files
        .filter(f => f.roomId === roomId)
        .forEach(f => socket.emit('file-shared', publicFile(f)));
    });

    socket.on('disconnect', () => {
      const roomId = socket.data.roomId;
      if (roomId && roomsState[roomId]) {
        const name = roomsState[roomId].users[socket.id]?.name;
        delete roomsState[roomId].users[socket.id];
        socket.to(roomId).emit('user-left', { socketId: socket.id, name });

        if (Object.keys(roomsState[roomId].users).length === 0) {
          delete roomsState[roomId]; // nettoyage ; le tableau blanc de la salle est perdu, les fichiers restent
        }
      }
    });
  });
}

module.exports = { initSignaling };
