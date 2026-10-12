'use strict';

// Logique d'une partie, indépendante du réseau (testable seule).
// Phases : lobby -> answering (un mème après l'autre) -> voting -> results

const TIME_OPTIONS = [10, 20, 30, 45, 60, 90];
const MAX_ANSWER_LENGTH = 200;
const MAX_NAME_LENGTH = 20;
const MIN_PLAYERS = 2;

function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

class GameError extends Error {}

class Room {
  // memes : [{ url, type: 'image' | 'video' }]
  // onChange : appelé à chaque changement d'état (pour prévenir les joueurs)
  constructor(code, memes, onChange = () => {}, timers = { setTimeout, clearTimeout }) {
    this.code = code;
    this.catalogue = memes;
    this.onChange = onChange;
    this.timers = timers;
    this.players = new Map(); // id -> { id, name, ready, connected }
    this.hostId = null;
    this.settings = { timePerMeme: 30, memeCount: Math.min(5, memes.length) };
    this.resetGame();
  }

  resetGame() {
    this.phase = 'lobby';
    this.memes = [];
    this.round = 0;
    this.roundEndsAt = null;
    this.answers = []; // answers[manche] : Map joueurId -> texte
    this.votes = []; // votes[manche] : Map auteurId -> Map votantId -> booléen
    this.scores = null;
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  // ---------- Joueurs ----------

  addPlayer(id, name) {
    if (this.phase !== 'lobby') throw new GameError('La partie a déjà commencé.');
    const cleanName = String(name || '').trim().slice(0, MAX_NAME_LENGTH);
    if (!cleanName) throw new GameError('Choisis un pseudo.');
    const taken = [...this.players.values()].some(
      (p) => p.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (taken) throw new GameError('Ce pseudo est déjà pris dans ce salon.');
    this.players.set(id, { id, name: cleanName, ready: false, connected: true });
    if (!this.hostId) this.hostId = id;
    this.onChange();
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    if (this.phase === 'lobby') {
      this.players.delete(id);
    } else {
      // On garde ses réponses pour la phase de vote
      player.connected = false;
    }
    if (this.hostId === id) {
      const next = [...this.players.values()].find((p) => p.connected);
      this.hostId = next ? next.id : null;
    }
    if (this.phase === 'answering') this.checkAllAnswered();
    this.onChange();
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  isEmpty() {
    return this.connectedPlayers().length === 0;
  }

  requireHost(id) {
    if (id !== this.hostId) throw new GameError("Seul l'hôte peut faire ça.");
  }

  // ---------- Salon ----------

  updateSettings(id, settings) {
    this.requireHost(id);
    if (this.phase !== 'lobby') throw new GameError('La partie a déjà commencé.');
    const time = Number(settings.timePerMeme);
    const count = Number(settings.memeCount);
    if (!TIME_OPTIONS.includes(time)) throw new GameError('Temps invalide.');
    if (!Number.isInteger(count) || count < 1 || count > this.catalogue.length) {
      throw new GameError(`Nombre de mèmes invalide (1 à ${this.catalogue.length}).`);
    }
    this.settings = { timePerMeme: time, memeCount: count };
    // Les réglages ont changé : tout le monde doit les accepter à nouveau
    for (const p of this.players.values()) p.ready = false;
    this.onChange();
  }

  setReady(id, ready) {
    const player = this.players.get(id);
    if (!player || this.phase !== 'lobby') return;
    player.ready = Boolean(ready);
    this.onChange();
  }

  start(id) {
    this.requireHost(id);
    if (this.phase !== 'lobby') throw new GameError('La partie a déjà commencé.');
    const players = this.connectedPlayers();
    if (players.length < MIN_PLAYERS) {
      throw new GameError(`Il faut au moins ${MIN_PLAYERS} joueurs.`);
    }
    if (!players.every((p) => p.ready)) {
      throw new GameError("Tous les joueurs doivent être prêts.");
    }
    this.memes = shuffle(this.catalogue).slice(0, this.settings.memeCount);
    this.answers = this.memes.map(() => new Map());
    this.votes = this.memes.map(() => new Map());
    this.startRound(0);
  }

  // ---------- Phase de réponses ----------

  startRound(index) {
    this.phase = 'answering';
    this.round = index;
    const ms = this.settings.timePerMeme * 1000;
    this.roundEndsAt = Date.now() + ms;
    this.timer = this.timers.setTimeout(() => this.endRound(), ms);
    this.onChange();
  }

  submitAnswer(id, text) {
    if (this.phase !== 'answering' || !this.players.has(id)) return;
    const clean = String(text || '').trim().slice(0, MAX_ANSWER_LENGTH);
    this.answers[this.round].set(id, clean);
    this.checkAllAnswered();
    this.onChange();
  }

  checkAllAnswered() {
    const answers = this.answers[this.round];
    const players = this.connectedPlayers();
    if (players.length > 0 && players.every((p) => answers.has(p.id))) this.endRound();
  }

  endRound() {
    if (this.phase !== 'answering') return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
    if (this.round + 1 < this.memes.length) {
      this.startRound(this.round + 1);
    } else {
      this.phase = 'voting';
      this.round = 0;
      this.roundEndsAt = null;
      this.onChange();
    }
  }

  // ---------- Phase de votes ----------

  vote(voterId, authorId, value) {
    if (this.phase !== 'voting') return;
    if (voterId === authorId) throw new GameError('Tu ne peux pas voter pour ta propre réponse.');
    if (!this.players.has(voterId)) return;
    const text = this.answers[this.round].get(authorId);
    if (!text) return; // pas de réponse = rien à voter
    const votes = this.votes[this.round];
    if (!votes.has(authorId)) votes.set(authorId, new Map());
    if (value === null) votes.get(authorId).delete(voterId);
    else votes.get(authorId).set(voterId, Boolean(value));
    this.onChange();
  }

  nextVote(id) {
    this.requireHost(id);
    if (this.phase !== 'voting') return;
    if (this.round + 1 < this.memes.length) {
      this.round += 1;
    } else {
      this.scores = this.computeScores();
      this.phase = 'results';
    }
    this.onChange();
  }

  // Un joueur marque le point si sa réponse n'est pas vide et
  // si les « vrai » sont au moins aussi nombreux que les « faux »
  // (égalité = point, aucun vote = égalité 0-0 = point).
  pointFor(round, authorId) {
    const text = this.answers[round].get(authorId);
    if (!text) return false;
    const votes = [...(this.votes[round].get(authorId) || new Map()).values()];
    const yes = votes.filter((v) => v).length;
    const no = votes.length - yes;
    return yes >= no;
  }

  computeScores() {
    return [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: this.memes.reduce((sum, _, r) => sum + (this.pointFor(r, p.id) ? 1 : 0), 0),
      }))
      .sort((a, b) => b.score - a.score);
  }

  backToLobby(id) {
    this.requireHost(id);
    // Les joueurs déconnectés pendant la partie quittent le salon
    for (const p of [...this.players.values()]) {
      if (!p.connected) this.players.delete(p.id);
      else p.ready = false;
    }
    this.resetGame();
    this.onChange();
  }

  // ---------- Ce que voit un joueur donné ----------

  stateFor(viewerId) {
    const state = {
      code: this.code,
      phase: this.phase,
      me: viewerId,
      hostId: this.hostId,
      settings: this.settings,
      timeOptions: TIME_OPTIONS,
      maxMemes: this.catalogue.length,
      maxAnswerLength: MAX_ANSWER_LENGTH,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        ready: p.ready,
        connected: p.connected,
      })),
    };

    if (this.phase === 'answering') {
      const answers = this.answers[this.round];
      // On n'envoie surtout pas les réponses des autres avant la fin de la partie
      state.round = this.round;
      state.totalRounds = this.memes.length;
      state.meme = this.memes[this.round];
      // Temps restant plutôt qu'une heure absolue : évite les décalages d'horloge
      state.remainingMs = Math.max(0, this.roundEndsAt - Date.now());
      state.answered = [...answers.keys()];
      state.myAnswer = answers.get(viewerId) ?? null;
    }

    if (this.phase === 'voting') {
      const answers = this.answers[this.round];
      const votes = this.votes[this.round];
      state.round = this.round;
      state.totalRounds = this.memes.length;
      state.meme = this.memes[this.round];
      state.answers = [...this.players.values()].map((p) => {
        const authorVotes = votes.get(p.id) || new Map();
        return {
          playerId: p.id,
          name: p.name,
          text: answers.get(p.id) || '',
          myVote: authorVotes.has(viewerId) ? authorVotes.get(viewerId) : null,
          voteCount: authorVotes.size,
        };
      });
    }

    if (this.phase === 'results') {
      state.scores = this.scores;
    }

    return state;
  }
}

module.exports = { Room, GameError, TIME_OPTIONS, MAX_ANSWER_LENGTH };
