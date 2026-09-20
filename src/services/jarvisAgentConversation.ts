import { API_BASE_URL } from '@web/config/api';
import { JARVIS_AGENT_UUID } from '@web/constants/jarvisAgent';
import { fetchWithAuth } from '@web/services/apiClient';

interface ApiMessage {
  id?: number;
  uuid?: string;
  content?: string;
  created_at?: string;
  is_ai_generated?: boolean;
  is_agent_thread_root?: boolean;
  framework_agent_uuid?: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseListPayload = <T,>(payload: unknown): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as { results?: unknown }).results)) {
    return (payload as { results: T[] }).results;
  }
  return [];
};

const parseErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload = await response.clone().json() as { error?: unknown; detail?: unknown; message?: unknown };
    const message = payload?.error || payload?.detail || payload?.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    // Try the plain-text response below.
  }

  try {
    const text = (await response.text()).trim();
    if (text) return text.slice(0, 240);
  } catch {
    // Use the fallback below.
  }

  return `${fallback} (HTTP ${response.status})`;
};

export const archiveConversation = async (conversationUuid: string, archived: boolean): Promise<void> => {
  const response = await fetchWithAuth(
    `${API_BASE_URL}/messaging/conversations/${conversationUuid}/archive/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: archived ? 'archive' : 'unarchive' }),
    },
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Impossible de modifier l'archive de la conversation"));
  }
};

const createArchivedJarvisConversation = async (): Promise<string> => {
  const response = await fetchWithAuth(`${API_BASE_URL}/messaging/conversations/agents/create/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_uuid: JARVIS_AGENT_UUID }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Impossible de créer la conversation Jarvis'));
  }

  const conversation = await response.json() as { uuid?: string };
  if (!conversation.uuid) throw new Error("La conversation Jarvis créée ne contient pas d'UUID.");

  await archiveConversation(conversation.uuid, true);
  return conversation.uuid;
};

const sendMessageToConversation = async (conversationUuid: string, message: string): Promise<ApiMessage> => {
  const response = await fetchWithAuth(
    `${API_BASE_URL}/messaging/conversations/${conversationUuid}/messages/create/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    },
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Impossible d'envoyer le message à Jarvis"));
  }
  return response.json();
};

const fetchConversationMessages = async (conversationUuid: string): Promise<ApiMessage[]> => {
  const response = await fetchWithAuth(
    `${API_BASE_URL}/messaging/conversations/${conversationUuid}/messages/?ordering=created_at&limit=80`,
  );
  if (!response.ok) return [];
  return parseListPayload<ApiMessage>(await response.json());
};

const waitForJarvisResponse = async (conversationUuid: string, afterMessageId?: number): Promise<string> => {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    if (attempt > 0) await sleep(attempt < 5 ? 650 : 1000);

    const messages = await fetchConversationMessages(conversationUuid);
    const response = messages
      .filter((message) => {
        if (!message.is_ai_generated || message.is_agent_thread_root) return false;
        if (afterMessageId !== undefined && (message.id ?? 0) <= afterMessageId) return false;
        if (message.framework_agent_uuid && message.framework_agent_uuid !== JARVIS_AGENT_UUID) return false;
        return typeof message.content === 'string' && message.content.trim().length > 0;
      })
      .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))[0];

    if (response?.content?.trim()) return response.content.trim();
  }

  throw new Error('Jarvis met trop de temps à répondre. La conversation est conservée en arrière-plan.');
};

export const sendTemporaryJarvisAgentMessage = async (
  message: string,
  existingConversationUuid?: string | null,
): Promise<{ conversationUuid: string; response: string }> => {
  const conversationUuid = existingConversationUuid || await createArchivedJarvisConversation();
  await archiveConversation(conversationUuid, true);

  try {
    const userMessage = await sendMessageToConversation(conversationUuid, message);
    const response = await waitForJarvisResponse(conversationUuid, userMessage.id);
    await archiveConversation(conversationUuid, true);
    return { conversationUuid, response };
  } catch (error) {
    await archiveConversation(conversationUuid, true).catch(() => undefined);
    throw error;
  }
};
