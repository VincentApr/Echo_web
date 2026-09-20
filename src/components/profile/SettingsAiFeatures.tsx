import React, { useState, useEffect } from 'react';
import { IoSparklesOutline } from 'react-icons/io5';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';

interface JarvisInstance {
    is_active: boolean;
    default_language: string;
    user_preferences?: string;
    total_requests?: number;
    total_actions_performed?: number;
}

const LANGUAGES = [
    { value: 'fr', label: 'Français' },
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' },
    { value: 'de', label: 'Deutsch' },
];

export default function SettingsAiFeatures() {
    const [jarvis, setJarvis] = useState<JarvisInstance | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        void fetchWithAuth(`${API_BASE_URL}/jarvis/instance/`)
            .then(r => r.ok ? r.json() : null)
            .then((data: JarvisInstance | null) => setJarvis(data))
            .finally(() => setLoading(false));
    }, []);

    const update = async (patch: Partial<JarvisInstance>) => {
        if (!jarvis) return;
        const prev = jarvis;
        setJarvis({ ...jarvis, ...patch }); // optimistic
        setSaving(true);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/jarvis/instance/`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) throw new Error();
            setMsg('Paramètres sauvegardés');
        } catch {
            setJarvis(prev); // rollback
            setMsg('Erreur lors de la sauvegarde');
        } finally {
            setSaving(false);
            setTimeout(() => setMsg(null), 2500);
        }
    };

    if (loading) return <div className="spage-loading"><div className="spage-spinner" /></div>;

    if (!jarvis) return (
        <div className="spage-empty">
            <IoSparklesOutline size={40} color="rgba(10,145,104,0.4)" />
            <p>Impossible de charger les paramètres Jarvis</p>
        </div>
    );

    return (
        <div className="spage-content">
            {msg && <div className="spage-toast">{msg}</div>}

            <div className="spage-section">
                <div className="spage-row spage-row--setting">
                    <div className="spage-row-info">
                        <span className="spage-row-name">Activer Jarvis</span>
                        <span className="spage-row-meta">Votre assistant IA personnel</span>
                    </div>
                    <button
                        className={`spage-toggle${jarvis.is_active ? ' spage-toggle--on' : ''}`}
                        onClick={() => void update({ is_active: !jarvis.is_active })}
                        disabled={saving}
                        aria-label={jarvis.is_active ? 'Désactiver Jarvis' : 'Activer Jarvis'}
                    />
                </div>

                <div className="spage-row spage-row--setting">
                    <div className="spage-row-info">
                        <span className="spage-row-name">Langue</span>
                        <span className="spage-row-meta">Langue de réponse de Jarvis</span>
                    </div>
                    <select
                        className="spage-select"
                        value={jarvis.default_language}
                        onChange={e => void update({ default_language: e.target.value })}
                        disabled={saving || !jarvis.is_active}
                    >
                        {LANGUAGES.map(l => (
                            <option key={l.value} value={l.value}>{l.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {(jarvis.total_requests !== undefined || jarvis.total_actions_performed !== undefined) && (
                <div className="spage-section spage-section--stats">
                    <p className="spage-section-title">Utilisation</p>
                    <div className="spage-stats-row">
                        <div className="spage-stat">
                            <span className="spage-stat-value">{jarvis.total_requests ?? 0}</span>
                            <span className="spage-stat-label">Requêtes</span>
                        </div>
                        <div className="spage-stat">
                            <span className="spage-stat-value">{jarvis.total_actions_performed ?? 0}</span>
                            <span className="spage-stat-label">Actions</span>
                        </div>
                    </div>
                </div>
            )}

            {jarvis.user_preferences && (
                <div className="spage-section">
                    <p className="spage-section-title">Préférences apprises</p>
                    <p className="spage-section-hint">{jarvis.user_preferences}</p>
                </div>
            )}
        </div>
    );
}
