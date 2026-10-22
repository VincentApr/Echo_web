# Veilles — lot 4 : proposer un agent et préparer la discussion

Une veille peut proposer « Discuter avec Recherche de stage », par exemple. Le clic
ouvre une conversation privée avec cet agent et prépare un brouillon modifiable
qui reprend le résumé de la veille. Aucun message n'est envoyé à l'ouverture.

## Backend

Le code reste dans l'application Django `watches` :

- `agents.py` sélectionne le catalogue autorisé, demande la recommandation à Mistral,
  valide ses références, conserve le résultat et prépare le relais au clic.
- `WatchAgentSuggestion` conserve un choix par veille, y compris une absence de
  correspondance. Son UUID d'agent est résolu à chaque utilisation contre le
  catalogue actuel ; ce stockage n'accorde aucun droit sur l'agent.
- Le worker exécute cette étape après le regroupement en sujets communs. Une erreur
  de recommandation n'empêche pas d'afficher les veilles et leurs actions de source.
- La migration supplémentaire est `watches/0004_watch_agent_suggestion`. Elle est
  préparée, sans exécution sur une base existante.

Le catalogue comprend les agents actifs créés par l'utilisateur ou ajoutés à ses
favoris, accessibles selon les règles existantes `agent.utils`. Les agents privés
d'autres personnes sont exclus ; les agents « amis » nécessitent une relation
encore acceptée. Le périmètre est borné aux quarante premiers agents par identifiant
interne, et aux trente veilles actives prioritaires. Les demandes d'amis et
invitations natives restent exclues de la recommandation.

L'autorisation `agents.read`, l'arrêt général IA et l'état actif de Jarvis sont
contrôlés avant de lire le catalogue. Mistral reçoit les noms/descriptions d'agents
et les résumés déjà autorisés des sujets ; il peut choisir une référence fournie ou
`null`. Des références inventées, omises ou dupliquées invalident toute sa réponse.
Les consignes interdisent de suivre des instructions présentes dans ces données.
Le cache dépend du contenu de la veille et du catalogue. Une modification invalide
la proposition jusqu'au prochain passage du worker. La pertinence sémantique du
choix reste à évaluer sur de vrais exemples en recette.

Avant publication, le worker recontrôle son bail, les autorisations, le contenu et
les décisions utilisateur. Au clic, le serveur relit la veille et vérifie à nouveau
toutes ses sources, le catalogue et le choix proposé. Une source révoquée, un résumé
périmé, un agent désactivé, un sujet masqué/reporté/expiré ou une référence étrangère
empêchent le relais.

Le relais réutilise une conversation `ai_agent` non archivée avec cet agent et
l'utilisateur comme seul participant. À défaut, il appelle le service existant
`messaging.services.AgentConversationService`. Un verrou par utilisateur évite les
doublons entre clics simultanés sur des veilles. Aucun message, appel d'agent ou
outil n'est créé par cette opération. La veille reste ouverte, sans être marquée
comme résolue.

## API et frontend

Une action peut désormais être :

```json
{"id":"discuss_agent","label":"Discuter avec Recherche de stage","agent_uuid":"…"}
```

Le frontend la renvoie au même endpoint authentifié `POST /watches/<uuid>/` avec
`action: discuss_agent` et cet `agent_uuid`. Une cible différente de la proposition
actuelle est refusée. La réponse ajoute une navigation `agent_conversation` avec
l'identifiant de conversation, les informations actuelles de l'agent et un texte
de brouillon construit par le serveur, sans nouvelle génération au clic.

La page de veille conserve son résumé et ses boutons. Le relais ouvre l'interface
de conversation existante. Son brouillon reste dans le stockage local déjà utilisé
pour les conversations, isolé par compte et conversation. Un texte existant est
conservé avant le contexte ; les envois récupérables sont conservés ; rouvrir la
même veille ne duplique pas un contexte identique. Le mode Jarvis et une éventuelle
réponse ciblée sont retirés pour adresser le nouveau texte à l'agent choisi.
Le champ s'agrandit aussi pour les brouillons préremplis, dans sa limite existante.

L'envoi ultérieur passe par le fonctionnement habituel de la conversation et les
droits propres à l'agent. Ce lot n'ajoute pas d'outils aux agents, ne garantit pas
qu'un agent puisse envoyer un mail et n'implémente pas d'exécution directe de mail.

## Vérification et aperçu

```sh
python scripts/test-watches-backend.py
npm run build
npx playwright test tests/e2e/watches.spec.ts
```

Les tests backend isolés utilisent les vrais contrôles de visibilité des agents et
le vrai service de création de conversation, avec des modèles voisins simplifiés.
Ils couvrent le cache positif/négatif, les révocations, les références invalides,
les décisions prises pendant la sélection, les baux expirés, l'isolation des
comptes et la réutilisation des conversations. Les tests navigateur vérifient le
brouillon modifiable, sa conservation, l'absence de doublon et l'absence d'envoi
automatique. La concurrence PostgreSQL et les appels Mistral/Google réels restent
à vérifier dans l'environnement complet après déploiement par le mainteneur.

```sh
ECHO_WATCH_PREVIEW_MODE=agents ECHO_TEST_PYTHON=/chemin/vers/python node scripts/preview-watches.mjs
```

Ouvrir `http://127.0.0.1:5178/` → « Votre candidature de stage » → « Discuter avec
Recherche de stage ». L'API en mémoire écoute sur 8005. Les services et choix IA
sont explicitement simulés, mais la persistance, le relais et la création de
conversation passent par le vrai code métier. Le serveur de simulation ne propose
pas l'exécution de l'agent : il sert à relire le brouillon sans connexion réelle.

Les illustrations générées et les notifications hors application restent à traiter.
Aucun déploiement, commit ou push n'est réalisé dans ce lot.
