'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Room, GameError } = require('./game');

const PORT = process.env.PORT || 3000;
const MEMES_DIR = path.join(__dirname, 'public', 'memes');
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov'];

// Le catalogue est lu dans memes.json ; le champ "nom" n'est jamais envoyé aux joueurs.
function loadMemes() {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'memes.json'), 'utf8'));
  return list
    .filter((m) => {
      const exists = fs.existsSync(path.join(MEMES_DIR, m.fichier));
      if (!exists) console.warn(`Mème ignoré, fichier introuvable : ${m.fichier}`);
      return exists;
    })
    .map((m) => ({
      url: `/memes/${encodeURIComponent(m.fichier)}`,
      type: VIDEO_EXTENSIONS.includes(path.extname(m.fichier).toLowerCase()) ? 'video' : 'image',
    }));
}

const memes = loadMemes();
if (memes.length === 0) {
  console.error('Aucun mème disponible : ajoute des fichiers dans public/memes et dans memes.json.');
  process.exit(1);
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map(); // code -> Room

function newRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function broadcast(room) {
  for (const player of room.connectedPlayers()) {
    io.to(player.id).emit('state', room.stateFor(player.id));
  }
}

io.on('connection', (socket) => {
  let room = null;

  // Exécute une action et renvoie l'erreur éventuelle au joueur
  const handle = (action) => (...args) => {
    try {
      action(...args);
    } catch (err) {
      if (err instanceof GameError) socket.emit('error_message', err.message);
      else console.error(err);
    }
  };

  socket.on('create_room', handle(({ name }) => {
    if (room) return;
    const code = newRoomCode();
    const created = new Room(code, memes, () => broadcast(created));
    created.addPlayer(socket.id, name);
    rooms.set(code, created);
    room = created;
  }));

  socket.on('join_room', handle(({ code, name }) => {
    if (room) return;
    const target = rooms.get(String(code || '').trim().toUpperCase());
    if (!target) throw new GameError('Salon introuvable.');
    target.addPlayer(socket.id, name);
    room = target;
  }));

  socket.on('update_settings', handle((settings) => room && room.updateSettings(socket.id, settings)));
  socket.on('set_ready', handle((ready) => room && room.setReady(socket.id, ready)));
  socket.on('start_game', handle(() => room && room.start(socket.id)));
  socket.on('submit_answer', handle((text) => room && room.submitAnswer(socket.id, text)));
  socket.on('vote', handle(({ authorId, value }) => room && room.vote(socket.id, authorId, value)));
  socket.on('next_vote', handle(() => room && room.nextVote(socket.id)));
  socket.on('back_to_lobby', handle(() => room && room.backToLobby(socket.id)));

  socket.on('disconnect', () => {
    if (!room) return;
    room.removePlayer(socket.id);
    if (room.isEmpty()) {
      room.resetGame(); // arrête le minuteur éventuel
      rooms.delete(room.code);
    }
  });
});

server.listen(PORT, () => {
  // Sur Render, RENDER_EXTERNAL_URL contient l'adresse publique du site
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`Jeu des mèmes lancé sur ${url} (${memes.length} mèmes chargés)`);
});
