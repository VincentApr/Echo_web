// Browser network error helpers.
export const isNetworkError = (error: unknown): boolean => {
    if (error instanceof TypeError && error.message === 'Failed to fetch') return true;
    if (error instanceof TypeError && error.message === 'Load failed') return true;
    if (error instanceof DOMException && error.name === 'AbortError') return true;
    return false;
};
