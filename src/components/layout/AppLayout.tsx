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
  const { currentPage, navigate, isSidebarPanelOpen, toggleSidebarPanel, conversationView, selectedConversation } = useNavigation();
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [savedPanelWidth, setSavedPanelWidth] = useState(() => {
    const stored = Number(localStorage.getItem('echo:sidebar-panel-width'));
    return Number.isFinite(stored) ? Math.min(SIDEBAR_PANEL_MAX_WIDTH, Math.max(SIDEBAR_PANEL_MIN_WIDTH, stored)) : getSidebarPanelWidthForColumns(2);
  });
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const isConversationHome = ['conversations', 'groups', 'agents'].includes(currentPage) && !selectedConversation;

  const isPanelOpen = PAGES_WITH_PANEL.includes(currentPage) && (isSidebarPanelOpen || currentPage === 'watch' || (dragWidth !== null && dragWidth > 0));
  const isImmersivePage = isConversationHome || currentPage === 'watch' || currentPage === 'add-friend' || currentPage === 'add-group' || currentPage === 'add-agent' || currentPage === 'marketplace' || currentPage === 'profile';
  const panelWidth = dragWidth ?? Math.max(savedPanelWidth, isSearchExpanded ? getSidebarPanelWidthForColumns(2) : SIDEBAR_PANEL_MIN_WIDTH);
  const panelColumns = panelWidth >= getSidebarPanelWidthForColumns(3) ? 3 : panelWidth >= getSidebarPanelWidthForColumns(2) ? 2 : 1;
  const handleSearchExpansionChange = useCallback((expanded: boolean) => setIsSearchExpanded(expanded), []);
  const handlePanelWidthChange = useCallback((width: number) => {
    setDragWidth(Math.min(SIDEBAR_PANEL_MAX_WIDTH, Math.max(currentPage === 'watch' ? SIDEBAR_PANEL_MIN_WIDTH : 0, width)));
  }, [currentPage]);
  const handlePanelResizeEnd = useCallback((width: number) => {
    const snapWidths = [1, 2, 3].map(getSidebarPanelWidthForColumns);
    if (currentPage !== 'watch') snapWidths.unshift(0);
    const snapped = snapWidths.reduce((closest, candidate) => Math.abs(candidate - width) < Math.abs(closest - width) ? candidate : closest);
    if (snapped === 0) {
      if (isSidebarPanelOpen) toggleSidebarPanel();
      setIsSearchExpanded(false);
    } else {
      if (!isSidebarPanelOpen && currentPage !== 'watch') toggleSidebarPanel();
      setSavedPanelWidth(snapped);
      localStorage.setItem('echo:sidebar-panel-width', String(snapped));
    }
    setDragWidth(null);
    setIsResizingPanel(false);
  }, [currentPage, isSidebarPanelOpen, toggleSidebarPanel]);

  useEffect(() => setIsSearchExpanded(false), [currentPage, isSidebarPanelOpen]);

  const userPhoto = user?.photo_profil_url || user?.photo_profil || null;
  const userName = user?.username || user?.first_name || undefined;

  return (
    <div className={`app-layout ${currentPage === 'watch' ? 'app-layout--watch' : ''} ${conversationView === 'management' ? 'app-layout--management' : ''}`}>
      <div className="app-layout__body">
        <Sidebar
          activePage={currentPage}
          onNavigate={navigate}
          panelContent={isPanelOpen ? panelContent(currentPage, handleSearchExpansionChange, panelColumns) : null}
          panelWidth={panelWidth}
          isPanelOpen={isPanelOpen}
          canResize={isPanelOpen || !!selectedConversation}
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
