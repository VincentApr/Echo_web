# Accueil et veilles — lot 2

La disposition approuvée reste la référence : grille seule, conversations épinglées
en premier, page de veille avec le header de conversation, résumé et actions.
Les carrés ont des coins de 19 px et des marges intérieures de 16 px. Un reflet
diagonal discret, un fin bord lumineux et une ombre légère suggèrent une vitre.
Leur titre
utilise Manrope, servie localement avec sa licence ; les contours sont uniformes,
sans marquage vert lié au statut de lecture.

## Implémentation

- Une ouverture de session web demande une collecte via `POST /watches/refresh/`.
  Cette requête inscrit le travail en base et renvoie immédiatement `202`.
- `WatchScan` conserve une seule tâche par utilisateur, un bail de quinze minutes,
  l'échéance suivante et un état par source. Un processus distinct effectue le travail.
  Un autre worker peut reprendre un bail expiré après un arrêt. Aucun appel externe
  n'est exécuté par une simple lecture du fil.
- Après la première connexion, le worker continue les collectes toutes les trente
  minutes, même lorsque le navigateur est fermé. Les erreurs sont retentées après
  cinq minutes ; les demandes rapprochées à la connexion sont regroupées.
- Trois premiers adaptateurs : Gmail (dix mails récents, hors catégories promotions
  et réseaux sociaux), Google Agenda (trente événements du calendrier principal dans
  les sept prochains jours), Echo (huit conversations avec messages non lus des sept
  derniers jours, six extraits par conversation). Les sujets Echo encore actifs
  sont réexaminés avec les réponses de l'utilisateur, même après lecture. Les comptes OAuth appartiennent
  obligatoirement à l'utilisateur et doivent avoir un scope de lecture adéquat.
- Mistral reçoit les extraits bornés et retourne titre, résumé, pertinence et priorité.
  Les références de source et les types de champs sont validés. Il ne choisit ni URL,
  ni fonction à appeler. Une réponse invalide conserve le fil précédent pour cette source.
- Une empreinte des données évite de payer une nouvelle synthèse si rien n'a changé.
  Les données identiques sont réévaluées chaque jour pour tenir compte du temps.
  Le titre et le résumé sont persistés ; les extraits bruts ne sont pas conservés.
- Une panne de source ne supprime pas les autres propositions ni leur dernier résumé.
  Les événements annulés disparaissent après une collecte Agenda complète. Les sujets
  arrivés à échéance sont retirés du fil actif. Une page partielle ne permet pas de
  conclure à la suppression d'un événement absent.
- Actions : consulter le mail, voir l'événement, ouvrir la conversation, masquer,
  reporter. Ouvrir une source demande un clic et un contrôle d'accès serveur récent.
  Aucun envoi de mail/message et aucune modification d'événement ne sont exécutés.
  Un sujet masqué reste masqué tant que ses informations ne changent pas.

## Autorisations

Le bouton général d'arrêt de l'IA et l'état actif de Jarvis sont relus avant
collecte, synthèse et publication. Les restrictions de lecture des messages et
du calendrier sont appliquées. Une conversation protégée par le refus d'un
participant ou d'un membre du groupe n'est pas analysée. Un utilisateur banni ou
ayant quitté une conversation n'y a plus accès par les veilles.

Les mêmes restrictions s'appliquent à la consultation des résumés persistés,
y compris dans l'historique. Les demandes d'amis et invitations natives du lot 1
restent disponibles lorsque l'IA est arrêtée. Les erreurs de providers ne sont
pas enregistrées avec leurs corps de réponse : elles pourraient contenir des secrets.

## Mise en service

Le backend doit être déployé avant le frontend. Les migrations manuelles
`watches/0001_initial` et `watches/0002_intelligent_watches` sont préparées ; aucune
migration n'a été exécutée sur une base existante pendant cette implémentation.

Le projet web et le backend sont deux dépôts et deux services distincts. Le push
du dépôt web ne publie pas le contenu du dossier local `backend-server`.

L'API publique cible est `https://api.echosocial.fr`. L'ancienne adresse Railway
répond toujours ; cela ne permet pas de conclure qu'elle utilise la même base ou
la même version. Le frontend, le proxy de développement et la valeur par défaut
de `JARVIS_INTERNAL_URL` ciblent désormais le domaine Echo. Vérifier aussi la
variable `JARVIS_INTERNAL_URL` du serveur : une valeur explicite remplace le défaut.

