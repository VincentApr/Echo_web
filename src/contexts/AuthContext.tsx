// Authentication context for the web application.
// Reuses: fetchWithAuth, setLogoutCallback, storage, API_BASE_URL
// Removes native Expo dependencies; browser watch notifications are optional.

import { API_BASE_URL } from '@web/config/api';
import { CURRENT_CGU_VERSION } from '@web/constants/cgu';
import { fetchWithAuth, setLogoutCallback, getValidAccessToken, subscribeAccessToken } from '@web/services/apiClient';
import { hasAcceptedCurrentCguLocally, markCurrentCguAcceptedLocally } from '@web/utils/cgu';
import { cacheManager } from '@web/services/cacheManager';
import { storage } from '@web/services/storage';
import { clearComposerForOwner } from '../services/composerDrafts';
import { releaseWatchDevice } from '../services/watchNotifications';
import { useQueryClient } from '@tanstack/react-query';
import { webDatabaseManager } from '../services/webDatabase';
import { webLogger } from '../utils/logger';
import React, { createContext, useContext, useEffect, useState } from 'react';

import type { User as ApiUser } from '@web/types/api';

export interface User extends ApiUser {
    email: string;
    photo_profil?: string | null;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    isLoggedIn: boolean;
    login: (username: string, password: string) => Promise<void>;
    register: (data: Record<string, unknown>) => Promise<void>;
    loginWithGoogleIdToken: (idToken: string) => Promise<GoogleAuthStartResult>;
    completeGoogleSignup: (tempToken: string, username: string) => Promise<void>;
    logout: () => Promise<void>;
    acceptCGU: () => Promise<void>;
    updateUser: (updatedUser: User) => Promise<void>;
    accessToken: string | null;
    reloadUser: () => Promise<User | null>;
    needsCguAcceptance: boolean;
    refreshCguAcceptanceStatus: (targetUser?: User | null) => Promise<boolean>;
    currentCguVersion: string;
}

interface GoogleAuthData {
    email?: string;
    first_name?: string;
    last_name?: string;
}

interface GoogleAuthStartResult {
    needsUsername: boolean;
    tempToken?: string;
    googleData?: GoogleAuthData;
}

interface AuthPayload {
    user?: User;
    access?: string;
    refresh?: string;
    tokens?: {
        access?: string;
        refresh?: string;
    };
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ── Error message utilities (same as mobile) ──
const FIELD_LABELS: Record<string, string> = {
    username: "Nom d'utilisateur",
    email: "Email",
    password: "Mot de passe",
    password2: "Confirmation du mot de passe",
};

const translateServerMessage = (message: string): string => {
    const lowered = message.trim().toLowerCase();
    if (!lowered) return '';
    if (lowered.includes('this password is too short') || lowered.includes('must contain at least'))
        return 'Le mot de passe doit contenir au moins 8 caractères.';
    if (lowered.includes('this password is too common'))
        return 'Le mot de passe est trop facile à deviner.';
    if (lowered.includes('this password is entirely numeric'))
        return 'Le mot de passe ne peut pas contenir uniquement des chiffres.';
    if (lowered.includes('this password is too similar'))
        return 'Le mot de passe est trop proche de vos informations personnelles.';
    if (lowered === 'this field may not be blank.' || lowered === 'this field is required.')
        return 'Ce champ est obligatoire.';
    if (lowered === 'enter a valid email address.')
        return 'Entrez une adresse email valide.';
    return message.trim();
};

const collectErrorMessages = (value: unknown, field: string | null = null): string[] => {
    if (typeof value === 'string') {
        const t = translateServerMessage(value);
        if (!t) return [];
        if (!field || field === 'non_field_errors' || field === 'detail' || field === 'error' || field === 'password')
            return [t];
        const label = FIELD_LABELS[field];
        return [label ? `${label}: ${t}` : t];
    }
    if (Array.isArray(value)) return value.flatMap((v) => collectErrorMessages(v, field));
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => collectErrorMessages(v, k));
};

const readErrorMessage = (data: unknown, fallback: string): string => {
    const msgs = [...new Set(collectErrorMessages(data))];
    return msgs.length > 0 ? msgs.join('\n') : fallback;
};

