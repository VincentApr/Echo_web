# Echo Web

Application web Echo, hébergée sur <https://app.echosocial.fr> (le site vitrine
`EchoInternet` occupe `echosocial.fr` et y renvoie depuis son bouton
« Messagerie Web »).

## Sous-module mobile

`mobile_src` ([`VincentApr/Echo_social`](https://github.com/VincentApr/Echo_social))
est une **référence de développement uniquement**. Le build ne s'en sert jamais :
aucun fichier de `src/` ni aucune configuration n'y fait référence, et le script
[`scripts/check-web-independence.mjs`](scripts/check-web-independence.mjs) —
lancé automatiquement en `prebuild` — fait échouer la compilation si une
référence à `mobile_src` ou `@mobile` réapparaît.

Conséquence : la compilation réussit avec `mobile_src` vide, sans récupération
du sous-module en production.

Pour disposer de la référence en local :

```sh
git submodule update --init
```

## Développement

```sh
npm ci
npm run dev
```

Le backend public est `https://api.echosocial.fr` (WebSockets :
`wss://api.echosocial.fr`). Le serveur de dev relaie `/api`, `/messaging`, `/ws`, etc. vers ce backend (cf.
`vite.config.ts`). En production, `src/config/api.ts` bascule sur l'URL absolue
du backend : aucun relais n'est nécessaire.

## Déploiement

```sh
npm ci
npm run build   # produit dist/
npm start       # sert dist/ via server.js
```

Serveur : [`server.js`](server.js) (Express, port `PORT`, repli SPA sur `index.html`).
Les fichiers `railway.toml` et `nixpacks.toml` proviennent de l’ancien hébergement.

Le domaine `app.echosocial.fr` doit figurer dans `CORS_ALLOWED_ORIGINS` et
`CSRF_TRUSTED_ORIGINS` du backend, sinon tous les appels API sont rejetés.

L'accueil intelligent nécessite aussi le déploiement du backend `watches`, ses
migrations et un processus worker distinct sur l'hébergement du backend. Publier le seul dépôt web ne
suffit pas. L'ordre de mise en service et les commandes sont décrits dans
le [guide de mise en service et de recette](docs/watches-lot-5-6.md).
Les détails du moteur initial sont conservés dans
[`docs/watches-lot-2.md`](docs/watches-lot-2.md).

Pour lancer la simulation isolée dans ce checkout, cloner séparément le backend
`VincentApr/reseau_social` dans `backend-server/` ; ce dossier est ignoré par le
dépôt web et se publie depuis son propre dépôt Git.
Le regroupement des sources et sa migration supplémentaire sont décrits dans
[`docs/watches-lot-3.md`](docs/watches-lot-3.md).
La recommandation d'agents, le brouillon de contexte et la migration associée sont
décrits dans [`docs/watches-lot-4.md`](docs/watches-lot-4.md).
Les illustrations, notifications web et le premier essai Gmail/GitHub sont décrits
dans [`docs/watches-lot-5-6.md`](docs/watches-lot-5-6.md).

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
