import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, formatMoney } from '../api';
import type { Acting, ClaimRow, WorkflowSummary } from '../types';
import { CONTROL } from './DynamicForm';

interface Props {
  acting: Acting;
  workflow: WorkflowSummary | undefined;
  selected: string | null;
  onSelect: (claimNo: string) => void;
}

export function ClaimList({ acting, workflow, selected, onSelect }: Props) {
  const [state, setState] = useState('');
  const [queue, setQueue] = useState(false);
  const params = new URLSearchParams({
    ...(state ? { state } : {}),
    ...(queue ? { queue: '1' } : {}),
  });
  const claims = useQuery({
    queryKey: ['claims', state, queue, acting.userId, acting.role],
    queryFn: () => api<ClaimRow[]>(`/claims?${params}`, { acting }),
    refetchInterval: 5000,
  });

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex gap-2">
        <label htmlFor="state-filter" className="sr-only">
          Filter by state
        </label>
        <select
          id="state-filter"
          className={CONTROL}
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="">All states</option>
          {workflow?.states.map((s) => (
            <option key={s.name} value={s.name}>
              {s.label ?? s.name}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={queue} onChange={(e) => setQueue(e.target.checked)} />
        Only claims I can act on now
      </label>
      {claims.isError && <p className="text-sm text-red-700">{claims.error.message}</p>}
      <ul className="-mx-1 flex-1 space-y-1 overflow-y-auto px-1">
        {claims.data?.length === 0 && <li className="p-2 text-sm text-slate-500">No claims.</li>}
        {claims.data?.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.claim_no)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${selected === c.claim_no ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.claim_no}</span>
                <span className="text-xs text-slate-500">{c.state}</span>
              </span>
              <span className="block text-xs text-slate-500">
                {c.claim_type} · {formatMoney(c.claimed_amount)} · {c.member_id}
              </span>
              {c.can_run && (
                <span className="block text-xs text-emerald-700">
                  You can: {c.can_run.join(', ')}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
