import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/infra/db/migrations/index';

const DIR = fileURLToPath(new URL('../../src/infra/db/migrations/', import.meta.url));
const FILE_RE = /^(\d{13})-(\w+)\.ts$/;

const files = readdirSync(DIR).filter((f) => FILE_RE.test(f));
const checksums: Record<string, string> = JSON.parse(readFileSync(`${DIR}checksums.json`, 'utf8'));
const sha256 = (file: string) =>
  createHash('sha256')
    .update(readFileSync(`${DIR}${file}`, 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex');

describe('migrations', () => {
  it('are append-only: an applied migration file never changes', () => {
    for (const file of files) {
      expect(
        checksums[file],
        `${file} is new: add its checksum to checksums.json, or it was edited after being applied: revert it and add a new migration`,
      ).toBe(sha256(file));
    }
    expect(Object.keys(checksums).sort()).toEqual([...files].sort());
  });

  it('are all registered, oldest first, under the name their file gives', () => {
    const names = files.sort().map((f) => {
      const [, timestamp, name] = FILE_RE.exec(f) as RegExpExecArray;
      return `${name}${timestamp}`;
    });
    expect(MIGRATIONS.map((m) => m.name)).toEqual(names);
  });
});
