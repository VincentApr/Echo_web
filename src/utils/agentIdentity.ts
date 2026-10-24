import type { ToolItem } from '../data/toolsCatalog';

export type IdentityEditorSection = 'name' | 'description' | 'portrait' | IdentitySection;
export type IdentitySection = 'instructions' | 'context' | 'tools';
export interface IdentityDocument { name: string; content: string; }
export interface IdentityTool { id?: number | string; uuid?: string; name: string; description?: string; }
export interface IdentityContent {
    instructions: string;
    context: string;
    documents: IdentityDocument[];
    tools: IdentityTool[];
}

// This is the exact envelope written by the existing creator. Preserve all other
// prompts verbatim; arbitrary prompts cannot reliably be split into documents.
const DOCUMENTATION_ENVELOPE = '\n\nDOCUMENTATION DE RÉFÉRENCE\nUtilise prioritairement les informations suivantes. Si elles ne suffisent pas, indique-le clairement.\n\n';

export function composeAgentPrompt(instructions: string, documentation: string, documents: IdentityDocument[]) {
    const reference = [documentation.trim(), ...documents.map(document => `DOCUMENT : ${document.name}\n${document.content.trim()}`)].filter(Boolean).join('\n\n---\n\n');
    return instructions + (reference ? DOCUMENTATION_ENVELOPE + reference : '');
}

export function identityContent(agent: ToolItem): IdentityContent {
    const index = agent.systemPrompt.indexOf(DOCUMENTATION_ENVELOPE);
    return {
        instructions: index < 0 ? agent.systemPrompt : agent.systemPrompt.slice(0, index),
        context: agent.identityContext?.text ?? (index < 0 ? '' : agent.systemPrompt.slice(index + DOCUMENTATION_ENVELOPE.length)),
        documents: agent.identityContext?.documents ?? [],
        tools: agent.tools ?? [],
    };
}

export function identityHue(id: string): number {
    let hash = 0;
    for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return [154, 212, 267, 332, 32, 183, 237][Math.abs(hash) % 7];
}

export function excerpt(text: string, limit = 125): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= limit) return normalized;
    const cut = normalized.slice(0, limit).replace(/\s+\S*$/, '');
    return `${cut || normalized.slice(0, limit)}…`;
}

export const identitySections = {
    instructions: { title: 'Instructions', empty: 'Aucune instruction renseignée.' },
    context: { title: 'Contexte', empty: 'Aucun document de référence renseigné.' },
    tools: { title: 'Outils', empty: 'Aucun outil renseigné.' },
};

export function sectionExcerpt(section: IdentitySection, content: IdentityContent): string {
    if (section === 'instructions') return excerpt(content.instructions) || identitySections.instructions.empty;
    if (section === 'context') {
        return excerpt([content.context, ...content.documents.map(document => document.name)].filter(Boolean).join(' · ')) || identitySections.context.empty;
    }
    return excerpt(content.tools.map(tool => tool.name).join(' · ')) || identitySections.tools.empty;
}

export interface AgentDraft extends IdentityContent {
    name: string;
    description: string;
    avatarPrompt: string;
    visibility: 'private' | 'friends' | 'public';
}
export const emptyAgentDraft: AgentDraft = { name: '', description: '', avatarPrompt: '', visibility: 'private', instructions: '', context: '', documents: [], tools: [] };
export function agentDraft(agent: ToolItem): AgentDraft {
    return { ...identityContent(agent), name: agent.name, description: agent.description, avatarPrompt: agent.avatarPrompt ?? '', visibility: agent.visibility };
}
export function draftPayload(draft: AgentDraft) {
    return {
        name: draft.name.trim(), description: draft.description.trim(), avatar_prompt: draft.avatarPrompt,
        system_prompt: composeAgentPrompt(draft.instructions, draft.context, draft.documents),
        identity_context: { text: draft.context, documents: draft.documents },
    };
}
