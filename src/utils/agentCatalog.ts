type CatalogAgent = { uuid: string; is_favorite?: boolean; is_mine?: boolean };

// The mobile API supports both paginated lists and grouped catalogues.
export function normalizeAgentCatalog<T extends CatalogAgent>(payload: unknown): T[] {
    if (Array.isArray(payload)) return payload as T[];
    if (!payload || typeof payload !== 'object') return [];
    const data = payload as { results?: T[]; created_agents?: T[]; favorite_agents?: T[] };
    if (Array.isArray(data.results)) return data.results;
    const agents = new Map<string, T>();
    for (const agent of data.created_agents || []) {
        agents.set(agent.uuid, { ...agent, is_mine: true });
    }
    for (const agent of data.favorite_agents || []) {
        agents.set(agent.uuid, { ...agents.get(agent.uuid), ...agent, is_favorite: true,
            is_mine: agents.get(agent.uuid)?.is_mine || agent.is_mine });
    }
    return [...agents.values()];
}
