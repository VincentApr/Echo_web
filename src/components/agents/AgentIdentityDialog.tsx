import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IoClose, IoArrowBackOutline } from 'react-icons/io5';
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
    actions: ReactNode;
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
    return content.tools.length ? <ul className="identity-panel__tools">{content.tools.map((tool, index) => <li key={tool.uuid ?? tool.id ?? index}><h4>{tool.name}</h4><p>{tool.description || 'Aucune description disponible.'}</p></li>)}</ul> : <p>{identitySections.tools.empty}</p>;
}

export function IdentityPanel({ section, content, onClose }: { section: IdentitySection; content: IdentityContent; onClose: () => void }) {
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [section]);
    return <section className="identity-panel" aria-label={identitySections[section].title}>
        <header><div><span>La carte en détail</span><h3 ref={heading} tabIndex={-1}>{identitySections[section].title}</h3></div><button className="identity-white-button identity-white-button--round" onClick={onClose} aria-label="Fermer la rubrique"><IoClose /></button></header>
        <div key={section} className="identity-panel__scroll" tabIndex={0} role="region" aria-label={`Contenu : ${identitySections[section].title}`}><SectionContent section={section} content={content} /></div>
    </section>;
}

export default function AgentIdentityDialog({ agent, loading, error, onRetry, onClose, actions, editing, onStopEditing }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const trigger = useRef<HTMLButtonElement | null>(null);
    const [section, setSection] = useState<IdentitySection | null>(null);
    const overlay = useMediaQuery('(max-width: 1100px)');
    useEffect(() => {
        const node = dialog.current;
        const previous = document.activeElement as HTMLElement | null;
        node?.showModal();
        return () => { node?.close(); previous?.focus(); };
    }, []);
    const closePanel = () => { setSection(null); requestAnimationFrame(() => trigger.current?.focus()); };

    return createPortal(<dialog ref={dialog} className="identity-dialog" aria-label={`Carte de ${agent.name}`}
        onCancel={event => { event.preventDefault(); if (editing) onStopEditing(); else if (section) closePanel(); else onClose(); }}
        onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
        <div className={`identity-dialog__stage ${(section || editing) ? 'identity-dialog__stage--with-panel' : ''}`}>
            <div className="identity-dialog__toolbar"><span>Identité de l’agent</span><button autoFocus className="identity-white-button identity-white-button--round" onClick={onClose} aria-label="Fermer la carte"><IoClose size={20} /></button></div>
            <div className="identity-dialog__row">
                <AgentIdentityCard agent={agent} loading={loading} unavailable={Boolean(error)} inert={overlay && Boolean(section || editing)} activeSection={editing ? null : section}
                    onSection={(next, button) => { onStopEditing(); trigger.current = button; setSection(next); }} />
                {editing ? <section className="identity-panel" aria-label="Modifier l’agent"><header><h3>Modifier l’agent</h3><button className="identity-white-button identity-white-button--round" onClick={onStopEditing} aria-label="Annuler la modification"><IoArrowBackOutline /></button></header><div className="identity-panel__scroll">{editing}</div></section>
                    : section && <IdentityPanel section={section} content={identityContent(agent)} onClose={closePanel} />}
            </div>
            <div className="identity-dialog__below">
                {loading && <p className="identity-dialog__status" role="status">Chargement de la fiche complète…</p>}
                {error && <div className="identity-dialog__error" role="alert">{error}<button className="identity-white-button" onClick={onRetry}>Réessayer</button></div>}
                {actions}
            </div>
        </div>
    </dialog>, document.body);
}
