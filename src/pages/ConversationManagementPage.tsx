import React, { useEffect, useMemo, useState } from 'react';
import {
    IoAddCircleOutline,
    IoAlertCircleOutline,
    IoArchiveOutline,
    IoArrowUpCircleOutline,
    IoBanOutline,
    IoCalendarOutline,
    IoCheckmarkCircleOutline,
    IoChevronBack,
    IoChevronDown,
    IoChevronUp,
    IoCloseCircleOutline,
    IoCopyOutline,
    IoDocumentOutline,
    IoExitOutline,
    IoGitBranchOutline,
    IoImageOutline,
    IoInformationCircleOutline,
    IoLinkOutline,
    IoPin,
    IoPinOutline,
    IoPeopleOutline,
    IoPersonAddOutline,
    IoPersonOutline,
    IoRefreshOutline,
    IoSettingsOutline,
    IoShieldCheckmarkOutline,
    IoSparklesOutline,
    IoStar,
    IoStarOutline,
} from 'react-icons/io5';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '../contexts/NavigationContext';
import { useAuth } from '../contexts/AuthContext';
import { webDatabaseManager } from '../services/webDatabase';
import type { Conversation } from '../hooks/useConversations';
import { isConversationPinned, setConversationPinned } from '../services/conversationPins';
import './ConversationManagementPage.css';

interface Props {
    conversation: Conversation;
}

type GroupRole = 'owner' | 'moderator' | 'member';

interface GroupSummary {
    id: number;
    uuid: string;
    name: string;
    description?: string;
    avatar?: string | null;
    parent: number | null;
    member_count: number;
    my_role?: GroupRole | null;
    conversation_uuid?: string | null;
    created_at?: string;
}

interface GroupUser {
    uuid: string;
    username: string;
    surnom?: string;
    photo_profil_url?: string | null;
}

interface GroupMember {
    id?: number;
    user?: GroupUser | null;
    uuid?: string;
    username?: string;
    surnom?: string;
    photo_profil_url?: string | null;
    role?: GroupRole;
    joined_at?: string;
    is_muted?: boolean;
    muted_until?: string | null;
}

interface GroupMembership {
    role?: GroupRole;
}

interface GroupDetails {
    id: number;
    uuid: string;
    name: string;
    description?: string;
    avatar?: string | null;
    invite_code?: string;
    parent: number | null;
    max_members?: number;
    member_count: number;
    created_at?: string;
    members?: GroupMember[];
    subgroups?: GroupSummary[];
    my_membership?: GroupMembership | GroupMember | null;
    conversation_uuid?: string | null;
}

interface GroupStats {
    total_members: number;
    recent_activity: {
        messages_7d: number;
        new_members_7d: number;
    };
}

interface PendingApproval {
    uuid: string;
    message?: string;
    target_user?: GroupUser | null;
}

interface ModerationLog {
    uuid: string;
    action: string;
    created_at: string;
    reason?: string;
    target_user?: Pick<GroupUser, 'username' | 'surnom'> | null;
    moderator?: Pick<GroupUser, 'username' | 'surnom'> | null;
}

interface Connection {
    id: number;
    uuid: string;
    username: string;
    surnom?: string;
    photo_profil_url?: string | null;
}

interface UserProfile {
    uuid: string;
    username: string;
    surnom?: string;
    photo_profil_url?: string;
    bio?: string;
    nb_connexions?: number;
}

interface AgentDetail {
    uuid: string;
    name: string;
    description?: string;
    avatar_url?: string;
    system_prompt?: string;
    is_favorite?: boolean;
}

interface MediaItem {
    attachment_uuid: string;
    file_url: string;
    thumbnail_url?: string;
    file_type: string;
    original_filename?: string;
    created_at: string;
    message?: { uuid: string; created_at: string; sender?: { username: string } };
}

interface LinkItem {
    url: string;
    created_at: string;
    sender?: string;
}

function extractGroupRole(membership?: GroupDetails['my_membership']): GroupRole | null {
    if (!membership || typeof membership !== 'object') return null;
    const role = 'role' in membership ? membership.role : null;
    return role === 'owner' || role === 'moderator' || role === 'member' ? role : null;
}

function getUserDisplayName(user?: Pick<GroupUser, 'username' | 'surnom'> | null): string {
    return user?.surnom || user?.username || 'Utilisateur';
}

function getMemberDisplayName(member: GroupMember): string {
    return member.surnom || member.user?.surnom || member.username || member.user?.username || 'Membre';
}

function getMemberAvatar(member: GroupMember): string {
    return member.photo_profil_url || member.user?.photo_profil_url || '';
}

function getMemberUuid(member: GroupMember): string {
    return member.uuid || member.user?.uuid || '';
}

function formatDate(value?: string | null): string {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('fr-FR');
}

