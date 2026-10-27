import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

interface Import {
  /** Importing file, relative to src/. */
  file: string;
  specifier: string;
  /** Imported module relative to src/, for relative imports. */
  target: string | null;
}

const toPosix = (path: string) => path.replaceAll('\\', '/');

function allImports(): Import[] {
  const found: Import[] = [];
  for (const file of readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts')) continue;
    const path = join(SRC, file);
    for (const m of readFileSync(path, 'utf8').matchAll(/(?:from|import)\s+'([^']+)'/g)) {
      const specifier = m[1] as string;
      const target = specifier.startsWith('.')
        ? toPosix(relative(SRC, resolve(dirname(path), specifier)))
        : null;
      found.push({ file: toPosix(file), specifier, target });
    }
  }
  return found;
}

const imports = allImports();

function violations(layer: RegExp, forbidden: (i: Import) => boolean): string[] {
  return imports
    .filter((i) => layer.test(i.file) && forbidden(i))
    .map((i) => `${i.file} → ${i.specifier}`);
}

const targets = (re: RegExp) => (i: Import) => i.target !== null && re.test(i.target);

describe('layering', () => {
  it('finds the imports it checks', () => {
    expect(imports.some((i) => i.file.startsWith('controllers/'))).toBe(true);
    expect(imports.some((i) => i.file.startsWith('services/'))).toBe(true);
  });

  it('controllers call services, never repositories or the database', () => {
    expect(
      violations(
        /^controllers\//,
        (i) => i.specifier === 'pg' || targets(/^(repositories|infra\/db)\//)(i),
      ),
    ).toEqual([]);
  });

  it('services reach data only through repository interfaces', () => {
    expect(
      violations(
        /^services\//,
        (i) =>
          i.specifier === 'pg' || targets(/^(infra\/db|repositories\/postgres|controllers)\//)(i),
      ),
    ).toEqual([]);
  });

  it('repository interfaces know nothing about PostgreSQL or their callers', () => {
    expect(
      violations(
        /^repositories\/[^/]+$/,
        (i) =>
          i.specifier === 'pg' || targets(/^(repositories\/postgres|services|controllers)\//)(i),
      ),
    ).toEqual([]);
  });

  it('repository implementations do not call back into services or controllers', () => {
    expect(violations(/^repositories\/postgres\//, targets(/^(services|controllers)\//))).toEqual(
      [],
    );
  });

  it('only the PostgreSQL repositories, migrations and the composition root use TypeORM', () => {
    expect(
      violations(
        /^(?!repositories\/postgres\/|infra\/db\/|bootstrap\.ts$)/,
        (i) => i.specifier === 'typeorm' || i.specifier.startsWith('typeorm/'),
      ),
    ).toEqual([]);
  });

  it('only the HTTP controller validates requests with class models', () => {
    expect(
      violations(
        /^(?!controllers\/http\/)/,
        (i) => i.specifier === 'class-validator' || i.specifier === 'class-transformer',
      ),
    ).toEqual([]);
  });

  it('the engine only depends on itself and the domain types', () => {
    expect(violations(/^engine\//, targets(/^(?!engine\/|domain\/)/))).toEqual([]);
  });
});
