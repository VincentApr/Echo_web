import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import {
    IoPeopleOutline, IoChatbubblesOutline, IoSendOutline, IoMailOutline,
    IoCalendarOutline, IoAlbumsOutline, IoFlashOutline, IoTrendingUpOutline,
    IoTimeOutline, IoDocumentTextOutline, IoStarOutline, IoFlameOutline,
    IoPaperPlaneOutline
} from 'react-icons/io5';

// Define the extended stats type matching the mobile structure
interface ExtendedStats {
    nb_amis?: number;
    conversations_actives?: number;
    messages_envoyes?: number;
    messages_recus?: number;
    
    total_evenements?: number;
    evenements_ce_mois?: number;
    total_reponses?: number;
    posts_publies?: number;
    
    agents_crees?: number;
    taux_reponse?: number;
    moyenne_messages_jour?: number;
    total_connexions?: number;
    
    ia_jarvis?: {
        messages_envoyes_jarvis: number;
        resumes_generes_jarvis: number;
    };
    ia_agents?: {
        messages_envoyes_agents: number;
        agent_prefere: { nom: string; interactions: number } | null;
        nombre_agents_favoris: number;
        total_reponses_agents: number;
    };
    engagement_temporel?: {
        jours_consecutifs_actifs: number;
        jour_plus_actif: string | null;
        heure_preferee: string | null;
        messages_cette_semaine: number;
    };
}

