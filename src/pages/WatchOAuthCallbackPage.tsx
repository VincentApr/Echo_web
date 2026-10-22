import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { finishConnection } from '../services/watchConnections';

export default function WatchOAuthCallbackPage() {
    const {user} = useAuth();
    const {navigate} = useNavigation();
    const [params] = useState(()=>new URLSearchParams(window.location.search));
    const [error,setError] = useState<string | null>(null);
    const [done,setDone] = useState(false);
    useEffect(()=>{
        let active=true;
        // Remove codes from the address bar before any further navigation.
        history.replaceState({},'', '/oauth/watch-callback/');
        if (user?.uuid) void finishConnection(user.uuid,params).then(()=>{if(active)setDone(true);}).catch((reason:Error)=>{if(active)setError(reason.message);});
        return ()=>{active=false;};
    },[user?.uuid,params]);
    const back = () => {history.replaceState({},'','/');navigate('home');window.location.reload();};
    return <div className="spage-content"><section className="spage-section">
        <h2>Connexion d’un service</h2>
        {error ? <p role="alert">{error}</p> : <p role="status">{done?'Service connecté. La première veille a été demandée.':'Finalisation de la connexion…'}</p>}
        {(done || error) && <button className="spage-ai-retry" onClick={back}>Revenir à l’accueil</button>}
    </section></div>;
}
