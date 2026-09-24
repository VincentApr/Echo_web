// Framework execution currently returns a parentless message. Keep the explicit
// invocation target, never infer it from whichever thread is open on screen.
type Invocation = { owner: string; conversation: string; agent: string; root: string; since: number; expires: number };
const pending = new Map<string, Invocation>();
const responses = new Map<string, { root: string; expires: number }>();
const key = (...parts: string[]) => JSON.stringify(parts);
const lifetime = 5 * 60_000;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
export function subscribeAgentExecutions(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export function isThreadExecuting(owner: string, conversation: string, root: string) {
    return [...pending.values()].some(item => item.owner === owner && item.conversation === conversation && item.root === root && item.expires > Date.now());
}

function prune() {
    for (const [id, value] of pending) if (value.expires < Date.now()) pending.delete(id);
    for (const [id, value] of responses) if (value.expires < Date.now()) responses.delete(id);
}

export function reserveAgentExecution(owner: string, conversation: string, agent: string, root: string, since = Date.now()) {
    prune();
    const id = key(owner, conversation, agent);
    if (pending.has(id)) throw new Error('Cet agent prépare déjà une réponse dans cette conversation. Attends sa réponse avant de continuer.');
    const invocation = { owner, conversation, agent, root, since, expires: Date.now() + lifetime };
    pending.set(id, invocation);
    notify();
    const cancel = () => {
        if (pending.get(id) === invocation) { pending.delete(id); notify(); }
    };
    if (typeof window !== 'undefined') window.setTimeout(cancel, lifetime);
    return cancel;
}

export function pendingAgentExecution(owner: string, agent: string, conversation?: string) {
    prune();
    const matches = [...pending.values()].filter(item => item.owner === owner && item.agent === agent && (!conversation || item.conversation === conversation));
    return matches.length === 1 ? matches[0] : undefined;
}

export function cancelAgentExecution(owner: string, conversation: string, agent: string) {
    pending.delete(key(owner, conversation, agent));
    notify();
}

export function rememberThreadMessage(owner: string, conversation: string, uuid: string, root: string) {
    prune();
    responses.set(key(owner, conversation, uuid), { root, expires: Date.now() + lifetime });
}

// Both the user's reply and the agent's answer must survive REST snapshots
// which omit (or null out) the parent. Keep this association in IndexedDB too.
export function mergeThreadMessage(existing: Record<string, unknown> | undefined, message: Record<string, unknown>, owner: string): Record<string, unknown> {
    const merged = { ...existing, ...message };
    const localParent = agentResponseParent(merged, owner) || message.web_agent_parent_uuid || existing?.web_agent_parent_uuid;
    if (localParent) {
        merged.parent_message_uuid ||= localParent;
        merged.web_agent_parent_uuid = merged.parent_message_uuid;
    }
    return merged;
}

export function agentResponseParent(message: Record<string, unknown>, owner: string): string | undefined {
    prune();
    if (!message.uuid || !message.conversation_uuid) return;
    const responseId = key(owner, String(message.conversation_uuid), String(message.uuid));
    const known = responses.get(responseId);
    if (known) return known.root;
    if (!message.is_ai_generated || message.is_agent_thread_root) return;
    const info = message.agent_info as { uuid?: string } | undefined;
    const agent = info?.uuid || message.framework_agent_uuid || message.ai_agent_uuid || message.agent_uuid;
    if (!agent) return;
    const id = key(owner, String(message.conversation_uuid), String(agent));
    const invocation = pending.get(id);
    const created = Date.parse(String(message.created_at || ''));
    if (!invocation || !Number.isFinite(created) || created < invocation.since) return;
    // An explicit server parent always wins. Do not steal another thread's reply.
    if (message.parent_message_uuid && message.parent_message_uuid !== invocation.root) return;
    pending.delete(id);
    notify();
    responses.set(responseId, { root: invocation.root, expires: Date.now() + lifetime });
    return invocation.root;
}
