import { useEffect, useRef, useState } from 'react';
import { IoChevronBack } from 'react-icons/io5';
import { useNavigation } from '../contexts/NavigationContext';
import { useWatch, useWatchAction } from '../hooks/useWatches';
import { WatchArtwork } from '../components/watches/WatchArtwork';
import { WatchList } from '../components/watches/WatchList';
import { enrichConversation, type Conversation } from '../hooks/useConversations';
import { fetchWithAuth } from '../services/apiClient';
import { API_BASE_URL } from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { readComposer, saveDraft } from '../services/composerDrafts';
import type { WatchChoice, WatchCommand } from '../services/watches';
import '../components/conversations/ConversationThread.css';
import '../components/watches/Watches.css';

export default function WatchPage() {
    const { watchUuid, closeWatch, openConversation } = useNavigation();
    const { user } = useAuth();
    const detail = useWatch(watchUuid);
    const action = useWatchAction(watchUuid);
    const [showList, setShowList] = useState(false);
    const [opening, setOpening] = useState(false);
    const [navigationError, setNavigationError] = useState<string | null>(null);
    const seen = useRef(new Set<string>());
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const item = detail.isError ? undefined : detail.data;
    const performAction = async (choice: WatchChoice) => {
        const command: WatchCommand = choice.agent_uuid ? { action: choice.id, agent_uuid: choice.agent_uuid }
            : choice.source_uuid ? { action: choice.id, source_uuid: choice.source_uuid } : choice.id;
        if (choice.id !== 'open_source' && choice.id !== 'discuss_agent') { action.mutate(command); return; }
        setOpening(true);
        setNavigationError(null);
        try {
            const result = await action.mutateAsync(command);
            if (!mounted.current) return;
            if (result.navigation?.type === 'external') {
                const url = new URL(result.navigation.url);
                if (url.protocol !== 'https:' || !['mail.google.com', 'calendar.google.com', 'github.com'].includes(url.host)) throw new Error();
                window.location.assign(url.href);
            } else if (result.navigation?.type === 'agent_conversation') {
                const target = result.navigation;
                if (!user?.uuid || target.agent_uuid !== choice.agent_uuid || !target.draft.trim()) throw new Error();
                const saved = readComposer(user.uuid, target.uuid);
                // Keep existing writing and recoverable sends. Reopening the same
                // watch must not duplicate its context or send anything implicitly.
                saveDraft(user.uuid, target.uuid, { text: saved.draft.text.includes(target.draft) ? saved.draft.text
                    : [saved.draft.text, target.draft].filter(Boolean).join('\n\n'), jarvisMode: false, agent: null, reply: null });
                openConversation(enrichConversation({ uuid: target.uuid, conversation_type: 'ai_agent',
                    name: target.agent_name, avatar_url: target.agent_avatar_url, unread_count: target.unread_count,
                    framework_agent: { uuid: target.agent_uuid, name: target.agent_name, avatar_url: target.agent_avatar_url } }));
            } else if (result.navigation?.type === 'conversation') {
                const response = await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/${encodeURIComponent(result.navigation.uuid)}/`);
                if (!response.ok) throw new Error();
                const conversation = await response.json() as Conversation;
                if (mounted.current) openConversation(enrichConversation(conversation));
            } else throw new Error();
        } catch {
            if (mounted.current) setNavigationError(choice.id === 'discuss_agent'
                ? 'Impossible de préparer cette discussion pour le moment. Votre brouillon est conservé.'
                : 'Impossible d’ouvrir cette source pour le moment.');
        } finally { if (mounted.current) setOpening(false); }
    };
    useEffect(() => {
        if (item && !item.seen_at && !seen.current.has(item.uuid)) {
            seen.current.add(item.uuid);
            action.mutate('seen');
        }
    }, [item, action]);
    return <section className="conversation-thread watch-page">
        <header className="thread-header">
            <button className="thread-back-btn" onClick={showList ? () => setShowList(false) : closeWatch} aria-label="Retour à l’accueil"><IoChevronBack size={22} /></button>
            {item && <button className="thread-header-info" onClick={() => setShowList(!showList)} aria-expanded={showList} aria-label="Afficher les veilles">
                <span className="thread-header-avatar watch-header__avatar"><WatchArtwork kind={item.kind} uuid={item.uuid} version={item.artwork_version} /></span>
                <span className="thread-header-name" title={item.title}>{item.title}</span>
            </button>}
        </header>
        {showList ? <div className="watch-inline-list"><WatchList onChoose={() => setShowList(false)} /></div> : <div className="watch-page__scroll">
            {detail.isLoading && <p role="status">Chargement…</p>}
            {detail.isError && <div className="watch-notice" role="alert"><p>{detail.error.message}</p><button onClick={() => void detail.refetch()}>Réessayer</button></div>}
            {item && <div className="watch-detail">
                <p className="watch-summary">{item.summary}{item.payload.message && <><br />{item.payload.message}</>}</p>
                {item.result || item.handled_at ? <p className="watch-result" role="status">{item.result || 'Veille masquée.'}</p> : <div className="watch-actions">
                    {item.actions.map(choice => <button key={`${choice.id}:${choice.source_uuid || choice.agent_uuid || ''}`} className={`watch-button ${choice.id === 'accept' || choice.id === 'open_source' || choice.id === 'discuss_agent' ? 'watch-button--primary' : ''}`} disabled={action.isPending || opening} onClick={() => void performAction(choice)}>{choice.label}</button>)}
                    {item.source_status === 'pending' && <button className="watch-button" disabled={action.isPending || opening} onClick={() => action.mutate('snooze')}>Plus tard</button>}
                </div>}
                {item.snoozed_until && <p className="watch-feedback" role="status">Cette veille reviendra demain.</p>}
                {action.isPending && action.variables !== 'seen' && <p className="watch-feedback" role="status">Mise à jour…</p>}
                {action.isError && <p className="watch-error" role="alert">{action.error.message}</p>}
                {navigationError && !action.isError && <p className="watch-error" role="alert">{navigationError}</p>}
            </div>}
        </div>}
    </section>;
}
