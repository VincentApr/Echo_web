// Catalogue d'outils — enrichissement local des agents backend

export interface ToolItem {
    id: string;          // = agent uuid
    agentUuid: string;
    avatarUrl?: string;
    name: string;
    description: string;
    longDescription: string;
    icon: string;
    categoryId: string;
    examples: string[];
    isFavorite: boolean;
    isMine: boolean;
    isPublic: boolean;
    systemPrompt: string;
}

export interface ToolCategory {
    id: string;
    name: string;
    icon: string;
    color: string;
}

// ── Catégories UI ──

export const TOOL_CATEGORIES: ToolCategory[] = [
    { id: 'communication', name: 'Communication',     icon: '', color: '#3b82f6' },
    { id: 'organisation',  name: 'Organisation',      icon: '', color: '#8b5cf6' },
    { id: 'infos',         name: 'Informations',      icon: '', color: '#f59e0b' },
    { id: 'social',        name: 'Collaboration',     icon: '', color: '#10b981' },
];

// ── Enrichissement par mots-clés dans le nom de l'agent ──

interface Enrichment {
    icon: string;
    categoryId: string;
    longDescription?: string;
    examples: string[];
}

const ENRICHMENT_RULES: Array<{ test: RegExp; data: Enrichment }> = [
    {
        test: /messagerie|echo.?msg|message(?!rie.*google)/i,
        data: {
            icon: '', categoryId: 'communication',
            examples: ["Quels messages non lus j'ai ?", "Envoie 'On se voit demain ?' à Lucas", "Résume ma conversation avec Marie"],
        },
    },
    {
        test: /gmail|google.?mail/i,
        data: {
            icon: '', categoryId: 'communication',
            examples: ['Lis mes derniers mails', 'Envoie un mail à mon prof', 'Résume les mails de cette semaine'],
        },
    },
    {
        test: /calendrier.?echo|agenda.?echo|echo.?calendar/i,
        data: {
            icon: '', categoryId: 'organisation',
            examples: ["Qu'est-ce que j'ai de prévu demain ?", 'Ajoute un RDV dentiste mardi à 14h', 'Supprime mon événement de lundi'],
        },
    },
    {
        test: /google.?calendar|agenda.?google/i,
        data: {
            icon: '', categoryId: 'organisation',
            examples: ['Montre mon agenda de la semaine', 'Crée un événement "Réunion projet" jeudi 10h-12h', 'Quels sont mes prochains rendez-vous ?'],
        },
    },
    {
        test: /calendrier|agenda|planning|calendar/i,
        data: {
            icon: '', categoryId: 'organisation',
            examples: ["Qu'est-ce que j'ai de prévu ?", 'Ajoute un événement demain à 14h', 'Montre mon agenda de la semaine'],
        },
    },
    {
        test: /météo|meteo|weather|climat/i,
        data: {
            icon: '', categoryId: 'infos',
            examples: ['Quel temps fait-il à Paris ?', "Est-ce qu'il va pleuvoir demain ?", 'Donne-moi la météo de la semaine'],
        },
    },
    {
        test: /ratp|transport|métro|metro|bus|rer|navigo/i,
        data: {
            icon: '', categoryId: 'infos',
            examples: ['Prochain métro ligne 6 à Trocadéro ?', 'Comment aller de Châtelet à La Défense ?', 'Y a-t-il des perturbations sur le RER A ?'],
        },
    },
    {
        test: /groupe|group(?!e.*google)/i,
        data: {
            icon: '', categoryId: 'social',
            examples: ['Crée un groupe "Vacances été" avec Lucas et Marie', 'Ajoute Thomas au groupe Projet', 'Quels sont mes groupes ?'],
        },
    },
    {
        test: /recherche|search|utilisateur|user.?finder/i,
        data: {
            icon: '', categoryId: 'social',
            examples: ["Cherche l'utilisateur \"marie_dupont\"", 'Trouve mes amis avec "Lucas"', 'Qui est en ligne ?'],
        },
    },
    {
        test: /jarvis/i,
        data: {
            icon: '', categoryId: 'social',
            examples: ['Que peux-tu faire pour moi ?', 'Résume mon activité de la semaine', 'Active le mode automatique'],
        },
    },
    {
        test: /news|actualit|annonce/i,
        data: {
            icon: '', categoryId: 'infos',
            examples: ['Quelles sont les dernières annonces ?', 'Y a-t-il des nouveautés sur Echo ?'],
        },
    },
    {
        test: /note|remind|rappel/i,
        data: {
            icon: '', categoryId: 'organisation',
            examples: ['Crée une note pour demain', 'Rappelle-moi à 18h', 'Quelles sont mes notes ?'],
        },
    },
];

