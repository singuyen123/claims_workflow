import { writeFileSync } from 'node:fs';
import { workflowJsonSchema } from '../src/engine/json-schema';

const target = 'config/workflow.schema.json';
writeFileSync(target, `${JSON.stringify(workflowJsonSchema(), null, 2)}\n`);
console.log(`wrote ${target}`);
