// Echo Web Design System — Colors & Variables
// Shared Echo colors and emerald interface theme.

export const ECHO_COLOR = 'rgba(10, 145, 104, 0.8)';
export const ECHO_COLOR_SOLID = 'rgba(10, 145, 104, 1)';
export const WHITE = '#fff';
export const BACKGROUND_GRAY = 'rgba(245, 245, 245, 0.9)';
export const LIGHT_GRAY = 'rgba(230, 230, 230, 1)';
export const DARK_GRAY = '#777';

// Emerald theme from BottomBarV2
export const EMERALD = {
    expandedPanelBackground: 'rgba(57, 175, 140, 0.82)',
    iosBackground: 'rgba(77, 175, 146, 0.82)',
    collapsedBackground: 'rgba(67, 180, 146, 0.82)',
    shadowColor: 'rgba(67, 180, 146, 0.82)',
    dragHandleColor: 'rgba(67, 180, 146, 0.82)',
    buttonBackground: 'rgba(255, 255, 255, 0)',
    buttonIconColor: '#FFFFFF',
    buttonIconDisabledColor: 'rgba(255, 255, 255, 0.5)',
    buttonAccentColor: '#4ade80',
    buttonAccentDisabledColor: 'rgba(255, 255, 255, 0.3)',
    contentTextColor: '#FFFFFF',
    placeholderTextColor: 'rgba(255, 255, 255, 0.6)',
    selectionColor: 'rgba(255, 255, 255, 0.7)',
    actionButtonShadowColor: 'rgba(10, 145, 104, 0.4)',
    actionButtonActiveShadowColor: 'rgba(34, 197, 94, 0.6)',
};

// Layout constants
export const SIDEBAR_ICON_WIDTH = 60;
export const SIDEBAR_PANEL_GRID_ITEM_SIZE = 80;
export const SIDEBAR_PANEL_GRID_GAP = 10;
export const SIDEBAR_PANEL_GRID_GUTTER = 54;
export const SIDEBAR_PANEL_SNAP_COLUMNS = [1, 2, 3] as const;

export const getSidebarPanelWidthForColumns = (columns: number) => (
    SIDEBAR_PANEL_GRID_GUTTER +
    (columns * SIDEBAR_PANEL_GRID_ITEM_SIZE) +
    (Math.max(columns - 1, 0) * SIDEBAR_PANEL_GRID_GAP)
);

export const SIDEBAR_PANEL_SNAP_WIDTHS = SIDEBAR_PANEL_SNAP_COLUMNS.map(getSidebarPanelWidthForColumns);
export const SIDEBAR_PANEL_MIN_WIDTH = SIDEBAR_PANEL_SNAP_WIDTHS[0];
export const SIDEBAR_PANEL_MAX_WIDTH = SIDEBAR_PANEL_SNAP_WIDTHS[SIDEBAR_PANEL_SNAP_WIDTHS.length - 1];
export const SIDEBAR_PANEL_DEFAULT_WIDTH = getSidebarPanelWidthForColumns(3);
export const BOTTOM_BAR_HEIGHT = 52;
