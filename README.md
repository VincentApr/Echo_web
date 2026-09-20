# Echo Web

Application web Echo, hébergée sur <https://web.echosocial.fr> (le site vitrine
`EchoInternet` occupe `echosocial.fr` et y renvoie depuis son bouton
« Messagerie Web »).

## Sous-module mobile

`mobile_src` ([`VincentApr/Echo_social`](https://github.com/VincentApr/Echo_social))
est une **référence de développement uniquement**. Le build ne s'en sert jamais :
aucun fichier de `src/` ni aucune configuration n'y fait référence, et le script
[`scripts/check-web-independence.mjs`](scripts/check-web-independence.mjs) —
lancé automatiquement en `prebuild` — fait échouer la compilation si une
référence à `mobile_src` ou `@mobile` réapparaît.

Conséquence : la compilation réussit avec `mobile_src` vide. C'est exactement ce
qui se passe en production, Railway ne récupérant pas les sous-modules.

Pour disposer de la référence en local :

```sh
git submodule update --init
```

## Développement

```sh
npm ci
npm run dev
```

Le serveur de dev relaie `/api`, `/messaging`, `/ws`, etc. vers le backend (cf.
`vite.config.ts`). En production, `src/config/api.ts` bascule sur l'URL absolue
du backend : aucun relais n'est nécessaire.

## Déploiement (Railway)

```sh
npm ci
npm run build   # produit dist/
npm start       # sert dist/ via server.js
```

Configuration : [`railway.toml`](railway.toml), [`nixpacks.toml`](nixpacks.toml)
et [`server.js`](server.js) (Express, port `PORT`, repli SPA sur `index.html`).

Le domaine `web.echosocial.fr` doit figurer dans `CORS_ALLOWED_ORIGINS` et
`CSRF_TRUSTED_ORIGINS` du backend, sinon tous les appels API sont rejetés.

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
