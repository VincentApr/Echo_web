import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IoClose, IoLockClosedOutline, IoPeopleOutline, IoGlobeOutline } from 'react-icons/io5';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { enrichAgent, type ToolItem } from '../../data/toolsCatalog';
import { type AgentDraft, type IdentityDocument, type IdentityEditorSection, type IdentityTool } from '../../utils/agentIdentity';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import AgentIdentityCard from './AgentIdentityCard';
import AgentActionRow from './AgentActionRow';

const visibilityOptions = [
    { value: 'private', label: 'Privé', icon: IoLockClosedOutline },
    { value: 'friends', label: 'Amis', icon: IoPeopleOutline },
    { value: 'public', label: 'Public', icon: IoGlobeOutline },
] as const;

const titles = { name: 'Nom', description: 'Description', portrait: 'Portrait', instructions: 'Instructions', context: 'Contexte', tools: 'Outils' };
interface Props {
    draft: AgentDraft;
    onChange: Dispatch<SetStateAction<AgentDraft>>;
    agent?: ToolItem;
    busy?: boolean;
    actions: ReactNode;
    status?: ReactNode;
}

export default function AgentIdentityEditor({ draft, onChange, agent, busy, actions, status }: Props) {
    const [section, setSection] = useState<IdentityEditorSection | null>(null);
    const [fileError, setFileError] = useState('');
    const [reading, setReading] = useState(false);
    const trigger = useRef<HTMLButtonElement | null>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const files = useRef<HTMLInputElement>(null);
    const mounted = useRef(true);
    const overlay = useMediaQuery('(max-width: 1360px)');
    const supportsTools = !agent || agent.agentType === 'ToolAgent';
    const supportsInstructions = !agent || !agent.agentType || ['MistralAgent', 'ToolAgent'].includes(agent.agentType);
    const tools = useQuery({
        queryKey: ['agent-editor-tools'], enabled: section === 'tools' && supportsTools,
        queryFn: async (): Promise<IdentityTool[]> => {
            const response = await fetchWithAuth(`${API_BASE_URL}/tools/`);
            if (!response.ok) throw new Error('Impossible de charger les outils.');
            const payload = await response.json();
            const items = Array.isArray(payload) ? payload : payload.results;
            if (!Array.isArray(items)) throw new Error('Impossible de charger les outils.');
            return items.map(tool => ({ uuid: tool.uuid, name: tool.display_name || tool.name, description: tool.description }));
        }, staleTime: 60_000,
    });
    useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [section]);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const close = () => { setSection(null); requestAnimationFrame(() => trigger.current?.focus()); };
    const open = (next: IdentityEditorSection, button: HTMLButtonElement) => { trigger.current = button; setSection(next); };
    const changeText = (field: 'name' | 'description' | 'avatarPrompt' | 'instructions' | 'context', value: string) => onChange(current => ({ ...current, [field]: value }));
    const readFiles = async (list: FileList | null) => {
        if (!list?.length) return;
        setReading(true); setFileError('');
        const documents: IdentityDocument[] = [];
        const errors = [];
        for (const file of Array.from(list)) {
            if (!/\.(txt|md|csv|json|xml|html)$/i.test(file.name)) { errors.push(`Format non pris en charge : ${file.name}.`); continue; }
            if (file.size > 1_500_000) { errors.push(`« ${file.name} » dépasse 1,5 Mo.`); continue; }
            try { documents.push({ name: file.name, content: await file.text() }); }
            catch { errors.push(`Impossible de lire « ${file.name} ».`); }
        }
        if (!mounted.current) return;
        onChange(current => ({ ...current, documents: [...current.documents, ...documents.filter(doc => !current.documents.some(existing => existing.name === doc.name && existing.content === doc.content))] }));
        setFileError(errors.join(' ')); setReading(false);
        if (files.current) files.current.value = '';
    };
    const card = { ...(agent ?? enrichAgent({ uuid: 'draft', name: '' })), name: draft.name, description: draft.description };
    const available = [...new Map([...draft.tools, ...(tools.data ?? [])].map(tool => [tool.uuid, tool])).values()];

    return <section className={`identity-editor identity-dialog__stage ${section ? 'identity-dialog__stage--with-panel' : ''}`} aria-label={agent ? 'Modifier la carte' : 'Créer une carte'}
        onKeyDown={event => { if (event.key === 'Escape' && section) { event.preventDefault(); event.stopPropagation(); close(); } }}>
        <fieldset disabled={busy || reading} className="identity-editor__fieldset">
            <div className="identity-dialog__row">
                <AgentIdentityCard agent={card} content={draft} inert={overlay && Boolean(section)} activeSection={section} onEdit={open} onSection={open} />
                {section && <section className="identity-panel" aria-label={titles[section]}>
                    <header><h3 ref={heading} tabIndex={-1}>{titles[section]}</h3><button type="button" className="identity-white-button identity-white-button--round" aria-label="Fermer la rubrique" onClick={close}><IoClose /></button></header>
                    <div className="identity-panel__scroll identity-edit" key={section}>
                        {section === 'name' && <input aria-label="Nom de l’agent" value={draft.name} maxLength={100} onChange={event => changeText('name', event.target.value)} />}
                        {section === 'description' && <textarea aria-label="Description" rows={6} maxLength={500} value={draft.description} onChange={event => changeText('description', event.target.value)} />}
                        {section === 'portrait' && <textarea aria-label="Prompt du portrait" rows={7} maxLength={4000} value={draft.avatarPrompt} onChange={event => changeText('avatarPrompt', event.target.value)} placeholder="Décrivez le personnage de votre agent…" />}
                        {section === 'instructions' && (supportsInstructions ? <textarea aria-label="Instructions système" rows={11} value={draft.instructions} onChange={event => changeText('instructions', event.target.value)} /> : <p>Les instructions de cet agent sont configurées dans son service externe.</p>)}
                        {section === 'context' && (supportsInstructions ? <>
                            <textarea aria-label="Documentation" rows={5} value={draft.context} onChange={event => changeText('context', event.target.value)} />
                            <input ref={files} type="file" hidden multiple accept=".txt,.md,.csv,.json,.xml,.html" aria-label="Documents de référence" onChange={event => void readFiles(event.target.files)} />
                            <button type="button" className="identity-white-button" onClick={() => files.current?.click()}>Importer des documents</button>
                            <small>TXT, Markdown, CSV, JSON, XML, HTML · 1,5 Mo par fichier</small>
                            {reading && <p role="status">Lecture des documents…</p>}
                            {fileError && <p role="alert">{fileError}</p>}
                            {draft.documents.map((document, index) => <div className="identity-editor__document" key={`${index}-${document.name}`}><span>{document.name}</span><button type="button" className="identity-white-button identity-white-button--round" aria-label={`Retirer ${document.name}`} onClick={() => onChange(current => ({ ...current, documents: current.documents.filter((_, i) => i !== index) }))}><IoClose /></button></div>)}
                        </> : <p>Le contexte de cet agent est configuré dans son service externe.</p>)}
                        {section === 'tools' && <>
                            {!supportsTools && <p>Les outils de cet agent sont définis par son moteur et ne peuvent pas être modifiés ici.</p>}
                            {supportsTools && tools.isPending && <p role="status">Chargement des outils…</p>}
                            {supportsTools && tools.isError && <><p role="alert">{tools.error.message}</p><button type="button" className="identity-white-button" onClick={() => void tools.refetch()}>Réessayer</button></>}
                            {available.map(tool => <label className="identity-editor__tool" key={tool.uuid ?? tool.id}><input type="checkbox" disabled={!supportsTools || tools.isPending || tools.isError} checked={draft.tools.some(item => item.uuid === tool.uuid)} onChange={event => onChange(current => ({ ...current, tools: event.target.checked ? [...current.tools, tool] : current.tools.filter(item => item.uuid !== tool.uuid) }))} /><span><strong>{tool.name}</strong></span></label>)}
                            {supportsTools && tools.isSuccess && !available.length && <p>Aucun outil disponible.</p>}
                        </>}
                    </div>
                </section>}
            </div>
            <div className="identity-dialog__below">
                {status}
                <AgentActionRow className="identity-editor__actions">
                <div className="identity-editor__visibility" role="group" aria-label="Visibilité">
                    {visibilityOptions.map(({ value, label, icon: Icon }) => <button key={value} type="button" className={draft.visibility === value ? 'is-active' : ''}
                        aria-label={label} aria-pressed={draft.visibility === value} title={label}
                        onClick={() => onChange(current => ({ ...current, visibility: value }))}>
                        <Icon size={18} aria-hidden="true" /><span>{label}</span>
                    </button>)}
                </div>
                {actions}
                </AgentActionRow>
            </div>
        </fieldset>
    </section>;
}
