import { useState, useCallback } from 'react';
import {
    IoHomeOutline, IoHome,
    IoChatbubblesOutline, IoChatbubbles,
    IoPeopleOutline, IoPeople,
    IoSparklesOutline, IoSparkles,
    IoExtensionPuzzleOutline, IoExtensionPuzzle,
    IoPersonOutline, IoPerson,
    IoLogOutOutline,
} from 'react-icons/io5';
import { useAuth } from '../../contexts/AuthContext';
import './Sidebar.css';

export type PageId = 'watch' | 'home' | 'conversations' | 'groups' | 'agents' | 'marketplace' | 'profile' | 'add-friend' | 'add-group' | 'add-agent';

interface NavItem {
    id: PageId;
    label: string;
    icon: React.ReactNode;
    iconActive: React.ReactNode;
    hasPanel: boolean; // whether this page expands the sidebar panel
}

const NAV_ITEMS: NavItem[] = [
    { id: 'home', label: 'Accueil', icon: <IoHomeOutline size={22} />, iconActive: <IoHome size={22} />, hasPanel: false },
    { id: 'conversations', label: 'Conversations', icon: <IoChatbubblesOutline size={22} />, iconActive: <IoChatbubbles size={22} />, hasPanel: true },
    { id: 'groups', label: 'Groupes', icon: <IoPeopleOutline size={22} />, iconActive: <IoPeople size={22} />, hasPanel: true },
    { id: 'agents', label: 'Jarvis', icon: <IoSparklesOutline size={22} />, iconActive: <IoSparkles size={22} />, hasPanel: true },
    { id: 'marketplace', label: 'Catalogue', icon: <IoExtensionPuzzleOutline size={22} />, iconActive: <IoExtensionPuzzle size={22} />, hasPanel: false },
    { id: 'profile', label: 'Profil', icon: <IoPersonOutline size={22} />, iconActive: <IoPerson size={22} />, hasPanel: false },
];

interface SidebarProps {
    activePage: PageId;
    onNavigate: (page: PageId) => void;
    panelContent: React.ReactNode | null;
    panelWidth: number;
    isPanelOpen: boolean;
    isResizing: boolean;
    onResizeStart: () => void;
    onPanelWidthChange: (width: number) => void;
    onResizeEnd: (width: number) => void;
    userPhoto?: string | null;
    userName?: string;
    isLoggedIn: boolean;
    onLogout: () => void;
}

export default function Sidebar({ activePage, onNavigate, panelContent, panelWidth, isPanelOpen, isResizing, onResizeStart, onPanelWidthChange, onResizeEnd, userPhoto, userName, isLoggedIn, onLogout }: SidebarProps) {
    const { user } = useAuth();
    const [hoveredItem, setHoveredItem] = useState<PageId | null>(null);

    const handleClick = useCallback((item: NavItem) => {
        onNavigate(item.id);
    }, [onNavigate]);

    // Total green body width = icon rail + panel (when open)
    const greenBodyWidth = isPanelOpen ? 60 + panelWidth : 60;

    const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = panelWidth;
        onResizeStart();
        const handleMove = (moveEvent: PointerEvent) => onPanelWidthChange(startWidth + moveEvent.clientX - startX);
        const handleUp = (upEvent: PointerEvent) => {
            const finalWidth = startWidth + upEvent.clientX - startX;
            document.removeEventListener('pointermove', handleMove);
            document.removeEventListener('pointerup', handleUp);
            onResizeEnd(finalWidth);
        };
        document.addEventListener('pointermove', handleMove);
        document.addEventListener('pointerup', handleUp);
    };

    return (
        <div className="sidebar">
            <div
                className={`sidebar__green-body ${isPanelOpen ? 'sidebar__green-body--open' : ''} ${isResizing ? 'sidebar__green-body--resizing' : ''}`}
                style={{ width: greenBodyWidth }}
            >
                {/* Icon rail */}
                <nav className="sidebar__rail">
                    <div className="sidebar__nav-items">
                        {NAV_ITEMS.filter(item => user?.ai_agents_enabled !== false || (item.id !== 'agents' && item.id !== 'marketplace')).map((item) => {
                            const isActive = (activePage === 'watch' ? 'home' : activePage) === item.id;
                            const isHovered = hoveredItem === item.id;

                            return (
                                <button
                                    key={item.id}
                                    className={`sidebar__nav-btn ${isActive ? 'sidebar__nav-btn--active' : ''}`}
                                    onClick={() => handleClick(item)}
                                    onMouseEnter={() => setHoveredItem(item.id)}
                                    onMouseLeave={() => setHoveredItem(null)}
                                    title={item.label}
                                >
                                    <span className="sidebar__nav-icon">
                                        {isActive ? item.iconActive : item.icon}
                                    </span>
                                    {/* Tooltip */}
                                    {isHovered && !isPanelOpen && (
                                        <span className="sidebar__tooltip">{item.label}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* User section at bottom */}
                    {isLoggedIn && (
                        <div className="sidebar__user-section">
                            <button
                                className={`sidebar__nav-btn ${activePage === 'profile' ? 'sidebar__nav-btn--active' : ''}`}
                                onClick={() => onNavigate('profile')}
                                title={userName || 'Profil'}
                            >
                                <div className="sidebar__user-avatar">
                                    {userPhoto ? (
                                        <img src={userPhoto} alt={userName} className="sidebar__user-avatar-img" />
                                    ) : (
                                        <span>{(userName || 'U').charAt(0).toUpperCase()}</span>
                                    )}
                                </div>
                            </button>
                            <button
                                className="sidebar__nav-btn sidebar__logout-btn"
                                onClick={onLogout}
                                title="Déconnexion"
                            >
                                <IoLogOutOutline size={18} />
                            </button>
                        </div>
                    )}
                </nav>

                {/* Panel inside the green body */}
                <div
                    className={`sidebar__panel ${isPanelOpen ? 'sidebar__panel--open' : ''} ${isResizing ? 'sidebar__panel--resizing' : ''}`}
                    style={{ width: isPanelOpen ? panelWidth : 0 }}
                >
                    {panelContent && (
                        <div className="sidebar__panel-content">
                            {panelContent}
                        </div>
                    )}
                </div>
            </div>
            {isPanelOpen && <div className="sidebar__resize-handle" onPointerDown={handleResizePointerDown} aria-label="Redimensionner la barre latérale" />}
        </div>
    );
}
