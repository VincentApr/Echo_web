// Web cache manager backed by memory and localStorage.

interface CacheEntry<T> {
    value: T;
    timestamp: number;
    ttl: number;
    key: string;
}

export class CacheManager {
    private static instance: CacheManager;
    private memoryCache: Map<string, CacheEntry<unknown>> = new Map();
    private readonly CACHE_KEY_PREFIX = '@cache:';
    private readonly MAX_MEMORY_ITEMS = 100;

    private constructor() { }

    public static getInstance(): CacheManager {
        if (!CacheManager.instance) {
            CacheManager.instance = new CacheManager();
        }
        return CacheManager.instance;
    }

    public async get<T>(key: string): Promise<T | null> {
        // Check memory first
        const memEntry = this.memoryCache.get(key);
        if (memEntry && !this.isExpired(memEntry)) {
            return memEntry.value as T;
        }

        // Check localStorage
        try {
            const raw = localStorage.getItem(this.CACHE_KEY_PREFIX + key);
            if (!raw) return null;

            const entry: CacheEntry<T> = JSON.parse(raw);
            if (this.isExpired(entry)) {
                localStorage.removeItem(this.CACHE_KEY_PREFIX + key);
                return null;
            }

            this.memoryCache.set(key, entry);
            return entry.value;
        } catch {
            return null;
        }
    }

    public async set<T>(key: string, value: T, ttl: number = 3600): Promise<void> {
        const entry: CacheEntry<T> = {
            value,
            timestamp: Date.now(),
            ttl,
            key,
        };

        this.memoryCache.set(key, entry);

        // LRU eviction
        if (this.memoryCache.size > this.MAX_MEMORY_ITEMS) {
            const firstKey = this.memoryCache.keys().next().value;
            if (firstKey) this.memoryCache.delete(firstKey);
        }

        try {
            localStorage.setItem(this.CACHE_KEY_PREFIX + key, JSON.stringify(entry));
        } catch {
            // localStorage full — silently fail
        }
    }

    public async invalidate(key: string): Promise<void> {
        this.memoryCache.delete(key);
        try {
            localStorage.removeItem(this.CACHE_KEY_PREFIX + key);
        } catch {
            // no-op
        }
    }

    public async invalidatePattern(pattern: string): Promise<void> {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');

        // Memory
        for (const key of this.memoryCache.keys()) {
            if (regex.test(key)) this.memoryCache.delete(key);
        }

        // localStorage
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const storageKey = localStorage.key(i);
                if (storageKey?.startsWith(this.CACHE_KEY_PREFIX)) {
                    const cacheKey = storageKey.slice(this.CACHE_KEY_PREFIX.length);
                    if (regex.test(cacheKey)) {
                        localStorage.removeItem(storageKey);
                    }
                }
            }
        } catch {
            // no-op
        }
    }

    public async clear(): Promise<void> {
        this.memoryCache.clear();
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key?.startsWith(this.CACHE_KEY_PREFIX)) {
                    localStorage.removeItem(key);
                }
            }
        } catch {
            // no-op
        }
    }

    private isExpired(entry: CacheEntry<unknown>): boolean {
        if (entry.ttl === Infinity) return false;
        return (Date.now() - entry.timestamp) / 1000 > entry.ttl;
    }
}

export const cacheManager = CacheManager.getInstance();
