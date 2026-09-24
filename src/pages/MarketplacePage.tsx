import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    IoCheckmark, IoClose, IoCloudUploadOutline, IoDocumentTextOutline,
    IoExtensionPuzzleOutline, IoLockClosedOutline, IoSearch, IoSparkles, IoStar, IoStarOutline,
    IoChatbubblesOutline, IoCalendarOutline, IoInformationCircleOutline, IoPeopleOutline,
    IoCreateOutline, IoTrashOutline, IoGlobeOutline, IoCompassOutline, IoPersonOutline, IoAddOutline,
} from 'react-icons/io5';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { useNavigation } from '../contexts/NavigationContext';
import { useAuth } from '../contexts/AuthContext';
import { useConversations, type Conversation } from '../hooks/useConversations';
import { webDatabaseManager } from '../services/webDatabase';
import { TOOL_CATEGORIES, enrichAgent, getCategoryById, type BackendAgent, type ToolItem } from '../data/toolsCatalog';
import './MarketplacePage.css';

type MarketplaceView = 'catalog' | 'mine' | 'create';
interface AgentDocument { id: string; name: string; content: string; size: number; }
interface CreatorForm { name: string; description: string; systemPrompt: string; documentation: string; isPublic: boolean; }

const EMPTY_FORM: CreatorForm = { name: '', description: '', systemPrompt: '', documentation: '', isPublic: false };

function normalizeAgentList(payload: unknown): BackendAgent[] {
    if (Array.isArray(payload)) return payload as BackendAgent[];
    if (!payload || typeof payload !== 'object') return [];
    const data = payload as Record<string, unknown>;
    if (Array.isArray(data.results)) return data.results as BackendAgent[];
    const created = Array.isArray(data.created_agents) ? data.created_agents : [];
    const favorites = Array.isArray(data.favorite_agents) ? data.favorite_agents : [];
    const unique = new Map<string, BackendAgent>();
    [...created, ...favorites].forEach((agent) => {
        const item = agent as BackendAgent;
        if (item.uuid) unique.set(item.uuid, { ...unique.get(item.uuid), ...item });
    });
    return [...unique.values()];
}

async function readError(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.json();
        return data.error || data.detail || fallback;
    } catch { return fallback; }
}

