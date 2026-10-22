# Modération des groupes

Depuis la page de gestion : actions directement à droite des membres, sans menu.
Une confirmation courte permet de choisir la durée du mute (1 h, 24 h, 7 jours,
illimité) et de saisir un motif. Les bannis apparaissent dans leur propre section.

- Le propriétaire peut sanctionner les membres/modérateurs et gérer les rôles.
- Un modérateur ne peut sanctionner que les membres ordinaires.
- Aucun utilisateur ne peut sanctionner le propriétaire ou lui-même.
- Un mute laisse la lecture accessible mais interdit les messages (texte/fichiers)
  et le déclenchement des agents. L'expiration est appliquée par le serveur.
- Exclure retire l'adhésion ; bannir interdit aussi toute nouvelle adhésion.
- Lever un bannissement autorise une nouvelle invitation/demande : cela ne réinscrit
  pas automatiquement la personne. Les rôles ne sont pas restaurés.
- La politique IA et le blocage individuel de l'accès IA sont appliqués aux appels
  manuels et automatiques. Une suspension d'agent concerne tout le groupe ; sa
  réautorisation laisse ses anciennes configurations automatiques désactivées.
- Le serveur revérifie les droits avant de lire le contexte et avant de publier une
  réponse IA. Un appel externe déjà parti ne peut pas être annulé rétroactivement.
- Les sanctions sont journalisées. Les personnes exclues/bannies perdent leur
  participation aux conversations, y compris les abonnements WebSocket ouverts.
- Les sanctions concernent le groupe choisi, sans propagation aux sous-groupes.

## Déploiement par le collègue

Déployer le backend et appliquer sa migration `groups.0006_group_agent_moderation`,
puis déployer la web app. Aucune migration n'a été appliquée à une base existante
pendant cette implémentation. Le backend est un dépôt séparé (`backend-server`).

Nouvelles routes : `GET /groups/{uuid}/moderation/` et
`PATCH /groups/{uuid}/agents/{agent_uuid}/moderation/` (`block` / `unblock`).
L'API des membres accepte désormais `unban`. Les contrôles restent désactivés si
le nouveau point d'entrée de modération ne peut pas être chargé.

## Vérification locale

```sh
/tmp/echo-ai-venv/bin/python scripts/test-group-moderation-backend.py
npm run build
npx playwright test tests/e2e/group-moderation.spec.ts
ECHO_TEST_PYTHON=/tmp/echo-ai-venv/bin/python node scripts/preview-group-moderation.mjs
```

Simulation : http://127.0.0.1:5181/ → Escapades → nom du groupe → Membres.
Vraies règles et API de modération, SQLite temporaire, données fictives, aucun
service IA ni compte réel. Redémarrer la simulation réinitialise les données.
