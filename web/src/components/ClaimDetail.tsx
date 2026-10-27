import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, formatMoney, formatTime } from '../api';
import type {
  Acting,
  AuditEntry,
  DeniedAttempt,
  ClaimDetail as Detail,
  MockNotification,
  OutboxMessage,
  Policy,
  User,
  VerifyReport,
} from '../types';
import { ActionsPanel } from './ActionsPanel';
import { AuditTimeline } from './AuditTimeline';
import { StateDiagram } from './StateDiagram';
import { errorToast, type Notify } from './Toasts';

type Tab = 'audit' | 'denied' | 'notifications' | 'outbox';

interface Props {
  claimNo: string;
  acting: Acting;
  users: User[];
  policies: Policy[];
  notify: Notify;
}

export function ClaimDetail({ claimNo, acting, users, policies, notify }: Props) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('audit');
  const detail = useQuery({
    queryKey: ['claim', claimNo, acting.userId, acting.role],
    queryFn: () => api<Detail>(`/claims/${claimNo}`, { acting }),
  });
  const audit = useQuery({
    queryKey: ['audit', claimNo, acting.userId],
    queryFn: () => api<AuditEntry[]>(`/claims/${claimNo}/audit`, { acting }),
  });

  const refresh = () => {
    for (const key of ['claim', 'audit', 'claims', 'denied', 'notifications', 'outbox']) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const verify = async () => {
    try {
      const report = await api<VerifyReport>(`/claims/${claimNo}/verify`, { acting });
      notify(
        report.ok
          ? {
              kind: 'success',
              title: `${claimNo}: integrity verified`,
              body: `${report.entries} audit entries: hash chain intact, every change replays to its snapshot, the claim row matches the last entry.`,
            }
          : {
              kind: 'error',
              title: `${claimNo}: integrity check failed`,
              body: report.issues.map((i) => `${i.code}: ${i.message}`).join('\n'),
            },
      );
    } catch (error) {
      notify(errorToast(error, 'Verify failed'));
    }
  };

  if (detail.isPending) return <p className="p-6 text-slate-500">Loading {claimNo}…</p>;
  if (detail.isError) return <p className="p-6 text-red-700">{detail.error.message}</p>;
  const { claim, policy, workflow, available = [] } = detail.data;
  const data = claim.data as Record<string, unknown>;
  const state = workflow.states.find((s) => s.name === claim.state);
  const required = workflow.document_requirements[claim.claim_type] ?? [];
  const received = new Set(
    (Array.isArray(data.documents) ? (data.documents as Array<{ type?: string }>) : []).map(
      (d) => d.type,
    ),
  );
  const assessment = data.assessment as { approved_amount?: number } | undefined;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              {claim.claim_no}{' '}
              <span
                className={`ml-1 rounded-full px-2.5 py-0.5 align-middle text-sm font-medium ${state?.terminal ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-800'}`}
              >
                {state?.label ?? claim.state}
              </span>
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {claim.claim_type} · claimed {formatMoney(claim.claimed_amount)}
              {assessment?.approved_amount !== undefined &&
                ` · assessed ${formatMoney(assessment.approved_amount)}`}{' '}
              · policy {claim.policy_id}
              {policy && ` (limit ${formatMoney(policy.coverage_limit)})`} · member{' '}
              {claim.member_id}
              {typeof data.assessor_id === 'string' && ` · assessor ${data.assessor_id}`}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              In {claim.state} since {formatTime(claim.state_entered_at)} · version {claim.version}{' '}
              · workflow {workflow.id} v{workflow.version} ({workflow.config_hash.slice(0, 12)})
              {workflow.counters.map((c) => ` · ${c.name} ${claim.counters[c.name] ?? 0}/${c.max}`)}
            </p>
          </div>
          <button
            type="button"
            onClick={verify}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Verify integrity
          </button>
        </div>
        {required.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <span className="text-slate-500">Required documents:</span>
            {required.map((doc) => (
              <span
                key={doc}
                className={`rounded px-1.5 py-0.5 ${received.has(doc) ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}
              >
                {received.has(doc) ? '✓' : '✗'} {doc}
              </span>
            ))}
          </p>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            State machine (pinned definition)
          </h3>
          <StateDiagram text={detail.data.diagram} />
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            What {acting.userId} can do now
            {detail.data.acting && (
              <span className="font-normal text-slate-500">
                {' '}
                ({detail.data.acting.roles.join(', ')})
              </span>
            )}
          </h3>
          <ActionsPanel
            claim={claim}
            available={available}
            acting={acting}
            users={users}
            policies={policies}
            notify={notify}
            onDone={refresh}
          />
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex gap-1 border-b border-slate-200" role="tablist">
          {(
            [
              ['audit', `Audit trail (${audit.data?.length ?? '…'})`],
              ['denied', 'Refused attempts'],
              ['notifications', 'Notifications'],
              ['outbox', 'Outbox'],
            ] as Array<[Tab, string]>
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === id ? 'border-blue-600 font-medium text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {text}
            </button>
          ))}
        </div>
        {tab === 'audit' && audit.data && (
          <AuditTimeline entries={audit.data} workflow={workflow} />
        )}
        {tab === 'denied' && <DeniedList claimNo={claimNo} acting={acting} />}
        {tab === 'notifications' && <NotificationList claimNo={claimNo} acting={acting} />}
        {tab === 'outbox' && <OutboxList claimNo={claimNo} acting={acting} />}
      </section>
    </div>
  );
}

interface ListProps {
  claimNo: string;
  acting: Acting;
}

/** Policyholders may not see operator data: the API refuses, the tab says why. */
function Refused({ error }: { error: Error }) {
  return <p className="text-sm text-slate-500">{error.message}</p>;
}

function DeniedList({ claimNo, acting }: ListProps) {
  const denied = useQuery({
    queryKey: ['denied', claimNo, acting.userId],
    queryFn: () => api<DeniedAttempt[]>(`/claims/${claimNo}/denied`, { acting }),
  });
  if (denied.isError) return <Refused error={denied.error} />;
  if (!denied.data?.length) return <p className="text-sm text-slate-500">No refused attempts.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-slate-500">
        <tr>
          <th className="py-1 pr-3">When</th>
          <th className="pr-3">Who</th>
          <th className="pr-3">Transition</th>
          <th>Refusal</th>
        </tr>
      </thead>
      <tbody>
        {denied.data.map((d) => (
          <tr key={d.id} className="border-t border-slate-100 align-top">
            <td className="py-1.5 pr-3 whitespace-nowrap">{formatTime(d.occurred_at)}</td>
            <td className="pr-3">
              {d.actor_user_id}
              {d.actor_role && <span className="text-slate-500"> ({d.actor_role})</span>}
            </td>
            <td className="pr-3 font-mono text-xs">{d.transition_id}</td>
            <td>
              <span className="font-mono text-xs text-red-700">{d.error_code}</span> {d.message}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NotificationList({ claimNo, acting }: ListProps) {
  const list = useQuery({
    queryKey: ['notifications', claimNo, acting.userId],
    queryFn: () => api<MockNotification[]>(`/claims/${claimNo}/notifications`, { acting }),
    refetchInterval: 2000,
  });
  if (list.isError) return <Refused error={list.error} />;
  if (!list.data?.length) {
    return (
      <p className="text-sm text-slate-500">
        Nothing sent yet (the outbox worker delivers notifications).
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {list.data.map((n) => (
        <li key={n.idempotency_key} className="rounded-md border border-slate-200 p-2 text-sm">
          <p className="text-xs text-slate-500">
            {formatTime(n.sent_at)} · {n.template} · {n.channel} to {String(n.recipient.kind ?? '')}
            {n.recipient.role ? ` ${String(n.recipient.role)}` : ''}
            {n.recipient.user_id ? ` ${String(n.recipient.user_id)}` : ''}
          </p>
          {n.subject && <p className="font-medium">{n.subject}</p>}
          <p className="text-slate-700">{n.body}</p>
        </li>
      ))}
    </ul>
  );
}

function OutboxList({ claimNo, acting }: ListProps) {
  const list = useQuery({
    queryKey: ['outbox', claimNo, acting.userId],
    queryFn: () => api<OutboxMessage[]>(`/claims/${claimNo}/outbox`, { acting }),
    refetchInterval: 2000,
  });
  if (list.isError) return <Refused error={list.error} />;
  if (!list.data?.length) return <p className="text-sm text-slate-500">No side effects queued.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-slate-500">
        <tr>
          <th className="py-1 pr-3">#</th>
          <th className="pr-3">Effect</th>
          <th className="pr-3">Status</th>
          <th className="pr-3">Attempts</th>
          <th>Result / last error</th>
        </tr>
      </thead>
      <tbody>
        {list.data.map((m) => (
          <tr key={m.id} className="border-t border-slate-100 align-top">
            <td className="py-1.5 pr-3">{m.id}</td>
            <td className="pr-3">
              {m.effect_type}
              {typeof m.payload.template === 'string' && (
                <span className="text-slate-500"> {m.payload.template}</span>
              )}
            </td>
            <td
              className={`pr-3 font-medium ${m.status === 'DONE' ? 'text-emerald-700' : m.status === 'DEAD' ? 'text-red-700' : 'text-amber-700'}`}
            >
              {m.status}
            </td>
            <td className="pr-3">
              {m.attempts}/{m.max_attempts}
            </td>
            <td className="font-mono text-xs break-all">
              {m.last_error ?? (m.result ? JSON.stringify(m.result) : '')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