export default function MarketplacePage() {
    const queryClient = useQueryClient();
    const { openConversation } = useNavigation();
    const { user } = useAuth();
    const { agentConversations } = useConversations();
    const [openingConversation, setOpeningConversation] = useState(false);
    const openingConversationRef = useRef(false);
    const [view, setView] = useState<MarketplaceView>('catalog');
    const [search, setSearch] = useState('');
    const [activeCategory, setActiveCategory] = useState<string | null>(null);
    const [selectedAgent, setSelectedAgent] = useState<ToolItem | null>(null);
    const [favoritePending, setFavoritePending] = useState<string | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [agentActionPending, setAgentActionPending] = useState(false);
    const [isEditingAgent, setIsEditingAgent] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [editForm, setEditForm] = useState({ name: '', description: '', systemPrompt: '' });
    const [form, setForm] = useState<CreatorForm>(EMPTY_FORM);
    const [documents, setDocuments] = useState<AgentDocument[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [creatorError, setCreatorError] = useState<string | null>(null);
    const [creatorSuccess, setCreatorSuccess] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { data: agents = [], isLoading } = useQuery({
        queryKey: ['agents', 'marketplace'],
        queryFn: async (): Promise<ToolItem[]> => {
            const [publicResponse, mineResponse] = await Promise.all([
                fetchWithAuth(`${API_BASE_URL}/framework/agents/public/`),
                fetchWithAuth(`${API_BASE_URL}/framework/agents/`),
            ]);
            const publicPayload = publicResponse.ok ? await publicResponse.json() : [];
            const minePayload = mineResponse.ok ? await mineResponse.json() : [];
            const mine = normalizeAgentList(minePayload);
            const favoriteUuids = new Set(mine.filter((agent) => agent.is_favorite).map((agent) => agent.uuid));
            return normalizeAgentList(publicPayload).map((agent) => enrichAgent({
                ...agent,
                is_favorite: Boolean(agent.is_favorite || favoriteUuids.has(agent.uuid)),
            }));
        },
        staleTime: 2 * 60_000,
    });

    const { data: myAgents = [], isLoading: isLoadingMine } = useQuery({
        queryKey: ['agents', 'mine', 'marketplace'],
        queryFn: async (): Promise<ToolItem[]> => {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/`);
            if (!response.ok) return [];
            const payload = await response.json();
            if (payload && !Array.isArray(payload) && Array.isArray(payload.created_agents)) {
                return (payload.created_agents as BackendAgent[]).map((agent) => enrichAgent({ ...agent, is_mine: true }));
            }
            return normalizeAgentList(payload).filter((agent) => agent.is_mine).map(enrichAgent);
        },
        staleTime: 2 * 60_000,
    });

    const displayedAgents = useMemo(() => {
        const query = search.trim().toLowerCase();
        const source = view === 'mine' ? myAgents : agents;
        return source.filter((agent) => {
            const matchesCategory = !activeCategory || agent.categoryId === activeCategory;
            const matchesSearch = !query || [agent.name, agent.description, agent.longDescription, ...agent.examples]
                .some((value) => value.toLowerCase().includes(query));
            return matchesCategory && matchesSearch;
        });
    }, [activeCategory, agents, myAgents, search, view]);

    const closeDetails = useCallback(() => {
        if (openingConversationRef.current) return;
        setSelectedAgent(null);
        setIsEditingAgent(false);
        setConfirmDelete(false);
    }, []);

    const startConversation = async (agent: ToolItem) => {
        if (openingConversationRef.current || agentActionPending) return;
        openingConversationRef.current = true;
        setOpeningConversation(true);
        setCatalogError(null);
        try {
            let conversation = agentConversations.find(item => !item.is_archived && (
                item.framework_agent?.uuid === agent.agentUuid || item.agent_info?.uuid === agent.agentUuid
            ));
            if (!conversation) {
                const response = await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/agents/create/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ agent_uuid: agent.agentUuid }),
                });
                if (!response.ok) throw new Error(await readError(response, 'Impossible de commencer cette conversation.'));
                const created = await response.json() as Partial<Conversation>;
                if (!created.uuid) throw new Error('La conversation créée ne contient pas d’identifiant.');
                conversation = {
                    ...created,
                    uuid: created.uuid,
                    conversation_type: 'agent',
                    unread_count: created.unread_count ?? 0,
                    name: created.framework_agent?.name || created.agent_info?.name || agent.name,
                    avatar_url: created.framework_agent?.avatar_url || created.agent_info?.avatar_url || agent.avatarUrl || '',
                    framework_agent: created.framework_agent || { uuid: agent.agentUuid, name: agent.name, avatar_url: agent.avatarUrl || '' },
                };
                if (user?.uuid) await webDatabaseManager.upsertConversation(conversation as unknown as Record<string, unknown>, user.uuid);
                await queryClient.invalidateQueries({ queryKey: ['conversations'] });
            }
            openingConversationRef.current = false;
            closeDetails();
            openConversation(conversation);
        } catch (error) {
            setCatalogError(error instanceof Error ? error.message : 'Impossible de commencer cette conversation.');
        } finally {
            openingConversationRef.current = false;
            setOpeningConversation(false);
        }
    };

    const openDetails = (agent: ToolItem) => {
        setSelectedAgent(agent);
        setEditForm({ name: agent.name, description: agent.description, systemPrompt: agent.systemPrompt });
        setIsEditingAgent(false);
        setConfirmDelete(false);
        setCatalogError(null);
    };

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeDetails(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [closeDetails]);

    const toggleFavorite = async (agent: ToolItem) => {
        if (favoritePending) return;
        setCatalogError(null);
        setFavoritePending(agent.agentUuid);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/${agent.agentUuid}/favorite/`, { method: 'POST' });
            if (!response.ok) throw new Error(await readError(response, 'Impossible de modifier les favoris.'));
            const result = await response.json();
            const isFavorite = typeof result.is_favorite === 'boolean' ? result.is_favorite : !agent.isFavorite;
            setSelectedAgent((current) => current?.id === agent.id ? { ...current, isFavorite } : current);
            queryClient.setQueryData<ToolItem[]>(['agents', 'marketplace'], (current = []) => (
                current.map((item) => item.id === agent.id ? { ...item, isFavorite } : item)
            ));
            queryClient.setQueryData<ToolItem[]>(['agents', 'mine', 'marketplace'], (current = []) => (
                current.map((item) => item.id === agent.id ? { ...item, isFavorite } : item)
            ));
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
        } catch (error) {
            setCatalogError(error instanceof Error ? error.message : 'Impossible de modifier les favoris.');
        } finally { setFavoritePending(null); }
    };

    const updateOwnedAgent = async (data: Record<string, unknown>) => {
        if (!selectedAgent || agentActionPending) return null;
        setAgentActionPending(true);
        setCatalogError(null);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/${selectedAgent.agentUuid}/`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!response.ok) throw new Error(await readError(response, "Impossible de modifier l'agent."));
            const updated = await response.json() as BackendAgent;
            const enriched = enrichAgent({
                ...updated,
                is_mine: true,
                is_favorite: updated.is_favorite ?? selectedAgent.isFavorite,
                is_public: updated.is_public ?? (data.is_public as boolean | undefined) ?? selectedAgent.isPublic,
            });
            setSelectedAgent(enriched);
            setEditForm({ name: enriched.name, description: enriched.description, systemPrompt: enriched.systemPrompt });
            queryClient.setQueryData<ToolItem[]>(['agents', 'mine', 'marketplace'], (current = []) => (
                current.map((item) => item.id === enriched.id ? enriched : item)
            ));
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            return enriched;
        } catch (error) {
            setCatalogError(error instanceof Error ? error.message : "Impossible de modifier l'agent.");
            return null;
        } finally { setAgentActionPending(false); }
    };

    const saveOwnedAgent = async () => {
        if (!editForm.name.trim()) { setCatalogError("Le nom de l'agent est obligatoire."); return; }
        const updated = await updateOwnedAgent({
            name: editForm.name.trim(),
            description: editForm.description.trim(),
            system_prompt: editForm.systemPrompt.trim(),
        });
        if (updated) setIsEditingAgent(false);
    };

    const toggleVisibility = async () => {
        if (!selectedAgent) return;
        await updateOwnedAgent({
            visibility: selectedAgent.isPublic ? 'private' : 'public',
            is_public: !selectedAgent.isPublic,
        });
    };

    const deleteOwnedAgent = async () => {
        if (!selectedAgent || agentActionPending) return;
        setAgentActionPending(true);
        setCatalogError(null);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/${selectedAgent.agentUuid}/`, { method: 'DELETE' });
            if (!response.ok) throw new Error(await readError(response, "Impossible de supprimer l'agent."));
            const deletedId = selectedAgent.id;
            queryClient.setQueryData<ToolItem[]>(['agents', 'mine', 'marketplace'], (current = []) => current.filter((item) => item.id !== deletedId));
            closeDetails();
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
        } catch (error) {
            setCatalogError(error instanceof Error ? error.message : "Impossible de supprimer l'agent.");
        } finally { setAgentActionPending(false); }
    };

    const handleFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        setCreatorError(null);
        const next: AgentDocument[] = [];
        for (const file of Array.from(files)) {
            if (file.size > 1_500_000) {
                setCreatorError(`« ${file.name} » est trop volumineux (1,5 Mo maximum).`);
                continue;
            }
            try {
                next.push({ id: `${file.name}-${file.lastModified}-${file.size}`, name: file.name, content: await file.text(), size: file.size });
            } catch { setCreatorError(`Impossible de lire « ${file.name} » comme document texte.`); }
        }
        setDocuments((current) => {
            const existing = new Set(current.map((document) => document.id));
            return [...current, ...next.filter((document) => !existing.has(document.id))];
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const createAgent = async () => {
        if (!form.name.trim()) { setCreatorError("Donnez un nom à l'agent."); return; }
        if (!form.systemPrompt.trim() && !form.documentation.trim() && documents.length === 0) {
            setCreatorError('Ajoutez au moins des instructions ou une documentation.'); return;
        }
        const documentationParts = [
            form.documentation.trim(),
            ...documents.map((document) => `DOCUMENT : ${document.name}\n${document.content.trim()}`),
        ].filter(Boolean);
        const systemPrompt = [
            form.systemPrompt.trim() || `Tu es ${form.name.trim()}, un agent spécialisé.`,
            documentationParts.length
                ? `DOCUMENTATION DE RÉFÉRENCE\nUtilise prioritairement les informations suivantes. Si elles ne suffisent pas, indique-le clairement.\n\n${documentationParts.join('\n\n---\n\n')}`
                : '',
        ].filter(Boolean).join('\n\n');

        setIsCreating(true); setCreatorError(null); setCreatorSuccess(null);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/framework/agents/mistral/`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: form.name.trim(), description: form.description.trim(), system_prompt: systemPrompt,
                    visibility: form.isPublic ? 'public' : 'private', is_public: form.isPublic,
                }),
            });
            if (!response.ok) throw new Error(await readError(response, "Impossible de créer l'agent."));
            const createdName = form.name.trim();
            const wasPublic = form.isPublic;
            setCreatorSuccess(`« ${createdName} » a été créé.`); setForm(EMPTY_FORM); setDocuments([]);
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            if (wasPublic) await queryClient.invalidateQueries({ queryKey: ['agents', 'marketplace'] });
        } catch (error) {
            setCreatorError(error instanceof Error ? error.message : "Impossible de créer l'agent.");
        } finally { setIsCreating(false); }
    };

    return (
        <div className="marketplace-page">
            <div className="marketplace-page__vignette" aria-hidden="true" />
            <header className="marketplace-header">
                <div>
                    <h1>Agents</h1>
                </div>
                <div className="marketplace-switch" role="tablist" aria-label="Marketplace d'agents">
                    <button className={view === 'catalog' ? 'is-active' : ''} onClick={() => setView('catalog')} aria-label="Découvrir" title="Découvrir">
                        <IoCompassOutline size={17} />{view === 'catalog' && <span>Découvrir</span>}
                    </button>
                    <button className={view === 'mine' ? 'is-active' : ''} onClick={() => setView('mine')} aria-label="Mes Agents" title="Mes Agents">
                        <IoPersonOutline size={17} />{view === 'mine' && <span>Mes Agents</span>}
                    </button>
                    <button className={view === 'create' ? 'is-active' : ''} onClick={() => setView('create')} aria-label="Créer" title="Créer">
                        <IoAddOutline size={19} />{view === 'create' && <span>Créer</span>}
                    </button>
                </div>
            </header>

            {view !== 'create' ? (
                <main className="marketplace-catalog">
                    <div className="marketplace-toolbar">
                        <div className="marketplace-search">
                            <IoSearch size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={view === 'mine' ? 'Rechercher dans mes agents…' : 'Rechercher un agent ou un besoin…'} />
                            {search && <button onClick={() => setSearch('')} aria-label="Effacer"><IoClose size={14} /></button>}
                        </div>
                    </div>
                    <div className="marketplace-categories">
                        <button className={!activeCategory ? 'is-active' : ''} onClick={() => setActiveCategory(null)}>Tous</button>
                        {TOOL_CATEGORIES.map((category) => <button key={category.id} className={activeCategory === category.id ? 'is-active' : ''} onClick={() => setActiveCategory(category.id)}>{category.name}</button>)}
                    </div>
                    {catalogError && <div className="marketplace-catalog__error">{catalogError}</div>}
                    {(view === 'mine' ? isLoadingMine : isLoading) ? (
                        <div className="marketplace-grid">{Array.from({ length: 6 }).map((_, index) => <div className="agent-card agent-card--skeleton" key={index} />)}</div>
                    ) : displayedAgents.length === 0 ? (
                        <div className="marketplace-empty"><IoSparkles size={42} /><strong>{view === 'mine' ? 'Aucun agent créé' : 'Aucun agent trouvé'}</strong><span>{view === 'mine' ? 'Créez votre premier agent.' : 'Essayez une autre recherche.'}</span></div>
                    ) : (
                        <div className="marketplace-grid">
                            {displayedAgents.map((agent) => {
                                return <article className="agent-card" key={agent.id} onClick={() => openDetails(agent)}>
                                    <div className="agent-card__top"><div className="agent-card__icon"><AgentGlyph categoryId={agent.categoryId} /></div><div className="agent-card__badges">{view === 'mine' && <span className="agent-card__visibility">{agent.isPublic ? 'Public' : 'Privé'}</span>}{agent.isFavorite && <span className="agent-card__favorite"><IoStar size={13} /> Favori</span>}</div></div>
                                    <div><h2>{agent.name}</h2></div>
                                    <div className="agent-card__example"><ChatExampleIcon /><span>{agent.examples[0]}</span></div>
                                </article>;
                            })}
                        </div>
                    )}
                </main>
            ) : (
                <main className="agent-creator">
                    <CreatorIntro step="1" title="Rôle" />
                    <section className="agent-creator__form">
                        <div className="agent-creator__row">
                            <label>Nom de l’agent<input value={form.name} maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex. Assistant juridique" /></label>
                            <label>Description<input value={form.description} maxLength={240} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Ce que cet agent sait faire" /></label>
                        </div>
                        <label>Instructions système<textarea value={form.systemPrompt} onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })} placeholder="Tu es un avocat spécialisé en droit du travail français. Tu réponds de manière claire, tu cites tes sources et tu précises lorsqu’une information manque…" rows={7} /></label>
                    </section>
                    <CreatorIntro step="2" title="Connaissances" />
                    <section className="agent-creator__form">
                        <label>Documentation<textarea value={form.documentation} onChange={(event) => setForm({ ...form, documentation: event.target.value })} placeholder="Collez ici un extrait de code, une procédure interne, un guide produit…" rows={8} /></label>
                        <input ref={fileInputRef} className="agent-creator__file-input" type="file" multiple accept=".txt,.md,.csv,.json,.xml,.html" onChange={(event) => void handleFiles(event.target.files)} />
                        <button className="agent-creator__upload" type="button" onClick={() => fileInputRef.current?.click()}><IoCloudUploadOutline size={21} /><span><strong>Importer des documents</strong><small>TXT, Markdown, CSV, JSON, XML ou HTML · 1,5 Mo maximum</small></span></button>
                        {documents.length > 0 && <div className="agent-creator__documents">{documents.map((document) => <div key={document.id}><IoDocumentTextOutline size={18} /><span>{document.name}<small>{Math.max(1, Math.round(document.size / 1024))} Ko</small></span><button onClick={() => setDocuments((current) => current.filter((item) => item.id !== document.id))}><IoClose size={14} /></button></div>)}</div>}
                    </section>
                    <section className="agent-creator__publish">
                        <VisibilityChoice active={!form.isPublic} icon={<IoLockClosedOutline size={20} />} title="Privé" hint="Visible uniquement par vous" onClick={() => setForm({ ...form, isPublic: false })} />
                        <VisibilityChoice active={form.isPublic} icon={<IoExtensionPuzzleOutline size={20} />} title="Marketplace" hint="Accessible à tous les utilisateurs" onClick={() => setForm({ ...form, isPublic: true })} />
                    </section>
                    {creatorError && <div className="agent-creator__message agent-creator__message--error">{creatorError}</div>}
                    {creatorSuccess && <div className="agent-creator__message agent-creator__message--success"><IoCheckmark /> {creatorSuccess}</div>}
                    <button className="agent-creator__submit" onClick={() => void createAgent()} disabled={isCreating}>{isCreating ? 'Création…' : <><IoSparkles size={18} /> Créer mon agent</>}</button>
                </main>
            )}

            {selectedAgent && <div className="agent-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetails(); }}>
                <section className="agent-detail" role="dialog" aria-modal="true" aria-label={selectedAgent.name}>
                    <button className="agent-detail__close" disabled={openingConversation} onClick={closeDetails}><IoClose size={18} /></button>
                    <div className="agent-detail__icon"><AgentGlyph categoryId={selectedAgent.categoryId} /></div>
                    {view === 'mine' && isEditingAgent ? (
                        <div className="agent-detail__edit">
                            <input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} placeholder="Nom" />
                            <input value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} placeholder="Description" />
                            <textarea value={editForm.systemPrompt} onChange={(event) => setEditForm({ ...editForm, systemPrompt: event.target.value })} placeholder="Instructions système" rows={6} />
                            <div><button onClick={() => setIsEditingAgent(false)}>Annuler</button><button className="is-primary" disabled={agentActionPending} onClick={() => void saveOwnedAgent()}>Enregistrer</button></div>
                        </div>
                    ) : (
                        <>
                            <h2>{selectedAgent.name}</h2><p>{selectedAgent.description}</p><h3>À essayer</h3>
                            <div className="agent-detail__examples">{selectedAgent.examples.slice(0, 2).map((example) => <div key={example}><ChatExampleIcon /><span>{example}</span></div>)}</div>
                        </>
                    )}
                    {catalogError && <div className="agent-detail__error">{catalogError}</div>}
                    {!isEditingAgent && <>
                        <div className="agent-detail__actions">
                        <button className={`agent-detail__favorite ${selectedAgent.isFavorite ? 'is-favorite' : ''}`} disabled={favoritePending === selectedAgent.agentUuid} onClick={() => void toggleFavorite(selectedAgent)}>
                            {selectedAgent.isFavorite ? <IoStar size={19} /> : <IoStarOutline size={19} />}{favoritePending === selectedAgent.agentUuid ? 'Mise à jour…' : selectedAgent.isFavorite ? 'Retirer de mes favoris' : 'Ajouter à mes favoris'}
                        </button>
                        <button type="button" className="agent-detail__start" disabled={openingConversation || agentActionPending} onClick={() => void startConversation(selectedAgent)}>
                            <IoChatbubblesOutline size={19} />{openingConversation ? 'Ouverture…' : 'Commencer une conversation'}
                        </button>
                        </div>
                        <small className="agent-detail__hint">Les favoris apparaissent dans + → Agents au sein de vos conversations.</small>
                    </>}
                    {view === 'mine' && !isEditingAgent && !openingConversation && <div className="agent-detail__management">
                        <button onClick={() => setIsEditingAgent(true)}><IoCreateOutline size={17} /><span>Modifier</span></button>
                        <button disabled={agentActionPending} onClick={() => void toggleVisibility()}>{selectedAgent.isPublic ? <IoLockClosedOutline size={17} /> : <IoGlobeOutline size={17} />}<span>{selectedAgent.isPublic ? 'Rendre privé' : 'Rendre public'}</span></button>
                        {!confirmDelete ? (
                            <button className="is-danger" onClick={() => setConfirmDelete(true)}><IoTrashOutline size={17} /><span>Supprimer</span></button>
                        ) : (
                            <div className="agent-detail__delete-confirm"><span>Supprimer cet agent ?</span><button onClick={() => setConfirmDelete(false)}>Non</button><button disabled={agentActionPending} onClick={() => void deleteOwnedAgent()}>Oui</button></div>
                        )}
                    </div>}
                </section>
            </div>}
        </div>
    );
}

function CreatorIntro({ step, title }: { step: string; title: string }) {
    return <section className="agent-creator__intro"><span className="agent-creator__step">{step}</span><h2>{title}</h2></section>;
}

function VisibilityChoice({ active, icon, title, hint, onClick }: { active: boolean; icon: React.ReactNode; title: string; hint: string; onClick: () => void }) {
    return <button className={`agent-creator__visibility ${active ? 'is-active' : ''}`} onClick={onClick}>{icon}<span><strong>{title}</strong><small>{hint}</small></span>{active && <IoCheckmark />}</button>;
}

function ChatExampleIcon() { return <span className="chat-example-icon" aria-hidden="true">↗</span>; }

function AgentGlyph({ categoryId }: { categoryId: string }) {
    if (categoryId === 'communication') return <IoChatbubblesOutline size={22} />;
    if (categoryId === 'organisation') return <IoCalendarOutline size={22} />;
    if (categoryId === 'infos') return <IoInformationCircleOutline size={22} />;
    if (categoryId === 'social') return <IoPeopleOutline size={22} />;
    return <IoSparkles size={22} />;
}
