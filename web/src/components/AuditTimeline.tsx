import { formatDuration, formatTime } from '../api';
import type { AuditEntry, WorkflowSummary } from '../types';

interface DecisionCheck {
  stage: string;
  code: string;
  ok: boolean;
}

/** The claim's audit trail, newest last, with the time spent in each state. */
export function AuditTimeline({
  entries,
  workflow,
}: {
  entries: AuditEntry[];
  workflow: WorkflowSummary;
}) {
  const label = (state: string | null) =>
    state === null ? '∅' : (workflow.states.find((s) => s.name === state)?.label ?? state);
  let enteredAt: string | undefined;
  return (
    <ol className="relative ml-2 border-l border-slate-200">
      {entries.map((e) => {
        const moved = e.from_state !== e.to_state;
        const stay =
          moved && enteredAt ? Date.parse(e.occurred_at) - Date.parse(enteredAt) : undefined;
        if (moved) enteredAt = e.occurred_at;
        const checks = (e.decision_context.checks ?? []) as DecisionCheck[];
        return (
          <li key={e.entry_id} className="mb-4 ml-4">
            <span
              className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white ${moved ? 'bg-blue-600' : 'bg-slate-300'}`}
            />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-xs text-slate-400">#{e.claim_seq}</span>
              <span className="font-medium">{e.transition_id}</span>
              {moved ? (
                <span className="text-sm">
                  {label(e.from_state)} → <strong>{label(e.to_state)}</strong>
                </span>
              ) : (
                <span className="text-sm text-slate-500">in {label(e.to_state)}</span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {formatTime(e.occurred_at)} · {e.actor_user_id} ({e.actor_role})
              {stay !== undefined && ` · after ${formatDuration(stay)} in ${label(e.from_state)}`}
            </p>
            {e.reason && <p className="mt-0.5 text-sm">Reason: {e.reason}</p>}
            {e.notes && <p className="mt-0.5 text-sm text-slate-600">Notes: {e.notes}</p>}
            <details className="mt-1 text-xs text-slate-600">
              <summary className="cursor-pointer text-slate-400">
                {e.changes.length} change(s) · {checks.length} check(s) · hash {e.hash.slice(0, 12)}
                …
              </summary>
              <ul className="mt-1 font-mono">
                {e.changes.map((c) => (
                  <li key={`${c.op} ${c.path}`}>
                    {c.op} {c.path}
                    {'value' in c ? ` = ${JSON.stringify(c.value)}` : ''}
                  </li>
                ))}
              </ul>
              {checks.length > 0 && (
                <p className="mt-1">
                  Checks: {checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.code}`).join(' · ')}
                </p>
              )}
              <p className="mt-1">
                Config {e.config_hash.slice(0, 12)}… · prev {e.prev_hash.slice(0, 12)}…
              </p>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
