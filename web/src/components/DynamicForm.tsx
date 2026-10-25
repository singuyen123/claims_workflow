import type { ReactNode } from 'react';
import { formatMoney } from '../api';
import type { InputField, Policy, User } from '../types';

export type FormValues = Record<string, string>;

export const CONTROL =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none';

interface Props {
  fields: InputField[];
  values: FormValues;
  onChange: (values: FormValues) => void;
  users: User[];
  policies: Policy[];
  idPrefix: string;
}

/**
 * A form generated from the inputs a transition declares in the workflow config, so a new input
 * (or a new transition) needs no UI change.
 */
export function DynamicForm({ fields, values, onChange, users, policies, idPrefix }: Props) {
  return (
    <div className="grid gap-3">
      {fields.map((field) => (
        <Field
          key={field.name}
          id={`${idPrefix}-${field.name}`}
          field={field}
          value={values[field.name] ?? ''}
          onChange={(value) => onChange({ ...values, [field.name]: value })}
          users={users}
          policies={policies}
        />
      ))}
    </div>
  );
}

interface FieldProps {
  id: string;
  field: InputField;
  value: string;
  onChange: (value: string) => void;
  users: User[];
  policies: Policy[];
}

function Field({ id, field, value, onChange, users, policies }: FieldProps) {
  const placeholderOption = <option value="">{field.required ? 'Choose…' : '(none)'}</option>;
  let control: ReactNode;
  switch (field.type) {
    case 'enum':
      control = (
        <select
          id={id}
          className={CONTROL}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {placeholderOption}
          {(field.values ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
      break;
    case 'user_ref':
      control = (
        <select
          id={id}
          className={CONTROL}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {placeholderOption}
          {users
            .filter((u) => !u.service_account && (!field.role || u.roles.includes(field.role)))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.id} — {u.display_name}
              </option>
            ))}
        </select>
      );
      break;
    case 'policy_ref':
      control = (
        <select
          id={id}
          className={CONTROL}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {placeholderOption}
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} — {p.product} ({p.member_id}, limit {formatMoney(p.coverage_limit)})
            </option>
          ))}
        </select>
      );
      break;
    case 'money':
    case 'integer':
      control = (
        <input
          id={id}
          className={CONTROL}
          type="number"
          inputMode="numeric"
          step={1}
          min={field.min}
          max={field.max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'date':
      control = (
        <input
          id={id}
          className={CONTROL}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'timestamp':
      control = (
        <input
          id={id}
          className={CONTROL}
          type="datetime-local"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'boolean':
      control = (
        <input
          id={id}
          type="checkbox"
          className="h-4 w-4"
          checked={value === 'true'}
          onChange={(e) => onChange(String(e.target.checked))}
        />
      );
      break;
    case 'text':
      control = (
        <textarea
          id={id}
          className={CONTROL}
          rows={3}
          maxLength={field.max_length}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    default:
      control = (
        <input
          id={id}
          className={CONTROL}
          type="text"
          maxLength={field.max_length}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {field.label ?? field.name}
        {field.required ? (
          <span className="text-red-600"> *</span>
        ) : (
          <span className="text-slate-400"> (optional)</span>
        )}
      </label>
      {control}
      {field.type === 'money' && /^\d+$/.test(value) && (
        <p className="mt-0.5 text-xs text-slate-500">{formatMoney(Number(value))}</p>
      )}
    </div>
  );
}

/** Values to send: empty fields are left out; datetime-local becomes an ISO timestamp. */
export function toInput(fields: InputField[], values: FormValues): Record<string, string> {
  const input: Record<string, string> = {};
  for (const field of fields) {
    const raw = values[field.name]?.trim() ?? '';
    if (raw === '') continue;
    input[field.name] = field.type === 'timestamp' ? new Date(raw).toISOString() : raw;
  }
  return input;
}
