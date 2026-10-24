import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';
import type { ToolItem } from '../../data/toolsCatalog';
import { identityContent, identitySections, type IdentityContent, type IdentitySection } from '../../utils/agentIdentity';
import AgentIdentityCard from './AgentIdentityCard';
import { useMediaQuery } from '../../hooks/useMediaQuery';

interface Props {
    agent: ToolItem;
    loading?: boolean;
    error?: string | null;
    onRetry: () => void;
    onClose: () => void;
    actions: (resetPanel: () => void) => ReactNode;
    editing?: ReactNode;
    onStopEditing: () => void;
}

function SectionContent({ section, content }: { section: IdentitySection; content: IdentityContent }) {
    if (section === 'instructions') return <p className="identity-panel__text">{content.instructions || identitySections.instructions.empty}</p>;
    if (section === 'context') return <>
        {content.context && <div className="identity-panel__document"><h4>Documentation de référence</h4><p className="identity-panel__text">{content.context}</p></div>}
        {content.documents.map((document, index) => <div className="identity-panel__document" key={`${document.name}-${index}`}><h4>{document.name}</h4><p className="identity-panel__text">{document.content}</p></div>)}
        {!content.context && !content.documents.length && <p>{identitySections.context.empty}</p>}
    </>;
    return content.tools.length ? <ul className="identity-panel__tools">{content.tools.map((tool, index) => <li key={tool.uuid ?? tool.id ?? index}><h4>{tool.name}</h4></li>)}</ul> : <p>{identitySections.tools.empty}</p>;
}

export function IdentityPanel({ section, content, onClose }: { section: IdentitySection; content: IdentityContent; onClose: () => void }) {
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [section]);
    return <section className="identity-panel" aria-label={identitySections[section].title}>
        <header><div><h3 ref={heading} tabIndex={-1}>{identitySections[section].title}</h3></div><button className="identity-white-button identity-white-button--round" onClick={onClose} aria-label="Fermer la rubrique"><IoClose /></button></header>
        <div key={section} className="identity-panel__scroll" tabIndex={0} role="region" aria-label={`Contenu : ${identitySections[section].title}`}><SectionContent section={section} content={content} /></div>
    </section>;
}

export default function AgentIdentityDialog({ agent, loading, error, onRetry, onClose, actions, editing, onStopEditing }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const trigger = useRef<HTMLButtonElement | null>(null);
    const [section, setSection] = useState<IdentitySection | null>(null);
    const editingMode = Boolean(editing);
    const previousCardBounds = useRef<DOMRect | null>(null);
    const captureCardBounds = () => {
        previousCardBounds.current = dialog.current?.querySelector('.identity-card-perspective')?.getBoundingClientRect() ?? null;
    };
    // Animate the new card from the previous mode's visible position and size.
    // The wrapper carries this transition separately from the card's drag tilt.
    useLayoutEffect(() => {
        const card = dialog.current?.querySelector<HTMLElement>('.identity-card-perspective');
        const before = previousCardBounds.current;
        if (!card || !before || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const after = card.getBoundingClientRect();
        if (!after.width || !after.height) return;
        const animation = card.animate([
            { transformOrigin: '0 0', transform: `translate(${before.x - after.x}px, ${before.y - after.y}px) scale(${before.width / after.width}, ${before.height / after.height})` },
            { transformOrigin: '0 0', transform: 'none' },
        ], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
        return () => animation.cancel();
    }, [editingMode]);
    const overlay = useMediaQuery('(max-width: 1220px)');
    useEffect(() => {
        const node = dialog.current;
        const previous = document.activeElement as HTMLElement | null;
        node?.showModal();
        node?.focus({ preventScroll: true });
        return () => { node?.close(); previous?.focus(); };
    }, []);
    const closePanel = () => { setSection(null); requestAnimationFrame(() => trigger.current?.focus()); };

    return createPortal(<dialog ref={dialog} tabIndex={-1} className="identity-dialog" aria-label={`Carte de ${agent.name}`}
        onClickCapture={captureCardBounds} onKeyDownCapture={captureCardBounds}
        onCancel={event => { event.preventDefault(); if (editing) onStopEditing(); else if (section) closePanel(); else onClose(); }}
        onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
        <div className={`identity-dialog__stage ${editing ? 'identity-dialog__stage--editor' : section ? 'identity-dialog__stage--with-panel' : ''}`}>
            <div className="identity-dialog__toolbar"><button className="identity-white-button identity-white-button--round" onClick={onClose} aria-label="Fermer la carte"><IoClose size={20} /></button></div>
            {editing || <><div className="identity-dialog__row">
                <AgentIdentityCard agent={agent} loading={loading} unavailable={Boolean(error)} inert={overlay && Boolean(section || editing)} activeSection={editing ? null : section}
                    onSection={(next, button) => { onStopEditing(); trigger.current = button; setSection(next); }} />
                {section && <IdentityPanel section={section} content={identityContent(agent)} onClose={closePanel} />}
            </div>
            <div className="identity-dialog__below">
                {loading && <p className="identity-dialog__status" role="status">Chargement de la fiche complète…</p>}
                {error && <div className="identity-dialog__error" role="alert">{error}<button className="identity-white-button" onClick={onRetry}>Réessayer</button></div>}
                {actions(() => setSection(null))}
            </div></>}
        </div>
    </dialog>, document.body);
}
