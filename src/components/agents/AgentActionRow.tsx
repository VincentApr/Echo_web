import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Fade only the edges that still have actions outside the visible area. */
export default function AgentActionRow({ children, className = '' }: { children: ReactNode; className?: string }) {
    const row = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const node = row.current;
        if (!node) return;
        const update = () => {
            node.toggleAttribute('data-fade-start', node.scrollLeft > 1);
            node.toggleAttribute('data-fade-end', node.scrollWidth - node.clientWidth - node.scrollLeft > 1);
        };
        const observer = new ResizeObserver(update);
        observer.observe(node);
        for (const child of node.children) observer.observe(child);
        node.addEventListener('scroll', update, { passive: true });
        update();
        return () => { observer.disconnect(); node.removeEventListener('scroll', update); };
    }, [children]);
    return <div ref={row} className={`identity-actions ${className}`}>{children}</div>;
}
