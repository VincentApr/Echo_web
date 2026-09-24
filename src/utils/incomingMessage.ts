// Normalizes the flat and nested events accepted by the mobile messaging client.
export function normalizeIncomingMessage(data: Record<string, any>): Record<string, any> | null {
    const source = data.message && typeof data.message === 'object' ? data.message : data;
    const uuid = source.uuid || source.message_uuid || data.message_uuid || data.uuid || source.id?.toString()
        || (data.type === 'agent_message' ? `agent-${crypto.randomUUID()}` : undefined);
    const conversationUuid = data.conversation_uuid || source.conversation_uuid || source.conversation?.uuid;
    if (!uuid || !conversationUuid) return null;
    const result: Record<string, any> = { ...source, uuid, conversation_uuid: conversationUuid };
    delete result.type;
    const content = source.content ?? (typeof source.message === 'string' ? source.message : undefined);
    if (content !== undefined) result.content = content;
    const senderUuid = source.sender_uuid || source.sender?.uuid || data.sender_uuid || data.sender?.uuid;
    const senderName = source.sender_username || source.sender?.username || data.sender_username || data.sender?.username;
    if (senderUuid) result.sender_uuid = senderUuid;
    if (senderName) result.sender_username = senderName;
    const agentName = source.agent_info?.name || source.framework_agent_name || source.agent_name || source.ai_agent_name
        || data.agent_info?.name || data.framework_agent_name || data.agent_name || data.ai_agent_name;
    const agentUuid = source.agent_info?.uuid || source.framework_agent_uuid || source.agent_uuid || source.ai_agent_uuid
        || data.agent_info?.uuid || data.framework_agent_uuid || data.agent_uuid || data.ai_agent_uuid;
    if (agentName || agentUuid) result.agent_info = { name: agentName, uuid: agentUuid };
    for (const field of ['parent_message_uuid', 'is_agent_thread_root', 'attachments', 'client_message_id', 'created_at']) {
        if (!(field in result) && field in data) result[field] = data[field];
    }
    if (data.type === 'agent_message') {
        result.is_ai_generated = true;
        result.message_type = 'ai_generated';
        result.sender_username ||= agentName || 'Agent';
    }
    if (data.type !== 'message_updated') {
        result.isPending = false;
        result.sendError = false;
    }
    return result;
}
