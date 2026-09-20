import React, { useState, useEffect } from 'react';
import { IoFlagOutline } from 'react-icons/io5';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';

const STATUS_LABELS: Record<string, string> = {
    pending: 'En attente',
    reviewed: 'Examiné',
    action_taken: 'Action prise',
    dismissed: 'Classé',
};

const REASON_LABELS: Record<string, string> = {
    harassment: 'Harcèlement',
    spam: 'Spam',
    inappropriate_content: 'Contenu inapproprié',
    hate_speech: 'Discours haineux',
    impersonation: 'Usurpation d\'identité',
};

interface Report {
    uuid: string;
    reported_user?: { uuid: string; username: string; surnom?: string };
    reason: string;
    status: string;
    created_at: string;
}

export default function SettingsMyReports() {
    const [reports, setReports] = useState<Report[]>([]);
    const [loading, setLoading] = useState(true);
    const [cancelling, setCancelling] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        void fetchWithAuth(`${API_BASE_URL}/messaging/reports/list/`)
            .then(r => r.ok ? r.json() : [])
            .then((data: unknown) => setReports(Array.isArray(data) ? data : (data as any)?.results ?? []))
            .finally(() => setLoading(false));
    }, []);

    const cancel = async (uuid: string) => {
        setCancelling(uuid);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/messaging/reports/${uuid}/cancel/`, { method: 'POST' });
            if (res.ok) {
                setReports(prev => prev.filter(r => r.uuid !== uuid));
                setMsg('Signalement annulé');
                setTimeout(() => setMsg(null), 2500);
            }
        } finally {
            setCancelling(null);
        }
    };

    if (loading) return <div className="spage-loading"><div className="spage-spinner" /></div>;

    return (
        <div className="spage-content">
            {msg && <div className="spage-toast">{msg}</div>}
            {reports.length === 0 ? (
                <div className="spage-empty">
                    <IoFlagOutline size={40} color="rgba(10,145,104,0.4)" />
                    <p>Aucun signalement</p>
                </div>
            ) : (
                <div className="spage-section">
                    <div className="spage-list">
                        {reports.map(r => (
                            <div key={r.uuid} className="spage-row spage-row--col">
                                <div className="spage-row-top">
                                    <span className="spage-row-name">
                                        {r.reported_user?.surnom || r.reported_user?.username || 'Utilisateur'}
                                    </span>
                                    <span className={`spage-badge spage-badge--${r.status}`}>
                                        {STATUS_LABELS[r.status] || r.status}
                                    </span>
                                </div>
                                <div className="spage-row-sub">
                                    <span className="spage-row-meta">
                                        {REASON_LABELS[r.reason] || r.reason} · {new Date(r.created_at).toLocaleDateString('fr-FR')}
                                    </span>
                                    {r.status === 'pending' && (
                                        <button
                                            className="spage-btn spage-btn--danger-sm"
                                            onClick={() => void cancel(r.uuid)}
                                            disabled={cancelling === r.uuid}
                                        >
                                            {cancelling === r.uuid ? '...' : 'Annuler'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
