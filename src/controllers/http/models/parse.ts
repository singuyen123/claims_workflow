import { type ClassConstructor, plainToInstance } from 'class-transformer';
import { getMetadataStorage, validateSync } from 'class-validator';
import { HttpProblem } from '../problem';

export interface ParseOptions {
  /**
   * Named in the error detail: "Invalid request body: …". A body is validated as sent and keys
   * its model does not declare are refused. Headers, query and path go through class-transformer,
   * which reads only the `@Expose`d keys (renaming and converting them) and ignores the rest.
   */
  part: 'body' | 'query' | 'path' | 'headers';
  status?: number;
  code?: string;
}

/** Converts one part of a request into its model and validates it; throws a problem if invalid. */
export function parseModel<T extends object>(
  model: ClassConstructor<T>,
  plain: unknown,
  { part, status = 400, code = 'BAD_REQUEST' }: ParseOptions,
): T {
  const fail = (issues: string[]) =>
    new HttpProblem(status, code, `Invalid request ${part}: ${issues.join('; ')}`);
  if (typeof plain !== 'object' || plain === null || Array.isArray(plain)) {
    throw fail(['expected a JSON object']);
  }
  const body = part === 'body';
  if (body) {
    // forbidNonWhitelisted alone lets through keys that name inherited methods
    // (`hasOwnProperty`, `isPrototypeOf`, …), so a body may only use the keys its model validates.
    const declared = new Set(
      getMetadataStorage()
        .getTargetValidationMetadatas(model, '', true, false)
        .map((m) => m.propertyName),
    );
    const unknown = Object.keys(plain).filter((key) => !declared.has(key));
    if (unknown.length > 0) throw fail(unknown.map((key) => `property ${key} should not exist`));
  }
  // class-transformer would rebuild the nested JSON of a body and lose keys such as `constructor`
  // or `toString`. Fastify refuses `__proto__` keys, so assigning cannot change the prototype.
  const instance = body
    ? Object.assign(new model(), plain)
    : plainToInstance(model, plain, { excludeExtraneousValues: true, exposeDefaultValues: true });
  const errors = validateSync(instance, { whitelist: true, forbidNonWhitelisted: body });
  if (errors.length > 0) {
    throw fail([...new Set(errors.flatMap((e) => Object.values(e.constraints ?? {})))]);
  }
  return instance;
}
