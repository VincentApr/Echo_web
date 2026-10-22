# Autorisations IA — tâche 4

Le front web et le backend sont deux dépôts distincts. Les changements serveur
se trouvent dans `backend-server` (dépôt `VincentApr/reseau_social`).

## Mise en service

Déployer le backend avec la migration
`jarvis/0006_jarvisinstance_permission_overrides`, puis le front web. La migration
est préparée mais n'a pas été exécutée sur une base existante pendant cette tâche.
Les nouvelles permissions héritent des quatre anciens scopes jusqu'à leur
modification explicite. Les PATCH fusionnent les actions modifiées.

Le serveur expose `permission_schema_version: 1` dans `/jarvis/instance/` et
`ai_policy_version: 1` dans le profil. Le front garde les commandes nouvelles
inactives si le serveur ne déclare pas leur prise en charge.

Le bouton global enregistre `User.ai_agents_enabled`. Il conserve les droits
individuels et bloque les déclenchements IA, les outils et les résumés. Les
conversations et les groupes avec un participant/membre ayant désactivé l'IA
sont protégés contre les lectures et les nouvelles réponses IA. Les anciens
messages d'un auteur ayant désactivé l'IA sont exclus des nouveaux contextes.
Un contrôle est refait avant la publication d'une réponse d'agent. Une requête
déjà transmise à un fournisseur avant la désactivation ne peut pas être rappelée.

## Vérifications

- `npm run build` et `npm test`.
- `npx playwright test tests/e2e/ai-settings.spec.ts` : API simulée, aucun compte réel.
- `python scripts/test-ai-permissions-backend.py` : vrais modèles et sérialiseurs
  Jarvis, fixtures pour les applications voisines, SQLite en mémoire. Ce test
  nécessite Django 5.1 et Django REST Framework. Aucun appel IA, Redis ou migration
  de base existante. Il ne remplace pas une validation d'intégration sur le backend complet.

## Aperçu isolé

Avec un Python disposant de ces dépendances :

```sh
ECHO_TEST_PYTHON=/chemin/vers/python node scripts/preview-ai-settings.mjs
```

Ouvrir `http://127.0.0.1:5174/`, puis Profil → Réglages → Modération →
Fonctionnalités IA. L'API sur le port 8001 utilise les vrais sérialiseurs et une
base temporaire en mémoire. Tous les services sont isolés de la production.
Les changements de l'aperçu disparaissent à son arrêt. Le serveur de développement
habituel sur le port 5173 conserve sa configuration.
