import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';

export type JarvisInteractionMode = 'global' | 'conversation_thread' | 'jarvis_conversation';
export type JarvisToolMode = 'auto' | 'force';

export interface JarvisInteractionRequest {
    message: string;
    mode: JarvisInteractionMode;
    toolMode: JarvisToolMode;
    conversationUuid?: string;
    conversationName?: string;
    conversationType?: string;
    parentMessageUuid?: string | null;
    parentMessagePreview?: string | null;
    preferredToolId?: string | null;
    includeLocalUserMessage?: boolean;
    jarvisThreadRootUuid?: string | null;
}

export interface JarvisInteractionResponse {
    response: string;
    raw: unknown;
}

function buildTemporaryPrompt(request: JarvisInteractionRequest): string {
    const lines = [
        'Tu es Jarvis, assistant IA unique de Echo.',
        'Reponds a la demande utilisateur en tenant compte du contexte fourni.',
    ];

    if (request.mode === 'conversation_thread') {
        lines.push('Contexte: demande faite depuis une conversation Echo.');
        if (request.conversationName) lines.push(`Conversation: ${request.conversationName}.`);
        if (request.conversationType) lines.push(`Type de conversation: ${request.conversationType}.`);
        if (request.conversationUuid) lines.push(`UUID conversation: ${request.conversationUuid}.`);
        if (request.parentMessageUuid) lines.push(`Thread parent UUID: ${request.parentMessageUuid}.`);
        if (request.parentMessagePreview) lines.push(`Message parent: ${request.parentMessagePreview}`);
    }

    if (request.toolMode === 'force') {
        lines.push('L utilisateur demande explicitement l usage d un tool si un tool pertinent est disponible.');
    } else {
        lines.push('Choisis toi-meme si un tool est utile. Si aucun tool n est utile, reponds directement.');
    }

    if (request.preferredToolId) {
        lines.push(`Tool souhaite: ${request.preferredToolId}.`);
    }

    lines.push('');
    lines.push(`Demande utilisateur: ${request.message}`);

    return lines.join('\n');
}

export async function sendJarvisInteraction(
    request: JarvisInteractionRequest
): Promise<JarvisInteractionResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/jarvis/chat/?type=message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: buildTemporaryPrompt(request),
            client_context: request,
        }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        const errorMessage =
            payload?.error ||
            payload?.detail ||
            `Erreur Jarvis ${response.status}`;
        throw new Error(errorMessage);
    }

    return {
        response: payload?.response || payload?.message || 'Aucune reponse',
        raw: payload,
    };
}
