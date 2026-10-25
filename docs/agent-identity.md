# Carte d’identité et éditeur d’agents

Le catalogue et « Mes agents » utilisent `AgentIdentityCard` en variante compacte.
La fiche complète garde ses dimensions : les rubriques s’ouvrent à côté dans un
panneau de même hauteur, dont seul le contenu défile. Sur écran étroit, le panneau
recouvre la carte et les commandes masquées deviennent inertes. Échap ferme
la rubrique, puis quitte la modification ou ferme la fiche.

`AgentIdentityEditor` est partagé par la création et la modification. À la création,
la carte est vide et centrée. Le nom, la description, le portrait et les trois
rubriques ouvrent chacun leur panneau. Les saisies actualisent la carte sans
l’agrandir. Dans une fiche existante, « Modifier » présente le même éditeur ;
« Quitter la modification » abandonne le brouillon et retrouve la fiche de lecture.
Les données ne sont écrites que par « Créer mon agent » ou « Enregistrer ».
Les actions restent sur une ligne : la carte de lecture mesure 540 × 500 px sur
ordinateur ; sur mobile, les actions défilent sans barre, avec un fondu uniquement
aux bords où il reste du contenu. Le passage lecture/édition est animé et respecte
la réduction des animations. Les panneaux de saisie ne répètent pas leur titre.

Le portrait ne propose qu’un prompt. Aucun appel de génération d’image ou de résumé
n’est effectué. Les extraits de rubrique sont toujours calculés localement. Les
boutons d’action gardent le style blanc des headers. Le glissement et le reflet
restent disponibles et respectent la réduction des animations.

## Données et compatibilité

- Avatar : `avatar_url` ou `avatar`, puis initiale. Le prompt est `avatar_prompt`.
- Couleur : palette déterministe à partir de l’UUID, stable après renommage.
- Contexte : `identity_context: { text, documents: [{ name, content }] }`.
- Le `system_prompt` envoyé contient aussi les instructions et les références,
  afin que le moteur utilise réellement les documents. Ils sont des textes joints
  au prompt, sans stockage documentaire, extraction PDF ou indexation RAG.
- Les anciens agents sans contexte structuré conservent leur prompt. Seule
  l’enveloppe exacte du précédent créateur web sépare instructions et contexte ;
  la documentation ancienne reste du texte intégral dans le panneau Contexte.
- Une modification du prompt par un ancien client efface le contexte structuré
  devenu potentiellement obsolète, afin de ne pas masquer sa modification.
- Les nouveaux agents utilisent `POST /framework/agents/tools/` (ToolAgent).
  `tool_uuids` choisit les outils ; `GET /tools/` fournit le catalogue public.
  Le backend refuse les outils inactifs ou privés appartenant à un autre utilisateur.
- Les ToolAgent existants permettent la sélection d’outils. Les anciens MistralAgent
  gardent leur moteur : leurs instructions et leur contexte sont éditables mais
  leur outillage n’est pas convertible depuis cette interface. Les agents externes
  gardent la configuration d’instructions et de contexte de leur service.
- Visibilité : privé par défaut, amis ou public, via le même sélecteur en création
  et en modification. Seul le propriétaire peut enregistrer un changement. La création conserve l’ajout aux favoris et sa reprise sur erreur.

## Publication

Web app : `https://app.echosocial.fr`. API : `https://api.echosocial.fr`.

Les badges de lecture sont publiés dans Echo_web au commit `0da697f`.
L’éditeur ajoute une dépendance backend : déployer les modifications de
`reseau_social` et exécuter `python manage.py migrate` (migration
`agent.0017_agent_identity`) avant de déployer ce nouveau frontend. Aucun appel
IA ni nouvelle clé de fournisseur n’est nécessaire pour cette étape.

## Vérification

- `npm run build` et ESLint sur les fichiers concernés.
- `npx playwright test tests/e2e/agent-identity.spec.ts tests/e2e/agent-creation.spec.ts` :
  géométrie, panneaux, clavier, mobile, création, modification, annulation,
  conservation du contexte et du prompt de portrait, outils, favoris et erreurs.
  Ces tests simulent les API, sans écriture distante.
- Backend : `python manage.py test agent.test_identity` : création/lecture,
  conservation des champs, modification, accès aux outils, visibilité et validation.
  Vérifié localement sous Django 5.1.3 avec une base SQLite isolée, sans signaux
  de génération d’embeddings et sans les index vectoriels PostgreSQL.

## Suite

Générer le portrait depuis le prompt et les résumés des rubriques, avec reprise
sur erreur. Puis décliner cette identité dans l’application mobile.

## Collection et historique des agents

L’onglet agents regroupe les conversations par UUID d’agent (jamais par nom).
Les badges reprennent le format horizontal d’origine, ses dégradés pastel et ses
arrondis, avec un portrait mis en avant et le logo Echo en filigrane très discret.
Les cartes complètes partagent la géométrie de création et d’édition : nom et
description centrés, portrait de 188 px sur ordinateur. Le portrait et le nom restent fixes
en haut des badges compacts, avec le résumé dessous. Les cartes complètes gardent
l’identité à gauche et les rubriques à droite. La sélection agrandit le badge,
sans socle ni ombre ajoutée. Les reflets et l’inclinaison respectent la
préférence de réduction des animations. L’agent sélectionné reste mémorisé pour
la session et le compte ; le retour depuis une conversation retrouve sa collection.

L’historique charge les conversations par lots de huit. En l’absence de titre
fourni par l’API, le premier prompt utilisateur sert de titre. L’aperçu provient
du dernier message explicitement identifié comme non généré par IA, jamais de
la dernière réponse de l’agent. Les requêtes sont mises en cache et annulées lors
d’un changement de sélection. Un aperçu absent ou indisponible est indiqué.
Le bouton « Nouvelle conversation » utilise la route de création existante et
crée une session distincte pour l’agent sélectionné, sans migration backend.

Dans une conversation d’agent, la barre latérale reprend le même historique
(titres et aperçus), filtré par UUID d’agent, et indique la conversation active.

La collection utilise les marges de 24 px des autres grilles et toute la largeur
disponible. Ouvrir « Ajouter un agent » conserve la barre latérale fermée.
