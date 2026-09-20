// Web API client with Bearer token injection and automatic token refresh.

let logoutCallback: (() => void) | null = null;

export function setLogoutCallback(callback: () => void): void {
  logoutCallback = callback;
}

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const accessToken = localStorage.getItem('accessToken');

  const headers = new Headers(options.headers as HeadersInit | undefined);
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  if (
    options.body &&
    typeof options.body === 'string' &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  let response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      try {
        const refreshRes = await fetch('/api/auth/token/refresh/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh: refreshToken }),
        });

        if (refreshRes.ok) {
          const data = await refreshRes.json() as { access: string };
          const newToken = data.access;
          localStorage.setItem('accessToken', newToken);

          const retryHeaders = new Headers(options.headers as HeadersInit | undefined);
          retryHeaders.set('Authorization', `Bearer ${newToken}`);
          if (
            options.body &&
            typeof options.body === 'string' &&
            !retryHeaders.has('Content-Type')
          ) {
            retryHeaders.set('Content-Type', 'application/json');
          }
          response = await fetch(url, { ...options, headers: retryHeaders });
        } else {
          logoutCallback?.();
        }
      } catch {
        logoutCallback?.();
      }
    } else {
      logoutCallback?.();
    }
  }

  return response;
}