function formatDateTime(value?: string | null): string {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function buildGroupConversation(detail: GroupDetails): Conversation | null {
    if (!detail.conversation_uuid) return null;
    return {
        uuid: detail.conversation_uuid,
        unread_count: 0,
        conversation_type: 'group',
        name: detail.name,
        avatar_url: detail.avatar || '',
        group_info: {
            uuid: detail.uuid,
            name: detail.name,
            avatar: detail.avatar || null,
            member_count: detail.member_count,
        },
    };
}

function parseErrorMessage(payload: unknown, fallback: string): string {
    if (!payload || typeof payload !== 'object') return fallback;
    const record = payload as Record<string, unknown>;
    const detail = record.detail;
    const error = record.error;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (typeof error === 'string' && error.trim()) return error;
    if (Array.isArray(error) && typeof error[0] === 'string') return error[0];
    return fallback;
}

export default function ConversationManagementPage({ conversation }: Props) {
    const { closeConversationManagement, closeConversation, openConversation } = useNavigation();
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const isGroup = conversation.conversation_type === 'group';
    const isAgent = conversation.conversation_type === 'agent';
    const isDirect = !isGroup && !isAgent;

    const [groupDetails, setGroupDetails] = useState<GroupDetails | null>(null);
    const [groupStats, setGroupStats] = useState<GroupStats | null>(null);
    const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
    const [myGroups, setMyGroups] = useState<GroupSummary[]>([]);
    const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
    const [moderationLogs, setModerationLogs] = useState<ModerationLog[]>([]);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [agentDetail, setAgentDetail] = useState<AgentDetail | null>(null);
    const [connections, setConnections] = useState<Connection[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingApprovals, setLoadingApprovals] = useState(false);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [loadingConnections, setLoadingConnections] = useState(false);
    const [showAllMembers, setShowAllMembers] = useState(false);
    const [promptExpanded, setPromptExpanded] = useState(false);
    const [isFavorite, setIsFavorite] = useState(false);
    const [isPinned, setIsPinned] = useState(() => isConversationPinned(user?.uuid, conversation.uuid));
    const [actionMsg, setActionMsg] = useState<string | null>(null);
    const [memberSearch, setMemberSearch] = useState('');
    const [inviteMessage, setInviteMessage] = useState('');
    const [selectedMemberUuids, setSelectedMemberUuids] = useState<string[]>([]);
    const [showInvitePanel, setShowInvitePanel] = useState(false);
    const [subgroupName, setSubgroupName] = useState('');
    const [subgroupDescription, setSubgroupDescription] = useState('');
    const [showSubgroupForm, setShowSubgroupForm] = useState(false);
    const [showModerationLogs, setShowModerationLogs] = useState(false);
    const [submittingInvites, setSubmittingInvites] = useState(false);
    const [creatingSubgroup, setCreatingSubgroup] = useState(false);
    const [activeMediaTab, setActiveMediaTab] = useState<'media' | 'links' | 'documents' | null>(null);
    const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
    const [documentItems, setDocumentItems] = useState<MediaItem[]>([]);
    const [linkItems, setLinkItems] = useState<LinkItem[]>([]);
    const [loadingMediaTab, setLoadingMediaTab] = useState(false);

    const groupUuid = (conversation as any).group_info?.uuid || (conversation as any).group_uuid || null;
    const myGroupRole = extractGroupRole(groupDetails?.my_membership);
    const canModerateGroup = myGroupRole === 'owner' || myGroupRole === 'moderator';
    const canCreateSubgroup = canModerateGroup && !groupDetails?.parent;

    const membersToDisplay = showAllMembers ? groupMembers : groupMembers.slice(0, 8);
    const hasMoreMembers = groupMembers.length > 8;
    const parentGroupSummary = useMemo(() => {
        if (!groupDetails?.parent) return null;
        return myGroups.find((group) => group.id === groupDetails.parent) || null;
    }, [groupDetails?.parent, myGroups]);

    const filteredConnections = useMemo(() => {
        const q = memberSearch.trim().toLowerCase();
        const currentMemberUuids = new Set(groupMembers.map((member) => getMemberUuid(member)).filter(Boolean));
        return connections.filter((connection) => {
            if (currentMemberUuids.has(connection.uuid)) return false;
            if (!q) return true;
            const haystack = `${connection.surnom || ''} ${connection.username}`.toLowerCase();
            return haystack.includes(q);
        });
    }, [connections, groupMembers, memberSearch]);

    useEffect(() => {
        if (!actionMsg) return undefined;
        const timeout = window.setTimeout(() => setActionMsg(null), 2500);
        return () => window.clearTimeout(timeout);
    }, [actionMsg]);

    const notify = (msg: string) => {
        setActionMsg(msg);
    };

    const loadConnections = async () => {
        if (connections.length > 0 || loadingConnections) return;
        setLoadingConnections(true);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/relations/connections/my-connections/`);
            if (!res.ok) throw new Error('Impossible de charger vos amis');
            const data = await res.json();
            setConnections((data.connexions || []) as Connection[]);
        } catch {
            setConnections([]);
            notify('Impossible de charger la liste des amis');
        } finally {
            setLoadingConnections(false);
        }
    };

    const loadPendingApprovals = async (targetGroupUuid: string) => {
        setLoadingApprovals(true);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/groups/${targetGroupUuid}/pending-approvals/`);
            if (!res.ok) throw new Error('Impossible de charger les demandes');
            setPendingApprovals(await res.json());
        } catch {
            setPendingApprovals([]);
        } finally {
            setLoadingApprovals(false);
        }
    };

    const handleMediaTab = async (tab: 'media' | 'links' | 'documents') => {
        if (activeMediaTab === tab) {
            setActiveMediaTab(null);
            return;
        }
        setActiveMediaTab(tab);
        setLoadingMediaTab(true);
        try {
            if (tab === 'media') {
                const res = await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/${conversation.uuid}/media/photos/`);
                if (!res.ok) throw new Error();
                const data = await res.json();
                setMediaItems(data.items || []);
            } else if (tab === 'documents') {
                const res = await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/${conversation.uuid}/media/documents/`);
                if (!res.ok) throw new Error();
                const data = await res.json();
                setDocumentItems(data.items || []);
            } else {
                const res = await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/${conversation.uuid}/messages/`);
                if (!res.ok) throw new Error();
                const data = await res.json();
                const messages: Array<{ content?: string; created_at?: string; sender_username?: string }> = data.results || data.messages || data || [];
                const urlRegex = /https?:\/\/[^\s<>"']+/g;
                const found: LinkItem[] = [];
                const seen = new Set<string>();
                for (const msg of messages) {
                    const urls = (msg.content || '').match(urlRegex) || [];
                    for (const url of urls) {
                        if (!seen.has(url)) {
                            seen.add(url);
                            found.push({ url, created_at: msg.created_at || '', sender: msg.sender_username });
                        }
                    }
                }
                setLinkItems(found);
            }
        } catch {
            notify('Impossible de charger les données');
        } finally {
            setLoadingMediaTab(false);
        }
    };

    const loadModerationLogs = async (targetGroupUuid: string) => {
        setLoadingLogs(true);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/groups/${targetGroupUuid}/moderation-logs/`);
            if (!res.ok) throw new Error('Impossible de charger les logs');
            setModerationLogs(await res.json());
        } catch {
            setModerationLogs([]);
            notify('Impossible de charger les logs de modération');
        } finally {
            setLoadingLogs(false);
        }
    };

    const loadGroupBundle = async (targetGroupUuid: string) => {
        setLoading(true);
        try {
            const detailRes = await fetchWithAuth(`${API_BASE_URL}/groups/${targetGroupUuid}/`);
            if (!detailRes.ok) throw new Error('Impossible de charger le groupe');
            const detail = (await detailRes.json()) as GroupDetails;
            setGroupDetails(detail);
            setGroupMembers(detail.members || []);

            const [statsResult, groupsResult, membersResult, approvalsResult] = await Promise.allSettled([
                fetchWithAuth(`${API_BASE_URL}/groups/${targetGroupUuid}/stats/`),
                fetchWithAuth(`${API_BASE_URL}/groups/my-groups/`),
                fetchWithAuth(`${API_BASE_URL}/groups/${targetGroupUuid}/members/`),
                canModerateGroup || extractGroupRole(detail.my_membership)
                    ? fetchWithAuth(`${API_BASE_URL}/groups/${targetGroupUuid}/pending-approvals/`)
                    : Promise.resolve(null),
            ]);

            if (statsResult.status === 'fulfilled' && statsResult.value?.ok) {
                setGroupStats(await statsResult.value.json());
            } else {
                setGroupStats(null);
            }

            if (groupsResult.status === 'fulfilled' && groupsResult.value.ok) {
                setMyGroups(await groupsResult.value.json());
            } else {
                setMyGroups([]);
            }

            if (membersResult.status === 'fulfilled' && membersResult.value.ok) {
                setGroupMembers(await membersResult.value.json());
            }

            if (approvalsResult.status === 'fulfilled' && approvalsResult.value?.ok) {
                setPendingApprovals(await approvalsResult.value.json());
            } else if (extractGroupRole(detail.my_membership) !== 'owner' && extractGroupRole(detail.my_membership) !== 'moderator') {
                setPendingApprovals([]);
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            try {
                if (isGroup && groupUuid) {
                    await loadGroupBundle(groupUuid);
                    return;
                }

                if (isDirect) {
                    const partnerUuid = (conversation as any).other_participant?.uuid || (conversation as any).participant_uuid;
                    if (!partnerUuid) return;
                    const res = await fetchWithAuth(`${API_BASE_URL}/api/users/${partnerUuid}/`);
                    if (!cancelled && res.ok) setUserProfile(await res.json());
                    return;
                }

                if (isAgent) {
                    const agentUuid = (conversation as any).agent_info?.uuid || (conversation as any).agent_uuid || (conversation as any).framework_agent?.uuid;
                    if (!agentUuid) return;
                    const res = await fetchWithAuth(`${API_BASE_URL}/framework/agents/${agentUuid}/`);
                    if (!cancelled && res.ok) {
                        const data = await res.json();
                        setAgentDetail(data);
                        setIsFavorite(!!data.is_favorite);
                    }
                }
            } catch {
                if (!cancelled) notify('Impossible de charger cette page');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [conversation.uuid, groupUuid, isAgent, isDirect, isGroup]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setIsPinned(isConversationPinned(user?.uuid, conversation.uuid));
    }, [conversation.uuid, user?.uuid]);

    const handleTogglePinned = () => {
        if (!user?.uuid) return;
        const next = !isPinned;
        setConversationPinned(user.uuid, conversation, next);
        setIsPinned(next);
        notify(next ? "Conversation épinglée à l'accueil" : "Conversation retirée de l'accueil");
    };

    const handleArchive = async () => {
        if (!window.confirm('Archiver cette conversation ?')) return;
        try {
            await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/${conversation.uuid}/archive/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'archive' }),
            });
            queryClient.invalidateQueries({ queryKey: ['conversations'] });
            closeConversation();
        } catch {
            notify("Erreur lors de l'archivage");
        }
    };

    const handleBlock = async () => {
        const partnerUuid = (conversation as any).other_participant?.uuid;
        if (!partnerUuid || !window.confirm('Bloquer cet utilisateur ?')) return;
        try {
            await fetchWithAuth(`${API_BASE_URL}/messaging/block-user/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_uuid: partnerUuid, action: 'block' }),
            });
            notify('Utilisateur bloqué');
            setTimeout(closeConversation, 1000);
        } catch {
            notify('Erreur lors du blocage');
        }
    };

    const handleLeaveGroup = async () => {
        if (!groupDetails?.uuid || !window.confirm('Quitter ce groupe ?')) return;
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/groups/${groupDetails.uuid}/leave/`, { method: 'POST' });
            if (!res.ok) throw new Error();
            // Remove from local IndexedDB immediately so the list updates without waiting for a sync
            if (user?.uuid) {
                await webDatabaseManager.initialize();
                await webDatabaseManager.deleteConversation(conversation.uuid, user.uuid);
            }
            await queryClient.invalidateQueries({ queryKey: ['conversations', 'groups'] });
            closeConversation();
            closeConversationManagement();
        } catch {
            notify('Impossible de quitter le groupe');
        }
    };

    const handleCopyInviteCode = async () => {
        if (!groupDetails?.invite_code) return;
        try {
            await navigator.clipboard.writeText(groupDetails.invite_code);
            notify('Code copié');
        } catch {
            notify('Impossible de copier le code');
        }
    };

    const handleRegenerateCode = async () => {
        if (!groupDetails?.uuid) return;
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/groups/${groupDetails.uuid}/regenerate-code/`, { method: 'POST' });
            if (!res.ok) throw new Error('Erreur');
            const data = await res.json();
            setGroupDetails((prev) => prev ? { ...prev, invite_code: data.new_code || prev.invite_code } : prev);
            notify('Nouveau code généré');
        } catch {
            notify('Erreur lors de la régénération');
        }
    };

    const handleToggleFavorite = async () => {
        if (!agentDetail?.uuid) return;
        try {
            const action = isFavorite ? 'unfavorite' : 'favorite';
            await fetchWithAuth(`${API_BASE_URL}/framework/agents/${agentDetail.uuid}/${action}/`, { method: 'POST' });
            setIsFavorite((current) => !current);
        } catch {
            notify('Impossible de modifier le favori');
        }
    };

    const handleOpenGroupConversation = async (summary: GroupSummary) => {
        // If the summary already carries the conversation UUID, open directly — no extra API call.
        if (summary.conversation_uuid) {
            openConversation({
                uuid: summary.conversation_uuid,
                unread_count: 0,
                conversation_type: 'group',
                name: summary.name,
                avatar_url: summary.avatar || '',
                group_info: {
                    uuid: summary.uuid,
                    name: summary.name,
                    avatar: summary.avatar || null,
                    member_count: summary.member_count,
                },
            });
            return;
        }
        // Fallback: fetch group detail (only works if user is a member).
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/groups/${summary.uuid}/`);
            if (!res.ok) throw new Error('Impossible de charger ce groupe');
            const detail = (await res.json()) as GroupDetails;
            const targetConversation = buildGroupConversation(detail);
            if (!targetConversation) {
                notify('Conversation introuvable pour ce groupe');
                return;
            }
            openConversation(targetConversation);
        } catch {
            notify('Impossible d\'ouvrir ce groupe');
        }
    };

    const handlePendingApproval = async (invitationUuid: string, action: 'approve' | 'reject', targetName: string) => {
        if (!groupDetails?.uuid) return;
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/groups/${groupDetails.uuid}/approve/${invitationUuid}/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, reason: '' }),
            });
            if (!res.ok) throw new Error('Erreur');
            notify(action === 'approve' ? `${targetName} ajouté au groupe` : `Demande de ${targetName} refusée`);
            await Promise.all([
                loadPendingApprovals(groupDetails.uuid),
                loadGroupBundle(groupDetails.uuid),
            ]);
        } catch {
            notify('Impossible de traiter cette demande');
        }
    };

    const toggleSelectedMember = (memberUuid: string) => {
        setSelectedMemberUuids((current) => (
            current.includes(memberUuid)
                ? current.filter((uuid) => uuid !== memberUuid)
                : [...current, memberUuid]
        ));
    };

    const handleInviteMembers = async () => {
        if (!groupDetails?.uuid || selectedMemberUuids.length === 0) return;
        setSubmittingInvites(true);
        try {
            const results = await Promise.allSettled(
                selectedMemberUuids.map(async (memberUuid) => {
                    const res = await fetchWithAuth(`${API_BASE_URL}/groups/${groupDetails.uuid}/invite/`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            target_user_uuid: memberUuid,
                            message: inviteMessage.trim(),
                        }),
                    });

                    if (!res.ok) {
                        const errorData = await res.json().catch(() => ({}));
                        throw new Error(parseErrorMessage(errorData, 'Invitation impossible'));
                    }
                })
            );

            const successCount = results.filter((result) => result.status === 'fulfilled').length;
            const failureCount = results.length - successCount;

            if (successCount > 0) {
                notify(
                    failureCount > 0
                        ? `${successCount} invitation(s) envoyée(s), ${failureCount} en échec`
                        : `${successCount} invitation(s) envoyée(s)`
                );
                setSelectedMemberUuids([]);
                setInviteMessage('');
                if (groupDetails.uuid) await loadPendingApprovals(groupDetails.uuid);
            } else {
                const firstFailure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
                notify(firstFailure?.reason instanceof Error ? firstFailure.reason.message : 'Aucune invitation envoyée');
            }
        } finally {
            setSubmittingInvites(false);
        }
    };

    const handleCreateSubgroup = async () => {
        if (!groupDetails?.uuid || !subgroupName.trim()) return;
        setCreatingSubgroup(true);
        try {
            const createRes = await fetchWithAuth(`${API_BASE_URL}/groups/create/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: subgroupName.trim(),
                    description: subgroupDescription.trim(),
                    parent_uuid: groupDetails.uuid,
                }),
            });

            if (!createRes.ok) {
                const errorData = await createRes.json().catch(() => ({}));
                throw new Error(parseErrorMessage(errorData, 'Impossible de créer le sous-groupe'));
            }

            const createdGroup = await createRes.json();
            const detailRes = await fetchWithAuth(`${API_BASE_URL}/groups/${createdGroup.uuid}/`);
            const createdDetail = detailRes.ok ? ((await detailRes.json()) as GroupDetails) : null;

            setSubgroupName('');
            setSubgroupDescription('');
            setShowSubgroupForm(false);
            await loadGroupBundle(groupDetails.uuid);
            queryClient.invalidateQueries({ queryKey: ['conversations'] });
            queryClient.invalidateQueries({ queryKey: ['conversations', 'groups'] });
            notify('Sous-groupe créé');

            const targetConversation = createdDetail ? buildGroupConversation(createdDetail) : null;
            if (targetConversation) {
                openConversation(targetConversation);
            }
        } catch (error) {
            notify(error instanceof Error ? error.message : 'Impossible de créer le sous-groupe');
        } finally {
            setCreatingSubgroup(false);
        }
    };

    const displayAvatar = isGroup
        ? (groupDetails?.avatar || conversation.avatar_url)
        : isAgent
            ? (agentDetail?.avatar_url || conversation.avatar_url)
            : (userProfile?.photo_profil_url || conversation.avatar_url);

    const displayName = isGroup
        ? (groupDetails?.name || conversation.name)
        : isAgent
            ? (agentDetail?.name || conversation.name)
            : (userProfile?.surnom || userProfile?.username || conversation.name);

    const typeBadgeLabel = isGroup ? 'Groupe' : isAgent ? 'Agent IA' : 'Conversation directe';
    const managementTitle = isGroup ? 'Infos du groupe' : isAgent ? "Infos de l'agent" : 'Infos du contact';

    return (
        <div className="mgmt-page">
            <div className="mgmt-page__top-vignette" aria-hidden="true" />
            <div className="mgmt-page__header">
                <button className="mgmt-page__back-btn" onClick={closeConversationManagement}>
                    <IoChevronBack size={22} />
                </button>
                <div className="mgmt-page__title-bubble">
                    <IoSettingsOutline size={18} className="mgmt-page__header-icon" />
                    <span className="mgmt-page__header-title">{managementTitle}</span>
                </div>
                <button className={`mgmt-page__pin-btn ${isPinned ? 'mgmt-page__pin-btn--active' : ''}`} onClick={handleTogglePinned} aria-label={isPinned ? "Désépingler de l'accueil" : "Épingler à l'accueil"} title={isPinned ? 'Désépingler' : 'Épingler'}>
                    {isPinned ? <IoPin size={19} /> : <IoPinOutline size={19} />}
                </button>
                {isAgent && (
                    <button className="mgmt-page__fav-btn" onClick={handleToggleFavorite}>
                        {isFavorite ? <IoStar size={20} color="rgba(10,145,104,1)" /> : <IoStarOutline size={20} color="#9ca3af" />}
                    </button>
                )}
            </div>

            {actionMsg && (
                <div className="mgmt-page__toast">
                    <IoCheckmarkCircleOutline size={16} />
                    {actionMsg}
                </div>
            )}

            <div className="mgmt-page__content">
                {loading ? (
                    <div className="mgmt-page__loading"><div className="mgmt-page__spinner" /></div>
                ) : (
                    <>
                        <div className="mgmt-page__desktop-layout">
                            <aside className="mgmt-page__identity-column">
                            <div className="mgmt-page__hero">
                            <div className="mgmt-page__hero-bg" />
                            {displayAvatar ? (
                                <img src={displayAvatar} alt={displayName} className="mgmt-page__avatar" />
                            ) : (
                                <div className="mgmt-page__avatar-placeholder">
                                    {isGroup ? <IoPeopleOutline size={44} /> : isAgent ? <IoSparklesOutline size={44} /> : <IoPersonOutline size={44} />}
                                </div>
                            )}
                            <h1 className="mgmt-page__name">{displayName}</h1>
                            <span className="mgmt-page__type-badge">{typeBadgeLabel}</span>

                            {isGroup && groupStats && (
                                <div className="mgmt-page__stats">
                                    <div className="mgmt-page__stat">
                                        <span className="mgmt-page__stat-value">{groupStats.total_members}</span>
                                        <span className="mgmt-page__stat-label">Membres</span>
                                    </div>
                                    <div className="mgmt-page__stat">
                                        <span className="mgmt-page__stat-value">{groupStats.recent_activity.messages_7d}</span>
                                        <span className="mgmt-page__stat-label">Messages (7j)</span>
                                    </div>
                                    <div className="mgmt-page__stat">
                                        <span className="mgmt-page__stat-value">{groupStats.recent_activity.new_members_7d}</span>
                                        <span className="mgmt-page__stat-label">Nouveaux (7j)</span>
                                    </div>
                                </div>
                            )}

                            {isDirect && userProfile?.nb_connexions !== undefined && (
                                <div className="mgmt-page__stats">
                                    <div className="mgmt-page__stat">
                                        <span className="mgmt-page__stat-value">{userProfile.nb_connexions}</span>
                                        <span className="mgmt-page__stat-label">Connexions</span>
                                    </div>
                                </div>
                            )}
                            </div>
                            </aside>

                            <main className="mgmt-page__settings-column">

                        {(isGroup && groupDetails?.description) && (
                            <section className="mgmt-page__section">
                                <h2 className="mgmt-page__section-title">À propos</h2>
                                <p className="mgmt-page__description">{groupDetails.description}</p>
                            </section>
                        )}

                        {(isDirect && userProfile?.bio) && (
                            <section className="mgmt-page__section">
                                <h2 className="mgmt-page__section-title">À propos</h2>
                                <p className="mgmt-page__description">{userProfile.bio}</p>
                            </section>
                        )}

                        {(isAgent && agentDetail?.description) && (
                            <section className="mgmt-page__section">
                                <h2 className="mgmt-page__section-title">À propos de l'agent</h2>
                                <p className="mgmt-page__description">{agentDetail.description}</p>
                            </section>
                        )}

                        {isAgent && agentDetail?.system_prompt && (
                            <section className="mgmt-page__section">
                                <button className="mgmt-page__expand-btn" onClick={() => setPromptExpanded((value) => !value)}>
                                    <span>Prompt système</span>
                                    {promptExpanded ? <IoChevronUp size={16} /> : <IoChevronDown size={16} />}
                                </button>
                                {promptExpanded && (
                                    <pre className="mgmt-page__prompt">{agentDetail.system_prompt}</pre>
                                )}
                            </section>
                        )}

                        {isGroup && groupDetails && (
                            <section className="mgmt-page__section">
                                <h2 className="mgmt-page__section-title">Hiérarchie</h2>

                                {parentGroupSummary ? (
                                    <button className="mgmt-page__setting-row" onClick={() => void handleOpenGroupConversation(parentGroupSummary)}>
                                        <div className="mgmt-page__setting-left">
                                            <IoArrowUpCircleOutline size={22} color="rgba(10, 145, 104, 1)" />
                                            <div>
                                                <span className="mgmt-page__setting-label">{parentGroupSummary.name}</span>
                                                <span className="mgmt-page__setting-hint">Groupe parent</span>
                                            </div>
                                        </div>
                                        <IoChevronDown className="mgmt-page__setting-chevron mgmt-page__setting-chevron--side" />
                                    </button>
                                ) : (
                                    <div className="mgmt-page__root-banner">
                                        <IoInformationCircleOutline size={16} />
                                        <span>Ce groupe est un groupe racine</span>
                                    </div>
                                )}

                                <div className="mgmt-page__subheading">
                                    SOUS-GROUPES ({groupDetails.subgroups?.length || 0})
                                </div>

                                {groupDetails.subgroups?.length ? (
                                    <div className="mgmt-page__stack">
                                        {groupDetails.subgroups.map((subgroup) => (
                                            <button
                                                key={subgroup.uuid}
                                                className="mgmt-page__setting-row"
                                                onClick={() => void handleOpenGroupConversation(subgroup)}
                                            >
                                                <div className="mgmt-page__setting-left">
                                                    <IoGitBranchOutline size={20} color="rgba(10, 145, 104, 1)" />
                                                    <div>
                                                        <span className="mgmt-page__setting-label">{subgroup.name}</span>
                                                        <span className="mgmt-page__setting-hint">
                                                            {subgroup.member_count} membre{subgroup.member_count > 1 ? 's' : ''}
                                                        </span>
                                                    </div>
                                                </div>
                                                <IoChevronDown className="mgmt-page__setting-chevron mgmt-page__setting-chevron--side" />
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="mgmt-page__muted-text">Aucun sous-groupe pour le moment.</p>
                                )}

                                {canCreateSubgroup && (
                                    <>
                                        <button
                                            className="mgmt-page__inline-action"
                                            onClick={() => setShowSubgroupForm((value) => !value)}
                                        >
                                            <IoAddCircleOutline size={20} />
                                            <span>Créer un sous-groupe</span>
                                        </button>

                                        {showSubgroupForm && (
                                            <div className="mgmt-page__panel-block">
                                                <label className="mgmt-page__field-label">Nom du sous-groupe</label>
                                                <input
                                                    className="mgmt-page__input"
                                                    value={subgroupName}
                                                    onChange={(event) => setSubgroupName(event.target.value)}
                                                    placeholder="Nom du sous-groupe"
                                                    maxLength={50}
                                                />
                                                <label className="mgmt-page__field-label">Description</label>
                                                <textarea
                                                    className="mgmt-page__textarea"
                                                    value={subgroupDescription}
                                                    onChange={(event) => setSubgroupDescription(event.target.value)}
                                                    placeholder="Description optionnelle"
                                                    rows={3}
                                                    maxLength={200}
                                                />
                                                <div className="mgmt-page__panel-actions">
                                                    <button className="mgmt-page__secondary-btn" onClick={() => setShowSubgroupForm(false)}>
                                                        Annuler
                                                    </button>
                                                    <button
                                                        className="mgmt-page__primary-btn"
                                                        onClick={() => void handleCreateSubgroup()}
                                                        disabled={creatingSubgroup || !subgroupName.trim()}
                                                    >
                                                        {creatingSubgroup ? 'Création...' : 'Créer'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                {canModerateGroup && !canCreateSubgroup && (
                                    <p className="mgmt-page__muted-text">
                                        Les sous-groupes ne peuvent être créés que depuis un groupe racine.
                                    </p>
                                )}
                            </section>
                        )}

                        {isGroup && groupDetails && (
                            <section className="mgmt-page__section">
                                <h2 className="mgmt-page__section-title">Membres & Accès</h2>

                                <div className="mgmt-page__subsection">
                                    <div className="mgmt-page__subsection-header">
                                        <span className="mgmt-page__subsection-label">Code d'invitation</span>
                                        {canModerateGroup && (
                                            <button className="mgmt-page__text-btn" onClick={() => void handleRegenerateCode()}>
                                                <IoRefreshOutline size={14} />
                                                Régénérer
                                            </button>
                                        )}
                                    </div>

                                    <button className="mgmt-page__invite-code-card" onClick={() => void handleCopyInviteCode()}>
                                        <span className="mgmt-page__invite-code-value">{groupDetails.invite_code || '••••••••'}</span>
                                        <IoCopyOutline size={20} />
                                    </button>
                                </div>

                                <button
                                    className="mgmt-page__inline-action"
                                    onClick={() => {
                                        setShowInvitePanel((value) => !value);
                                        if (!showInvitePanel) void loadConnections();
                                    }}
                                >
                                    <IoPersonAddOutline size={20} />
                                    <span>Ajouter des membres</span>
                                </button>

                                {showInvitePanel && (
                                    <div className="mgmt-page__panel-block">
                                        <input
                                            className="mgmt-page__input"
                                            value={memberSearch}
                                            onChange={(event) => setMemberSearch(event.target.value)}
                                            placeholder="Rechercher parmi vos amis..."
                                        />
                                        <textarea
                                            className="mgmt-page__textarea"
                                            value={inviteMessage}
                                            onChange={(event) => setInviteMessage(event.target.value)}
                                            placeholder="Message d'invitation optionnel"
                                            rows={2}
                                            maxLength={200}
                                        />

                                        {loadingConnections ? (
                                            <div className="mgmt-page__empty-state">Chargement de vos amis...</div>
                                        ) : filteredConnections.length === 0 ? (
                                            <div className="mgmt-page__empty-state">Aucun ami disponible à inviter.</div>
                                        ) : (
                                            <div className="mgmt-page__member-pick-list">
                                                {filteredConnections.map((connection) => {
                                                    const selected = selectedMemberUuids.includes(connection.uuid);
                                                    return (
                                                        <button
                                                            key={connection.uuid}
                                                            className={`mgmt-page__pick-row ${selected ? 'mgmt-page__pick-row--selected' : ''}`}
                                                            onClick={() => toggleSelectedMember(connection.uuid)}
                                                        >
                                                            <div className="mgmt-page__member-left">
                                                                {connection.photo_profil_url ? (
                                                                    <img src={connection.photo_profil_url} alt="" className="mgmt-page__member-avatar" />
                                                                ) : (
                                                                    <div className="mgmt-page__member-avatar-placeholder">
                                                                        {(connection.surnom || connection.username).charAt(0).toUpperCase()}
                                                                    </div>
                                                                )}
                                                                <div className="mgmt-page__member-info">
                                                                    <span className="mgmt-page__member-name">{connection.surnom || connection.username}</span>
                                                                    <span className="mgmt-page__member-role">@{connection.username}</span>
                                                                </div>
                                                            </div>
                                                            {selected ? <IoCheckmarkCircleOutline size={18} color="rgba(10,145,104,1)" /> : null}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        <div className="mgmt-page__panel-actions">
                                            <button className="mgmt-page__secondary-btn" onClick={() => setShowInvitePanel(false)}>
                                                Fermer
                                            </button>
                                            <button
                                                className="mgmt-page__primary-btn"
                                                onClick={() => void handleInviteMembers()}
                                                disabled={submittingInvites || selectedMemberUuids.length === 0}
                                            >
                                                {submittingInvites ? 'Envoi...' : `Inviter (${selectedMemberUuids.length})`}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {canModerateGroup && (
                                    <div className="mgmt-page__subsection">
                                        <div className="mgmt-page__subsection-header">
                                            <span className="mgmt-page__subsection-label">
                                                DEMANDES EN ATTENTE ({pendingApprovals.length})
                                            </span>
                                            <button className="mgmt-page__icon-btn" onClick={() => groupDetails.uuid && void loadPendingApprovals(groupDetails.uuid)}>
                                                <IoRefreshOutline size={16} />
                                            </button>
                                        </div>

                                        {loadingApprovals ? (
                                            <div className="mgmt-page__empty-state">Chargement des demandes...</div>
                                        ) : pendingApprovals.length === 0 ? (
                                            <div className="mgmt-page__empty-state">Aucune demande en attente.</div>
                                        ) : (
                                            <div className="mgmt-page__request-list">
                                                {pendingApprovals.map((invitation) => {
                                                    const targetName = getUserDisplayName(invitation.target_user);
                                                    return (
                                                        <div key={invitation.uuid} className="mgmt-page__request-card">
                                                            <span className="mgmt-page__request-name">{targetName}</span>
                                                            {invitation.message ? (
                                                                <span className="mgmt-page__request-message">{invitation.message}</span>
                                                            ) : null}
                                                            <div className="mgmt-page__request-actions">
                                                                <button
                                                                    className="mgmt-page__primary-btn"
                                                                    onClick={() => void handlePendingApproval(invitation.uuid, 'approve', targetName)}
                                                                >
                                                                    Approuver
                                                                </button>
                                                                <button
                                                                    className="mgmt-page__secondary-btn"
                                                                    onClick={() => void handlePendingApproval(invitation.uuid, 'reject', targetName)}
                                                                >
                                                                    Refuser
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="mgmt-page__subsection">
                                    <div className="mgmt-page__subsection-header">
                                        <span className="mgmt-page__subsection-label">MEMBRES ({groupMembers.length || groupDetails.member_count})</span>
                                    </div>

                                    <div className="mgmt-page__members">
                                        {membersToDisplay.map((member, index) => (
                                            <div key={getMemberUuid(member) || `member-${index}`} className="mgmt-page__member-row">
                                                <div className="mgmt-page__member-left">
                                                    {getMemberAvatar(member) ? (
                                                        <img src={getMemberAvatar(member)} alt="" className="mgmt-page__member-avatar" />
                                                    ) : (
                                                        <div className="mgmt-page__member-avatar-placeholder">
                                                            {getMemberDisplayName(member).charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div className="mgmt-page__member-info">
                                                        <span className="mgmt-page__member-name">{getMemberDisplayName(member)}</span>
                                                        <span className="mgmt-page__member-role">
                                                            {member.role === 'owner' ? '👑 Propriétaire' : member.role === 'moderator' ? '⭐ Modérateur' : 'Membre'}
                                                        </span>
                                                        {member.is_muted ? (
                                                            <span className="mgmt-page__member-muted">
                                                                Muté{member.muted_until ? ` jusqu'au ${formatDateTime(member.muted_until)}` : ''}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {hasMoreMembers && (
                                        <button className="mgmt-page__show-more" onClick={() => setShowAllMembers((value) => !value)}>
                                            {showAllMembers ? 'Voir moins' : 'Voir tous les membres'}
                                        </button>
                                    )}
                                </div>
                            </section>
                        )}

                        {isGroup && (
                            <section className="mgmt-page__section">
                                <h2 className="mgmt-page__section-title">Calendrier partagé</h2>
                                <div className="mgmt-page__setting-row mgmt-page__setting-row--static">
                                    <div className="mgmt-page__setting-left">
                                        <IoCalendarOutline size={22} color="rgba(10, 145, 104, 1)" />
                                        <div>
                                            <span className="mgmt-page__setting-label">Ouvrir le calendrier</span>
                                            <span className="mgmt-page__setting-hint">Ajout et consultation d'événements à aligner avec mobile</span>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        )}

                        <section className="mgmt-page__section">
                            <h2 className="mgmt-page__section-title">Médias, liens et documents</h2>
                            <div className="mgmt-page__media-tabs">
                                <button
                                    className={`mgmt-page__media-tab${activeMediaTab === 'media' ? ' mgmt-page__media-tab--active' : ''}`}
                                    onClick={() => void handleMediaTab('media')}
                                >
                                    <IoImageOutline size={18} />
                                    <span>Médias</span>
                                </button>
                                <button
                                    className={`mgmt-page__media-tab${activeMediaTab === 'links' ? ' mgmt-page__media-tab--active' : ''}`}
                                    onClick={() => void handleMediaTab('links')}
                                >
                                    <IoLinkOutline size={18} />
                                    <span>Liens</span>
                                </button>
                                <button
                                    className={`mgmt-page__media-tab${activeMediaTab === 'documents' ? ' mgmt-page__media-tab--active' : ''}`}
                                    onClick={() => void handleMediaTab('documents')}
                                >
                                    <IoDocumentOutline size={18} />
                                    <span>Documents</span>
                                </button>
                            </div>

                            {activeMediaTab && (
                                <div className="mgmt-page__media-panel">
                                    {loadingMediaTab ? (
                                        <div className="mgmt-page__empty-state">Chargement…</div>
                                    ) : activeMediaTab === 'media' ? (
                                        mediaItems.length === 0 ? (
                                            <div className="mgmt-page__empty-state">Aucun média dans cette conversation.</div>
                                        ) : (
                                            <div className="mgmt-page__media-grid">
                                                {mediaItems.map((item) => (
                                                    <a
                                                        key={item.attachment_uuid}
                                                        href={item.file_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="mgmt-page__media-thumb"
                                                    >
                                                        {item.file_type === 'video' ? (
                                                            <div className="mgmt-page__media-thumb-video">
                                                                {item.thumbnail_url
                                                                    ? <img src={item.thumbnail_url} alt="" />
                                                                    : <IoImageOutline size={28} />}
                                                                <span className="mgmt-page__media-thumb-play">▶</span>
                                                            </div>
                                                        ) : (
                                                            <img src={item.thumbnail_url || item.file_url} alt={item.original_filename || ''} />
                                                        )}
                                                    </a>
                                                ))}
                                            </div>
                                        )
                                    ) : activeMediaTab === 'documents' ? (
                                        documentItems.length === 0 ? (
                                            <div className="mgmt-page__empty-state">Aucun document dans cette conversation.</div>
                                        ) : (
                                            <div className="mgmt-page__doc-list">
                                                {documentItems.map((item) => (
                                                    <a
                                                        key={item.attachment_uuid}
                                                        href={item.file_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="mgmt-page__doc-row"
                                                    >
                                                        <IoDocumentOutline size={20} color="rgba(10,145,104,0.85)" />
                                                        <div className="mgmt-page__doc-info">
                                                            <span className="mgmt-page__doc-name">{item.original_filename || 'Document'}</span>
                                                            {item.message?.sender?.username && (
                                                                <span className="mgmt-page__doc-meta">{item.message.sender.username} · {formatDate(item.created_at)}</span>
                                                            )}
                                                        </div>
                                                    </a>
                                                ))}
                                            </div>
                                        )
                                    ) : (
                                        linkItems.length === 0 ? (
                                            <div className="mgmt-page__empty-state">Aucun lien dans cette conversation.</div>
                                        ) : (
                                            <div className="mgmt-page__link-list">
                                                {linkItems.map((item, i) => (
                                                    <a
                                                        key={i}
                                                        href={item.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="mgmt-page__link-row"
                                                    >
                                                        <IoLinkOutline size={16} color="rgba(10,145,104,0.85)" className="mgmt-page__link-icon" />
                                                        <div className="mgmt-page__link-info">
                                                            <span className="mgmt-page__link-url">{item.url}</span>
                                                            {item.sender && (
                                                                <span className="mgmt-page__link-meta">{item.sender} · {formatDate(item.created_at)}</span>
                                                            )}
                                                        </div>
                                                    </a>
                                                ))}
                                            </div>
                                        )
                                    )}
                                </div>
                            )}
                        </section>

                        {isGroup && (
                            <section className="mgmt-page__section">
                                <h2 className="mgmt-page__section-title">Autres actions</h2>
                                <div className="mgmt-page__actions">
                                    {canModerateGroup && (
                                        <>
                                            <button
                                                className="mgmt-page__action-row"
                                                onClick={() => {
                                                    const nextValue = !showModerationLogs;
                                                    setShowModerationLogs(nextValue);
                                                    if (nextValue && groupDetails?.uuid) void loadModerationLogs(groupDetails.uuid);
                                                }}
                                            >
                                                <div className="mgmt-page__action-icon"><IoShieldCheckmarkOutline size={22} /></div>
                                                <span>Historique de modération</span>
                                            </button>

                                            {showModerationLogs && (
                                                <div className="mgmt-page__panel-block">
                                                    {loadingLogs ? (
                                                        <div className="mgmt-page__empty-state">Chargement des logs...</div>
                                                    ) : moderationLogs.length === 0 ? (
                                                        <div className="mgmt-page__empty-state">Aucun log de modération.</div>
                                                    ) : (
                                                        <div className="mgmt-page__log-list">
                                                            {moderationLogs.map((log) => (
                                                                <div key={log.uuid} className="mgmt-page__log-row">
                                                                    <span className="mgmt-page__log-title">
                                                                        {log.action} · {getUserDisplayName(log.target_user)}
                                                                    </span>
                                                                    <span className="mgmt-page__log-meta">
                                                                        Par {getUserDisplayName(log.moderator)} le {formatDateTime(log.created_at)}
                                                                    </span>
                                                                    {log.reason ? (
                                                                        <span className="mgmt-page__log-meta">{log.reason}</span>
                                                                    ) : null}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )}

                                    <button className="mgmt-page__action-row mgmt-page__action-row--danger" onClick={handleLeaveGroup}>
                                        <div className="mgmt-page__action-icon mgmt-page__action-icon--danger"><IoExitOutline size={22} /></div>
                                        <span>Quitter le groupe</span>
                                    </button>
                                </div>
                            </section>
                        )}

                        {!isGroup && (
                            <section className="mgmt-page__section">
                                <h2 className="mgmt-page__section-title">Actions</h2>
                                <div className="mgmt-page__actions">
                                    <button className="mgmt-page__action-row" onClick={handleArchive}>
                                        <div className="mgmt-page__action-icon"><IoArchiveOutline size={22} /></div>
                                        <span>Archiver la conversation</span>
                                    </button>

                                    {isDirect && (
                                        <button className="mgmt-page__action-row mgmt-page__action-row--danger" onClick={handleBlock}>
                                            <div className="mgmt-page__action-icon mgmt-page__action-icon--danger"><IoBanOutline size={22} /></div>
                                            <span>Bloquer cet utilisateur</span>
                                        </button>
                                    )}
                                </div>
                            </section>
                        )}

                        {isGroup && groupDetails && (
                            <section className="mgmt-page__info-section">
                                <div className="mgmt-page__info-line">
                                    <IoInformationCircleOutline size={16} />
                                    <span>Groupe créé le {formatDate(groupDetails.created_at || conversation.created_at)}</span>
                                </div>
                                {groupDetails.invite_code ? (
                                    <div className="mgmt-page__info-line">
                                        <IoCopyOutline size={16} />
                                        <span>Code d'invitation : {groupDetails.invite_code}</span>
                                    </div>
                                ) : null}
                            </section>
                        )}

                        {isGroup && !groupDetails && (
                            <section className="mgmt-page__section">
                                <div className="mgmt-page__empty-state mgmt-page__empty-state--error">
                                    <IoAlertCircleOutline size={18} />
                                    <span>Impossible de charger les détails du groupe.</span>
                                </div>
                            </section>
                        )}
                            </main>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
