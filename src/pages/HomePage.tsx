import { useEffect, useMemo, useState } from 'react';
import {
    IoAdd, IoArrowForward, IoCalendarOutline, IoClose, IoDocumentTextOutline,
    IoImageOutline, IoMailOutline, IoMusicalNotesOutline, IoPartlySunnyOutline,
    IoPlanetOutline, IoSearchOutline, IoWalkOutline,
} from 'react-icons/io5';
import { useAuth } from '../contexts/AuthContext';
import { useJarvis } from '../contexts/JarvisContext';
import { AgentContentRenderer } from '../components/conversations/AgentContentRenderer';
import { archiveConversation, sendTemporaryJarvisAgentMessage } from '@web/services/jarvisAgentConversation';
import { useNavigation } from '../contexts/NavigationContext';
import { useConversations } from '../hooks/useConversations';
import { CONVERSATION_PINS_EVENT, getPinnedConversationUuids } from '../services/conversationPins';
import jarvisLogo from '@web/assets/logo-watermark.png?inline';
import './HomePage.css';

interface HomeSuggestion {
    id: string;
    keyword: string;
    icon: React.ReactNode;
    completions: string[];
}

const WELCOME_MESSAGES = [
    'Content de vous retrouver.', 'Bon retour parmi vos conversations.',
    'Bonjour, tout est prêt pour reprendre tranquillement.', 'Bienvenue, {name}.',
    'Ravi de vous revoir, {name}.', 'Vos échanges importants vous attendent.',
    'Installez-vous, on reprend là où vous en étiez.', 'Un nouveau passage sur Echo, au calme.',
    'Bonjour {name}, vos conversations sont prêtes.', 'Tout est en place pour continuer.',
];

const SUGGESTIONS: HomeSuggestion[] = [
    { id: 'gmail', keyword: 'Gmail', icon: <IoMailOutline />, completions: ['Résume mes derniers mails reçus sur Gmail', 'Rédige un brouillon sur mon Gmail pour demander un rendez-vous', 'Rédige une réponse professionnelle au dernier mail important', 'Prépare un brouillon Gmail de relance polie pour un dossier en attente'] },
    { id: 'playlist', keyword: 'Playlist', icon: <IoMusicalNotesOutline />, completions: ['Crée une playlist Spotify pour une soirée dans une ambiance house et solaire', 'Crée une playlist Spotify pour un moment chill entre amis', 'Crée une playlist Spotify pour travailler sans paroles agressives', 'Crée une playlist Spotify adaptée à mes goûts pour courir 45 minutes'] },
    { id: 'strava', keyword: 'Course', icon: <IoWalkOutline />, completions: ['Crée une course Strava de 5 km pour demain matin', 'Crée un entraînement Strava progressif pour reprendre la course', 'Planifie une sortie Strava de 10 km avec un objectif d’allure régulier', 'Ajoute une course Strava facile pour ce week-end'] },
    { id: 'nasa', keyword: 'NASA', icon: <IoPlanetOutline />, completions: ['Récupère l’image NASA du jour et explique-moi ce qu’on voit', 'Trouve une image NASA liée à Mars et donne-moi son lien', 'Récupère une photo spatiale impressionnante et prépare un message pour la partager'] },
    { id: 'agenda', keyword: 'Agenda', icon: <IoCalendarOutline />, completions: ['Crée un événement dans mon agenda pour déjeuner avec Paul vendredi', 'Trouve un créneau libre cette semaine pour appeler ma famille', 'Ajoute un rappel demain matin pour préparer ma réunion', 'Planifie ma semaine avec mes rendez-vous importants'] },
    { id: 'notion', keyword: 'Notion', icon: <IoDocumentTextOutline />, completions: ['Crée une page Notion avec le plan de mon prochain projet', 'Ajoute dans Notion un résumé structuré de mes idées du jour', 'Transforme cette liste en tâches Notion avec priorités'] },
    { id: 'image', keyword: 'Image', icon: <IoImageOutline />, completions: ['Génère une image pour annoncer une soirée entre amis', 'Crée une image de couverture pour une playlist chill', 'Génère un visuel minimaliste pour présenter mon projet'] },
    { id: 'web', keyword: 'Cherche', icon: <IoSearchOutline />, completions: ['Cherche les meilleurs restaurants ouverts ce soir près de moi', 'Compare les prix actuels pour ce produit et donne-moi le meilleur lien', 'Trouve trois sources fiables sur ce sujet et résume-les'] },
    { id: 'meteo', keyword: 'Météo', icon: <IoPartlySunnyOutline />, completions: ['Regarde la météo de demain et propose-moi une tenue adaptée', 'Vérifie s’il va pleuvoir avant ma sortie running', 'Préviens-moi si la météo change pour mon trajet de ce soir'] },
];

