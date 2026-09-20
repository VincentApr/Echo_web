import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { useAuth } from '../contexts/AuthContext';

export interface Agent {
    uuid: string;
    name: string;
    description?: string;
    agent_type: string;
    is_active: boolean;
    is_favorite?: boolean;
    is_mine?: boolean;
    is_public?: boolean;
    avatar_url?: string;
    created_at: string;
    instructions?: {
        system_prompt?: string;
    };
}

function normalizeAgents(data: any): Agent[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.results)) return data.results;
    const combined = [...(data?.created_agents || []), ...(data?.favorite_agents || [])] as Agent[];
    const unique = new Map<string, Agent>();
    combined.forEach((agent) => {
        if (agent.uuid) unique.set(agent.uuid, { ...unique.get(agent.uuid), ...agent });
    });
    return [...unique.values()];
}

export function useAgentFramework() {
    const { isLoggedIn } = useAuth();
    const queryClient = useQueryClient();

    const myAgentsQuery = useQuery({
        queryKey: ['agents', 'my'],
        queryFn: async (): Promise<Agent[]> => {
            const res = await fetchWithAuth(`${API_BASE_URL}/framework/agents/`);
            if (!res.ok) return [];
            const data = await res.json();
            return normalizeAgents(data);
        },
        enabled: isLoggedIn,
        staleTime: 5 * 60_000,
    });

    const publicAgentsQuery = useQuery({
        queryKey: ['agents', 'public'],
        queryFn: async (): Promise<Agent[]> => {
            const res = await fetchWithAuth(`${API_BASE_URL}/framework/agents/public/`);
            if (!res.ok) return [];
            const data = await res.json();
            return normalizeAgents(data);
        },
        enabled: isLoggedIn,
        staleTime: 5 * 60_000,
    });

    const toggleFavoriteMutation = useMutation({
        mutationFn: async (agentUuid: string) => {
            const res = await fetchWithAuth(`${API_BASE_URL}/framework/agents/${agentUuid}/favorite/`, {
                method: 'POST',
            });
            if (!res.ok) throw new Error('Failed to toggle favorite');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agents'] });
        },
    });

    const myAgents = myAgentsQuery.data ?? [];
    const favoriteAgents = myAgents.filter((a) => a.is_favorite);

    return {
        myAgents,
        favoriteAgents,
        publicAgents: publicAgentsQuery.data ?? [],
        isLoading: myAgentsQuery.isLoading,
        toggleFavorite: toggleFavoriteMutation.mutate,
        refetch: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
    };
}
