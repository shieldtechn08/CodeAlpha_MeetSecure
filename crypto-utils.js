const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';

// Clé 32 octets : depuis FILE_ENCRYPTION_KEY (hex) si fournie, sinon dérivée de JWT_SECRET (dépannage seulement)
function getEncryptionKey() {
  const raw = process.env.FILE_ENCRYPTION_KEY;
  if (raw && raw.length === 64) {
    return Buffer.from(raw, 'hex');
  }
  return crypto.createHash('sha256').update(JWT_SECRET).digest();
}

const KEY = getEncryptionKey();

// Chiffre un buffer, retourne { encrypted, iv, authTag } (iv et authTag en hexadécimal)
function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(12); // taille recommandée pour AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encrypted, iv: iv.toString('hex'), authTag: authTag.toString('hex') };
}

// Déchiffre un buffer chiffré avec encryptBuffer
function decryptBuffer(encryptedBuffer, ivHex, authTagHex) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
}

module.exports = { encryptBuffer, decryptBuffer };
