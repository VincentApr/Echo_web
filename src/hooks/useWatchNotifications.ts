import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../config/api';
import { fetchWithAuth } from '../services/apiClient';
import { bindPushAccount } from '../services/watchNotifications';

export function useWatchNotifications() {
    const { user, isLoggedIn } = useAuth();
    const owner = isLoggedIn ? user?.uuid : undefined;
    useEffect(() => {
        if (!owner) return;
        void bindPushAccount(owner).catch(() => {});
        const presence = () => {
            if (document.visibilityState === 'visible') void fetchWithAuth(`${API_BASE_URL}/watches/presence/`, { method: 'POST' }).catch(() => {});
        };
        presence();
        const timer = window.setInterval(presence, 60_000);
        document.addEventListener('visibilitychange', presence);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', presence);
            void bindPushAccount(null, owner).catch(() => {});
        };
    }, [owner]);
}
