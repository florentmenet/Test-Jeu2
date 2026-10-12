'use strict';

const socket = io();
const $ = (id) => document.getElementById(id);

let state = null;
let roundEndsAt = null; // heure locale de fin de manche
let lastAnswerRound = null;

// ---------- Utilitaires ----------

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = false;
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => ($('error').hidden = true), 4000);
}

function showScreen(name) {
  for (const screen of document.querySelectorAll('.screen')) screen.hidden = screen.id !== name;
}

// N'affiche le mème que s'il a changé (sinon une vidéo redémarrerait à chaque mise à jour)
function renderMedia(container, meme) {
  if (container.dataset.url === meme.url) return;
  container.dataset.url = meme.url;
  container.replaceChildren();
  const el = document.createElement(meme.type === 'video' ? 'video' : 'img');
  el.src = meme.url;
  if (meme.type === 'video') {
    el.controls = true;
    el.autoplay = true;
    el.loop = true;
    el.playsInline = true;
  } else {
    el.alt = 'Mème à deviner';
  }
  container.appendChild(el);
}

function playerName(id) {
  const p = state.players.find((pl) => pl.id === id);
  return p ? p.name : '?';
}

const isHost = () => state.hostId === state.me;

// ---------- Accueil ----------

$('create').onclick = () => socket.emit('create_room', { name: $('name').value });
$('join').onclick = () => socket.emit('join_room', { code: $('code').value, name: $('name').value });
$('code').addEventListener('input', (e) => (e.target.value = e.target.value.toUpperCase()));

// ---------- Salon ----------

function sendSettings() {
  socket.emit('update_settings', { timePerMeme: Number($('time').value), memeCount: Number($('count').value) });
}
$('time').onchange = sendSettings;
$('count').onchange = sendSettings;
$('ready').onclick = () => {
  const me = state.players.find((p) => p.id === state.me);
  socket.emit('set_ready', !me.ready);
};
$('start').onclick = () => socket.emit('start_game');

function renderLobby() {
  $('room-code').textContent = state.code;
  // Nouvelle partie : on oublie les mèmes affichés précédemment
  for (const id of ['answer-media', 'vote-media']) delete $(id).dataset.url;

  const time = $('time');
  if (time.options.length === 0) {
    for (const t of state.timeOptions) time.add(new Option(`${t} secondes`, t));
  }
  time.value = state.settings.timePerMeme;
  $('count').max = state.maxMemes;
  if (document.activeElement !== $('count')) $('count').value = state.settings.memeCount;
  time.disabled = $('count').disabled = !isHost();
  $('settings-hint').textContent = isHost()
    ? `Tu es l'hôte : choisis les réglages (max ${state.maxMemes} mèmes). Chaque changement remet tout le monde en « pas prêt ».`
    : "L'hôte choisit les réglages. Clique sur « Prêt » si tu es d'accord.";

  const list = $('lobby-players');
  list.replaceChildren();
  for (const p of state.players) {
    const li = document.createElement('li');
    li.textContent = `${p.ready ? '✅' : '⏳'} ${p.name}${p.id === state.hostId ? ' (hôte)' : ''}${p.id === state.me ? ' — toi' : ''}`;
    list.appendChild(li);
  }

  const me = state.players.find((p) => p.id === state.me);
  $('ready').textContent = me.ready ? 'Pas prêt' : "Prêt (j'accepte les réglages)";
  $('start').hidden = !isHost();
  const allReady = state.players.length >= 2 && state.players.every((p) => p.ready);
  $('start').disabled = !allReady;
}

// ---------- Réponses ----------

$('answer-form').onsubmit = (e) => {
  e.preventDefault();
  socket.emit('submit_answer', $('answer').value);
};

function renderAnswering() {
  if (lastAnswerRound !== state.round) {
    lastAnswerRound = state.round;
    $('answer').value = '';
    $('answer').focus();
  }
  roundEndsAt = Date.now() + state.remainingMs;
  $('answer-round').textContent = `Mème ${state.round + 1} / ${state.totalRounds}`;
  renderMedia($('answer-media'), state.meme);
  $('answer').maxLength = state.maxAnswerLength;

  const waiting = state.players.filter((p) => p.connected && !state.answered.includes(p.id)).length;
  $('answer-status').textContent =
    (state.myAnswer !== null
      ? `Réponse enregistrée : « ${state.myAnswer || '(vide)'} ». Tu peux encore la modifier. `
      : '') + `En attente de ${waiting} joueur(s).`;
}

setInterval(() => {
  if (!state || state.phase !== 'answering') return;
  const seconds = Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000));
  $('timer').textContent = `⏱ ${seconds} s`;
  $('timer').classList.toggle('urgent', seconds <= 5);
}, 200);

// ---------- Votes ----------

$('next-vote').onclick = () => socket.emit('next_vote');

function voteButton(label, answer, value) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.className = answer.myVote === value ? 'vote selected' : 'vote';
  // Re-cliquer sur son vote l'annule
  btn.onclick = () =>
    socket.emit('vote', { authorId: answer.playerId, value: answer.myVote === value ? null : value });
  return btn;
}

function renderVoting() {
  lastAnswerRound = null;
  $('vote-round').textContent = `Votes — mème ${state.round + 1} / ${state.totalRounds}`;
  renderMedia($('vote-media'), state.meme);

  const list = $('vote-answers');
  list.replaceChildren();
  for (const answer of state.answers) {
    const li = document.createElement('li');
    const who = document.createElement('strong');
    who.textContent = answer.name;
    const text = document.createElement('span');
    text.className = 'answer-text';
    text.textContent = answer.text || '(pas de réponse — 0 point)';
    li.append(who, text);

    if (answer.text) {
      const actions = document.createElement('div');
      actions.className = 'actions';
      if (answer.playerId === state.me) {
        actions.textContent = 'Ta réponse — les autres votent';
      } else {
        actions.append(voteButton('✅ Vrai', answer, true), voteButton('❌ Faux', answer, false));
      }
      const count = document.createElement('small');
      count.textContent = `${answer.voteCount} vote(s)`;
      actions.append(count);
      li.append(actions);
    } else {
      li.classList.add('empty');
    }
    list.appendChild(li);
  }

  const last = state.round + 1 === state.totalRounds;
  $('next-vote').hidden = !isHost();
  $('next-vote').textContent = last ? 'Voir le classement' : 'Mème suivant';
  $('vote-hint').textContent = isHost()
    ? 'Passe à la suite quand tout le monde a voté.'
    : `L'hôte (${playerName(state.hostId)}) passera à la suite quand tout le monde aura voté.`;
}

// ---------- Résultats ----------

$('replay').onclick = () => socket.emit('back_to_lobby');

function renderResults() {
  const list = $('scores');
  list.replaceChildren();
  for (const s of state.scores) {
    const li = document.createElement('li');
    li.textContent = `${s.name} — ${s.score} point${s.score > 1 ? 's' : ''}`;
    list.appendChild(li);
  }
  $('replay').hidden = !isHost();
}

// ---------- Réception de l'état ----------

const renderers = {
  lobby: renderLobby,
  answering: renderAnswering,
  voting: renderVoting,
  results: renderResults,
};

socket.on('state', (newState) => {
  state = newState;
  showScreen(state.phase);
  renderers[state.phase]();
});

socket.on('error_message', showError);

socket.on('disconnect', () => {
  state = null;
  showScreen('home');
  showError('Connexion perdue avec le serveur.');
});
