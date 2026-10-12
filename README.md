# Test-Jeu2 — Devine le mème

J'essaie de créer un jeu vidéo avec l'IA.

Jeu multijoueur dans le navigateur : un mème (image ou vidéo) s'affiche, chaque joueur écrit son nom ou ses paroles, et ce sont les autres joueurs qui valident les réponses par un vote.

## Règles

1. **Salon** : un joueur crée un salon et partage son code de 4 lettres. L'hôte choisit le temps par mème et le nombre de mèmes. Chaque joueur clique sur « Prêt » pour accepter ces réglages. Toute modification des réglages remet tout le monde en « pas prêt ». La partie démarre quand au moins 2 joueurs sont prêts.
2. **Réponses** : chaque mème s'affiche à tous les joueurs. Chacun écrit sa réponse sans voir celles des autres. On passe au mème suivant quand le temps est écoulé ou quand tout le monde a répondu.
3. **Votes** (à la fin de la partie) : pour chaque mème, les réponses de tous les joueurs sont révélées. Chacun vote ✅ Vrai ou ❌ Faux pour les réponses des autres, mais jamais pour la sienne. La vraie réponse n'est pas affichée.
4. **Points** : un joueur marque 1 point si les ✅ sont au moins aussi nombreux que les ❌.
   - En cas d'égalité, le joueur a le point.
   - Un joueur qui ne vote pas n'est pas compté.
   - Une réponse vide vaut 0 point.

## Lancer le jeu

Il faut [Node.js](https://nodejs.org) version 18 ou plus récente.

```bash
npm install
npm start
```

Ouvre ensuite http://localhost:3000. Pour tester seul, ouvre plusieurs onglets en navigation privée.
Pour jouer à plusieurs sur le même réseau Wi-Fi, les autres joueurs ouvrent `http://<adresse-IP-de-ton-PC>:3000`.

Pour lancer les tests des règles : `npm test`.

## Ajouter des mèmes

1. Place le fichier dans `public/memes/`. Formats acceptés : images (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`) et vidéos (`.mp4`, `.webm`, `.ogg`, `.mov`).
2. Ajoute une ligne dans `memes.json` :
   ```json
   { "fichier": "rickroll.mp4", "nom": "Rickroll — « Never gonna give you up »" }
   ```
   Le champ `nom` sert seulement d'aide-mémoire : il n'est jamais envoyé aux joueurs.

Les trois fichiers `exemple-*.svg` ne sont que des exemples. Supprime-les une fois que tu as ajouté tes vrais mèmes.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `game.js` | Règles du jeu : phases, réponses, votes, calcul des points |
| `server.js` | Serveur web (Express) et communication en temps réel (Socket.IO) |
| `public/index.html`, `style.css` | Interface |
| `public/client.js` | Code du navigateur : envoie les actions au serveur et affiche l'état reçu |
| `test/game.test.js` | Tests des règles |
