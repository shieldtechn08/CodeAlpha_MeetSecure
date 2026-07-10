# 🔒 MeetSecure — Visioconférence &amp; collaboration (WebRTC + Socket.io + Express)

Application de visioconférence et de collaboration en temps réel : appels vidéo
multi-utilisateurs, partage d'écran, partage de fichiers chiffrés, tableau blanc
collaboratif.

## Stack technique

- **Backend** : Express.js + Socket.io (signalisation WebRTC)
- **Frontend** : HTML, CSS, JavaScript natif (aucun framework)
- **Communication temps réel** : WebRTC (flux média P2P) + Socket.io (signalisation, tableau blanc, notifications)
- **Base de données** : fichier JSON local (`data/db.json`) pour les comptes et les métadonnées de fichiers
- **Authentification** : JWT + mots de passe hashés (bcrypt)
- **Chiffrement** :
  - **En transit** : WebRTC chiffre nativement tous les flux audio/vidéo/données (DTLS-SRTP) — non désactivable, intégré au protocole
  - **Au repos** : chaque fichier partagé est chiffré avec **AES-256-GCM** avant d'être écrit sur disque, et déchiffré à la volée uniquement au moment du téléchargement par un utilisateur authentifié

## Installation

```bash
npm install
cp .env.example .env
npm start
```

Site accessible sur : http://localhost:3000

⚠️ **Important pour la production** : générez une vraie clé de chiffrement des
fichiers avant de déployer :
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
et placez le résultat dans `FILE_ENCRYPTION_KEY` du fichier `.env`. Sans cela,
une clé de dépannage est dérivée automatiquement de `JWT_SECRET` (à éviter en production).
Déployez aussi le tout derrière HTTPS/WSS (par ex. via un reverse proxy Nginx +
certificat TLS) : WebRTC exige un contexte sécurisé pour accéder à la caméra/micro
dès que l'app n'est pas servie en `localhost`.

## Structure du projet

```
meet-app/
├── server.js                 # Express + Socket.io
├── db.js                     # Accès à la base JSON
├── crypto-utils.js           # Chiffrement/déchiffrement AES-256-GCM des fichiers
├── helpers.js                # Formats publics (utilisateur / fichier)
├── data/
│   ├── db.json                # Comptes utilisateurs + métadonnées de fichiers
│   └── uploads/                # Fichiers chiffrés (illisibles sans la clé)
├── middleware/auth.js         # requireAuth (header) + requireAuthFlexible (header ou ?token=)
├── routes/
│   ├── auth.js                 # Inscription / connexion
│   └── files.js                  # Upload chiffré, téléchargement déchiffré, listing
├── sockets/signaling.js        # Signalisation WebRTC + tableau blanc (Socket.io)
└── public/                     # Frontend
    ├── index.html                # Lobby (créer/rejoindre une salle)
    ├── room.html                  # Salle : vidéo, fichiers, tableau blanc
    ├── login.html / register.html
    ├── css/style.css
    └── js/ (api.js, nav.js, auth.js, lobby.js, room.js)
```

## Fonctionnalités

- 📹 **Appels vidéo multi-utilisateurs** : topologie mesh WebRTC (une connexion
  P2P directe entre chaque paire de participants), adaptée aux petits groupes
- 🖥️ **Partage d'écran** : bascule à la volée la piste vidéo envoyée à tous les
  pairs (`RTCRtpSender.replaceTrack`), sans interrompre l'appel
- 📁 **Partage de fichiers** : upload HTTP, chiffrement AES-256-GCM avant
  écriture sur disque, notification instantanée aux participants de la salle,
  déchiffrement à la demande au téléchargement
- ✏️ **Tableau blanc collaboratif** : dessin synchronisé en temps réel,
  coordonnées normalisées (cohérentes quelle que soit la taille d'écran), état
  rejoué automatiquement pour les participants qui rejoignent en cours de séance
- 🔐 **Chiffrement** : transit (WebRTC natif) + repos (fichiers, AES-256-GCM)
- 👤 **Authentification** : JWT, mots de passe hashés, toutes les routes
  sensibles protégées

## Comment fonctionne la signalisation WebRTC (résumé)

1. Un client rejoint une salle via l'événement Socket.io `join-room`.
2. Le serveur lui renvoie la liste des participants déjà présents (`room-users`).
3. Le nouvel arrivant crée une `RTCPeerConnection` par participant existant et
   lui envoie une offre SDP (relayée par le serveur via l'événement `signal`,
   qui ne fait que transmettre les messages sans les interpréter).
4. Chaque destinataire répond avec une réponse SDP, puis les candidats ICE
   s'échangent au fur et à mesure qu'ils sont découverts.
5. Une fois la connexion établie, l'audio/vidéo circule **directement entre
   navigateurs** (P2P), le serveur n'y a plus accès.

## API REST

| Méthode | Route                              | Protégée        | Description                             |
|---------|--------------------------------------|------------------|-------------------------------------------|
| POST    | /api/auth/register                     | non              | Créer un compte                           |
| POST    | /api/auth/login                        | non              | Se connecter                              |
| GET     | /api/auth/me                           | oui              | Utilisateur connecté                      |
| POST    | /api/rooms/:roomId/files                 | oui              | Uploader un fichier (chiffré au repos)    |
| GET     | /api/rooms/:roomId/files                 | oui              | Lister les fichiers d'une salle           |
| GET     | /api/rooms/:roomId/files/:fileId          | oui (ou ?token=) | Télécharger (déchiffrement à la volée)    |

## Événements Socket.io

| Événement          | Sens              | Description                                   |
|--------------------|-------------------|-------------------------------------------------|
| `join-room`         | client → serveur  | Rejoindre une salle                            |
| `room-users`         | serveur → client  | Liste des participants déjà présents           |
| `user-joined`         | serveur → salle   | Un nouveau participant est arrivé              |
| `user-left`            | serveur → salle   | Un participant est parti                       |
| `signal`                | bidirectionnel    | Relais SDP/ICE (offre, réponse, candidats)     |
| `media-state`             | client → salle    | Statut micro/caméra                            |
| `whiteboard-stroke`         | bidirectionnel    | Trait dessiné sur le tableau blanc             |
| `whiteboard-clear`            | bidirectionnel    | Effacer le tableau blanc                       |
| `whiteboard-init`               | serveur → client  | État initial du tableau blanc à la connexion   |
| `file-shared`                     | serveur → salle   | Un fichier a été partagé                       |
| `request-files`                     | client → serveur  | Demander la liste des fichiers déjà partagés   |

## Limites connues (projet pédagogique)

- Topologie **mesh** : convient à de petits groupes (jusqu'à ~6-8 personnes) ;
  au-delà, une architecture SFU (ex. mediasoup, Janus) serait nécessaire.
- Pas de serveur **TURN** configuré : les connexions entre réseaux avec NAT
  restrictif/symétrique peuvent échouer. Pour la production, ajoutez un
  serveur TURN (ex. coturn) aux `ICE_SERVERS` dans `public/js/room.js`.
- L'état du tableau blanc est **en mémoire** (non persisté en base) et perdu
  quand la salle se vide complètement.
- Base JSON à but pédagogique ; à remplacer par une vraie base de données pour
  un déploiement réel.
