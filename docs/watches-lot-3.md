# Veilles — lot 3 : sujets communs

Les informations liées provenant de Gmail, Agenda ou Echo peuvent former une seule
veille, avec un résumé commun et un bouton par source. L'organisation visuelle
validée reste identique : carré, header de conversation, texte et actions.

## Organisation backend

Tout reste dans l'application Django `watches` :

- `topics.py` sélectionne au plus trente sources actives et accessibles, demande
  leur regroupement, conserve les identités de sujets et publie les associations.
- `intelligence.py` contient une seconde consigne Mistral. Elle demande des liens
  concrets, privilégie les sujets séparés en cas de doute et borne chaque groupe à
  quatre sources. Une source seule conserve son résumé et sa présentation.
- `access.py` regroupe les contrôles d'affichage employés par l'API et le moteur.
- `WatchItem.kind = topic` représente le sujet commun. Les sources individuelles
  restent des WatchItem avec une clé étrangère vers ce sujet. Leurs droits d'accès
  et cibles d'action restent indépendants ; les modèles des autres apps sont réutilisés.

Les demandes d'amis et invitations natives sont exclues de ce rapprochement.
Elles gardent leurs propres décisions et restent disponibles sans IA.

## Comportement et garanties

- Mistral doit répartir chaque référence fournie exactement une fois : les sources
  inventées, omises ou dupliquées invalident toute la réponse de regroupement.
  Les groupes et les longueurs de texte sont bornés ; aucun outil n'est exécuté.
- Le regroupement utilise les résumés déjà autorisés, avec leurs dates. Aucun
  extrait brut supplémentaire n'est conservé. La qualité sémantique du rapprochement
  devra aussi être évaluée sur de vrais cas ; les contrôles de référence ne peuvent
  pas prouver qu'un rapprochement proposé par le modèle est pertinent.
- Les identifiants sont réutilisés par recouvrement de sources quand un sujet
  évolue. Une empreinte du contenu évite une nouvelle synthèse à chaque collecte.
- Un sujet groupé remplace ses composants dans le fil. Les composants réapparaissent
  individuellement si le résumé commun est périmé ou inaccessible. Les sujets actifs
  valides en dehors de la sélection bornée sont conservés.
- L'accès à TOUTES les sources est requis pour montrer leur résumé commun, y compris
  dans l'historique. Une révocation, une expiration ou une nouvelle version d'une
  source retire le résumé commun de l'affichage immédiatement lors de la prochaine
  lecture API. Les autres sources encore autorisées restent affichables seules.
- Masquer ou reporter un sujet applique la décision aux sources concernées. Une
  activité inchangée ne fait pas réapparaître ces sources. Les mises à jour sont
  conditionnées à leur empreinte pour préserver une nouvelle information concurrente.
- Le worker recontrôle son bail et l'état des sources avant publication. Une décision
  prise par l'utilisateur pendant la génération n'est pas écrasée. Une réponse IA
  invalide conserve les sources individuelles et les résumés encore valides.

## API et frontend

Le schéma des veilles ajoute le type `topic`. Son `payload.source_label` décrit
brièvement ses services, par exemple `Gmail · Agenda`.

Une action d'ouverture peut inclure un `source_uuid`. Le frontend le renvoie au
serveur avec `action: open_source`. Le serveur vérifie que la source appartient à
la veille et à l'utilisateur, relit ses autorisations, puis fournit la navigation.
Une référence étrangère ou extérieure au sujet est refusée. Les URLs restent
construites/validées par le serveur ; le modèle ne choisit pas les destinations.

Les sources du même service reçoivent des libellés distincts. Consulter une source
ne marque pas le sujet comme terminé et n'envoie aucun message.

## Migration et validation

Migration supplémentaire préparée : `watches/0003_watch_topics`. Aucune migration
n'est exécutée sur une base existante ici. À appliquer avec les migrations des lots
précédents lors du déploiement par le mainteneur du serveur.

```sh
python scripts/test-watches-backend.py
npm run build
npx playwright test tests/e2e/watches.spec.ts
```

La suite backend isolée inclut `watches.test_topics`, avec les vraies fonctions de
validation, regroupement, persistance et accès. Google et Mistral sont simulés.
Restent la recette sur de vraies données et les vérifications de concurrence sur
PostgreSQL dans l'environnement complet du backend.

Un aperçu distinct est disponible :

```sh
ECHO_WATCH_PREVIEW_MODE=topics ECHO_TEST_PYTHON=/chemin/vers/python node scripts/preview-watches.mjs
```

Ouvrir `http://127.0.0.1:5177/`, API en mémoire sur le port 8004. Le mail et
l'événement de candidature sont regroupés par le vrai moteur, avec des réponses
IA fictives explicites. Les aperçus des lots précédents gardent leurs ports.

Le relais vers un agent est traité dans le [lot 4](watches-lot-4.md).
Les illustrations générées restent à traiter. Aucun déploiement ni appel aux
services réels n'est effectué.
