import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import type { Acting, ActResult, InputField, Policy, User, WorkflowSummary } from '../types';
import { DynamicForm, type FormValues, toInput } from './DynamicForm';
import { errorToast, type Notify } from './Toasts';

const NOTES: InputField = {
  name: 'notes',
  type: 'text',
  label: 'Notes (kept in the audit trail)',
  max_length: 2000,
};

interface Props {
  workflow: WorkflowSummary;
  acting: Acting;
  actingUser: User | undefined;
  users: User[];
  policies: Policy[];
  notify: Notify;
  onCreated: (claimNo: string) => void;
}

/** The creation transition's form, generated from its declared inputs. */
export function NewClaim({
  workflow,
  acting,
  actingUser,
  users,
  policies,
  notify,
  onCreated,
}: Props) {
  const { creation } = workflow;
  const fields = [...creation.inputs, NOTES];
  const [values, setValues] = useState<FormValues>({});
  const [key, setKey] = useState(() => crypto.randomUUID());
  const allowed = actingUser?.roles.some((r) => creation.roles.includes(r)) ?? false;

  const create = useMutation({
    mutationFn: () =>
      api<ActResult>('/claims', {
        method: 'POST',
        acting,
        body: { input: toInput(fields, values) },
        idempotencyKey: key,
      }),
    onSuccess: (result) => {
      notify({
        kind: 'success',
        title: `${result.claim.claim_no} submitted`,
        body: `State ${result.claim.state}`,
      });
      setValues({});
      setKey(crypto.randomUUID());
      onCreated(result.claim.claim_no);
    },
    onError: (error) => notify(errorToast(error, `${creation.id} refused`)),
  });

  return (
    <section className="max-w-xl rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">{creation.label}</h2>
      <p className="mb-3 text-xs text-slate-500">
        Transition <span className="font-mono">{creation.id}</span> · roles{' '}
        {creation.roles.join(', ')}
        {!allowed && ` · ${acting.userId} holds none of them, so the engine will refuse`}
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <DynamicForm
          fields={fields}
          values={values}
          onChange={setValues}
          users={users}
          policies={policies}
          idPrefix="new-claim"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {create.isPending ? 'Submitting…' : 'Submit claim'}
        </button>
      </form>
    </section>
  );
}
