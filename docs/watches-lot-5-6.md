# Veilles — illustrations, notifications web et premier essai Gmail/GitHub

Ce document est le point d'entrée pour la mise en service par le mainteneur.

## Dépôts et ordre de mise en service

Deux dépôts distincts sont à récupérer :

- [Backend `reseau_social`, branche main](https://github.com/VincentApr/reseau_social/tree/main) :
  application Django `watches/`, migrations, worker et configuration des services.
- [Frontend `Echo_web`, branche main](https://github.com/VincentApr/Echo_web/tree/main) :
  interface, service worker et cette documentation sous `docs/watches-lot-5-6.md`.

Déployer d'abord le backend sur l'hébergement actuel de `api.echosocial.fr`,
appliquer ses migrations, configurer les services et lancer son worker ; déployer
ensuite le frontend. Un push Git ne garantit pas que ces opérations soient faites.
Le `Procfile` est une déclaration de processus : le worker doit être effectivement
créé sur l'hébergement utilisé. Ce guide ne présume pas que le backend soit sur Railway.

Les commandes de migration et de mise en service ci-dessous sont à exécuter par
le mainteneur sur son environnement. Aucune base existante n'a été migrée ici.
Un aide-mémoire est aussi présent dans le dépôt backend : `watches/DEPLOYMENT.md`.

## Ce qui est livré

- Illustrations générées par l'outil image de Mistral, dans une direction artistique
  commune. La grille, les ombres et le léger effet verre validés restent identiques.
- Génération dans le worker, au plus deux nouvelles illustrations par passage et
  quatre tentatives par utilisateur sur une fenêtre de vingt-quatre heures par
  défaut. Une image publiée est conservée quand le sujet évolue. Les échecs attendent
  six heures avant une nouvelle tentative, avec trois tentatives au maximum.
- Préférences dans « Fonctionnalités IA » : illustrations, notifications, plafond
  quotidien, heures calmes et fuseau horaire. L'arrêt général de l'IA est respecté.
- Web Push avec abonnement volontaire par appareil, service worker et lien vers
  la veille. Aucun prompt de permission n'apparaît automatiquement à la connexion.
- Connecteur GitHub en lecture seule, en plus de Gmail, Google Agenda et Echo.
- Boutons de connexion/reconnexion Google et GitHub pour préparer un vrai essai
  depuis la web app. La connexion Google d'authentification reste distincte de
  l'autorisation de lire Gmail ou l'agenda.

## Organisation et stockage

Le backend reste dans `watches/` : `artwork.py`, `push.py`, `preferences.py`,
modèles associés et tests. `run_watch_worker` effectue la génération et la
distribution des alertes, même sans session web ouverte. Les images sont privées,
normalisées en WebP 512 × 512, sans métadonnées d'origine, limitées à 200 ko et
stockées en base. Ce choix évite de rendre publiques des URL de stockage ; un
stockage objet privé pourra remplacer les octets en base si le volume le justifie.
Les images de sujets traités/expirés depuis trente jours sont purgées au passage
du générateur. La limite de tentatives peut être conservatrice lors d'un échec
ancien suivi d'une nouvelle tentative.

Le modèle texte choisit un motif parmi une liste fermée. L'outil image ne reçoit
que ce motif générique et la direction artistique : aucun nom, extrait de mail,
identifiant utilisateur ou titre de dépôt. Les images d'exemple locales proviennent
du skill imagegen ; les générations exécutées par l'application passent par Mistral.
Pour les demandes d'amis/invitations, le motif est fixe : leurs textes ne sont
pas envoyés au modèle de classification.

La route `GET /watches/<uuid>/artwork/` exige le propriétaire authentifié, les
droits actuels sur toutes les sources et l'autorisation IA. Les réponses sont
`private, no-store`. Le frontend utilise la même image pour la grille, la liste
latérale et le header, avec le visuel vectoriel existant comme repli.

## Notifications : comportement précis

- Désactivées par défaut. Le navigateur doit être compatible et l'utilisateur
  doit accorder son autorisation depuis un clic sur les réglages.
- Jusqu'à huit appareils, par défaut trois sujets par jour pour le compte entier
  (réglable de un à cinq), et silence de 22 h à 8 h dans le fuseau choisi.
- Seuls les sujets IA de priorité au moins 80 et les demandes/invitations natives
  sont concernés. Les composants d'un sujet groupé ne produisent pas de doublons.
- Les sujets déjà consultés, masqués, reportés, expirés ou devenus inaccessibles
  sont exclus. Les versions déjà présentes à l'activation restent silencieuses.
  Une vraie nouvelle activité peut produire une nouvelle alerte.
- Un heartbeat de page visible suspend les alertes pendant deux minutes après la
  dernière présence. Le worker examine les abonnements au plus toutes les cinq
  minutes ; la collecte des sources reste périodique, généralement trente minutes.
- Le reçu est réservé en base avant l'envoi, avec une unicité par sujet et empreinte.
  Une panne réseau ambiguë ou un arrêt du worker ne relance pas automatiquement
  cet envoi : livraison au mieux, sans promesse de livraison exactement une fois.
  Les tentatives réservées consomment le quota, même en cas d'échec.
- Les endpoints 404/410 sont retirés. Les destinations sont limitées aux services
  push connus des navigateurs, en HTTPS sans redirection. Les clés sont contrôlées.
- Le contenu est chiffré par Web Push. L'alerte affichée dit seulement « Echo — Une
  nouvelle veille vous attend. » Aucun extrait ni illustration privée n'est transmis.
  Les relais de transport sont ceux du navigateur (Apple, Google, Mozilla, etc.),
  distincts de l'hébergement européen du backend. Ils transportent le message chiffré.
- Le service worker mémorise seulement le compte lié dans IndexedDB, sans jeton
  d'authentification. Réception et clic vérifient ce compte ; une déconnexion ou un
  changement de compte empêche d'ouvrir une alerte de l'ancien compte.
  La déconnexion tente également de retirer l'abonnement de cet appareil, sans
  bloquer la sortie de session si le serveur est indisponible.
- Aucun cache hors ligne ni interception des requêtes de messagerie n'est ajouté.
  Un manifeste permet l'ouverture en mode application. Sur iPhone/iPad, utiliser
  l'application web ajoutée à l'écran d'accueil pour les notifications.

## Premier périmètre de services

| Service | Lecture actuellement branchée | Ce qui reste hors périmètre |
| --- | --- | --- |
| Gmail | Dix mails récents, métadonnées et extraits, résumés et liens vers le bon compte Google. | Pièces jointes, boîte complète, envoi automatique de mail. |
| Google Agenda | Trente événements du calendrier principal sur les sept jours à venir. | Tous les agendas secondaires et modification d'événements. |
| GitHub | Jusqu'à dix notifications récentes de mentions, assignations, revues et activité pertinente, métadonnées et lien vers issue/PR. | Code, diffs, commentaires complets, création de commits ou fusion. |
| Echo | Conversations autorisées, demandes d'amis et invitations. | Autres domaines internes non encore collectés. |

GitHub exige le scope OAuth `notifications` (ou un scope existant `repo`). Le
connecteur utilise uniquement la connexion chiffrée de cet utilisateur, jamais
un token partagé. Une notification lue hors d'Echo retire sa veille si la réponse
constitue un instantané complet. En cas de pagination ou de limite dépassée, le
collecteur ne déduit pas abusivement qu'une source absente a disparu ; son
expiration borne alors la durée de conservation dans le fil.

Le retour OAuth existant était limité aux deep links mobiles. La modification
dans `mistral_tools/views.py` ajoute le chemin web `/oauth/watch-callback/`, sur
une origine exacte autorisée par `CORS_ALLOWED_ORIGINS`. Le localhost est admis
uniquement en DEBUG. Les codes et états ne sont plus inscrits dans les logs de
ce parcours. Le frontend conserve l'état attendu en session, le lie au compte,
vérifie son âge et n'échange le code qu'une fois. Les scopes renvoyés par le
provider sont conservés lorsqu'ils sont fournis.

## Configuration à effectuer par le mainteneur

Ces commandes sont documentées, pas exécutées sur une base ou un compte réels ici.

1. Déployer le backend actuel de `api.echosocial.fr` avec ses dépendances, dont
   `pywebpush==2.5.0`. Appliquer les migrations watches jusqu'à
   `0005_artwork_and_web_push` et `0006_github_watches`, après les lots précédents.
   Depuis la racine de ce dépôt backend, la vérification puis l'application se font
   avec `python manage.py showmigrations watches` et `python manage.py migrate`.
   Le Procfile existant contient déjà une migration au démarrage du processus web ;
   sur un autre hébergement, utiliser sa procédure de release habituelle.
2. Garder `MISTRAL_API_KEY`, `ENCRYPTION_KEY` et les connexions OAuth existantes.
   Vérifier le compte/région Mistral retenu et ses droits sur l'outil image.
3. Créer une fois l'agent image dédié, sans autre outil :

   ```sh
   python manage.py create_watch_image_agent
   ```

   Reporter l'identifiant affiché dans `WATCHES_IMAGE_AGENT_ID`.
   `WATCHES_IMAGES_PER_DAY=4` est la valeur par défaut.
4. Générer une paire VAPID stable avec `py_vapid`, par exemple `vapid --gen`,
   puis `vapid --applicationServerKey`. Configurer :

   ```text
   WATCHES_VAPID_PUBLIC_KEY=<clé publique applicationServerKey, base64url non compressée>
   WATCHES_VAPID_PRIVATE_KEY=<chemin du fichier PEM privé disponible au worker>
   WATCHES_VAPID_SUBJECT=mailto:<adresse opérationnelle réelle>
   ```

   Garder le fichier privé hors de Git, stable entre les redémarrages. Le navigateur
   ne reçoit que la clé publique. Sans cette configuration, les boutons de
   notification indiquent que le serveur doit être configuré.
5. Vérifier les `OAuthProvider` Google/Gmail et GitHub dans l'admin. Demander
   `https://www.googleapis.com/auth/gmail.readonly` et éventuellement
   `https://www.googleapis.com/auth/calendar.readonly` à Google, `notifications`
   à GitHub. Enregistrer les callbacks exacts :

   ```text
   https://api.echosocial.fr/tools/oauth/callback/google/
   https://api.echosocial.fr/tools/oauth/callback/github/
   ```

   Si l'identifiant technique existant est `gmail`, adapter son callback au même
   identifiant. Le panneau réutilise les identifiants des connexions existantes.
   La validation du consentement Google dépend de la configuration du projet
   Google ; utiliser un compte de recette autorisé pour le premier essai.
6. Lancer `python manage.py run_watch_worker` comme processus permanent, avec la
   même base et les mêmes secrets que l'API. Déployer aussi le frontend et vérifier
   que `/watch-push-sw.js` est servi en JavaScript et sans cache long. Le serveur
   Express du dépôt est configuré en conséquence.
   Le frontend se construit avec `npm ci`, puis `npm run build` ; `npm start`
   sert le résultat avec le serveur Express du dépôt. Maintenir les routes SPA
   `/veilles/<uuid>` et `/oauth/watch-callback/` vers `index.html`.

Le worker doit pouvoir lire le fichier VAPID privé au chemin configuré ; l'API et
le worker doivent recevoir la même configuration VAPID, Mistral et chiffrement.
Conserver également Redis pour les états OAuth et la messagerie existante.
L'origine `https://web.echosocial.fr` doit être autorisée dans les paramètres CORS
et CSRF du backend. Vérifier toute surcharge existante de `JARVIS_INTERNAL_URL` :
la valeur attendue est `https://api.echosocial.fr`.

## Recette recommandée

1. Sur le serveur de recette, connecter Gmail depuis Profil → Réglages →
   Modération → Fonctionnalités IA → Services de veille. Vérifier « Gmail autorisé ».
2. Recevoir un mail de test appelant une réponse, demander/attendre une collecte,
   puis vérifier le résumé, l'image, le compte Google du lien et le brouillon agent.
   Vérifier aussi qu'une révocation Gmail retire le sujet et son illustration.
3. Connecter GitHub, provoquer une mention ou une demande de revue sur une PR de
   test et vérifier la veille et sa destination. Aucune écriture GitHub n'est faite.
4. Activer les notifications sur le navigateur de recette. Ajuster les heures
   calmes, quitter l'onglet, attendre au moins deux minutes puis créer une nouvelle
   activité pertinente (ou une demande d'ami). Vérifier livraison et ouverture du
   bon sujet, sans texte privé dans l'alerte.
5. Vérifier un second compte, un abonnement supprimé, la désactivation IA, le
   plafond quotidien et la déconnexion. Valider Safari/iOS séparément si ciblé.

Les tests locaux couvrent les vraies validations, la création des images privées,
les filtres et quotas, la déduplication, le chiffrement/signature Web Push, le
service worker et le retour OAuth. Google, GitHub et Mistral restent simulés dans
la suite isolée ; le transport réel vers les navigateurs et la concurrence sur
PostgreSQL restent à vérifier lors de cette recette.

Contrôles rapides après mise en service : avec un compte authentifié,
`GET /watches/` doit retourner un objet avec `results`, `POST /watches/refresh/`
doit retourner 202, puis `GET /watches/refresh/` permet de contrôler la fin de la
collecte et l'état de chaque source. Le statut `disconnected` est normal pour un
service non connecté ; `error` demande une vérification de sa configuration.
Les routes de réglages sont `GET/PATCH /watches/preferences/`.

Vérification finale : 77 tests backend isolés, 32 tests navigateur (veilles,
notifications, paramètres IA et fiabilité), suite unitaire web et build réussis.
Le lint des nouveaux modules passe. `AuthContext.tsx` conserve deux diagnostics
de lint déjà présents dans HEAD (export du hook et dépendances d'effet), vérifiés
sur la version d'origine ; aucune nouvelle erreur n'y est introduite par ce lot.

## Aperçu local

```sh
ECHO_WATCH_PREVIEW_MODE=experience ECHO_TEST_PYTHON=/chemin/vers/python node scripts/preview-watches.mjs
```

Ouvrir `http://127.0.0.1:5179/` (API en mémoire : 8006). Les données Gmail/GitHub
sont fictives, l'illustration de candidature est un exemple IA pré-généré et aucune
notification réelle ni connexion à un compte externe n'est déclenchée. Les réglages
et le service des images utilisent la vraie API locale. L'illustration et sa
consigne sont dans [scripts/fixtures/watches](../scripts/fixtures/watches/README.md).

## Références officielles

- [Mistral : génération et téléchargement d'images](https://docs.mistral.ai/studio/agents/agent-tools/image_generation).
- [GitHub : API des notifications et scopes](https://docs.github.com/en/rest/activity/notifications).
- [Web Push : chiffrement et abonnement](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription).
- [Apple : notifications web et service worker](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
- [pywebpush](https://github.com/web-push-libs/pywebpush) et [configuration VAPID](https://github.com/web-push-libs/vapid/tree/main/python).
