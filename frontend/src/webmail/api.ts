let token = '';
let authGeneration = 0;

/** MailError differentiates an expired mailbox session from a service outage. */
export class MailError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Keep the mailbox CSRF token in memory, independent of the admin application's token. */
export function setMailToken(value: string) {
  token = value;
  authGeneration++;
}

/** One same-origin, non-caching transport for the independently authenticated mailbox. */
export async function mailAPI<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const generation = authGeneration;
  const requestToken = token;
  let response: Response;
  try {
    response = await fetch(`/api/webmail${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(method !== 'GET' ? { 'X-CSRF-Token': token } : {}),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new MailError('Cannot reach your mailbox. Check the connection and try again.', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (
      response.status === 401 &&
      path !== '/login' &&
      requestToken &&
      generation === authGeneration
    )
      window.dispatchEvent(new Event('mail-session-expired'));
    throw new MailError(
      data.error || `Mailbox request failed (${response.status})`,
      response.status,
    );
  }
  return data as T;
}
