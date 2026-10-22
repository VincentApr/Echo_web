import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useEffect } from 'react';
import { watchRequest, requestWatchScan, type WatchFeed, type WatchItem, type WatchScope, type WatchCommand } from '../services/watches';

export function useWatchRefreshOnSession() {
    const { user, isLoggedIn, loading } = useAuth();
    const client = useQueryClient();
    const uuid = user?.uuid;
    const aiEnabled = user?.ai_agents_enabled !== false;
    useEffect(() => {
        if (loading || !isLoggedIn || !uuid || !aiEnabled) return;
        // The server coalesces repeated requests, including React StrictMode mounts.
        void requestWatchScan().then(() => client.invalidateQueries({ queryKey: ['watches', uuid, 'feed'] })).catch(() => {
            // A collection failure must not interrupt native notifications or navigation.
        });
    }, [uuid, aiEnabled, isLoggedIn, loading, client]);
}

export function useWatchFeed(scope: WatchScope = 'active') {
    const { user, isLoggedIn } = useAuth();
    return useInfiniteQuery({
        queryKey: ['watches', user?.uuid, 'feed', scope, user?.ai_agents_enabled !== false],
        initialPageParam: 0,
        queryFn: async ({ pageParam }) => {
            const data = await watchRequest<WatchFeed>(`?scope=${scope}&offset=${pageParam}`);
            if (!Array.isArray(data.results)) throw new Error('Le serveur de veilles doit être mis à jour.');
            return data;
        },
        getNextPageParam: page => page.next_offset ?? undefined,
        enabled: isLoggedIn,
        staleTime: 15_000,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
        retry: false,
    });
}

export function useWatch(uuid: string | null) {
    const { user, isLoggedIn } = useAuth();
    return useQuery({
        queryKey: ['watches', user?.uuid, 'detail', uuid, user?.ai_agents_enabled !== false],
        queryFn: () => watchRequest<WatchItem>(`${uuid}/`),
        enabled: isLoggedIn && !!uuid,
        refetchInterval: 30_000,
        retry: false,
    });
}

export function useWatchAction(uuid: string | null) {
    const { user } = useAuth();
    const client = useQueryClient();
    return useMutation({
        mutationFn: (action: WatchCommand) => watchRequest<WatchItem>(`${uuid}/`, action),
        onSuccess: async (item, action) => {
            const cachedItem = { ...item };
            delete cachedItem.navigation;
            client.setQueryData(['watches', user?.uuid, 'detail', uuid, user?.ai_agents_enabled !== false], cachedItem);
            const command = typeof action === 'string' ? action : action.action;
            if (command === 'discuss_agent') {
                await client.invalidateQueries({ queryKey: ['conversations'] });
                return;
            }
            if (command === 'open_source') return;
            await Promise.all([
                client.invalidateQueries({ queryKey: ['watches', user?.uuid, 'feed'] }),
                client.invalidateQueries({ queryKey: ['friendRequests'] }),
                client.invalidateQueries({ queryKey: ['groupInvitations'] }),
                client.invalidateQueries({ queryKey: ['conversations'] }),
                client.invalidateQueries({ queryKey: ['profile'] }),
            ]);
        },
        onError: () => { void client.invalidateQueries({ queryKey: ['watches', user?.uuid] }); },
    });
}
