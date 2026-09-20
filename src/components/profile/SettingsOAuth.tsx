import React, { useState, useEffect } from 'react';
import { IoLogoGoogle, IoCheckmarkCircle, IoEllipseOutline } from 'react-icons/io5';
import { fetchWithAuth } from '@web/services/apiClient';
import { API_BASE_URL } from '@web/config/api';

interface SocialAccount {
    provider: string;
    uid?: string;
}

export default function SettingsOAuth() {
    const [accounts, setAccounts] = useState<SocialAccount[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void fetchWithAuth(`${API_BASE_URL}/api/auth/social-accounts/`)
            .then(r => r.ok ? r.json() : [])
            .then((data: unknown) => setAccounts(Array.isArray(data) ? data : []))
            .catch(() => setAccounts([]))
            .finally(() => setLoading(false));
    }, []);

    const googleConnected = accounts.some(a => a.provider === 'google');

    if (loading) return <div className="spage-loading"><div className="spage-spinner" /></div>;

    return (
        <div className="spage-content">
            <div className="spage-section">
                <p className="spage-section-hint">
                    Connectez des services externes pour faciliter votre connexion à Echo.
                </p>
                <div className="spage-oauth-row">
                    <IoLogoGoogle size={24} color="#4285f4" />
                    <div className="spage-row-info">
                        <span className="spage-row-name">Google</span>
                        <span className="spage-row-meta">
                            {googleConnected ? 'Compte connecté' : 'Non connecté'}
                        </span>
                    </div>
                    {googleConnected
                        ? <IoCheckmarkCircle size={22} color="rgba(10,145,104,0.85)" />
                        : <IoEllipseOutline size={22} color="#d1d5db" />}
                </div>
            </div>
        </div>
    );
}
