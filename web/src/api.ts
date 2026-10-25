import type { Acting, Problem } from './types';

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  acting?: Acting | undefined;
  idempotencyKey?: string;
}

/** Calls the API; the acting user travels in X-User-Id / X-Role (demo authentication). */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.acting) {
    headers['x-user-id'] = options.acting.userId;
    if (options.acting.role) headers['x-role'] = options.acting.role;
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      data ?? {
        type: 'about:blank',
        title: response.statusText,
        status: response.status,
        detail: `HTTP ${response.status}: is the API running (npm run api)?`,
        code: 'HTTP_ERROR',
      },
    );
  }
  return data as T;
}

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

export const formatMoney = (vnd: number) => `${new Intl.NumberFormat('en-US').format(vnd)} VND`;

export const formatTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days`;
}
