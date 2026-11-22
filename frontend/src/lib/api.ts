let csrfToken = '';

/** ApiError preserves HTTP status so session expiry differs from network failure. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** setCSRF keeps the token in memory. Session credentials live in HttpOnly cookies. */
export function setCSRF(token: string) {
  csrfToken = token;
}

/** api is the one JSON transport used by every screen. Nothing is stored offline. */
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/login')
      window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(data.error || `Request failed (${response.status})`, response.status);
  }
  return data as T;
}
