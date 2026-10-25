import type { TypeNode } from './context-types';
import { isNumeric, isStringy, isTemporal, scalar } from './context-types';

export interface Placeholder {
  raw: string;
  path: string;
  filters: string[];
}

const PLACEHOLDER_RE = /^\{([a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*)((?:\|[a-z_]+)*)\}$/;
// `{{` and `}}` are escaped braces; anything else in braces must be a placeholder.
const TOKEN_RE = /\{\{|\}\}|\{[^{}]*\}/g;

export interface TemplateIssue {
  raw: string;
  message: string;
}

export function parsePlaceholders(text: string): {
  placeholders: Placeholder[];
  issues: TemplateIssue[];
} {
  const placeholders: Placeholder[] = [];
  const issues: TemplateIssue[] = [];
  for (const match of text.matchAll(TOKEN_RE)) {
    const raw = match[0];
    if (raw === '{{' || raw === '}}') continue;
    const parsed = PLACEHOLDER_RE.exec(raw);
    if (!parsed) {
      issues.push({
        raw,
        message: `malformed placeholder ${raw} (expected {path} or {path|filter})`,
      });
      continue;
    }
    const filters = (parsed[2] ?? '').split('|').filter(Boolean);
    placeholders.push({ raw, path: parsed[1] as string, filters });
  }
  return { placeholders, issues };
}

interface FilterSpec {
  accepts: (t: TypeNode) => boolean;
  expects: string;
  result: TypeNode;
  apply: (value: unknown) => unknown;
}

export const FILTERS: Record<string, FilterSpec> = {
  money: {
    accepts: isNumeric,
    expects: 'money or integer',
    result: scalar('string'),
    apply: (v) => (typeof v === 'number' ? formatMoney(v) : v),
  },
  date: {
    accepts: isTemporal,
    expects: 'date or timestamp',
    result: scalar('string'),
    apply: (v) => (typeof v === 'string' ? formatDate(v) : v),
  },
  datetime: {
    accepts: isTemporal,
    expects: 'date or timestamp',
    result: scalar('string'),
    apply: (v) => (typeof v === 'string' ? formatDateTime(v) : v),
  },
  upper: {
    accepts: isStringy,
    expects: 'a string',
    result: scalar('string'),
    apply: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
  },
  lower: {
    accepts: isStringy,
    expects: 'a string',
    result: scalar('string'),
    apply: (v) => (typeof v === 'string' ? v.toLowerCase() : v),
  },
  mask: {
    accepts: isStringy,
    expects: 'a string',
    result: scalar('string'),
    apply: (v) => (typeof v === 'string' ? maskValue(v) : v),
  },
  count: {
    accepts: (t) => t.kind === 'list',
    expects: 'a list',
    result: scalar('integer'),
    apply: (v) => (Array.isArray(v) ? v.length : 0),
  },
  join: {
    accepts: (t) => t.kind === 'list',
    expects: 'a list',
    result: scalar('string'),
    apply: (v) => (Array.isArray(v) ? v.map(stringifyValue).join(', ') : v),
  },
};

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

export function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('en-US').format(value)} VND`;
}

function zonedParts(iso: string): Record<string, string> | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** `YYYY-MM-DD` in Vietnam time; date-only strings are returned unchanged. */
export function formatDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const p = zonedParts(value);
  return p ? `${p.year}-${p.month}-${p.day}` : value;
}

export function formatDateTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const p = zonedParts(value);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ICT` : value;
}

/** Keeps the first and last character: "Nguyen" → "N****n". */
export function maskValue(value: string): string {
  if (value.length <= 2) return '*'.repeat(value.length);
  return `${value[0]}${'*'.repeat(value.length - 2)}${value[value.length - 1]}`;
}

export function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return '(not set)';
  if (Array.isArray(value)) return value.map(stringifyValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Renders `{path|filter}` placeholders. `lookup` receives the dotted path. */
export function renderText(text: string, lookup: (path: string) => unknown): string {
  return text.replace(TOKEN_RE, (raw) => {
    if (raw === '{{') return '{';
    if (raw === '}}') return '}';
    const parsed = PLACEHOLDER_RE.exec(raw);
    if (!parsed) return raw;
    let value = lookup(parsed[1] as string);
    for (const name of (parsed[2] ?? '').split('|').filter(Boolean)) {
      const filter = FILTERS[name];
      if (filter && value !== undefined && value !== null) value = filter.apply(value);
    }
    return stringifyValue(value);
  });
}