const DEFAULT_ENRICHMENT: Enrichment = {
    icon: '',
    categoryId: 'social',
    examples: [],
};

function buildContextualExamples(agent: BackendAgent): string[] {
    const source = `${agent.name} ${agent.description || ''}`.toLowerCase();
    if (/jurid|droit|avocat|contrat|legal/.test(source)) return [
        'Analyse cette clause et explique-moi les risques.',
        'Quelles obligations ce texte impose-t-il ?',
        'Résume cette décision en termes simples.',
    ];
    if (/code|dévelop|programm|technique|api|logiciel/.test(source)) return [
        'Relis ce code et identifie les erreurs.',
        'Explique-moi cette API avec un exemple.',
        'Propose une implémentation plus robuste.',
    ];
    if (/finance|compta|budget|invest|fiscal/.test(source)) return [
        'Analyse ces chiffres et relève les anomalies.',
        'Explique-moi les conséquences de cette opération.',
        'Compare ces deux scénarios financiers.',
    ];
    if (/rédac|écri|contenu|marketing|communication/.test(source)) return [
        'Réécris ce texte dans un ton plus clair.',
        'Prépare une version courte pour mes lecteurs.',
        'Propose trois angles adaptés à mon objectif.',
    ];
    if (/santé|médical|nutrition|sport/.test(source)) return [
        'Explique-moi ce document en termes simples.',
        'Quels points dois-je discuter avec un professionnel ?',
        'Compare ces recommandations avec ma situation.',
    ];
    if (/voyage|tourisme|séjour|itinéraire/.test(source)) return [
        'Prépare un itinéraire adapté à mes contraintes.',
        'Compare ces destinations pour mon séjour.',
        'Organise mon programme jour par jour.',
    ];
    const subject = agent.description?.trim().replace(/[.!?]+$/, '');
    if (subject) return [
        `Aide-moi sur ce besoin : ${subject}.`,
        `Analyse ma situation avec ton expertise en ${agent.name}.`,
        `Donne-moi une recommandation précise sur ${agent.name}.`,
    ];
    return [
        `Analyse cette demande comme ${agent.name}.`,
        `Applique ton expertise de ${agent.name} à mon cas.`,
        `Donne-moi une recommandation précise en tant que ${agent.name}.`,
    ];
}

// ── Fonction d'enrichissement ──

export interface BackendAgent {
    uuid: string;
    name: string;
    description?: string;
    agent_type?: string;
    is_public?: boolean;
    avatar_url?: string;
    is_favorite?: boolean;
    is_mine?: boolean;
    visibility?: 'private' | 'friends' | 'public';
    system_prompt?: string;
    instructions?: { system_prompt?: string };
}

export function enrichAgent(agent: BackendAgent): ToolItem {
    const match = ENRICHMENT_RULES.find(r => r.test.test(agent.name));
    const enrichment = match?.data ?? DEFAULT_ENRICHMENT;

    return {
        id: agent.uuid,
        agentUuid: agent.uuid,
        avatarUrl: agent.avatar_url,
        name: agent.name,
        description: agent.description || 'Agent IA disponible sur Echo.',
        longDescription: enrichment.longDescription || agent.description || 'Cet agent peut vous aider à automatiser vos tâches et répondre à vos questions.',
        icon: enrichment.icon,
        categoryId: enrichment.categoryId,
        examples: enrichment.examples.length ? enrichment.examples : buildContextualExamples(agent),
        isFavorite: Boolean(agent.is_favorite),
        isMine: Boolean(agent.is_mine),
        isPublic: Boolean(agent.is_public || agent.visibility === 'public'),
        systemPrompt: agent.system_prompt || agent.instructions?.system_prompt || '',
    };
}

export function getCategoryById(categoryId: string): ToolCategory | undefined {
    return TOOL_CATEGORIES.find(c => c.id === categoryId);
}
