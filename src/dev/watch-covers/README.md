# Essai : des veilles comme des pochettes

Prototype local séparé : `node scripts/preview-watch-covers.mjs`.
Utiliser `ECHO_TEST_PYTHON` si Django se trouve dans un environnement virtuel.

- Pochettes : http://127.0.0.1:5182/
- Version précédente : http://127.0.0.1:5182/?view=classic

Le plugin Vite de ce script remplace uniquement le module d'accueil servi par
ce processus. `src/pages/HomePage.tsx`, ses styles historiques et la génération
backend restent intacts. Ce prototype n'est importé par aucune entrée de production.
Il utilise l'API de simulation des veilles, avec SQLite temporaire, sources et
résumés fictifs. Les clics ouvrent les pages de veille existantes.

## Direction artistique de la série

Six pochettes carrées, dont la conversation épinglée : une palette restreinte par
image, des textures papier, des compositions photographiques ou sculpturales,
une typographie sans empattement commune, des titres courts et un sous-titre.
Les textes font partie intégrante des pixels générés, sans texte HTML visible
ni dégradé sombre ajouté. Le nom accessible et l'infobulle restent explicites.
La géométrie des carrés et le verre 3D sont conservés.

Le système envisagé pour la suite :

1. Les faits de la veille donnent un titre court, un sous-titre exact et un motif.
   Ne jamais déduire une bonne nouvelle à partir d'un fait ambigu.
2. Une consigne de collection partagée fixe typographie, marges, textures et
   lisibilité miniature ; une fiche de sujet fixe motif et palette.
3. Le générateur produit une seule image complète, texte compris.
4. Vérifier l'orthographe exacte, les marges et le contraste à la taille affichée
   avant de publier. Conserver l'ancien rendu si une couverture n'est pas prête.
5. Réutiliser l'image tant que le sujet et ses textes n'ont pas changé.

Ici, les étapes de génération et validation sont effectuées manuellement : aucune
nouvelle génération n'est lancée au chargement de la page. Le backend réel ne
produit pas encore ce nouveau format.

## Assets et provenance

Les six PNG originaux sont conservés dans [`assets/`](assets/).
Ils ont été générés avec la compétence imagegen et l'outil intégré, à partir
d'exemples fictifs. L'image entière, typographie incluse, vient du générateur.

Les consignes finales complètes de chaque couverture et la direction partagée
sont dans [`prompts.json`](../../../scripts/fixtures/watch-covers/prompts.json).
Ce sont des assets d'essai ; leur compression et leur stockage privé seront
à reprendre avec le branchement de production, après validation du rendu.
