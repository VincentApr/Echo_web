import type { Conversation } from '../hooks/useConversations';
import { API_BASE_URL } from '../config/api';
import { fetchWithAuth } from './apiClient';

export type AgentConversation = Conversation & {
    agent_uuid?: string;
    agent?: { uuid: string; name?: string; description?: string; avatar?: string };
    title?: string;
};
export const conversationAgentUuid = (conversation: AgentConversation) => conversation.framework_agent?.uuid || conversation.agent_info?.uuid || conversation.agent_uuid || conversation.agent?.uuid;
export const conversationActivity = (conversation: Conversation) => Date.parse(conversation.last_message?.created_at || conversation.updated_at || conversation.created_at || '') || 0;

/** Only explicit human messages qualify; an assistant response is never used as a prompt. */
export async function conversationPrompt(uuid: string, oldest: boolean, signal: AbortSignal): Promise<string | null> {
    const path = `/messaging/conversations/${encodeURIComponent(uuid)}/messages/`;
    let query = `?ordering=${oldest ? '' : '-'}created_at&limit=50`;
    const visited = new Set<string>();
    for (let page = 0; page < 4; page++) {
        if (visited.has(query)) break;
        visited.add(query);
        const response = await fetchWithAuth(`${API_BASE_URL}${path}${query}`, { signal });
        if (!response.ok) throw new Error('Aperçu indisponible');
        const payload = await response.json();
        const messages: { content?: string; is_ai_generated?: boolean; attachments?: unknown[]; created_at?: string }[] = Array.isArray(payload) ? payload : payload.results || [];
        const ordered = [...messages].sort((a, b) => ((Date.parse(a.created_at || '') || 0) - (Date.parse(b.created_at || '') || 0)) * (oldest ? 1 : -1));
        const prompt = ordered.find(message => message.is_ai_generated === false && (message.content?.trim() || message.attachments?.length));
        if (prompt) return prompt.content?.trim() || 'Pièce jointe';
        if (!payload.next) {
            // The API may cap results before pagination. Do not mistake a full
            // page of agent messages for a conversation with no user prompts.
            if (messages.length >= 50) throw new Error('Aperçu indisponible');
            return null;
        }
        const next = new URL(payload.next, window.location.origin);
        if (next.pathname !== path) break;
        query = next.search;
    }
    throw new Error('Aperçu indisponible');
}
