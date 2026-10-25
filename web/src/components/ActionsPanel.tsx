import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import type { Acting, ActResult, AvailableTransition, ClaimSnapshot, Policy, User } from '../types';
import { CONTROL, DynamicForm, type FormValues, toInput } from './DynamicForm';
import { errorToast, type Notify } from './Toasts';

interface Props {
  claim: ClaimSnapshot;
  available: AvailableTransition[];
  acting: Acting;
  users: User[];
  policies: Policy[];
  notify: Notify;
  onDone: () => void;
}

interface Run {
  transition: string;
  input: Record<string, string>;
  key: string;
  role?: string;
}

export function ActionsPanel({ claim, available, acting, users, policies, notify, onDone }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>({});
  // One key per opened form: a retried submit (e.g. after a timeout) cannot run twice.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [manual, setManual] = useState('');

  const run = useMutation({
    mutationFn: (r: Run) =>
      api<ActResult>(`/claims/${claim.claim_no}/transitions/${encodeURIComponent(r.transition)}`, {
        method: 'POST',
        acting: { userId: acting.userId, ...(r.role ? { role: r.role } : {}) },
        body: { input: r.input, expected_version: claim.version },
        idempotencyKey: r.key,
      }),
    onSuccess: (result, r) => {
      const e = result.entry;
      const moved =
        e.from_state === e.to_state ? `still ${e.to_state}` : `${e.from_state} → ${e.to_state}`;
      const auto = result.automatic.map(
        (a) => `then ${a.entry.transition_id} (system) → ${a.entry.to_state}`,
      );
      notify({
        kind: 'success',
        title: `${r.transition}: ${moved}`,
        body: [result.replayed ? 'Replayed: this request had already run.' : '', ...auto]
          .filter(Boolean)
          .join(' '),
      });
      setOpen(null);
      setValues({});
      setKey(crypto.randomUUID());
      onDone();
    },
    onError: (error, r) => {
      notify(errorToast(error, `${r.transition} refused`));
      onDone();
    },
  });

  const toggle = (id: string) => {
    setOpen(open === id ? null : id);
    setValues({});
    setKey(crypto.randomUUID());
  };

  const manualActions = available.filter((t) => !t.automatic);
  const automatic = available.filter((t) => t.automatic);

  if (available.length === 0) {
    return (
      <p className="text-sm text-slate-500">No transitions: the claim is in a terminal state.</p>
    );
  }

  return (
    <div className="space-y-2">
      {manualActions.map((t) => {
        const failing = t.checks.filter((c) => !c.ok);
        const required = t.inputs.filter((i) => i.required).map((i) => i.label ?? i.name);
        const isOpen = open === t.id;
        return (
          <div
            key={t.id}
            className={`rounded-lg border p-3 ${t.allowed ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {t.label}{' '}
                  <span className="font-mono text-xs text-slate-500">
                    {t.id} {t.to ? `→ ${t.to}` : '(same state)'}
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  Roles: {t.roles.join(', ')}
                  {t.allowed && ` · you act as ${t.acting_role}`}
                  {required.length > 0 && ` · needs ${required.join(', ')}`}
                </p>
                {failing.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-red-800">
                    {failing.map((c) => (
                      <li key={`${c.stage}:${c.code}`}>
                        ✗ <span className="font-mono">{c.code}</span> {c.message}
                      </li>
                    ))}
                  </ul>
                )}
                {t.checks
                  .filter((c) => c.ok && c.stage === 'counter')
                  .map((c) => (
                    <p key={c.code} className="text-xs text-slate-500">
                      {c.message}
                    </p>
                  ))}
              </div>
              <button
                type="button"
                onClick={() => toggle(t.id)}
                className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${
                  t.allowed
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
                title={t.allowed ? undefined : 'Not available now: try it to see the refusal'}
              >
                {isOpen ? 'Cancel' : t.allowed ? 'Run…' : 'Try anyway…'}
              </button>
            </div>
            {isOpen && (
              <form
                className="mt-3 space-y-3 border-t border-slate-200 pt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  run.mutate({
                    transition: t.id,
                    input: toInput(t.inputs, values),
                    key,
                    role: t.acting_role,
                  });
                }}
              >
                <DynamicForm
                  fields={t.inputs}
                  values={values}
                  onChange={setValues}
                  users={users}
                  policies={policies}
                  idPrefix={`${claim.claim_no}-${t.id}`}
                />
                <button
                  type="submit"
                  disabled={run.isPending}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {run.isPending ? 'Running…' : `Run ${t.id}`}
                </button>
              </form>
            )}
          </div>
        );
      })}
      {automatic.map((t) => (
        <div
          key={t.id}
          className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600"
        >
          <span className="font-medium">{t.label}</span>{' '}
          <span className="font-mono text-xs">
            {t.id} → {t.to}
          </span>{' '}
          runs automatically (system) once its conditions hold
          {t.checks.some((c) => !c.ok) && `: ${t.checks.find((c) => !c.ok)?.message}`}
        </div>
      ))}
      <details className="rounded-lg border border-slate-200 p-3 text-sm">
        <summary className="cursor-pointer text-slate-600">Advanced: run any transition id</summary>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (manual.trim())
              run.mutate({ transition: manual.trim(), input: {}, key: crypto.randomUUID() });
          }}
        >
          <label htmlFor={`${claim.claim_no}-manual`} className="sr-only">
            Transition id
          </label>
          <input
            id={`${claim.claim_no}-manual`}
            className={CONTROL}
            placeholder="e.g. approve"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
          >
            Try
          </button>
        </form>
        <p className="mt-1 text-xs text-slate-500">
          The engine explains every refusal, e.g. approving a claim that is still SUBMITTED.
        </p>
      </details>
    </div>
  );
}
