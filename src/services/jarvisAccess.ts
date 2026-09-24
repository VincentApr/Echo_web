import { API_BASE_URL } from '../config/api';
import { JARVIS_AGENT_UUID } from '../constants/jarvisAgent';
import { fetchWithAuth } from './apiClient';

let activation: Promise<void> | null = null;

export function ensureJarvisAccess(): Promise<void> {
    if (activation) return activation;
    activation = (async () => {
        const url = `${API_BASE_URL}/framework/agents/${JARVIS_AGENT_UUID}/`;
        const detail = await fetchWithAuth(url);
        if (detail.ok) {
            const agent = await detail.json();
            if (agent.is_favorite) return;
        } else if (detail.status !== 403) {
            throw new Error(`Impossible de vérifier l’accès à Jarvis (${detail.status}).`);
        }

        // Mobile also uses this endpoint to activate Jarvis after an access 403.
        const response = await fetchWithAuth(`${url}favorite/`, { method: 'POST' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.is_favorite === false) {
            if (response.status === 403 || response.status === 404) {
                throw new Error('Le serveur refuse l’accès à Jarvis dans les conversations. Ton message n’a pas été envoyé.');
            }
            throw new Error(result.detail || result.error || 'Impossible d’activer Jarvis dans les conversations.');
        }
    })().finally(() => { activation = null; });
    return activation;
}
