# Accueil et veilles — lot 1

## Périmètre

Demandes d'amis reçues et invitations officielles aux groupes. Aucun traitement
IA ni service externe : les illustrations vectorielles sont des visuels de
transition cohérents, avant la génération d'images prévue dans les lots suivants.
La messagerie Jarvis existante reste utilisable depuis l'accueil.

Le backend persiste un sujet par utilisateur et source, avec une contrainte
unique. Les signaux créent/réconcilient les veilles après validation de la
transaction. La lecture du fil reprend aussi les demandes déjà en attente au
déploiement et réconcilie les réponses données depuis les autres écrans.
Les fils sont paginés par 40. Les invitations expirées et sources supprimées
ne proposent plus de décision. Les notifications natives restent accessibles
lorsque l'IA est désactivée.

Les décisions accept/refuse sont des transactions qui verrouillent la veille et
la source, ainsi que le groupe pour vérifier sa capacité. Une seconde décision
identique retourne le résultat existant. L'acceptation d'un groupe appelle sa
méthode métier existante pour créer le membre et la participation à la conversation.
Aucun identifiant de source ni destinataire n'est fourni par le navigateur.

## API et déploiement

Application Django `watches`, à déployer dans le dépôt backend. La migration
`watches/0001_initial` est préparée, sans exécution sur une base existante ici.
Le Procfile actuel exécute les migrations lors du démarrage du déploiement.

- `GET /watches/?scope=active|history&offset=0`
- `GET /watches/<uuid>/`
- `POST /watches/<uuid>/` avec `action` : `seen`, `accept`, `decline`, `dismiss`, `snooze`.

Chaque accès est filtré sur l'utilisateur authentifié. La consultation est
séparée du traitement. Le report est de 24 heures. Les statuts et l'historique
sont persistés côté serveur ; l'interface présente un seul fil actif.

Le web expose `/veilles/<uuid>`, supporte rechargement et navigation navigateur,
conserve la position de la grille et place les conversations
épinglées en premier. Il actualise le fil toutes les 30 secondes lorsque l'app
est visible, au retour au premier plan et lors des notifications WebSocket prises
en charge. Les notifications push et les collectes externes restent des lots suivants.

Déployer le backend avant le web : une ancienne API affiche une erreur explicite,
sans inventer de veilles ni masquer une erreur par un faux état vide.

## Validation et aperçu

- `npm run build`, `npm test`.
- `npx playwright test tests/e2e/watches.spec.ts tests/e2e/ai-settings.spec.ts tests/e2e/agent-creation.spec.ts`.
- `python scripts/test-watches-backend.py`, avec Django 5.1 et DRF installés.

Le test backend charge les vraies vues et services de veille, le vrai modèle
Relation et le modèle GroupInvitation extrait du code, y compris ses méthodes
métier. Les modèles voisins sont des fixtures. Base SQLite en mémoire, aucun
appel réseau/IA. Ce test ne remplace pas la validation du backend complet avec
ses signaux externes ni les tests de concurrence sur PostgreSQL.

Pour une visite manuelle isolée :

```sh
ECHO_TEST_PYTHON=/chemin/vers/python node scripts/preview-watches.mjs
```

Ouvrir `http://127.0.0.1:5175/`. API locale sur le port 8002, données fictives et
base en mémoire. Les décisions utilisent les vraies vues de veille. Aucune
connexion à la production. Un redémarrage réinitialise les données fictives.


## Ajustement visuel

Accueil limité à une grille de carrés compacts (60 % du côté de la première
grille), avec taille conservée pendant le redimensionnement. Les titres en gras
sont en haut à gauche, les détails en gras en bas à gauche, en blanc sur des
ombres légères partant des deux coins gauches à l'intérieur des carrés. Les
carrés et la barre latérale réutilisent les classes des conversations. Le détail
reprend le header à deux bulles de ConversationThread, puis uniquement le résumé
et les actions. Les onglets de filtrage, les parties numérotées et le bloc de
sources sont retirés. Les états d'erreur et les résultats d'action restent visibles.
