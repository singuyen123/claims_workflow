import type { Acting, User } from '../types';
import { CONTROL } from './DynamicForm';

interface Props {
  users: User[];
  acting: Acting;
  onChange: (acting: Acting) => void;
}

/** Simulated login: every request carries the chosen user (and role) in headers. */
export function UserSwitcher({ users, acting, onChange }: Props) {
  const user = users.find((u) => u.id === acting.userId);
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="acting-user" className="text-sm whitespace-nowrap text-slate-300">
        Acting as
      </label>
      <select
        id="acting-user"
        className={`${CONTROL} w-64 text-slate-900`}
        value={acting.userId}
        onChange={(e) => onChange({ userId: e.target.value })}
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.id} — {u.roles.join(', ')}
          </option>
        ))}
      </select>
      {user && user.roles.length > 1 && (
        <>
          <label htmlFor="acting-role" className="sr-only">
            Role
          </label>
          <select
            id="acting-role"
            className={`${CONTROL} w-40 text-slate-900`}
            value={acting.role ?? ''}
            onChange={(e) =>
              onChange({
                userId: acting.userId,
                ...(e.target.value ? { role: e.target.value } : {}),
              })
            }
          >
            <option value="">any of my roles</option>
            {user.roles.map((r) => (
              <option key={r} value={r}>
                as {r}
              </option>
            ))}
          </select>
        </>
      )}
      <span className="hidden rounded bg-amber-400/20 px-1.5 py-0.5 text-xs text-amber-200 lg:inline">
        demo login
      </span>
    </div>
  );
}
