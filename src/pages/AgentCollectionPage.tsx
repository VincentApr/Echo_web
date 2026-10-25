import AgentConversationHistory from '../components/agents/AgentConversationHistory';
import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { IoAdd } from 'react-icons/io5';
import AgentIdentityCard from '../components/agents/AgentIdentityCard';
import AgentActionRow from '../components/agents/AgentActionRow';
import { enrichAgent, type ToolItem } from '../data/toolsCatalog';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { useAgentFramework } from '../hooks/useAgentFramework';
import type { Conversation } from '../hooks/useConversations';
import { conversationActivity, conversationAgentUuid, type AgentConversation } from '../services/agentCollection';
import { fetchWithAuth } from '../services/apiClient';
import { API_BASE_URL } from '../config/api';
import { webDatabaseManager } from '../services/webDatabase';
import './AgentCollectionPage.css';

function History({ conversations, agent, create, busy }: { conversations: AgentConversation[]; agent: ToolItem; create: () => void; busy: boolean }) {
    return <section className="agent-history" aria-label={`Historique de ${agent.name}`}>
        <header className="agent-history__header"><div><h1>{agent.name}</h1><span>{conversations.length} conversation{conversations.length > 1 ? 's' : ''}</span></div><button className="identity-white-button" disabled={busy} onClick={create}><IoAdd />{busy ? 'Création…' : 'Nouvelle conversation'}</button></header>
        <AgentConversationHistory conversations={conversations} />
    </section>;
}

export default function AgentCollectionPage({ conversations, loading, error, retry }: { conversations: AgentConversation[]; loading: boolean; error: unknown; retry: () => void }) {
    const { user } = useAuth();
    const { openConversation, navigate } = useNavigation();
    const { myAgents, publicAgents } = useAgentFramework();
    const queryClient = useQueryClient();
    const storageKey = `echo:agent-collection:${user?.uuid}`;
    const [selected, setSelected] = useState(() => sessionStorage.getItem(storageKey));
    const [busy, setBusy] = useState(false);
    const creating = useRef(false);
    const [creationError, setCreationError] = useState<string | null>(null);
    const collection = useMemo(() => {
        const buckets = new Map<string, { agent: ToolItem; conversations: AgentConversation[]; uuid?: string }>();
        const catalog = new Map([...publicAgents, ...myAgents].map(agent => [agent.uuid, agent]));
        for (const conversation of [...conversations].sort((a, b) => conversationActivity(b) - conversationActivity(a))) {
            const uuid = conversationAgentUuid(conversation);
            // Never merge unrelated agents merely because they share a name.
            const key = uuid || `unknown:${conversation.uuid}`;
            const existing = buckets.get(key);
            if (existing) { existing.conversations.push(conversation); continue; }
            const metadata = catalog.get(uuid || '');
            const agent = enrichAgent({ uuid: key, name: conversation.framework_agent?.name || conversation.agent_info?.name || conversation.agent?.name || conversation.agent_name || conversation.name, description: conversation.framework_agent?.description || conversation.agent?.description || '', avatar_url: conversation.avatar_url, ...metadata });
            buckets.set(key, { agent, conversations: [conversation], uuid });
        }
        return [...buckets.values()];
    }, [conversations, myAgents, publicAgents]);
    const active = collection.find(item => item.agent.agentUuid === selected) || collection[0];
    const select = (id: string) => { setSelected(id); sessionStorage.setItem(storageKey, id); setCreationError(null); };
    const create = async () => {
        if (!active?.uuid || creating.current) return;
        const target = active;
        creating.current = true; setBusy(true); setCreationError(null);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/agents/create/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_uuid: target.uuid }) });
            if (!response.ok) throw new Error('Impossible de créer cette conversation. Réessaie dans un instant.');
            const data = await response.json() as Partial<Conversation>;
            if (!data.uuid) throw new Error('La conversation créée ne contient pas d’identifiant.');
            const conversation: Conversation = { ...data, uuid: data.uuid, name: target.agent.name, avatar_url: target.agent.avatarUrl || '', conversation_type: 'agent', unread_count: 0, framework_agent: { uuid: target.uuid, name: target.agent.name, avatar_url: target.agent.avatarUrl || '' } };
            if (user?.uuid) await webDatabaseManager.upsertConversation(conversation as unknown as Record<string, unknown>, user.uuid);
            await queryClient.invalidateQueries({ queryKey: ['conversations', 'agents'] });
            select(target.agent.agentUuid);
            openConversation(conversation);
        } catch (error) { setCreationError(error instanceof Error ? error.message : 'Impossible de créer la conversation.'); }
        finally { creating.current = false; setBusy(false); }
    };
    return <div className="agent-collection">
        <div className="agent-collection__heading"><button className="identity-white-button" onClick={() => navigate('add-agent')} aria-label="Ajouter un agent à ma collection"><IoAdd />Ajouter un agent</button></div>
        {!!error && <div role="alert" className="agent-collection__notice">Impossible de charger les conversations. <button onClick={retry}>Réessayer</button></div>}
        <AgentActionRow className="agent-wallet">
            {collection.map(item => <div key={item.agent.agentUuid} className={`agent-wallet__slot ${item === active ? 'agent-wallet__slot--selected' : ''}`}>
                <AgentIdentityCard agent={item.agent} compact selected={item === active} onOpen={() => select(item.agent.agentUuid)} />
            </div>)}
            {loading && !collection.length && <div className="agent-wallet__loading" role="status">Chargement de la collection…</div>}
        </AgentActionRow>
        {creationError && <p className="agent-collection__notice" role="alert">{creationError}</p>}
        {active ? <History key={active.agent.agentUuid} agent={active.agent} conversations={active.conversations} busy={busy || !active.uuid} create={() => void create()} /> : !loading && !error && <div className="agent-collection__empty"><h1>Ta collection commence ici</h1><p>Choisis un agent pour commencer une conversation.</p><button className="identity-white-button" onClick={() => navigate('add-agent')}><IoAdd />Choisir un agent</button></div>}
    </div>;
}
