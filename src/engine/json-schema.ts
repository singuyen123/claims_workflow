import { z } from 'zod';
import { workflowFileSchema } from './schema';

type JsonNode = Record<string, unknown>;

/** The `{ ref: rule }` shorthand has no `type`; the loader adds it, so the editor must accept it. */
function relaxRefShorthand(node: unknown) {
  if (Array.isArray(node)) {
    node.forEach(relaxRefShorthand);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as JsonNode;
  const props = obj.properties as JsonNode | undefined;
  const type = props?.type as JsonNode | undefined;
  if (type?.const === 'ref' && Array.isArray(obj.required)) {
    obj.required = (obj.required as string[]).filter((k) => k !== 'type');
  }
  for (const value of Object.values(obj)) relaxRefShorthand(value);
}

/** JSON Schema for workflow files, used by the YAML language server for autocomplete. */
export function workflowJsonSchema(): JsonNode {
  const schema = z.toJSONSchema(workflowFileSchema, {
    io: 'input',
    unrepresentable: 'any',
    cycles: 'ref',
  }) as JsonNode;
  relaxRefShorthand(schema);
  return {
    title: 'Claims workflow definition',
    description:
      'Generated from src/engine/schema.ts — run `npm run config:schema` after changing it.',
    ...schema,
  };
}
