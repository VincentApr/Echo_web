import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { IoStar } from 'react-icons/io5';
import type { ToolItem } from '../../data/toolsCatalog';
import { identityContent, identityHue, identitySections, sectionExcerpt, type IdentityContent, type IdentitySection } from '../../utils/agentIdentity';
import './AgentIdentityCard.css';

interface Props {
    agent: ToolItem;
    compact?: boolean;
    visibilityLabel?: string;
    content?: IdentityContent;
    loading?: boolean;
    unavailable?: boolean;
    inert?: boolean;
    activeSection?: IdentitySection | null;
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

export default function AgentIdentityCard({ agent, compact = false, visibilityLabel, content = identityContent(agent), loading, unavailable, inert, activeSection, onSection, onOpen }: Props) {
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

    const identity = <>
        <Portrait agent={agent} />
        <div className="identity-card__name"><h2 title={agent.name}>{agent.name}</h2><p>{agent.description}</p></div>
    </>;

    if (compact) return <button type="button" className="identity-card identity-card--compact" style={style} onClick={onOpen} aria-label={`Voir la carte de ${agent.name}`}>
        <span className="identity-card__glow" aria-hidden="true" />
        <span className="identity-card__compact-body">
            <span className="identity-card__compact-header">
                <Portrait agent={agent} />
                <span className="identity-card__name"><h2 title={agent.name}>{agent.name}</h2>{visibilityLabel && <span className="identity-card__visibility">{visibilityLabel}</span>}</span>
            </span>
            <span className="identity-card__name identity-card__compact-description"><p>{agent.description}</p></span>
        </span>
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
                            <span className="identity-card__excerpt">{loading ? 'Chargement…' : unavailable ? 'Informations indisponibles pour le moment.' : sectionExcerpt(section, content)}</span>
                        </button>;
                    })}
                </div>
            </div>
            <div className="identity-card__reflection" aria-hidden="true" />
        </div>
    </div>;
}