Il faut lancer un processus supplémentaire sur l'hébergement actuel du backend,
avec une commande de démarrage explicite (service systemd ou conteneur selon
l'installation). Si le backend est encore hébergé sur Railway, créer un service
depuis le même dépôt et la même branche. La ligne `watch_worker` du Procfile
documente la commande ; elle ne crée pas automatiquement un service. Le worker doit utiliser les mêmes
variables Django que le backend, notamment `DATABASE_URL`, `MISTRAL_API_KEY` et
`ENCRYPTION_KEY` (pour déchiffrer les connexions OAuth), dans le même environnement
et la même région que le backend. Aucun domaine public n'est nécessaire. Il exécute :

```sh
python manage.py run_watch_worker
```

Ordre de mise en service :

1. Publier le code backend dans son dépôt et déployer le service API.
2. Vérifier l'application des migrations par la procédure de déploiement du serveur.
   La commande web du Procfile prévoit `migrate --no-input` uniquement si cet
   hébergement exécute effectivement cette commande.
3. Créer/configurer le service worker, puis le démarrer une fois les migrations
   appliquées. Désactiver sa mise en veille automatique pour la collecte hors connexion.
4. Vérifier la présence de la clé Mistral et des connexions OAuth valides du compte
   de recette. Une reconnexion Google peut être nécessaire si les scopes de lecture
   Gmail/Agenda n'avaient pas été accordés.
5. Publier et déployer le dépôt web, puis tester une vraie session : demande de
   collecte acceptée, état des sources, résumé produit par Mistral et navigation.

Un push ne déploie le serveur que si son hébergement dispose d'une automatisation
reliée à la bonne branche. Cela doit être vérifié sur l'installation actuelle.
Si un service utilise encore Railway, son autodéploiement GitHub peut remplir ce rôle.

Une exécution ponctuelle, utile pour un job planifié, est aussi disponible :

```sh
python manage.py run_watch_worker --once
```

Le worker utilise `settings.MISTRAL_API_KEY`. Le modèle par défaut est
`mistral-small-latest`, remplaçable via le setting Django `WATCHES_MISTRAL_MODEL`.
Sans clé Mistral, les notifications natives fonctionnent et les sources IA passent
en erreur sans fabriquer de suggestions. Le démarrage de ce processus en production
reste à effectuer au déploiement : une simple mise à jour du frontend ne le lance pas.

`GET /watches/refresh/` expose l'état de la collecte pour le compte authentifié.
La grille garde son actualisation existante toutes les trente secondes au premier plan.

## Validation et simulation

```sh
python scripts/test-watches-backend.py
npm run build
npm test
npx playwright test tests/e2e/watches.spec.ts tests/e2e/ai-settings.spec.ts tests/e2e/agent-creation.spec.ts
```

Les tests backend utilisent SQLite en mémoire, les vrais collecteurs, le vrai
moteur et les vraies permissions. Les modèles voisins complexes restent des
fixtures (le modèle JarvisInstance est extrait du code réel). Les requêtes Google
et Mistral sont simulées et les autres accès réseau interdits. Cela ne remplace
pas une recette avec de vrais comptes OAuth ni la validation de concurrence sur PostgreSQL.

La simulation de référence reste sur le port 5175. Un aperçu distinct du moteur
et des nouveaux sujets est disponible sans toucher à cette référence :

```sh
ECHO_WATCH_PREVIEW_MODE=intelligent ECHO_TEST_PYTHON=/chemin/vers/python node scripts/preview-watches.mjs
```

Ouvrir `http://127.0.0.1:5176/`. API en mémoire sur le port 8003. Le moteur et la
persistance sont réels ; Google et Mistral sont remplacés par des réponses fictives.
Les liens Google renvoient vers des identifiants fictifs. Aucun appel IA payant,
aucune connexion à la production. Un redémarrage réinitialise les décisions.

## Lots suivants

Ce lot fournit les premiers adaptateurs, et non une analyse automatique de n'importe
quel plugin. Les autres services auront chacun un adaptateur de lecture explicite.
Le rapprochement des sujets entre services est traité dans le [lot 3](watches-lot-3.md).
Restent les illustrations générées, les propositions adressées à un agent choisi
et les notifications push.

Références techniques : [Gmail](https://developers.google.com/gmail/api/reference/rest/v1/users.messages),
[Google Agenda](https://developers.google.com/workspace/calendar/api/v3/reference/events/list),
[mode JSON Mistral](https://docs.mistral.ai/studio/conversations/structured-output/json_mode),
[services Railway](https://docs.railway.com/services),
[commande de démarrage](https://docs.railway.com/deployments/start-command),
[autodéploiement GitHub](https://docs.railway.com/deployments/github-autodeploys).
