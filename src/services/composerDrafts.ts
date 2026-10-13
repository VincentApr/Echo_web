import type { ReplyTarget } from '../contexts/NavigationContext';
import type { ToolItem } from '../data/toolsCatalog';

export interface ComposerDraft {
    text: string;
    jarvisMode: boolean;
    agent: ToolItem | null;
    reply: ReplyTarget | null;
}
export interface RecoverableSend {
    id: string;
    draft: ComposerDraft;
    fileNames: string[];
    status: 'pending' | 'failed' | 'uncertain';
    error?: string;
}
interface ComposerRecord { draft: ComposerDraft; sends: RecoverableSend[] }
const prefix = 'echo:composer:v1:';
const emptyDraft = (): ComposerDraft => ({ text: '', jarvisMode: false, agent: null, reply: null });
const key = (owner: string, conversation: string) => prefix + JSON.stringify([owner, conversation]);
const listeners = new Set<() => void>();
export const subscribeComposer = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
export function readComposer(owner: string, conversation: string): ComposerRecord {
    try {
        const value = JSON.parse(localStorage.getItem(key(owner, conversation)) || 'null');
        if (value && typeof value.draft?.text === 'string' && Array.isArray(value.sends)) return value;
    } catch { /* A corrupt or unavailable record must not break the composer. */ }
    return { draft: emptyDraft(), sends: [] };
}
function update(owner: string, conversation: string, edit: (record: ComposerRecord) => ComposerRecord) {
    if (!owner || !conversation) return;
    const record = edit(readComposer(owner, conversation));
    // Let the caller show a storage failure instead of pretending a draft is saved.
    localStorage.setItem(key(owner, conversation), JSON.stringify(record));
    listeners.forEach(listener => listener());
}
export function saveDraft(owner: string, conversation: string, draft: ComposerDraft) {
    update(owner, conversation, record => ({ ...record, draft }));
}
export function beginSend(owner: string, conversation: string, send: RecoverableSend) {
    update(owner, conversation, record => ({ draft: emptyDraft(), sends: [...record.sends, send] }));
}
export function failSend(owner: string, conversation: string, id: string, error: string, uncertain: boolean) {
    update(owner, conversation, record => ({ ...record, sends: record.sends.map(send => send.id === id
        ? { ...send, status: uncertain ? 'uncertain' : 'failed', error } : send) }));
}
export function completeSend(owner: string, conversation: string, id: string) {
    // Most server messages have no corresponding local submission.
    if (!readComposer(owner, conversation).sends.some(send => send.id === id)) return;
    update(owner, conversation, record => ({ ...record, sends: record.sends.filter(send => send.id !== id) }));
}
export function clearComposerForOwner(owner: string) {
    for (let index = localStorage.length - 1; index >= 0; index--) {
        const itemKey = localStorage.key(index);
        if (!itemKey?.startsWith(prefix)) continue;
        try { if (JSON.parse(itemKey.slice(prefix.length))[0] === owner) localStorage.removeItem(itemKey); } catch { /* unrelated malformed key */ }
    }
}
