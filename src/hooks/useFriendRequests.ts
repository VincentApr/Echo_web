// Web version of useFriendRequests — same API, uses web AuthContext
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { useAuth } from '../contexts/AuthContext';

export interface FriendRequest {
    id: number;
    uuid: string;
    demandeur_info: {
        id: number;
        uuid: string;
        username: string;
        surnom: string;
        first_name: string;
        last_name: string;
        photo_profil_url: string | null;
    };
    destinataire_info: {
        id: number;
        uuid: string;
        username: string;
        surnom: string;
    };
    statut: string;
    message: string;
    date_demande: string;
    date_reponse?: string;
}

export const useFriendRequests = () => {
    const queryClient = useQueryClient();
    const { accessToken } = useAuth();

    const query = useQuery({
        queryKey: ['friendRequests'],
        queryFn: async () => {
            const response = await fetchWithAuth(
                `${API_BASE_URL}/relations/connections/pending/`
            );
            if (!response.ok) throw new Error('Failed to fetch friend requests');
            const data = await response.json();
            return (data.demandes || []) as FriendRequest[];
        },
        enabled: !!accessToken,
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });

    const updateFriendRequest = (requestId: number, action: 'accept' | 'reject') => {
        queryClient.setQueryData(['friendRequests'], (old: FriendRequest[] | undefined) => {
            if (!old) return [];
            return old.filter(req => req.id !== requestId);
        });
    };

    return {
        friendRequests: query.data || [],
        isLoading: query.isLoading,
        isError: query.isError,
        refetch: query.refetch,
        updateFriendRequest,
    };
};