// ── Provider ──
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const queryClient = useQueryClient();
    const [user, setUser] = useState<User | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [needsCguAcceptance, setNeedsCguAcceptance] = useState(false);
    const [loading, setLoading] = useState(true);
    const isLoggingOutRef = React.useRef(false);

    // Init: restore session from localStorage
    useEffect(() => {
        const unsubscribeToken = subscribeAccessToken(setAccessToken);
        const initAuth = async () => {
            try {
                webLogger.info('auth', 'Initializing web auth session');
                setLogoutCallback(() => { performLogout(false); });

                const [storedUser, storedAccess, storedRefresh] = await Promise.all([
                    storage.getItemAsync('user'),
                    storage.getItemAsync('accessToken'),
                    storage.getItemAsync('refreshToken'),
                ]);

                if (storedUser && storedRefresh) {
                    let resolvedUser = JSON.parse(storedUser) as User;
                    let restoredAccess = storedAccess;
                    try {
                        restoredAccess = await getValidAccessToken();
                        if (!restoredAccess) return;
                    } catch (error) {
                        // Keep the cached session offline; a later request retries renewal.
                        webLogger.warn('auth', 'Session renewal temporarily unavailable', { error: String(error) });
                    }
                    await webDatabaseManager.initialize();
                    await webDatabaseManager.logSnapshot();
                    setUser(resolvedUser);
                    setAccessToken(restoredAccess);
                    webLogger.info('auth', 'Restored stored session', {
                        userUuid: resolvedUser?.uuid ?? null,
                        username: resolvedUser?.username ?? null,
                    });

                    // Self-heal: fetch profile if UUID missing
                    if (!resolvedUser?.uuid) {
                        try {
                            const res = await fetchWithAuth(`${API_BASE_URL}/api/auth/profile/`);
                            if (res.ok) {
                                const fresh = await res.json();
                                if (fresh?.uuid) {
                                    resolvedUser = fresh;
                                    setUser(fresh);
                                    await storage.setItemAsync('user', JSON.stringify(fresh));
                                    webLogger.info('auth', 'Hydrated missing UUID from profile endpoint', {
                                        userUuid: fresh.uuid,
                                        username: fresh.username,
                                    });
                                }
                            }
                        } catch { /* best effort */ }
                    }

                    if (resolvedUser?.uuid) {
                        await webDatabaseManager.logSnapshot(resolvedUser.uuid);
                    }

                    await refreshCguAcceptanceStatus(resolvedUser);
                } else {
                    webLogger.info('auth', 'No stored session found');
                    await webDatabaseManager.initialize();
                    await webDatabaseManager.logSnapshot();
                    setNeedsCguAcceptance(false);
                }
            } catch (err) {
                webLogger.error('auth', 'Auth init error', {
                    error: err instanceof Error ? err.message : String(err),
                });
            } finally {
                setLoading(false);
            }
        };
        initAuth();
        return () => { unsubscribeToken(); setLogoutCallback(null); };
    }, []);

    const refreshCguAcceptanceStatus = async (targetUser?: User | null): Promise<boolean> => {
        const resolved = targetUser ?? user;
        if (!resolved?.uuid) { setNeedsCguAcceptance(false); return false; }
        const local = await hasAcceptedCurrentCguLocally(resolved.uuid);
        const needs = resolved.has_accepted_cgu !== true || !local;
        setNeedsCguAcceptance(needs);
        return needs;
    };

    const applyAuthenticatedSession = async (payload: AuthPayload) => {
        const access = payload.access ?? payload.tokens?.access;
        const refresh = payload.refresh ?? payload.tokens?.refresh;
        const currentUser = payload.user;
        if (!access || !refresh || !currentUser) throw new Error("Réponse d'authentification invalide");

        await storage.setItemAsync('accessToken', access);
        await storage.setItemAsync('refreshToken', refresh);
        await storage.setItemAsync('user', JSON.stringify(currentUser));
        await webDatabaseManager.initialize();
        await webDatabaseManager.logSnapshot();
        await webDatabaseManager.logSnapshot(currentUser.uuid);
        webLogger.info('auth', 'Applied authenticated session', {
            userUuid: currentUser.uuid,
            username: currentUser.username,
        });
        setUser(currentUser);
        setAccessToken(access);
        await refreshCguAcceptanceStatus(currentUser);
        // Push notifications: no-op on web
    };

    const performLogout = async (callApi: boolean = true) => {
        if (isLoggingOutRef.current) return;
        isLoggingOutRef.current = true;
        try {
            if (user?.uuid) {
                // Revoke this device before clearing credentials, without letting
                // an unavailable push service hold up an explicit logout.
                await Promise.race([releaseWatchDevice(user.uuid),new Promise(resolve=>setTimeout(resolve,1200))]);
            }
            const currentRefresh = await storage.getItemAsync('refreshToken');
            webLogger.info('auth', 'Logging out', {
                callApi,
                userUuid: user?.uuid ?? null,
            });
            if (callApi && currentRefresh) {
                try {
                    await fetchWithAuth(`${API_BASE_URL}/api/auth/logout/`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ refresh: currentRefresh }),
                    });
                } catch { /* best effort */ }
            }

            setUser(null);
            setAccessToken(null);
            setNeedsCguAcceptance(false);
            await storage.deleteItemAsync('accessToken');
            await storage.deleteItemAsync('refreshToken');
            await storage.deleteItemAsync('user');
            await queryClient.cancelQueries();
            queryClient.clear();
            if (callApi && user?.uuid) clearComposerForOwner(user.uuid);
            // Cache cleanup must never prevent an explicit logout from persisting.
            await cacheManager.clear();
            await webDatabaseManager.clearAllData();
        } finally {
            isLoggingOutRef.current = false;
        }
    };

    const login = async (username: string, password: string) => {
        const res = await fetch(`${API_BASE_URL}/api/auth/login/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(readErrorMessage(data, 'Échec de la connexion'));
        await applyAuthenticatedSession(data as AuthPayload);
    };

    const register = async (formData: Record<string, unknown>) => {
        if (formData.password && !formData.password2) formData.password2 = formData.password;
        const res = await fetch(`${API_BASE_URL}/api/auth/register/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(readErrorMessage(data, "Échec de l'inscription"));
        await applyAuthenticatedSession(data as AuthPayload);
    };

    const loginWithGoogleIdToken = async (idToken: string): Promise<GoogleAuthStartResult> => {
        const res = await fetch(`${API_BASE_URL}/api/auth/google/verify/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_token: idToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(readErrorMessage(data, 'Échec de la connexion Google'));
        if ((data as Record<string, unknown>).needs_username === true) {
            return {
                needsUsername: true,
                tempToken: (data as Record<string, unknown>).temp_token as string | undefined,
                googleData: (data as Record<string, unknown>).google_data as GoogleAuthData | undefined,
            };
        }
        await applyAuthenticatedSession(data as AuthPayload);
        return { needsUsername: false };
    };

    const completeGoogleSignup = async (tempToken: string, username: string) => {
        const res = await fetch(`${API_BASE_URL}/api/auth/google/complete/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ temp_token: tempToken, username }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(readErrorMessage(data, "Impossible de finaliser l'inscription Google"));
        await applyAuthenticatedSession(data as AuthPayload);
    };

    const logout = async () => { await performLogout(true); };

    const updateUser = async (updatedUser: User) => {
        setUser(updatedUser);
        await storage.setItemAsync('user', JSON.stringify(updatedUser));
        await refreshCguAcceptanceStatus(updatedUser);
    };

    const reloadUser = async (): Promise<User | null> => {
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/auth/profile/`);
            if (res.ok) { const u = await res.json() as User; await updateUser(u); return u; }
        } catch { /* silent */ }
        return null;
    };

    const acceptCGU = async () => {
        const storedRaw = await storage.getItemAsync('user');
        const stored = storedRaw ? JSON.parse(storedRaw) as User : null;
        const current = user || stored;
        if (!current) throw new Error('Utilisateur introuvable');

        let cguData: Partial<User> | null = null;
        if (current.has_accepted_cgu !== true) {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/auth/cgu/`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ has_accepted_cgu: true }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as Record<string, string>).detail || "Impossible d'enregistrer l'acceptation");
            }
            cguData = await res.json().catch(() => null) as Partial<User> | null;
        }

        await markCurrentCguAcceptedLocally(current.uuid);
        const merged: User = {
            ...current,
            ...(cguData || {}),
            has_accepted_cgu: true,
            cgu_accepted_at: cguData?.cgu_accepted_at ?? new Date().toISOString(),
        };
        await updateUser(merged);
        setNeedsCguAcceptance(false);
    };

    return (
        <AuthContext.Provider
            value={{
                user, loading, isLoggedIn: !!user,
                login, register, loginWithGoogleIdToken, completeGoogleSignup, logout,
                acceptCGU, updateUser, accessToken, reloadUser,
                needsCguAcceptance, refreshCguAcceptanceStatus, currentCguVersion: CURRENT_CGU_VERSION,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
};