const stableIndex = (value: string, length: number) =>
    [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0) % length;

export default function HomePage() {
    const { user } = useAuth();
    const { liveTurns, clearLiveTurns, setComposerText, focusComposer } = useJarvis();
    const { openConversation } = useNavigation();
    const { privateConversations, groupConversations, agentConversations, refreshAll } = useConversations();
    const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);
    const [isOpeningConversation, setIsOpeningConversation] = useState(false);
    const [pinRevision, setPinRevision] = useState(0);
    const identity = user?.uuid || user?.username || 'echo';
    const firstName = (user?.first_name || user?.username || '').trim().split(/\s+/)[0];
    const welcomeMessage = WELCOME_MESSAGES[stableIndex(identity, WELCOME_MESSAGES.length)]
        .replace(/\{name\}/g, firstName).replace(/\s+,/g, ',');
    const visibleSuggestions = useMemo(() => {
        const offset = stableIndex(identity, SUGGESTIONS.length);
        return Array.from({ length: 5 }, (_, index) => SUGGESTIONS[(offset + index) % SUGGESTIONS.length]);
    }, [identity]);
    const activeSuggestion = SUGGESTIONS.find(item => item.id === activeSuggestionId) ?? null;
    const latestTurn = liveTurns.at(-1) ?? null;
    const previousTurns = liveTurns.slice(0, -1);
    const pinnedConversations = useMemo(() => {
        const pinnedIds = getPinnedConversationUuids(user?.uuid);
        const conversations = [...privateConversations, ...groupConversations, ...agentConversations];
        const byUuid = new Map(conversations.map(conversation => [conversation.uuid, conversation]));
        return pinnedIds.map(uuid => byUuid.get(uuid)).filter((conversation): conversation is NonNullable<typeof conversation> => !!conversation);
    }, [agentConversations, groupConversations, pinRevision, privateConversations, user?.uuid]);

    useEffect(() => {
        const updatePins = () => setPinRevision(value => value + 1);
        window.addEventListener(CONVERSATION_PINS_EVENT, updatePins);
        window.addEventListener('storage', updatePins);
        return () => {
            window.removeEventListener(CONVERSATION_PINS_EVENT, updatePins);
            window.removeEventListener('storage', updatePins);
        };
    }, []);

    const chooseCompletion = (text: string) => {
        setComposerText(text);
        setActiveSuggestionId(null);
        focusComposer();
    };

    const openAsConversation = async () => {
        if (!latestTurn || isOpeningConversation) return;
        setIsOpeningConversation(true);
        try {
            let conversationUuid = latestTurn.conversationUuid;
            if (!conversationUuid && latestTurn.userMessage.trim()) {
                const result = await sendTemporaryJarvisAgentMessage(latestTurn.userMessage, null);
                conversationUuid = result.conversationUuid;
            }
            if (!conversationUuid) return;
            await archiveConversation(conversationUuid, false);
            await refreshAll();
            const existing = agentConversations.find(conversation => conversation.uuid === conversationUuid);
            openConversation(existing || {
                uuid: conversationUuid, unread_count: 0, conversation_type: 'agent',
                name: 'Jarvis', avatar_url: '', framework_agent: { name: 'Jarvis', avatar_url: '' },
            });
            clearLiveTurns();
        } finally {
            setIsOpeningConversation(false);
        }
    };

    return (
        <section className={`home-page ${latestTurn ? 'home-page--with-jarvis' : ''}`}>
            {!latestTurn && <div className="home-page__welcome">
                <img className="home-page__welcome-logo" src={jarvisLogo} alt="" />
                <p className="home-page__welcome-text">{welcomeMessage}</p>
            </div>}

            {!latestTurn && pinnedConversations.length > 0 && <div className="home-page__pinned-grid" aria-label="Conversations épinglées">
                {pinnedConversations.map(conversation => <button key={conversation.uuid} type="button" className="home-page__pinned-conversation" onClick={() => openConversation(conversation)} aria-label={`Ouvrir ${conversation.name}`} title={conversation.name}>
                    {conversation.avatar_url ? <img src={conversation.avatar_url} alt="" /> : <span>{conversation.name.charAt(0).toUpperCase()}</span>}
                </button>)}
            </div>}

            {latestTurn && <article className="home-page__jarvis-panel">
                <header className="home-page__jarvis-header">
                    <span className="home-page__jarvis-title">Jarvis</span>
                    <div className="home-page__jarvis-actions">
                        <button type="button" className="home-page__jarvis-close" onClick={() => void openAsConversation()} disabled={isOpeningConversation || latestTurn.isProcessing} aria-label="Ouvrir dans une conversation avec Jarvis">{isOpeningConversation ? <span className="home-page__action-spinner" /> : <IoAdd size={22} />}</button>
                        <button type="button" className="home-page__jarvis-close" onClick={clearLiveTurns} aria-label="Fermer la conversation Jarvis"><IoClose size={20} /></button>
                    </div>
                </header>
                {previousTurns.map(turn => <div className="home-page__turn home-page__turn--previous" key={turn.id}>
                    <div className="home-page__user-row"><div className="home-page__user-bubble">{turn.userMessage}</div></div>
                    <div className="home-page__jarvis-response">{turn.isProcessing ? 'Analyse en cours…' : <AgentContentRenderer content={turn.jarvisResponse} />}</div>
                </div>)}
                <div className="home-page__turn home-page__turn--current">
                    {latestTurn.userMessage && <div className="home-page__user-row"><div className="home-page__user-bubble">{latestTurn.userMessage}</div></div>}
                    <div className={`home-page__jarvis-response ${latestTurn.isProcessing ? 'home-page__jarvis-response--processing' : ''}`}>
                        {latestTurn.isProcessing ? <><span className="home-page__processing-dot" /> Analyse en cours…</> : <AgentContentRenderer content={latestTurn.jarvisResponse} />}
                    </div>
                </div>
            </article>}

            {activeSuggestion ? <div className="home-page__completions">
                <button type="button" className="home-page__completions-dismiss" onClick={() => setActiveSuggestionId(null)} aria-label="Fermer les suggestions" />
                <div className="home-page__completions-list">{activeSuggestion.completions.map(completion =>
                    <button type="button" className="home-page__completion" key={completion} onClick={() => chooseCompletion(completion)}>
                        <span>{completion}</span><IoArrowForward size={16} />
                    </button>)}</div>
            </div> : !latestTurn && <div className="home-page__suggestions" aria-label="Suggestions Jarvis">
                {visibleSuggestions.map(suggestion => <button type="button" className="home-page__suggestion" key={suggestion.id} onClick={() => setActiveSuggestionId(suggestion.id)}>
                    <span className="home-page__suggestion-icon">{suggestion.icon}</span><span>{suggestion.keyword}</span>
                </button>)}
            </div>}
        </section>
    );
}
