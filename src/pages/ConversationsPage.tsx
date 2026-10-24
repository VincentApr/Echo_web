import { IoAdd } from 'react-icons/io5';
import type { CSSProperties } from 'react';
import { useConversations } from '../hooks/useConversations';
import { useWatchTileSize } from '../hooks/useWatchTileSize';
import '../components/panels/ConversationsPanel.css';
import '../components/watches/Watches.css';
import { ConversationThread } from '../components/conversations/ConversationThread';
import ConversationManagementPage from './ConversationManagementPage';
import { useNavigation } from '../contexts/NavigationContext';
import './ConversationsPage.css';

export default function ConversationsPage() {
  const { selectedConversation, conversationView, currentPage, openConversation, navigate } = useNavigation();
  const { privateConversations, groupConversations, agentConversations, isLoading } = useConversations();
  const tileSize = useWatchTileSize();
  const conversations = currentPage === 'groups' ? groupConversations : currentPage === 'agents' ? agentConversations : privateConversations;
  const title = currentPage === 'groups' ? 'Groupes' : currentPage === 'agents' ? 'Conversations avec les agents' : 'Conversations';
  const addLabel = currentPage === 'groups' ? 'Nouveau groupe' : currentPage === 'agents' ? 'Nouvel agent' : 'Nouvelle conversation';

  if (!selectedConversation) {
    return <section className="watch-home conv-panel conversations-home" style={{ '--watch-tile-size': `${tileSize}px` } as CSSProperties} aria-label={title}>
      <div className="watch-grid" aria-label={title} aria-busy={isLoading}>
        {conversations.map(conversation => <button key={conversation.uuid} className="conv-square watch-card" title={conversation.name} aria-label={`Ouvrir ${conversation.name}`} onClick={() => openConversation(conversation)}>
          {conversation.avatar_url
            ? <img src={conversation.avatar_url} alt="" className="conv-square__avatar" />
            : <span className="conv-square__avatar-placeholder">{conversation.name.charAt(0).toUpperCase()}</span>}
          <span className="conv-square__name-badge"><span className="conv-square__name">{conversation.name}</span></span>
          {conversation.unread_count > 0 && <span className="conv-square__unread-badge">{conversation.unread_count > 99 ? '99+' : conversation.unread_count}</span>}
        </button>)}
        {isLoading && conversations.length === 0 && Array.from({ length: 3 }, (_, index) => <div key={index} className="conv-square watch-card watch-card--skeleton" aria-label="Chargement des conversations" />)}
        <button className="conv-square watch-card conv-square--add" title={addLabel} aria-label={addLabel} onClick={() => navigate(currentPage === 'groups' ? 'add-group' : currentPage === 'agents' ? 'add-agent' : 'add-friend')}>
          <IoAdd size={38} color="var(--echo-green)" />
        </button>
      </div>
    </section>;
  }

  if (conversationView === 'management') {
    return <ConversationManagementPage conversation={selectedConversation} />;
  }

  return (
    <ConversationThread
      key={selectedConversation.uuid}
      conversationId={selectedConversation.uuid}
      conversationName={selectedConversation.name}
      conversationAvatar={selectedConversation.avatar_url}
      conversationType={selectedConversation.conversation_type}
    />
  );
}
