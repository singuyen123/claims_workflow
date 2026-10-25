import { createHash, createHmac } from 'node:crypto';
import canonicalize from 'canonicalize';

/** RFC 8785 (JCS) canonical JSON: stable key order, so equal values always hash the same. */
export function canonicalJson(value: unknown): string {
  const text = canonicalize(value);
  if (text === undefined) throw new Error('Value cannot be canonicalised to JSON');
  return text;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hmacSha256Hex(key: string, text: string): string {
  return createHmac('sha256', key).update(text, 'utf8').digest('hex');
}

export function hashValue(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
