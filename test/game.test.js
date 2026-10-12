'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Room, GameError } = require('../game');

const MEMES = [
  { url: '/memes/a.png', type: 'image' },
  { url: '/memes/b.mp4', type: 'video' },
];

// Minuteur manuel : la manche ne se termine que quand on le décide
function fakeTimers() {
  const pending = new Set();
  return {
    setTimeout: (fn) => { const t = { fn }; pending.add(t); return t; },
    clearTimeout: (t) => pending.delete(t),
    fire: () => { for (const t of [...pending]) { pending.delete(t); t.fn(); } },
  };
}

function startedRoom(names, memeCount = 1) {
  const timers = fakeTimers();
  const room = new Room('TEST', MEMES, () => {}, timers);
  names.forEach((n) => room.addPlayer(n, n));
  room.updateSettings(names[0], { timePerMeme: 30, memeCount });
  names.forEach((n) => room.setReady(n, true));
  room.start(names[0]);
  return { room, timers };
}

test('la partie ne démarre que si tout le monde est prêt', () => {
  const room = new Room('TEST', MEMES, () => {}, fakeTimers());
  room.addPlayer('a', 'a');
  room.addPlayer('b', 'b');
  room.setReady('a', true);
  assert.throws(() => room.start('a'), GameError);
  room.setReady('b', true);
  room.start('a');
  assert.strictEqual(room.phase, 'answering');
});

test('changer les réglages remet tout le monde en « pas prêt »', () => {
  const room = new Room('TEST', MEMES, () => {}, fakeTimers());
  room.addPlayer('a', 'a');
  room.addPlayer('b', 'b');
  room.setReady('b', true);
  room.updateSettings('a', { timePerMeme: 60, memeCount: 2 });
  assert.strictEqual(room.players.get('b').ready, false);
  assert.throws(() => room.updateSettings('b', { timePerMeme: 10, memeCount: 1 }), GameError);
});

test('les réponses des autres restent cachées pendant la phase de réponses', () => {
  const { room } = startedRoom(['a', 'b', 'c']);
  room.submitAnswer('a', 'secret');
  const seenByB = room.stateFor('b');
  assert.ok(!JSON.stringify(seenByB).includes('secret'));
  assert.deepStrictEqual(seenByB.answered, ['a']);
});

test('les votes commencent après le dernier mème (fin du temps ou tout le monde a répondu)', () => {
  const { room, timers } = startedRoom(['a', 'b'], 2);
  room.submitAnswer('a', 'x');
  timers.fire(); // fin du temps pour le mème 1
  assert.strictEqual(room.phase, 'answering');
  assert.strictEqual(room.round, 1);
  room.submitAnswer('a', 'y');
  room.submitAnswer('b', 'z'); // tout le monde a répondu
  assert.strictEqual(room.phase, 'voting');
  assert.strictEqual(room.round, 0);
});

test('on ne peut pas voter pour sa propre réponse', () => {
  const { room } = startedRoom(['a', 'b']);
  room.submitAnswer('a', 'x');
  room.submitAnswer('b', 'y');
  assert.throws(() => room.vote('a', 'a', true), GameError);
});

test('majorité, égalité, abstention et réponse vide', () => {
  const { room } = startedRoom(['a', 'b', 'c', 'd', 'e']);
  room.submitAnswer('a', 'majorité vrai');
  room.submitAnswer('b', 'majorité faux');
  room.submitAnswer('c', 'égalité');
  room.submitAnswer('d', 'personne ne vote');
  room.submitAnswer('e', '   '); // vide
  assert.strictEqual(room.phase, 'voting');

  room.vote('b', 'a', true); room.vote('c', 'a', true); room.vote('d', 'a', false);
  room.vote('a', 'b', false); room.vote('c', 'b', false); room.vote('d', 'b', true);
  room.vote('a', 'c', true); room.vote('b', 'c', false);
  room.vote('a', 'e', true); // ignoré : pas de réponse

  room.nextVote('a');
  assert.strictEqual(room.phase, 'results');
  const score = Object.fromEntries(room.scores.map((s) => [s.id, s.score]));
  assert.deepStrictEqual(score, { a: 1, b: 0, c: 1, d: 1, e: 0 });
});

test('à deux joueurs, le seul votant décide', () => {
  const { room } = startedRoom(['a', 'b']);
  room.submitAnswer('a', 'x');
  room.submitAnswer('b', 'y');
  room.vote('b', 'a', false); // faux -> pas de point
  // a ne vote pas pour b -> b a le point
  room.nextVote('a');
  const score = Object.fromEntries(room.scores.map((s) => [s.id, s.score]));
  assert.deepStrictEqual(score, { a: 0, b: 1 });
});

test('annuler un vote le retire du décompte', () => {
  const { room } = startedRoom(['a', 'b']);
  room.submitAnswer('a', 'x');
  room.submitAnswer('b', 'y');
  room.vote('b', 'a', false);
  room.vote('b', 'a', null);
  assert.strictEqual(room.pointFor(0, 'a'), true);
});

test("si l'hôte part, un autre joueur devient hôte", () => {
  const { room } = startedRoom(['a', 'b', 'c']);
  room.removePlayer('a');
  assert.strictEqual(room.hostId, 'b');
  // Un joueur déconnecté ne bloque pas la fin de la manche
  room.submitAnswer('b', 'x');
  room.submitAnswer('c', 'y');
  assert.strictEqual(room.phase, 'voting');
});
