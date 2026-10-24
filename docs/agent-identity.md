# Carte d’identité des agents — première passe visuelle

Le catalogue et « Mes agents » utilisent `AgentIdentityCard` en variante compacte.
La fiche complète utilise le même composant : la carte garde ses dimensions,
et les rubriques s’ouvrent dans un panneau distinct, de même hauteur, dont seul
le contenu défile. Sur écran étroit, le panneau recouvre la carte ; les commandes
masquées deviennent inertes. Échap ferme d’abord la rubrique puis la fiche.

Les actions existantes restent sous la carte. La modification ouvre elle aussi
un panneau extérieur et utilise le prompt complet chargé depuis l’API détail.
Le formulaire de création dispose d’un aperçu vivant, sans changer son contrat
de création actuel. Le glissement incline légèrement la carte et déplace un
reflet ; relâcher ou annuler le geste la remet à plat. La préférence de réduction
des animations désactive cet effet.

## Données utilisées actuellement

- Avatar : `avatar_url` ou `avatar`, puis initiale si absent ou inaccessible.
- Couleur : palette déterministe à partir de l’UUID, stable après renommage.
- Texte global : description existante ; rubriques : extraits, **pas des résumés IA**.
- Instructions et outils : API `GET /framework/agents/{uuid}/`. Les outils
  utilisent le `display_name` du serializer Django.
- Contexte ancien : seule l’enveloppe exacte écrite par le formulaire web est
  reconnue. Son contenu reste intégralement lisible. Aucun document n’est inventé
  à partir d’un prompt libre. L’éditeur conserve le prompt original complet.
- Dans l’aperçu, les fichiers sont distincts parce que le formulaire connaît
  encore leurs noms et leurs contenus. Le backend continue de recevoir le format
  historique jusqu’à la migration du contexte.

## Suite après validation visuelle

Structurer le contexte et les documents côté backend, enregistrer les quatre
résumés générés et la couleur, générer le portrait à la création avec reprise
sur erreur, puis décliner le badge dans l’application mobile. La construction
guidée de la carte pourra ensuite remplacer le formulaire actuel.

## Vérification

`npm run build` et ESLint sur les fichiers concernés.

`npx playwright test tests/e2e/agent-identity.spec.ts tests/e2e/agent-creation.spec.ts`
vérifie les dimensions, le défilement indépendant, les détails chargés depuis
l’API, la conservation des instructions à l’édition, les erreurs/reprises,
le petit écran, le clavier, le glissement et les parcours de création existants.
Les API de ces tests sont simulées, sans écriture sur le backend distant.
