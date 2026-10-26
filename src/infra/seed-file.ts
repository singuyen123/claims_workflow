import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';
import type { Policy, User } from '../domain/types';

const seedSchema = z.strictObject({
  users: z.array(
    z.strictObject({
      id: z.string().min(1),
      display_name: z.string().min(1),
      roles: z.array(z.string()).min(1),
      member_id: z.string().nullable().default(null),
      service_account: z.boolean().default(false),
    }),
  ),
  policies: z.array(
    z.strictObject({
      id: z.string().min(1),
      member_id: z.string().min(1),
      product: z.string().min(1),
      coverage_limit: z.number().int().positive(),
      currency: z.literal('VND').default('VND'),
      effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
});

export interface SeedData {
  users: User[];
  policies: Policy[];
}

export function loadSeed(path = 'config/seed.yaml'): SeedData {
  return seedSchema.parse(parse(readFileSync(path, 'utf8')));
}
