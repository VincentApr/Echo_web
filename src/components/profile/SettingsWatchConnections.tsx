import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { connectedServices, connectService } from '../../services/watchConnections';

export default function SettingsWatchConnections() {
    const {user} = useAuth();
    const query = useQuery({queryKey:['watch-connections',user?.uuid],queryFn:connectedServices,retry:false});
    const connect = useMutation({mutationFn:(provider:string)=>connectService(user!.uuid,provider)});
    return <section className="spage-section" aria-label="Services de veille">
        <p className="spage-section-title">Services de veille</p>
        <p className="spage-section-hint">L’IA lit uniquement les sources autorisées. La connexion Google utilisée pour se connecter à Echo ne donne pas automatiquement accès à Gmail.</p>
        {[{id:'google',name:'Gmail et Google Agenda',aliases:['google','gmail','google_calendar','calendar']},{id:'github',name:'GitHub',aliases:['github']}].map(service=>{
            const connections = query.data?.filter(item=>service.aliases.includes(item.provider)) || [];
            const scopes = connections.flatMap(item=>typeof item.granted_scopes==='string' ? item.granted_scopes.replace(/,/g,' ').split(' ') : item.granted_scopes);
            const mail = scopes.some(scope=>['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/'].includes(scope));
            const calendar = scopes.some(scope=>/^https:\/\/www.googleapis.com\/auth\/calendar(?:\.events)?(?:\.readonly)?$/.test(scope));
            const github = scopes.some(scope=>['notifications','repo'].includes(scope));
            const ready = service.id==='github' ? github : mail || calendar;
            const status = service.id==='github' ? 'Notifications GitHub autorisées' : [mail?'Gmail autorisé':null,calendar?'Agenda autorisé':null].filter(Boolean).join(' · ');
            return <div key={service.id} className="spage-row spage-row--setting"><div className="spage-row-info"><span className="spage-row-name">{service.name}</span><span className="spage-row-meta">{query.isLoading?'Vérification…':ready?status:connections.length?'Autorisations de lecture à compléter':'Non connecté pour la veille'}</span></div>
                <button type="button" className="spage-ai-retry" disabled={connect.isPending || user?.ai_agents_enabled===false} onClick={()=>connect.mutate(connections[0]?.provider || service.id)}>{ready?'Reconnecter':'Connecter'}</button></div>;
        })}
        {query.isError && <p className="spage-section-hint">L’état des connexions est momentanément indisponible.</p>}
        {connect.isError && <p className="spage-ai-error" role="alert">{connect.error.message}</p>}
    </section>;
}
