import { useCallback, useEffect, useState } from 'react';
import Sidebar, { type PageId } from './Sidebar';
import WebBottomBar from './WebBottomBar';
import { getSidebarPanelWidthForColumns, SIDEBAR_PANEL_MAX_WIDTH, SIDEBAR_PANEL_MIN_WIDTH } from '../../styles/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';
import './AppLayout.css';

interface AppLayoutProps {
  children: (activePage: PageId) => React.ReactNode;
  panelContent: (activePage: PageId, onSearchExpansionChange: (expanded: boolean) => void, columns: number) => React.ReactNode | null;
}

const PAGES_WITH_PANEL: PageId[] = ['watch', 'conversations', 'groups', 'agents', 'add-friend', 'add-group', 'add-agent'];

export default function AppLayout({ children, panelContent }: AppLayoutProps) {
  const { user, isLoggedIn, logout } = useAuth();
  const { currentPage, navigate, isSidebarPanelOpen, conversationView, selectedConversation } = useNavigation();
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [savedPanelWidth, setSavedPanelWidth] = useState(() => {
    const stored = Number(localStorage.getItem('echo:sidebar-panel-width'));
    return Number.isFinite(stored) ? Math.min(SIDEBAR_PANEL_MAX_WIDTH, Math.max(SIDEBAR_PANEL_MIN_WIDTH, stored)) : getSidebarPanelWidthForColumns(2);
  });
  const [isResizingPanel, setIsResizingPanel] = useState(false);

  const isPanelOpen = PAGES_WITH_PANEL.includes(currentPage) && (isSidebarPanelOpen || currentPage === 'watch');
  const isImmersivePage = currentPage === 'watch' || currentPage === 'add-friend' || currentPage === 'add-group' || currentPage === 'add-agent' || currentPage === 'marketplace' || currentPage === 'profile';
  const panelWidth = Math.max(savedPanelWidth, isSearchExpanded ? getSidebarPanelWidthForColumns(2) : SIDEBAR_PANEL_MIN_WIDTH);
  const panelColumns = panelWidth >= getSidebarPanelWidthForColumns(3) ? 3 : panelWidth >= getSidebarPanelWidthForColumns(2) ? 2 : 1;
  const handleSearchExpansionChange = useCallback((expanded: boolean) => setIsSearchExpanded(expanded), []);
  const handlePanelWidthChange = useCallback((width: number) => {
    setSavedPanelWidth(Math.min(SIDEBAR_PANEL_MAX_WIDTH, Math.max(SIDEBAR_PANEL_MIN_WIDTH, width)));
  }, []);
  const handlePanelResizeEnd = useCallback((width: number) => {
    const snapWidths = [1, 2, 3].map(getSidebarPanelWidthForColumns);
    const snapped = snapWidths.reduce((closest, candidate) => Math.abs(candidate - width) < Math.abs(closest - width) ? candidate : closest);
    setSavedPanelWidth(snapped);
    localStorage.setItem('echo:sidebar-panel-width', String(snapped));
    setIsResizingPanel(false);
  }, []);

  useEffect(() => setIsSearchExpanded(false), [currentPage, isSidebarPanelOpen]);

  const userPhoto = user?.photo_profil_url || user?.photo_profil || null;
  const userName = user?.username || user?.first_name || undefined;

  return (
    <div className={`app-layout ${currentPage === 'watch' ? 'app-layout--watch' : ''}`}>
      <div className="app-layout__body">
        <Sidebar
          activePage={currentPage}
          onNavigate={navigate}
          panelContent={isPanelOpen ? panelContent(currentPage, handleSearchExpansionChange, panelColumns) : null}
          panelWidth={panelWidth}
          isPanelOpen={isPanelOpen}
          isResizing={isResizingPanel}
          onResizeStart={() => setIsResizingPanel(true)}
          onPanelWidthChange={handlePanelWidthChange}
          onResizeEnd={handlePanelResizeEnd}
          userPhoto={userPhoto}
          userName={userName}
          isLoggedIn={isLoggedIn}
          onLogout={logout}
        />

        <div className={`app-layout__foreground ${isPanelOpen ? 'app-layout__foreground--panel-open' : ''}`}>
          <main className={`app-layout__main ${currentPage === 'home' ? 'app-layout__main--home' : ''} ${currentPage === 'marketplace' ? 'app-layout__main--marketplace' : ''} ${currentPage === 'profile' ? 'app-layout__main--profile' : ''} ${PAGES_WITH_PANEL.includes(currentPage) ? 'app-layout__main--conversation' : ''}`}>
            {children(currentPage)}
          </main>

          {conversationView !== 'management' && !isImmersivePage && <WebBottomBar key={`${user?.uuid || 'guest'}:${selectedConversation?.uuid || 'home'}`} />}
        </div>
      </div>
    </div>
  );
}