export default function ExpandedStats() {
    const { user } = useAuth();

    const { data: stats, isLoading } = useQuery({
        queryKey: ['profile-stats-extended', user?.uuid],
        queryFn: async () => {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/auth/profile/stats/`);
            if (!res.ok) throw new Error('Failed to fetch stats');
            const data = await res.json();
            
            // On the web, we compute the same mapping logic as mobile if any computation is needed, 
            // but here the API seems to provide all the data we need. 
            // Let's format it.
            return {
                nb_amis: data.total_connexions,
                conversations_actives: data.conversations_actives,
                messages_envoyes: data.messages_envoyes,
                messages_recus: data.messages_recus,
                
                total_evenements: data.total_evenements,
                evenements_ce_mois: data.evenements_ce_mois,
                total_reponses: data.total_reponses,
                posts_publies: data.posts_publies,

                agents_crees: data.agents_crees,
                taux_reponse: data.taux_reponse,
                moyenne_messages_jour: data.moyenne_messages_jour,
                total_connexions: data.total_connexions,
                
                ia_jarvis: data.ia_jarvis,
                ia_agents: data.ia_agents,
                engagement_temporel: data.engagement_temporel,
            } as ExtendedStats;
        },
        enabled: !!user,
        staleTime: 5 * 60_000,
    });

    if (isLoading) {
        return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Chargement des statistiques...</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            
            {/* Section: Vue d'ensemble */}
            <section>
                <h3 style={{ fontSize: '18px', fontWeight: 750, color: '#1a2620', marginBottom: '16px' }}>Vue d'ensemble</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                    <StatCard icon={<IoPeopleOutline />} color="#10b981" value={stats?.nb_amis ?? 0} title="Amis" subtitle="connexions" />
                    <StatCard icon={<IoChatbubblesOutline />} color="#3b82f6" value={stats?.conversations_actives ?? 0} title="Conversations" subtitle="actives" />
                    <StatCard icon={<IoSendOutline />} color="#f59e0b" value={stats?.messages_envoyes ?? 0} title="Messages envoyés" subtitle="au total" />
                    <StatCard icon={<IoMailOutline />} color="#8b5cf6" value={stats?.messages_recus ?? 0} title="Messages reçus" subtitle="au total" />
                </div>
            </section>

            {/* Section: Activité */}
            <section>
                <h3 style={{ fontSize: '18px', fontWeight: 750, color: '#1a2620', marginBottom: '16px' }}>Activité</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                    <StatCard icon={<IoCalendarOutline />} color="#06b6d4" value={stats?.total_evenements ?? 0} title="Événements" subtitle="au total" />
                    <StatCard icon={<IoCalendarOutline />} color="#0d9488" value={stats?.evenements_ce_mois ?? 0} title="Ce mois-ci" subtitle="événements" />
                    <StatCard icon={<IoChatbubblesOutline />} color="#6366f1" value={stats?.total_reponses ?? 0} title="Réponses" subtitle="aux questions" />
                    <StatCard icon={<IoDocumentTextOutline />} color="#ec4899" value={stats?.posts_publies ?? 0} title="Posts" subtitle="publiés" />
                </div>
            </section>

            {/* Section: Intelligence Artificielle */}
            <section>
                <h3 style={{ fontSize: '18px', fontWeight: 750, color: '#1a2620', marginBottom: '16px' }}>Intelligence Artificielle</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                    <StatCard icon={<IoFlashOutline />} color="#6366f1" value={stats?.ia_jarvis?.messages_envoyes_jarvis ?? 0} title="Messages à Jarvis" subtitle="interactions" />
                    <StatCard icon={<IoDocumentTextOutline />} color="#8b5cf6" value={stats?.ia_jarvis?.resumes_generes_jarvis ?? 0} title="Résumés Jarvis" subtitle="générés" />
                    <StatCard icon={<IoChatbubblesOutline />} color="#ec4899" value={stats?.ia_agents?.messages_envoyes_agents ?? 0} title="Messages aux agents" subtitle="total" />
                    <StatCard icon={<IoStarOutline />} color="#f59e0b" value={stats?.ia_agents?.nombre_agents_favoris ?? 0} title="Agents favoris" subtitle="sélectionnés" />
                </div>
                {stats?.ia_agents?.agent_prefere && (
                    <div style={{ marginTop: '16px', background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.05)', borderRadius: '16px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <p style={{ margin: 0, fontSize: '13px', color: '#6b7a72', fontWeight: 600 }}>🤖 Agent préféré</p>
                            <p style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 750, color: '#1a2620' }}>{stats.ia_agents.agent_prefere.nom}</p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#3b82f6' }}>{stats.ia_agents.agent_prefere.interactions}</p>
                            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#9ca3af' }}>interactions</p>
                        </div>
                    </div>
                )}
            </section>

            {/* Section: Engagement Temporel */}
            <section>
                <h3 style={{ fontSize: '18px', fontWeight: 750, color: '#1a2620', marginBottom: '16px' }}>Engagement temporel</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                    <StatCard icon={<IoFlameOutline />} color="#ef4444" value={stats?.engagement_temporel?.jours_consecutifs_actifs ?? 0} title="Série active" subtitle="jours consécutifs" />
                    <StatCard icon={<IoCalendarOutline />} color="#10b981" value={stats?.engagement_temporel?.jour_plus_actif || '—'} title="Jour préféré" subtitle="le plus actif" />
                    <StatCard icon={<IoTimeOutline />} color="#3b82f6" value={stats?.engagement_temporel?.heure_preferee || '—'} title="Heure préférée" subtitle="d'activité" />
                    <StatCard icon={<IoPaperPlaneOutline />} color="#14b8a6" value={stats?.engagement_temporel?.messages_cette_semaine ?? 0} title="Cette semaine" subtitle="messages" />
                </div>
            </section>

        </div>
    );
}

function StatCard({ icon, value, title, subtitle, color }: any) {
    return (
        <div style={{
            background: 'rgba(255, 255, 255, 0.9)',
            borderRadius: '16px',
            padding: '16px',
            borderLeft: `4px solid ${color}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
        }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '24px', background: `${color}15`, color: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                {icon}
            </div>
            <div>
                <h4 style={{ margin: 0, fontSize: '13px', color: '#6b7a72', fontWeight: 600 }}>{title}</h4>
                <p style={{ margin: '4px 0', fontSize: '26px', fontWeight: 800, color: color }}>{value}</p>
                <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af' }}>{subtitle}</p>
            </div>
        </div>
    );
}
