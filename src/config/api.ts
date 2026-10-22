// Canonical public API. Development keeps same-origin URLs through Vite's proxy.
const productionApiOrigin = 'https://api.echosocial.fr';

// Use Vite's environment flag instead of checking the hostname: development
// previews may be served through a forwarded Codespaces domain rather than
// localhost, and still need the same-origin Vite proxy to avoid CORS issues.
const isDevServer = import.meta.env.DEV;

export const API_BASE_URL = isDevServer ? '' : productionApiOrigin;

const devWebSocketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

export const WS_BASE_URL = isDevServer
    ? `${devWebSocketProtocol}//${window.location.host}`
    : productionApiOrigin.replace(/^https:/, 'wss:');

export const getApiUrl = (endpoint: string): string => {
    return `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
};
