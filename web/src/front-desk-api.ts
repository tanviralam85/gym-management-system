type Member = { memberNumber: number; fullName: string; phone: string };
type ApiProblem = { message?: string; code?: string; existing?: Member[] };

export class RequestError extends Error {
  constructor(readonly status: number, readonly problem: ApiProblem) {
    super(problem.message ?? 'The request could not be completed.');
  }
}

export async function api<T>(path: string, options?: { method: string; data: object }, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/v1/' + path, {
    signal, method: options?.method,
    headers: options && { 'Content-Type': 'application/json' },
    body: options && JSON.stringify(options.data),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new RequestError(response.status, problem);
  }
  return response.json();
}

export function errorMessage(error: unknown) {
  if (error instanceof RequestError) {
    if (error.status === 401) return 'Your session expired. Sign out and sign in again.';
    if (error.status === 403) return 'You do not have permission to do that.';
    if (error.status < 500) return error.message;
  }
  return 'Could not complete the request. Try again.';
}

export function memberNumber(number: number) {
  return 'LG-' + String(number).padStart(4, '0');
}

export function displayPhone(phone: string) {
  return '+91 ' + phone.slice(3, 8) + ' ' + phone.slice(8);
}

export const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });


