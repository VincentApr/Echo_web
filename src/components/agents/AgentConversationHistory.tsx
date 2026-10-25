import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IoArrowForward } from 'react-icons/io5';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { conversationActivity, conversationPrompt, type AgentConversation } from '../../services/agentCollection';
import './AgentConversationHistory.css';

const dateLabel = (value: number) => value ? new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'short' }).format(value) : '';

function HistoryRow({ conversation }: { conversation: AgentConversation }) {
    const { user } = useAuth();
    const { openConversation, selectedConversation } = useNavigation();
    const version = conversation.last_message?.created_at || conversation.updated_at;
    const first = useQuery({ queryKey: ['agent-history', user?.uuid, conversation.uuid, 'first', version], queryFn: ({ signal }) => conversationPrompt(conversation.uuid, true, signal), staleTime: 60_000, retry: 1 });
    const last = useQuery({ queryKey: ['agent-history', user?.uuid, conversation.uuid, 'last', version], queryFn: ({ signal }) => conversationPrompt(conversation.uuid, false, signal), staleTime: 60_000, retry: 1 });
    const title = conversation.title || first.data || (first.isPending ? 'Chargement…' : conversation.last_message ? `Conversation${conversationActivity(conversation) ? ` du ${dateLabel(conversationActivity(conversation))}` : ''}` : 'Nouvelle conversation');
    const preview = last.data || (last.isPending ? 'Chargement du dernier prompt…' : last.isError ? 'Aperçu indisponible' : 'Aucun prompt pour le moment');
    return <button className="agent-history__row" aria-current={selectedConversation?.uuid === conversation.uuid ? 'page' : undefined} onClick={() => openConversation(conversation)} aria-label={`Ouvrir la conversation : ${title}`}>
        <span className="agent-history__copy"><strong>{title}</strong><span>{preview}</span></span>
        <span className="agent-history__meta"><time>{dateLabel(conversationActivity(conversation))}</time>{conversation.unread_count > 0 && <span className="agent-history__unread" aria-label={`${conversation.unread_count} messages non lus`}>{conversation.unread_count}</span>}<IoArrowForward aria-hidden="true" /></span>
    </button>;
}

export default function AgentConversationHistory({ conversations }: { conversations: AgentConversation[] }) {
    const [limit, setLimit] = useState(8);
    return <>
        <div className="agent-history__list">{conversations.slice(0, limit).map(conversation => <HistoryRow key={conversation.uuid} conversation={conversation} />)}</div>
        {conversations.length > limit && <button className="identity-white-button agent-history__more" onClick={() => setLimit(value => value + 8)}>Afficher la suite</button>}
    </>;
}
