import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';
import { ClaimDetail } from './components/ClaimDetail';
import { ClaimList } from './components/ClaimList';
import { NewClaim } from './components/NewClaim';
import { StateDiagram } from './components/StateDiagram';
import { errorToast, Toasts, useToasts } from './components/Toasts';
import { UserSwitcher } from './components/UserSwitcher';
import type { Acting, ActResult, Policy, User, WorkflowSummary } from './types';

const STORAGE_KEY = 'claims-workflow.acting';

function loadActing(): Acting {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && typeof saved.userId === 'string') return saved;
  } catch {
    // storage unavailable: fall back to the default user
  }
  return { userId: 'u_member_01' };
}

/** `#/claims/CLM-…` selects a claim, `#/new` opens the submission form. */
function useRoute(): [string, (route: string) => void] {
  const [route, setRoute] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return [route, (next) => (window.location.hash = next)];
}

export function App() {
  const queryClient = useQueryClient();
  const { toasts, notify, dismiss } = useToasts();
  const [acting, setActingState] = useState<Acting>(loadActing);
  const [route, navigate] = useRoute();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const policies = useQuery({
    queryKey: ['policies', acting.userId],
    queryFn: () => api<Policy[]>('/policies', { acting }),
  });
  const workflow = useQuery({
    queryKey: ['workflow'],
    queryFn: () => api<WorkflowSummary>('/workflow'),
  });

  const setActing = (next: Acting) => {
    setActingState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // not persisted; the choice still applies to this tab
    }
  };

  const runScheduler = async () => {
    try {
      const { results, failures } = await api<{
        results: ActResult[];
        failures: Array<{ claim_no: string; message: string }>;
      }>('/system/run', { method: 'POST', acting });
      const lines = [
        ...results.map(
          (r) => `${r.claim.claim_no}: ${r.entry.transition_id} → ${r.entry.to_state}`,
        ),
        ...failures.map((f) => `${f.claim_no}: not checked (${f.message})`),
      ];
      notify({
        kind: failures.length ? 'error' : 'info',
        title: 'Scheduler pass',
        body: lines.length ? lines.join('\n') : 'No automatic transition is due.',
      });
      queryClient.invalidateQueries();
    } catch (error) {
      notify(errorToast(error, 'Scheduler failed'));
    }
  };

  const claimNo = route.startsWith('/claims/')
    ? decodeURIComponent(route.slice('/claims/'.length))
    : null;
  const apiDown = users.isError || workflow.isError;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 px-4 py-2.5 text-white">
        <div className="flex items-baseline gap-3">
          <button type="button" onClick={() => navigate('')} className="font-semibold">
            Claims workflow
          </button>
          {workflow.data && (
            <span className="text-xs text-slate-400">
              {workflow.data.label} · v{workflow.data.version} ·{' '}
              {workflow.data.config_hash.slice(0, 12)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runScheduler}
            className="rounded-md border border-slate-600 px-2.5 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            title="Fire time-based automatic transitions, e.g. closing a rejected claim after the appeal window"
          >
            Run scheduler
          </button>
          {users.data && <UserSwitcher users={users.data} acting={acting} onChange={setActing} />}
        </div>
      </header>

      {apiDown && (
        <p className="bg-red-100 px-4 py-2 text-sm text-red-900">
          Cannot reach the API. Start it with <code>npm run api</code> (or <code>npm run dev</code>
          ).
        </p>
      )}

      <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-3 lg:h-[calc(100vh-5rem)]">
          <button
            type="button"
            onClick={() => navigate('/new')}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + New claim
          </button>
          <ClaimList
            acting={acting}
            workflow={workflow.data}
            selected={claimNo}
            onSelect={(no) => navigate(`/claims/${encodeURIComponent(no)}`)}
          />
        </aside>
        <div className="min-w-0">
          {route === '/new' && workflow.data && (
            <NewClaim
              workflow={workflow.data}
              acting={acting}
              actingUser={users.data?.find((u) => u.id === acting.userId)}
              users={users.data ?? []}
              policies={policies.data ?? []}
              notify={notify}
              onCreated={(no) => {
                queryClient.invalidateQueries({ queryKey: ['claims'] });
                navigate(`/claims/${encodeURIComponent(no)}`);
              }}
            />
          )}
          {claimNo && (
            <ClaimDetail
              key={claimNo}
              claimNo={claimNo}
              acting={acting}
              users={users.data ?? []}
              policies={policies.data ?? []}
              notify={notify}
            />
          )}
          {!claimNo && route !== '/new' && workflow.data && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-1 font-semibold">{workflow.data.label}</h2>
              <p className="mb-3 text-sm text-slate-600">
                Pick a claim on the left or submit a new one. Switch users at the top right to see
                how the available actions change with each role.
              </p>
              <StateDiagram text={workflow.data.diagram} />
            </section>
          )}
        </div>
      </main>
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
