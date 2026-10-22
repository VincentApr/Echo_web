import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { JarvisProvider } from './contexts/JarvisContext'
import { NavigationProvider, useNavigation } from './contexts/NavigationContext'
import { WebSocketProvider } from './contexts/WebSocketContext'
import AppLayout from './components/layout/AppLayout'
import type { PageId } from './components/layout/Sidebar'
import HomePage from './pages/HomePage'
import WatchPage from './pages/WatchPage'
import WatchOAuthCallbackPage from './pages/WatchOAuthCallbackPage'
import { WatchList } from './components/watches/WatchList'
import { useWatchRefreshOnSession } from './hooks/useWatches'
import { useWatchNotifications } from './hooks/useWatchNotifications'
import LoginPage from './pages/LoginPage'
import ProfilePage from './pages/ProfilePage'
import PlaceholderPage from './pages/PlaceholderPage'
import MarketplacePage from './pages/MarketplacePage'
import ConversationsPage from './pages/ConversationsPage'
import AddFriendPage from './pages/AddFriendPage'
import CreateGroupPage from './pages/CreateGroupPage'
import AddAgentPage from './pages/AddAgentPage'
import ConversationsPanel from './components/panels/ConversationsPanel'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

function AppContent() {
  useWatchRefreshOnSession();
  useWatchNotifications();
  const { watchUuid } = useNavigation();
  const { isLoggedIn, loading, user } = useAuth();

  const renderPage = (activePage: PageId) => {
    if (loading) return null;
    if (!isLoggedIn) return <LoginPage />;
    if (window.location.pathname === '/oauth/watch-callback/') return <WatchOAuthCallbackPage />;

    if (user?.ai_agents_enabled === false && ['agents', 'add-agent', 'marketplace'].includes(activePage)) return <HomePage />;

    switch (activePage) {
      case 'watch':
        return <WatchPage key={watchUuid} />;
      case 'home':
        return <HomePage />;
      case 'conversations':
      case 'groups':
      case 'agents':
        return <ConversationsPage />;
      case 'add-friend':
        return <AddFriendPage />;
      case 'add-group':
        return <CreateGroupPage />;
      case 'add-agent':
        return <AddAgentPage />;
      case 'marketplace':
        return <MarketplacePage />;
      case 'profile':
        return <ProfilePage />;
      default:
        return <HomePage />;
    }
  };

  const renderPanelContent = (activePage: PageId, onSearchExpansionChange: (expanded: boolean) => void, columns: number) => {
    if (!isLoggedIn) return null;

    if (activePage === 'watch') return <WatchList columns={columns} />;
    const filterMap: Partial<Record<PageId, 'private' | 'groups' | 'agents'>> = {
      conversations: 'private',
      groups: 'groups',
      agents: 'agents',
      'add-friend': 'private',
      'add-group': 'groups',
      'add-agent': 'agents',
    };
    const filter = filterMap[activePage];
    if (!filter) return null;
    return <ConversationsPanel filter={filter} onSearchExpansionChange={onSearchExpansionChange} columns={columns} />;
  };

  return (
    <AppLayout panelContent={renderPanelContent}>
      {renderPage}
    </AppLayout>
  );
}

function SessionProviders() {
  const { user } = useAuth();
  return (
    <NavigationProvider key={user?.uuid || 'anonymous'}>
      <WebSocketProvider>
        <JarvisProvider>
          <AppContent />
        </JarvisProvider>
      </WebSocketProvider>
    </NavigationProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SessionProviders />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App
