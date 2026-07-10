function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

// Version d'un fichier envoyée aux clients : jamais l'IV/authTag/storedFilename (détails internes du chiffrement)
function publicFile(file) {
  return {
    id: file.id,
    roomId: file.roomId,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    uploadedBy: file.uploadedBy,
    createdAt: file.createdAt
  };
}

module.exports = { publicUser, publicFile };
