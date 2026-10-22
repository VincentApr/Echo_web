import { useState, useEffect, useRef, useCallback } from 'react';
import { IoShieldCheckmarkOutline } from 'react-icons/io5';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';
import { useAuth } from '../../contexts/AuthContext';
import { AI_PERMISSION_GROUPS, type AiPermissions } from '../../services/aiPermissions';

interface JarvisInstance {
    is_active: boolean;
    default_language: string;
    permissions?: AiPermissions;
    permission_schema_version?: number;
    user_preferences?: string;
    total_requests?: number;
    total_actions_performed?: number;
}

const LANGUAGES = [
    { value: 'fr', label: 'Français' }, { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' }, { value: 'de', label: 'Deutsch' },
];

export default function SettingsAiFeatures() {
    const { user, updateUser } = useAuth();
    const aiEnabled = user?.ai_agents_enabled !== false;
    const [jarvis, setJarvis] = useState<JarvisInstance | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const policySupported = jarvis?.permission_schema_version === 1 || user?.ai_policy_version === 1;
    const lock = useRef(false);
    const mounted = useRef(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/jarvis/instance/`);
            if (!response.ok) throw new Error();
            const data = await response.json() as JarvisInstance;
            if (mounted.current) setJarvis(data);
        } catch {
            if (mounted.current) setJarvis(null);
        } finally { if (mounted.current) setLoading(false); }
    }, []);

    useEffect(() => {
        mounted.current = true;
        void load();
        return () => { mounted.current = false; };
    }, [load]);

    const update = async (patch: Partial<JarvisInstance>) => {
        if (!jarvis || lock.current) return;
        lock.current = true;
        const prev = jarvis;
        setJarvis({ ...jarvis, ...patch, permissions: { ...jarvis.permissions, ...patch.permissions } });
        setSaving(true); setError(null); setMsg(null);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/jarvis/instance/`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
            });
            if (!response.ok) throw new Error();
            const data = await response.json() as JarvisInstance;
            if (patch.permissions && Object.entries(patch.permissions).some(([key, value]) => data.permissions?.[key] !== value)) {
                throw new Error();
            }
            setJarvis({ ...prev, ...data });
            setMsg('Paramètres sauvegardés');
        } catch {
            setJarvis(prev);
            setError('Sauvegarde impossible. Vos réglages précédents ont été conservés.');
        } finally { lock.current = false; setSaving(false); }
    };

    const toggleAllAi = async () => {
        if (!user || lock.current || !policySupported) return;
        lock.current = true; setSaving(true); setError(null); setMsg(null);
        const enabled = !aiEnabled;
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/auth/profile/`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ai_agents_enabled: enabled }),
            });
            if (!response.ok) throw new Error();
            const data = await response.json();
            if (data.ai_agents_enabled !== enabled) throw new Error();
            await updateUser({ ...user, ai_agents_enabled: enabled });
            setMsg(enabled ? 'Fonctionnalités IA réactivées. Vos autorisations sont conservées.' : 'Toute présence d’IA est désactivée.');
        } catch { setError('Modification impossible. Le réglage précédent est conservé.'); }
        finally { lock.current = false; setSaving(false); }
    };

    const detailedSupported = jarvis?.permission_schema_version === 1;
    const controlsDisabled = saving || !aiEnabled || !jarvis?.is_active;

    return (
        <div className="spage-content">
            <section className={`spage-ai-master ${!aiEnabled ? 'spage-ai-master--off' : ''}`}>
                <IoShieldCheckmarkOutline size={26} aria-hidden="true" />
                <div><h3>{aiEnabled ? 'Vous gardez le contrôle' : 'Echo sans IA'}</h3>
                    <p>Coupez Jarvis, les agents et les résumés intelligents. Aucun nouveau message ne sera lu par l’IA et aucune réponse IA ne sera générée dans vos conversations.</p>
                    <button type="button" className="spage-ai-master__button" disabled={saving || !policySupported} onClick={() => void toggleAllAi()}>
                        {aiEnabled ? 'Désactiver toute présence d’IA' : 'Réactiver les fonctionnalités IA'}
                    </button>
                    <small>Vos autorisations sont conservées pour une éventuelle réactivation. Les messages échangés entre personnes restent disponibles.</small>
                </div>
            </section>
            {!loading && !policySupported && <p className="spage-ai-status">La désactivation complète de l’IA nécessite la mise à jour du serveur.</p>}
            {error && <p className="spage-ai-error" role="alert">{error}</p>}
            {msg && <p className="spage-ai-status" role="status">{msg}</p>}
            {loading ? <div className="spage-loading" role="status">Chargement des autorisations…</div> : !jarvis ? (
                <div className="spage-section"><p>Impossible de charger les paramètres Jarvis.</p><button type="button" className="spage-ai-retry" onClick={() => void load()}>Réessayer</button></div>
            ) : <>
                <section className="spage-section">
                    <p className="spage-section-title">Assistant Jarvis</p>
                    <div className="spage-row spage-row--setting"><div className="spage-row-info"><span className="spage-row-name">Activer Jarvis</span><span className="spage-row-meta">Votre assistant IA personnel</span></div>
                        <button type="button" role="switch" aria-checked={jarvis.is_active} aria-label="Activer Jarvis" className={`spage-toggle${jarvis.is_active ? ' spage-toggle--on' : ''}`} disabled={saving || !aiEnabled} onClick={() => void update({ is_active: !jarvis.is_active })} />
                    </div>
                    <div className="spage-row spage-row--setting"><div className="spage-row-info"><label className="spage-row-name" htmlFor="jarvis-language">Langue</label><span className="spage-row-meta">Langue de réponse de Jarvis</span></div>
                        <select id="jarvis-language" className="spage-select" value={jarvis.default_language} disabled={controlsDisabled} onChange={event => void update({ default_language: event.target.value })}>{LANGUAGES.map(language => <option key={language.value} value={language.value}>{language.label}</option>)}</select>
                    </div>
                </section>
                <section className="spage-section spage-ai-permissions" aria-label="Autorisations de Jarvis">
                    <p className="spage-section-title">Autorisations de Jarvis</p>
                    <p className="spage-section-hint">Choisissez les données accessibles et les actions autorisées. Les droits de votre compte et de vos groupes continuent de s’appliquer.</p>
                    {!detailedSupported && <p className="spage-ai-status">Les autorisations détaillées nécessitent la mise à jour du serveur.</p>}
                    {AI_PERMISSION_GROUPS.map(group => {
                        const count = group.actions.filter(([action]) => jarvis.permissions?.[`${group.id}.${action}`] === true).length;
                        return <details key={group.id} className="spage-ai-domain"><summary><span>{group.title}</span><small>{detailedSupported ? `${count} / ${group.actions.length} autorisées` : 'À venir'}</small></summary>
                            {group.actions.map(([action, title, hint]) => {
                                const key = `${group.id}.${action}`;
                                const allowed = jarvis.permissions?.[key] === true;
                                return <div className="spage-row spage-row--setting" key={key}><div className="spage-row-info"><span className="spage-row-name">{title}</span><span className="spage-row-meta">{hint}</span></div>
                                    <button type="button" role="switch" aria-checked={allowed} aria-label={title} disabled={controlsDisabled || !detailedSupported} className={`spage-toggle${allowed ? ' spage-toggle--on' : ''}`} onClick={() => void update({ permissions: { [key]: !allowed } })} />
                                </div>;
                            })}
                        </details>;
                    })}
                    <p className="spage-section-hint">Ces réglages concernent Echo. Les autorisations des comptes externes, comme Gmail et Google Calendar, sont gérées séparément.</p>
                </section>
                {(jarvis.total_requests !== undefined || jarvis.total_actions_performed !== undefined) && <section className="spage-section spage-section--stats"><p className="spage-section-title">Utilisation</p><div className="spage-stats-row"><div className="spage-stat"><span className="spage-stat-value">{jarvis.total_requests ?? 0}</span><span className="spage-stat-label">Requêtes</span></div><div className="spage-stat"><span className="spage-stat-value">{jarvis.total_actions_performed ?? 0}</span><span className="spage-stat-label">Actions</span></div></div></section>}
                {jarvis.user_preferences && <section className="spage-section"><p className="spage-section-title">Préférences apprises</p><p className="spage-section-hint">{jarvis.user_preferences}</p></section>}
            </>}
        </div>
    );
}
