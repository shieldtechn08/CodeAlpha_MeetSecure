require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const fileRoutes = require('./routes/files');
const { initSignaling } = require('./sockets/signaling');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // à restreindre à votre domaine en production
});

const PORT = process.env.PORT || 3000;

app.set('io', io);

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/rooms', fileRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route API introuvable.' });
});

initSignaling(io);

server.listen(PORT, () => {
  console.log(`MeetSecure démarré : http://localhost:${PORT}`);
});
