import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { preferences, enableDevice, disableDevice, pushSupported, type WatchPreferences } from '../../services/watchNotifications';

export default function SettingsWatches() {
    const { user } = useAuth();
    const client = useQueryClient();
    const key = ['watch-preferences', user?.uuid];
    const query = useQuery({queryKey:key,queryFn:()=>preferences(),retry:false});
    const update = useMutation({
        mutationFn: async (patch: Partial<WatchPreferences> & { device?: 'enable' | 'disable' }) => {
            const { device, ...values } = patch;
            if (device === 'enable') await enableDevice(user!.uuid, query.data!.vapid_public_key);
            if (device === 'disable') await disableDevice();
            return preferences(values);
        },
        onSuccess: async data => {
            client.setQueryData(key,data);
            await client.invalidateQueries({queryKey:['watches',user?.uuid]});
            await client.invalidateQueries({queryKey:['watch-artwork',user?.uuid]});
        },
    });
    const value = query.data;
    if (query.isLoading) return <section className="spage-section"><p className="spage-section-title">Accueil intelligent</p><p>Chargement…</p></section>;
    if (!value) return <section className="spage-section"><p className="spage-section-title">Accueil intelligent</p><p className="spage-section-hint">Les réglages de veille nécessitent la mise à jour du serveur.</p></section>;
    const saving = update.isPending;
    return <section className="spage-section" aria-label="Réglages des veilles">
        <p className="spage-section-title">Accueil intelligent</p>
        <div className="spage-row spage-row--setting"><div className="spage-row-info"><span className="spage-row-name">Illustrations générées</span><span className="spage-row-meta">Des visuels sobres, conservés pour chaque veille.</span></div>
            <button type="button" role="switch" aria-label="Illustrations générées" aria-checked={value.images_enabled} disabled={saving || user?.ai_agents_enabled === false} className={`spage-toggle${value.images_enabled ? ' spage-toggle--on' : ''}`} onClick={()=>update.mutate({images_enabled:!value.images_enabled})} />
        </div>
        {!value.images_available && <p className="spage-section-hint">La génération d’images doit être configurée sur le serveur.</p>}
        <div className="spage-row spage-row--setting"><div className="spage-row-info"><span className="spage-row-name">Notifications de veille</span><span className="spage-row-meta">Sujets importants, demandes d’amis et invitations. Aucun extrait privé sur l’écran verrouillé.</span></div>
            <button type="button" role="switch" aria-label="Notifications de veille" aria-checked={value.notifications_enabled} disabled={saving || (!value.notifications_enabled && (!value.push_available || !pushSupported()))} className={`spage-toggle${value.notifications_enabled ? ' spage-toggle--on' : ''}`} onClick={()=>update.mutate(value.notifications_enabled ? {notifications_enabled:false} : {notifications_enabled:true,device:'enable'})} />
        </div>
        {!value.push_available ? <p className="spage-section-hint">Les notifications doivent être configurées sur le serveur.</p> : !pushSupported() && <p className="spage-section-hint">Utilise un navigateur compatible. Sur iPhone, ouvre Echo depuis l’écran d’accueil.</p>}
        {value.push_available && pushSupported() && <div className="spage-watch-device-actions">
            <button type="button" className="spage-ai-retry" disabled={saving} onClick={()=>update.mutate({device:'enable',notifications_enabled:true})}>Activer sur cet appareil</button>
            <button type="button" className="spage-ai-retry" disabled={saving} onClick={()=>update.mutate({device:'disable'})}>Désactiver sur cet appareil</button>
        </div>}
        <div className="spage-row spage-row--setting"><div className="spage-row-info"><label className="spage-row-name" htmlFor="watch-daily-limit">Maximum par jour</label></div><select id="watch-daily-limit" className="spage-select" value={value.daily_limit} disabled={saving} onChange={event=>update.mutate({daily_limit:Number(event.target.value)})}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select></div>
        <div className="spage-row spage-row--setting"><div className="spage-row-info"><span className="spage-row-name">Heures calmes</span><span className="spage-row-meta">Aucune notification pendant cette plage. Deux heures identiques la désactivent.</span></div><div className="spage-watch-hours">
            {(['quiet_start','quiet_end'] as const).map((field,index)=><select key={field} className="spage-select" aria-label={index===0?'Début des heures calmes':'Fin des heures calmes'} value={value[field]} disabled={saving} onChange={event=>update.mutate({[field]:Number(event.target.value)})}>{Array.from({length:24},(_,hour)=><option key={hour} value={hour}>{hour} h</option>)}</select>)}
        </div></div>
        <div className="spage-row spage-row--setting"><div className="spage-row-info"><label className="spage-row-name" htmlFor="watch-timezone">Fuseau horaire</label></div><select id="watch-timezone" className="spage-select" value={value.timezone} disabled={saving} onChange={event=>update.mutate({timezone:event.target.value})}>{[...new Set([value.timezone,Intl.DateTimeFormat().resolvedOptions().timeZone,'Europe/Paris','Europe/London','America/Montreal','UTC'])].map(zone=><option key={zone} value={zone}>{zone}</option>)}</select></div>
        <p className="spage-section-hint">Les alertes attendent deux minutes après ton départ d’Echo. Les sujets déjà consultés restent silencieux. L’arrêt de l’IA conserve les notifications d’amis et de groupes.</p>
        {update.isError && <p className="spage-ai-error" role="alert">{update.error.message}</p>}
        {update.isSuccess && <p className="spage-ai-status" role="status">Réglages de veille enregistrés.</p>}
    </section>;
}
