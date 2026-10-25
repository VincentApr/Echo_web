import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { IoStar } from 'react-icons/io5';
import type { ToolItem } from '../../data/toolsCatalog';
import { identityContent, identityHue, identitySections, sectionExcerpt, type IdentityContent, type IdentityEditorSection, type IdentitySection } from '../../utils/agentIdentity';
import './AgentIdentityCard.css';

interface Props {
    agent: ToolItem;
    compact?: boolean;
    selected?: boolean;
    visibilityLabel?: string;
    content?: IdentityContent;
    loading?: boolean;
    unavailable?: boolean;
    inert?: boolean;
    activeSection?: IdentityEditorSection | null;
    onEdit?: (section: IdentityEditorSection, trigger: HTMLButtonElement) => void;
    onSection?: (section: IdentitySection, trigger: HTMLButtonElement) => void;
    onOpen?: () => void;
}

function Portrait({ agent }: { agent: ToolItem }) {
    const [failedUrl, setFailedUrl] = useState<string>();
    const hasImage = agent.avatarUrl && agent.avatarUrl !== failedUrl;
    return <span className={`identity-portrait ${hasImage ? '' : 'identity-portrait--fallback'}`}>
        {hasImage
            ? <img src={agent.avatarUrl} alt="" draggable={false} loading="lazy" onError={() => setFailedUrl(agent.avatarUrl)} />
            : <span aria-hidden="true">{agent.name.trim().slice(0, 1).toLocaleUpperCase('fr')}</span>}
    </span>;
}

export default function AgentIdentityCard({ agent, compact = false, selected, visibilityLabel, content = identityContent(agent), loading, unavailable, inert, activeSection, onSection, onOpen, onEdit }: Props) {
    const surface = useRef<HTMLDivElement>(null);
    const drag = useRef<{ id: number; x: number; y: number } | null>(null);
    const style = { '--identity-hue': identityHue(agent.agentUuid) } as CSSProperties;
    const startTilt = (event: PointerEvent<HTMLDivElement>) => {
        if (compact || event.button !== 0 || (event.target as HTMLElement).closest('button') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.dragging = 'true';
    };
    const moveTilt = (event: PointerEvent<HTMLDivElement>) => {
        if (!drag.current || drag.current.id !== event.pointerId) return;
        const x = Math.max(-1, Math.min(1, (event.clientX - drag.current.x) / 140));
        const y = Math.max(-1, Math.min(1, (event.clientY - drag.current.y) / 140));
        event.currentTarget.style.setProperty('--identity-rx', `${-y * 7}deg`);
        event.currentTarget.style.setProperty('--identity-ry', `${x * 9}deg`);
        event.currentTarget.style.setProperty('--identity-shine', `${50 + x * 35}%`);
    };
    const resetTilt = () => {
        drag.current = null;
        if (!surface.current) return;
        delete surface.current.dataset.dragging;
        surface.current.style.removeProperty('--identity-rx');
        surface.current.style.removeProperty('--identity-ry');
        surface.current.style.removeProperty('--identity-shine');
    };

    const identity = onEdit ? <>
        <button type="button" className="identity-card__edit identity-card__edit-portrait" aria-label="Modifier le portrait" aria-expanded={activeSection === 'portrait'} onClick={event => onEdit('portrait', event.currentTarget)}>
            <Portrait agent={agent} />
        </button>
        <div className="identity-card__name">
            <button type="button" className="identity-card__edit identity-card__edit-name" aria-label="Modifier le nom" aria-expanded={activeSection === 'name'} onClick={event => onEdit('name', event.currentTarget)}><h2>{agent.name || 'Nom'}</h2></button>
            <button type="button" className="identity-card__edit identity-card__edit-description" aria-label="Modifier la description" aria-expanded={activeSection === 'description'} onClick={event => onEdit('description', event.currentTarget)}><p>{agent.description || 'Description'}</p></button>
        </div>
    </> : <>
        <Portrait agent={agent} />
        <div className="identity-card__name"><div className="identity-card__read-name"><h2 title={agent.name}>{agent.name}</h2></div><div className="identity-card__read-description"><p>{agent.description}</p></div></div>
    </>;

    if (compact) return <button type="button" className="identity-card identity-card--compact" style={style} onClick={onOpen} aria-pressed={selected} aria-label={selected === undefined ? `Voir la carte de ${agent.name}` : `Sélectionner ${agent.name}`}
        onPointerMove={event => {
            if (event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            event.currentTarget.style.setProperty('--identity-rx', `${(0.5 - (event.clientY - bounds.top) / bounds.height) * 7}deg`);
            event.currentTarget.style.setProperty('--identity-ry', `${((event.clientX - bounds.left) / bounds.width - 0.5) * 9}deg`);
            event.currentTarget.style.setProperty('--identity-shine', `${(event.clientX - bounds.left) / bounds.width * 100}%`);
        }}
        onPointerLeave={event => { event.currentTarget.style.removeProperty('--identity-rx'); event.currentTarget.style.removeProperty('--identity-ry'); event.currentTarget.style.removeProperty('--identity-shine'); }}>
        <span className="identity-card__glow" aria-hidden="true" />
        <span className="identity-card__compact-body">
            <span className="identity-card__compact-header">
                <Portrait agent={agent} />
                <span className="identity-card__name"><h2 title={agent.name}>{agent.name}</h2>{visibilityLabel && <span className="identity-card__visibility">{visibilityLabel}</span>}</span>
            </span>
            <span className="identity-card__name identity-card__compact-description"><p>{agent.description}</p></span>
        </span>
        <span className="identity-card__reflection" aria-hidden="true" />
        {agent.isFavorite && <span className="identity-card__favorite" role="img" aria-label="Favori" title="Favori"><IoStar aria-hidden="true" /></span>}
    </button>;

    return <div className="identity-card-perspective" inert={inert}>
        <div ref={surface} className="identity-card identity-card--full" style={style}
            onPointerDown={startTilt} onPointerMove={moveTilt} onPointerUp={resetTilt} onPointerCancel={resetTilt} onLostPointerCapture={resetTilt}>
            <div className="identity-card__glow" aria-hidden="true" />
            <div className="identity-card__body">
                <div className="identity-card__identity">{identity}</div>
                <div className="identity-card__sections" aria-label="Informations de l’agent">
                    {(Object.keys(identitySections) as IdentitySection[]).map(section => {
                        return <button type="button" key={section} className="identity-card__section" aria-expanded={activeSection === section}
                            disabled={loading || unavailable} onClick={event => onSection?.(section, event.currentTarget)}>
                            <span className="identity-card__section-title"><strong>{identitySections[section].title}</strong></span>
                            <span className="identity-card__excerpt">{loading ? 'Chargement…' : unavailable ? 'Informations indisponibles pour le moment.' : (onEdit && !content[section === 'instructions' ? 'instructions' : section === 'context' ? 'context' : 'tools'].length && !(section === 'context' && content.documents.length)) ? 'Ajouter' : sectionExcerpt(section, content)}</span>
                        </button>;
                    })}
                </div>
            </div>

            <div className="identity-card__reflection" aria-hidden="true" />
        </div>
    </div>;
}
