import type { Message } from '../hooks/useMessages';

export function isAgentMessage(msg: Message): boolean {
    return !!(msg.is_agent_thread_root || msg.is_ai_generated
        || msg.framework_agent_name || msg.framework_agent_uuid
        || msg.agent_info?.name || msg.agent_info?.uuid
        || msg.ai_agent_name || msg.ai_agent_uuid || msg.agent_uuid || msg.agent_name);
}

// In a dedicated agent conversation, ordinary AI answers belong to the main
// feed. Only an explicit invocation/marker starts an embedded thread, even
// when its target is the very same agent as the conversation's participant.
export function isEmbeddedAgentRoot(msg: Message, agentConversation: boolean): boolean {
    if (!agentConversation) return isAgentMessage(msg);
    return !!(msg.is_agent_thread_root || msg.is_jarvis_thread_root
        || (!msg.is_ai_generated && (msg.ai_agent_uuid || msg.web_agent_waiting_since)));
}

export function findEmbeddedAgentRoot(message: Message, byUuid: Map<string, Message>, agentConversation: boolean): Message | undefined {
    let parent = byUuid.get(message.parent_message_uuid || message.jarvis_thread_root_uuid || '');
    let root: Message | undefined;
    const visited = new Set([message.uuid]);
    while (parent && !visited.has(parent.uuid)) {
        visited.add(parent.uuid);
        if (isEmbeddedAgentRoot(parent, agentConversation)) root = parent;
        parent = byUuid.get(parent.parent_message_uuid || parent.jarvis_thread_root_uuid || '');
    }
    return root;
}
