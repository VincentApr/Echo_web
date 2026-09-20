import type { QueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { syncConversationsByType } from './localSync';

interface GroupDetail {
    uuid: string;
    name: string;
    description?: string;
    avatar?: string | null;
    member_count?: number;
    conversation_uuid?: string;
}

interface CreateGroupAndSyncParams {
    ownerUuid?: string | null;
    queryClient: QueryClient;
    name: string;
    description?: string;
    inviteeUuids?: string[];
    parentUuid?: string | null;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
    try {
        const payload = await response.json();
        if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
        if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail.trim();
        if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();

        const flatErrors = Object.values(payload || {})
            .flatMap((value) => Array.isArray(value) ? value : [value])
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

        if (flatErrors.length > 0) return flatErrors.join('\n');
    } catch {
        // Ignore JSON parsing errors and fall back below.
    }

    const text = await response.text().catch(() => '');
    return text.trim() || fallback;
}

export async function createGroupAndSync({
    ownerUuid,
    queryClient,
    name,
    description = '',
    inviteeUuids = [],
    parentUuid = null,
}: CreateGroupAndSyncParams): Promise<{ group: GroupDetail; invitedCount: number; inviteFailures: string[] }> {
    const createResponse = await fetchWithAuth(`${API_BASE_URL}/groups/create/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            ...(parentUuid ? { parent_uuid: parentUuid } : {}),
        }),
    });

    if (!createResponse.ok) {
        throw new Error(await readApiError(createResponse, 'Impossible de créer le groupe.'));
    }

    const createdGroup = await createResponse.json() as GroupDetail;
    let groupDetails = createdGroup;

    if (createdGroup?.uuid) {
        const detailResponse = await fetchWithAuth(`${API_BASE_URL}/groups/${createdGroup.uuid}/`);
        if (detailResponse.ok) {
            groupDetails = await detailResponse.json() as GroupDetail;
        }
    }

    const inviteFailures: string[] = [];
    const uniqueInvitees = Array.from(new Set(inviteeUuids.filter(Boolean)));

    if (groupDetails?.uuid && uniqueInvitees.length > 0) {
        const invitationResults = await Promise.allSettled(
            uniqueInvitees.map(async (targetUserUuid) => {
                const inviteResponse = await fetchWithAuth(`${API_BASE_URL}/groups/${groupDetails.uuid}/invite/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target_user_uuid: targetUserUuid }),
                });

                if (!inviteResponse.ok) {
                    throw new Error(await readApiError(inviteResponse, 'Invitation impossible.'));
                }
            })
        );

        invitationResults.forEach((result) => {
            if (result.status === 'rejected') {
                inviteFailures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
            }
        });
    }

    if (ownerUuid) {
        await syncConversationsByType(ownerUuid, 'group');
    }

    await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['conversations', 'groups'] }),
    ]);

    return {
        group: groupDetails,
        invitedCount: Math.max(0, uniqueInvitees.length - inviteFailures.length),
        inviteFailures,
    };
}

export async function joinGroupByCodeAndSync({
    ownerUuid,
    queryClient,
    inviteCode,
}: {
    ownerUuid?: string | null;
    queryClient: QueryClient;
    inviteCode: string;
}): Promise<void> {
    const joinResponse = await fetchWithAuth(`${API_BASE_URL}/groups/join-by-code/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: inviteCode.trim() }),
    });

    if (!joinResponse.ok) {
        throw new Error(await readApiError(joinResponse, 'Impossible de rejoindre le groupe.'));
    }

    if (ownerUuid) {
        await syncConversationsByType(ownerUuid, 'group');
    }

    await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['conversations', 'groups'] }),
    ]);
}
