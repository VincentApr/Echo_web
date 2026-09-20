// Web version of useGroupInvitations — same API, uses web AuthContext
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { useAuth } from '../contexts/AuthContext';

export interface GroupInvitation {
    id: number;
    uuid: string;
    group: {
        uuid: string;
        name: string;
        description?: string;
        member_count?: number;
    };
    created_by: {
        uuid: string;
        username: string;
        surnom?: string;
    };
    status: string;
    message?: string;
    created_at: string;
    is_expired?: boolean;
}

export const useGroupInvitations = () => {
    const queryClient = useQueryClient();
    const { accessToken } = useAuth();

    const query = useQuery({
        queryKey: ['groupInvitations'],
        queryFn: async () => {
            const response = await fetchWithAuth(
                `${API_BASE_URL}/groups/invitations/received/`
            );
            if (!response.ok) throw new Error('Failed to fetch group invitations');
            const data = await response.json();
            const invitations = Array.isArray(data) ? data : [];
            return invitations.filter((inv: GroupInvitation) => !inv.is_expired) as GroupInvitation[];
        },
        enabled: !!accessToken,
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });

    const updateGroupInvitation = (invitationUuid: string) => {
        queryClient.setQueryData(['groupInvitations'], (old: GroupInvitation[] | undefined) => {
            if (!old) return [];
            return old.filter(inv => inv.uuid !== invitationUuid);
        });
    };

    return {
        groupInvitations: query.data || [],
        isLoading: query.isLoading,
        isError: query.isError,
        refetch: query.refetch,
        updateGroupInvitation,
    };
};
