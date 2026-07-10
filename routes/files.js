const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readDB, writeDB } = require('../db');
const { requireAuth, requireAuthFlexible } = require('../middleware/auth');
const { publicFile } = require('../helpers');
const { encryptBuffer, decryptBuffer } = require('../crypto-utils');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
const MAX_SIZE = 20 * 1024 * 1024; // 20 Mo

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SIZE } });

// POST /api/rooms/:roomId/files -- upload d'un fichier, chiffré avant écriture sur disque
router.post('/:roomId/files', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier reçu.' });
  }

  const { roomId } = req.params;
  const { encrypted, iv, authTag } = encryptBuffer(req.file.buffer);
  const storedFilename = `${crypto.randomUUID()}.enc`;

  fs.writeFileSync(path.join(UPLOAD_DIR, storedFilename), encrypted);

  const db = readDB();
  const fileRecord = {
    id: db.nextFileId++,
    roomId,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype || 'application/octet-stream',
    size: req.file.size,
    storedFilename,
    iv,
    authTag,
    uploadedBy: req.user.name,
    uploadedById: req.user.id,
    createdAt: new Date().toISOString()
  };
  db.files.push(fileRecord);
  writeDB(db);

  const publicRecord = publicFile(fileRecord);

  // Notifier tous les participants de la salle en temps réel
  const io = req.app.get('io');
  if (io) io.to(roomId).emit('file-shared', publicRecord);

  res.status(201).json({ file: publicRecord });
});

// GET /api/rooms/:roomId/files/:fileId -- téléchargement (déchiffrement à la volée)
// Accepte le token en query (?token=) car un lien <a href> ne peut pas envoyer d'en-tête Authorization.
router.get('/:roomId/files/:fileId', requireAuthFlexible, (req, res) => {
  const db = readDB();
  const file = db.files.find(
    f => f.id === Number(req.params.fileId) && f.roomId === req.params.roomId
  );
  if (!file) {
    return res.status(404).json({ error: 'Fichier introuvable.' });
  }

  const encryptedPath = path.join(UPLOAD_DIR, file.storedFilename);
  if (!fs.existsSync(encryptedPath)) {
    return res.status(404).json({ error: 'Fichier introuvable sur le serveur.' });
  }

  try {
    const encryptedBuffer = fs.readFileSync(encryptedPath);
    const decrypted = decryptBuffer(encryptedBuffer, file.iv, file.authTag);

    res.set('Content-Type', file.mimeType);
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    res.send(decrypted);
  } catch (err) {
    res.status(500).json({ error: 'Échec du déchiffrement du fichier.' });
  }
});

// GET /api/rooms/:roomId/files -- liste des fichiers d'une salle (pour un rechargement de page)
router.get('/:roomId/files', requireAuth, (req, res) => {
  const db = readDB();
  const files = db.files
    .filter(f => f.roomId === req.params.roomId)
    .map(publicFile);
  res.json({ files });
});

module.exports = router;
