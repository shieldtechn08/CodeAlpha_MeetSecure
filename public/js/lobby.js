document.addEventListener('DOMContentLoaded', () => {
  const createForm = document.getElementById('create-room-form');
  const joinForm = document.getElementById('join-room-form');

  createForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = randomRoomCode();
    goToRoom(code);
  });

  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('join-room-code');
    const code = input.value.trim().toLowerCase();
    if (!code) return;
    goToRoom(code);
  });

  function goToRoom(code) {
    const user = getCurrentUser();
    if (!user) {
      sessionStorage.setItem('pending-room', code);
      requireLogin("Connectez-vous pour rejoindre ou créer une salle.");
      return;
    }
    window.location.href = `room.html?room=${encodeURIComponent(code)}`;
  }
});
