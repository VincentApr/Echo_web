# Inventaire des dépendances envers Echo_social

État relevé le 20 septembre 2026. Cette étape est strictement documentaire : aucun import ni comportement n'a été modifié.

## Résumé

- `mobile_src` est un sous-module Git pointant sur `Echo_social` (`cf23b917`, branche `main`).
- 31 fichiers sous `src/` utilisent au moins un import `@mobile/...`.
- La majorité de ces imports sont déjà interceptés par Vite et TypeScript et redirigés vers des implémentations web dans `src/stubs/`.
- Deux fonctions et un asset sont encore consommés directement depuis `mobile_src`.
- Les alias génériques `@mobile/*` et `@/*` rendent encore le build dépendant de la présence du sous-module.

## Dépendances directes réelles

### Service de conversation Jarvis

Fichier mobile exécuté par le web :

- `mobile_src/services/jarvisAgentConversation.ts`

Fonctions utilisées :

- `sendTemporaryJarvisAgentMessage`
- `archiveConversation`

Consommateurs web :

- `src/contexts/JarvisContext.tsx`
- `src/pages/HomePage.tsx`

Dépendance transitive mobile supplémentaire :

- `mobile_src/constants/jarvisAgent.ts` pour `JARVIS_AGENT_UUID`

Les imports `@/config/api` et `@/services/apiClient` effectués à l'intérieur du service mobile sont interceptés par les alias Vite et utilisent actuellement les stubs web.

### Asset partagé

Asset mobile chargé par le bundle web :

- `mobile_src/assets/images/logo-watermark.png`

Consommateurs web :

- `src/pages/HomePage.tsx`
- `src/components/layout/WebBottomBar.tsx`

## Imports redirigés vers des implémentations web

Ces chemins ont une apparence mobile, mais Vite et TypeScript les redirigent vers `src/stubs` :

| Import actuel | Implémentation réellement utilisée |
| --- | --- |
| `@mobile/config/api` | `src/stubs/api.ts` |
| `@mobile/services/apiClient` | `src/stubs/apiClient.ts` |
| `@mobile/types/api` | `src/stubs/api-types.ts` |
| `@mobile/constants/cgu` | `src/stubs/cgu-constants.ts` |
| `@mobile/utils/cgu` | `src/stubs/cgu-utils.ts` |
| `@mobile/utils/storage` | `src/stubs/storage.ts` |
| `@mobile/utils/notifications` | `src/stubs/notifications.ts` |
| `@mobile/services/DatabaseManager` | `src/stubs/DatabaseManager.ts` |
| `@mobile/utils/CacheManager` | `src/stubs/CacheManager.ts` |
| `@mobile/utils/networkErrors` | `src/stubs/networkErrors.ts` |
| `@mobile/utils/routeParams` | `src/stubs/routeParams.ts` |

Les imports les plus répandus sont `fetchWithAuth` et `API_BASE_URL`. Ils sont présents dans les contextes, hooks, pages, composants de profil et services de synchronisation, mais ils n'exécutent déjà plus le code React Native.

## Fichiers web contenant des imports `@mobile`

### Contextes

- `src/contexts/AuthContext.tsx`
- `src/contexts/JarvisContext.tsx`
- `src/contexts/WebSocketContext.tsx`

### Hooks

- `src/hooks/useAgentFramework.ts`
- `src/hooks/useConversations.ts`
- `src/hooks/useFriendRequests.ts`
- `src/hooks/useGroupInvitations.ts`
- `src/hooks/useMessages.ts`
- `src/hooks/useNotificationsSummary.ts`

### Services

- `src/services/groupCreation.ts`
- `src/services/jarvisInteractionService.ts`
- `src/services/localSync.ts`

### Pages

- `src/pages/AddAgentPage.tsx`
- `src/pages/AddFriendPage.tsx`
- `src/pages/ConversationManagementPage.tsx`
- `src/pages/CreateGroupPage.tsx`
- `src/pages/HomePage.tsx`
- `src/pages/MarketplacePage.tsx`
- `src/pages/ProfilePage.tsx`

### Composants

- `src/components/conversations/MessageBubble.tsx`
- `src/components/layout/WebBottomBar.tsx`
- `src/components/panels/AddFriendModal.tsx`
- `src/components/panels/ConversationsPanel.tsx`
- `src/components/profile/ExpandedCalendar.tsx`
- `src/components/profile/ExpandedFriends.tsx`
- `src/components/profile/ExpandedStats.tsx`
- `src/components/profile/SettingsAiFeatures.tsx`
- `src/components/profile/SettingsArchivedConversations.tsx`
- `src/components/profile/SettingsBlockedUsers.tsx`
- `src/components/profile/SettingsMyReports.tsx`
- `src/components/profile/SettingsOAuth.tsx`

## Références documentaires sans dépendance d'exécution

Ces références peuvent rester après la migration si leur origine est utile :

- commentaire d'adaptation dans `src/contexts/AuthContext.tsx` ;
- commentaire de provenance des couleurs dans `src/styles/theme.ts` ;
- commentaires descriptifs dans certains fichiers de `src/stubs`.

Elles ne nécessitent pas la présence de `mobile_src`.

## Configuration qui maintient le couplage

### `vite.config.ts`

- alias générique `@mobile` vers `./mobile_src` ;
- alias générique `@/` vers `./mobile_src/` ;
- alias spécifiques qui interceptent les modules déjà adaptés au web ;
- alias `react-native` vers `react-native-web`, potentiellement devenu inutile après extraction du dernier service mobile.

### `tsconfig.app.json`

- onze chemins spécifiques vers `src/stubs` ;
- chemin générique `@mobile/*` vers `mobile_src/*` ;
- chemin générique `@/*` vers `mobile_src/*` ;
- exclusion explicite de `mobile_src`, les fichiers importés restant néanmoins résolus par le bundler.

## Critère de sortie pour la suite

Echo_web sera indépendant lorsque les commandes suivantes ne retourneront plus de dépendance de compilation :

```bash
rg "@mobile|mobile_src" src vite.config.ts tsconfig.app.json
npm run build
```

Les seules occurrences tolérables seront alors des commentaires de provenance ou ce document d'inventaire.
