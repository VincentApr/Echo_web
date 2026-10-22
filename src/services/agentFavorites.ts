import { fetchWithAuth } from './apiClient';
import { API_BASE_URL } from '../config/api';

export async function ensureAgentFavorite(agentUuid: string): Promise<void> {
    if (!agentUuid) throw new Error('Agent introuvable.');
    const url = `${API_BASE_URL}/framework/agents/${agentUuid}/`;
    // The POST endpoint toggles favorites. Check persisted state before every
    // attempt, including retries after a lost response, to avoid removing one.
    const detail = await fetchWithAuth(url);
    if (!detail.ok) throw new Error('Impossible de vérifier les favoris.');
    const agent = await detail.json();
    if (agent.is_favorite === true) return;
    if (agent.is_favorite !== false) throw new Error('État des favoris inconnu.');

    const response = await fetchWithAuth(`${url}favorite/`, { method: 'POST' });
    if (!response.ok) throw new Error('Impossible d’ajouter cet agent aux favoris.');
    const result = await response.json();
    if (result.is_favorite !== true) throw new Error('Ajout aux favoris non confirmé.');
}
