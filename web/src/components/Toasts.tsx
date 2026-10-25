import { useCallback, useState } from 'react';
import { ApiError } from '../api';
import type { Problem } from '../types';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  body?: string;
  problem?: Problem;
}

export type Notify = (toast: Omit<Toast, 'id'>) => void;

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback(
    (id: number) => setToasts((list) => list.filter((t) => t.id !== id)),
    [],
  );
  const notify: Notify = useCallback(
    (toast) => {
      const id = nextId++;
      setToasts((list) => [...list.slice(-3), { ...toast, id }]);
      setTimeout(() => dismiss(id), toast.kind === 'error' ? 20_000 : 5_000);
    },
    [dismiss],
  );
  return { toasts, notify, dismiss };
}

/** Error toast for a failed API call, keeping the problem details for display. */
export function errorToast(error: unknown, title = 'Refused'): Omit<Toast, 'id'> {
  if (error instanceof ApiError) return { kind: 'error', title, problem: error.problem };
  return {
    kind: 'error',
    title: 'Request failed',
    body: error instanceof Error ? error.message : String(error),
  };
}

export function ProblemDetails({ problem }: { problem: Problem }) {
  const failures = problem.failures ?? [];
  const showFailures =
    failures.length > 1 || (failures.length === 1 && failures[0]?.message !== problem.detail);
  return (
    <div className="mt-1 space-y-1 text-sm">
      <p>{problem.detail}</p>
      {showFailures && (
        <ul className="list-disc pl-5">
          {failures.map((f) => (
            <li key={`${f.code}:${f.message}`}>
              <span className="font-mono text-xs">{f.code}</span> {f.message}
            </li>
          ))}
        </ul>
      )}
      {problem.input_errors && problem.input_errors.length > 0 && (
        <ul className="list-disc pl-5">
          {problem.input_errors.map((e) => (
            <li key={e.input}>{e.message}</li>
          ))}
        </ul>
      )}
      {problem.counter && (
        <p className="text-xs">
          Counter {problem.counter.name}: {problem.counter.value}/{problem.counter.max}
        </p>
      )}
      {problem.path_to_target && (
        <p className="text-xs">Path: {problem.path_to_target.join(' → ')}</p>
      )}
    </div>
  );
}

const STYLES: Record<Toast['kind'], string> = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-950',
  error: 'border-red-300 bg-red-50 text-red-950',
  info: 'border-slate-300 bg-white text-slate-900',
};

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div
      className="fixed right-4 bottom-4 z-50 flex w-[30rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`rounded-lg border p-3 shadow-lg ${STYLES[t.kind]}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{t.title}</p>
              {t.problem && (
                <p className="font-mono text-xs opacity-80">
                  {t.problem.code} · HTTP {t.problem.status}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="rounded px-1.5 text-lg leading-none opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
          {t.body && <p className="mt-1 text-sm">{t.body}</p>}
          {t.problem && <ProblemDetails problem={t.problem} />}
        </div>
      ))}
    </div>
  );
}
