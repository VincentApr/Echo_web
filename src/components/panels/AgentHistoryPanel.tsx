import AgentConversationHistory from '../agents/AgentConversationHistory';
import { useNavigation } from '../../contexts/NavigationContext';
import { useConversations } from '../../hooks/useConversations';
import { conversationActivity, conversationAgentUuid } from '../../services/agentCollection';

export default function AgentHistoryPanel() {
    const { selectedConversation } = useNavigation();
    const { agentConversations, isLoading, error, refreshAll } = useConversations();
    if (!selectedConversation) return null;
    const uuid = conversationAgentUuid(selectedConversation);
    const conversations = agentConversations.filter(conversation => uuid
        ? conversationAgentUuid(conversation) === uuid
        : conversation.uuid === selectedConversation.uuid);
    if (!conversations.some(conversation => conversation.uuid === selectedConversation.uuid)) conversations.push(selectedConversation);
    conversations.sort((a, b) => conversationActivity(b) - conversationActivity(a));
    const name = selectedConversation.framework_agent?.name || selectedConversation.agent_info?.name || selectedConversation.agent_name || selectedConversation.name;
    return <section className="agent-history-panel" aria-label={`Historique de ${name}`}>
        <h2>{name}</h2>
        {!!error && <p role="alert">Historique indisponible. <button onClick={() => void refreshAll()}>Réessayer</button></p>}
        {isLoading && <p role="status">Chargement…</p>}
        <AgentConversationHistory key={uuid || selectedConversation.uuid} conversations={conversations} />
    </section>;
}
