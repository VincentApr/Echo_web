export const AI_PERMISSION_GROUPS = [
    { id: 'messages', title: 'Messages', actions: [
        ['conversations', 'Consulter les conversations', 'Voir la liste de vos conversations.'],
        ['read', 'Lire les messages', 'Lire l’historique et produire des résumés.'],
        ['send', 'Envoyer des messages', 'Envoyer un message en votre nom.'],
        ['mark_read', 'Marquer comme lu', 'Modifier l’état de lecture des messages.'],
    ] },
    { id: 'groups', title: 'Groupes', actions: [
        ['read', 'Consulter les groupes', 'Voir vos groupes, leurs membres et les invitations.'],
        ['create', 'Créer des groupes', 'Créer un groupe à votre demande.'],
        ['update', 'Modifier les groupes', 'Modifier les informations des groupes que vous gérez.'],
        ['members', 'Gérer les membres', 'Inviter ou retirer des membres, ou quitter un groupe.'],
        ['moderate', 'Modérer les groupes', 'Bannir ou réintégrer des membres selon votre rôle.'],
        ['delete', 'Supprimer des groupes', 'Supprimer un groupe que vous possédez.'],
    ] },
    { id: 'calendar', title: 'Calendrier Echo', actions: [
        ['read', 'Consulter les événements', 'Voir votre agenda et les événements à venir.'],
        ['create', 'Créer des événements', 'Ajouter un événement dans votre calendrier.'],
        ['update', 'Modifier les événements', 'Modifier les événements auxquels vous avez accès.'],
        ['delete', 'Supprimer des événements', 'Supprimer vos événements.'],
    ] },
    { id: 'agents', title: 'Agents IA', actions: [
        ['read', 'Consulter les agents', 'Voir vos agents et leurs informations.'],
        ['create', 'Créer des agents', 'Créer un agent à votre demande.'],
        ['update', 'Modifier les agents', 'Modifier les agents que vous avez créés.'],
        ['delete', 'Supprimer des agents', 'Supprimer les agents que vous avez créés.'],
    ] },
] as const;

export type AiPermissions = Record<string, boolean>;
