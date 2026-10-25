import {
  assignable,
  buildTypeEnv,
  CORE_CLAIM_FIELDS,
  contextType,
  describeType,
  equatable,
  fieldType,
  isNumeric,
  isStringy,
  isTemporal,
  type ObjectType,
  RESERVED_ENUMS,
  refType,
  scalar,
  type TypeEnv,
  type TypeNode,
  typeAtPath,
} from './context-types';
import { isIsoDuration, toDate } from './duration';
import {
  buildEdges,
  describeCycle,
  findUnboundedCycle,
  reachableFrom,
  statesReaching,
} from './graph';
import {
  type Condition,
  type Effect,
  type FieldDef,
  isFnCall,
  type Operand,
  type TransitionDef,
  type ValueExpr,
  type WorkflowDefinition,
} from './schema';
import { didYouMean } from './suggest';
import { FILTERS, parsePlaceholders } from './templates';

export interface ConfigIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
}

/** Extra placeholders a condition's `message` may use, besides context paths. */
const CONDITION_LOCALS: Partial<Record<Condition['type'], readonly string[]>> = {
  compare: ['left', 'right'],
  documents_present: ['missing'],
  duration_elapsed: ['deadline'],
  received_since_state_entry: ['since'],
  not_performed: ['user'],
  has_role: ['user'],
};

const ORDERING_OPS = new Set(['lt', 'lte', 'gt', 'gte']);

type OperandInfo = { kind: 'type'; type: TypeNode } | { kind: 'literal'; value: Operand };

export function validateDefinition(def: WorkflowDefinition): ValidationResult {
  return new Validator(def).run();
}

class Validator {
  private readonly errors: ConfigIssue[] = [];
  private readonly warnings: ConfigIssue[] = [];
  private readonly env: TypeEnv;
  private readonly transitionIds: Set<string>;
  private readonly usedTemplates = new Set<string>();
  private readonly usedRules = new Set<string>();
  private readonly seen = new Set<string>();
  /** Errors inside a named rule, reported once with every transition that uses the rule. */
  private readonly ruleErrors = new Map<string, { issue: ConfigIssue; via: string[] }>();

  constructor(private readonly def: WorkflowDefinition) {
    this.env = buildTypeEnv(def);
    this.transitionIds = new Set(def.transitions.map((t) => t.id));
  }

  run(): ValidationResult {
    this.checkEnums();
    this.checkSettings();
    this.checkDocumentRequirements();
    this.checkFields();
    this.checkStates();
    this.checkTemplateRecipients();
    if (this.checkTransitions()) this.checkGraph();
    for (const t of this.def.transitions) this.checkTransitionBody(t);
    this.checkUnused();
    return { errors: this.errors, warnings: this.warnings };
  }

  private error(path: string, message: string) {
    const arrow = path.lastIndexOf(' → ');
    if (arrow > 0) {
      const via = path.slice(0, arrow);
      const rulePath = path.slice(arrow + 3);
      const key = `${rulePath}\u0000${message}`;
      const known = this.ruleErrors.get(key);
      if (known) {
        if (!known.via.includes(via)) known.via.push(via);
      } else {
        const issue = { path: rulePath, message };
        this.ruleErrors.set(key, { issue, via: [via] });
        this.errors.push(issue);
      }
      const entry = this.ruleErrors.get(key) as { issue: ConfigIssue; via: string[] };
      entry.issue.path = `${rulePath} (used by ${entry.via.join(', ')})`;
      return;
    }
    const key = `${path}\u0000${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.errors.push({ path, message });
  }

  private warn(path: string, message: string) {
    this.warnings.push({ path, message });
  }

  // ── top-level sections ─────────────────────────────────────────────────────────────────────

  private checkEnums() {
    for (const name of RESERVED_ENUMS) {
      if (name in this.def.enums) {
        const source =
          name === 'claim_type' ? 'the keys of document_requirements' : `the ${name}s section`;
        this.error(`enums.${name}`, `'${name}' is reserved: it is derived from ${source}`);
      }
    }
    for (const [name, values] of Object.entries(this.def.enums)) {
      const dupes = values.filter((v, i) => values.indexOf(v) !== i);
      if (dupes.length)
        this.error(`enums.${name}`, `duplicate values: ${[...new Set(dupes)].join(', ')}`);
    }
  }

  private checkSettings() {
    for (const [name, s] of Object.entries(this.def.settings)) {
      const path = `settings.${name}.value`;
      const v = s.value;
      const ok =
        (s.type === 'duration' && isIsoDuration(v)) ||
        (s.type === 'money' && Number.isInteger(v) && (v as number) >= 0) ||
        (s.type === 'integer' && Number.isInteger(v)) ||
        (s.type === 'string' && typeof v === 'string') ||
        (s.type === 'boolean' && typeof v === 'boolean');
      if (!ok) this.error(path, `${JSON.stringify(v)} is not a valid ${s.type}`);
    }
  }

  private checkDocumentRequirements() {
    const claimTypes = Object.keys(this.def.document_requirements);
    if (claimTypes.length === 0) {
      this.error(
        'document_requirements',
        'declare at least one claim type (its keys form the claim_type enum)',
      );
      return;
    }
    const docTypes = this.def.enums.document_type;
    if (!docTypes) {
      this.error('enums.document_type', 'required: document_requirements lists document types');
      return;
    }
    for (const [claimType, docs] of Object.entries(this.def.document_requirements)) {
      for (const doc of docs) {
        if (!docTypes.includes(doc)) {
          this.error(
            `document_requirements.${claimType}`,
            `unknown document type '${doc}'.${didYouMean(doc, docTypes)}`,
          );
        }
      }
    }
  }

  private checkFields() {
    for (const [name, field] of Object.entries(this.def.fields)) {
      if ((CORE_CLAIM_FIELDS as readonly string[]).includes(name)) {
        this.error(`fields.${name}`, `'${name}' is a claim column managed by the engine`);
      }
      this.checkFieldDef(field, `fields.${name}`);
    }
    const assessor = this.def.fields.assessor_id;
    if (assessor && assessor.type !== 'user_ref') {
      this.error(
        'fields.assessor_id',
        'must be user_ref: the database indexes it as the generated column claims.assessor_id',
      );
    }
  }

  private checkFieldDef(field: FieldDef, path: string) {
    if (field.type === 'enum' && !this.env.enums[field.enum]) {
      this.error(
        `${path}.enum`,
        `unknown enum '${field.enum}'.${didYouMean(field.enum, Object.keys(this.env.enums))}`,
      );
    } else if (field.type === 'object') {
      for (const [k, f] of Object.entries(field.fields))
        this.checkFieldDef(f, `${path}.fields.${k}`);
    } else if (field.type === 'list') {
      this.checkFieldDef(field.of, `${path}.of`);
    }
  }

  private checkStates() {
    const { initial_state } = this.def.workflow;
    if (!(initial_state in this.def.states)) {
      this.error(
        'workflow.initial_state',
        `unknown state '${initial_state}'.${didYouMean(initial_state, this.env.states)}`,
      );
    }
    if (!Object.values(this.def.states).some((s) => s.terminal)) {
      this.error('states', 'at least one state must be terminal');
    }
  }

  private checkTemplateRecipients() {
    for (const [name, tpl] of Object.entries(this.def.templates)) {
      if (tpl.to.startsWith('role:')) {
        const role = tpl.to.slice(5);
        if (!(role in this.def.roles)) {
          this.error(
            `templates.${name}.to`,
            `unknown role '${role}'.${didYouMean(role, this.env.roles)}`,
          );
        }
      }
    }
  }

  // ── transitions: structure ─────────────────────────────────────────────────────────────────

  /** Returns false when the structure is too broken for graph checks to be meaningful. */
  private checkTransitions(): boolean {
    let ok = true;
    const { states, roles, counters } = this.def;
    const initial = this.def.workflow.initial_state;

    const creations = this.def.transitions.filter((t) => t.from.length === 0);
    if (creations.length !== 1) {
      ok = false;
      this.error(
        'transitions',
        creations.length === 0
          ? 'exactly one transition without `from` (the claim-creation transition) is required'
          : `only one creation transition (without \`from\`) is allowed, found: ${creations.map((t) => t.id).join(', ')}`,
      );
    }

    const ids = new Set<string>();
    this.def.transitions.forEach((t, index) => {
      const p = `transitions.${t.id}`;
      if (ids.has(t.id)) {
        ok = false;
        this.error(`transitions[${index}].id`, `duplicate transition id '${t.id}'`);
      }
      ids.add(t.id);

      for (const from of t.from) {
        if (!(from in states)) {
          ok = false;
          this.error(`${p}.from`, `unknown state '${from}'.${didYouMean(from, this.env.states)}`);
        } else if (states[from]?.terminal) {
          this.error(`${p}.from`, `'${from}' is terminal and cannot have outgoing transitions`);
        }
      }
      if (t.to && !(t.to in states)) {
        ok = false;
        this.error(`${p}.to`, `unknown state '${t.to}'.${didYouMean(t.to, this.env.states)}`);
      }

      if (t.from.length === 0) this.checkCreation(t, initial);

      for (const role of t.roles) {
        if (!(role in roles)) {
          this.error(`${p}.roles`, `unknown role '${role}'.${didYouMean(role, this.env.roles)}`);
        }
      }
      const serviceRoles = t.roles.filter((r) => roles[r]?.service_account_only);
      if (t.automatic) {
        if (!t.to || t.from.length === 0) {
          this.error(`${p}.automatic`, 'only state-changing transitions can be automatic');
        }
        if (serviceRoles.length === 0) {
          this.error(
            `${p}.roles`,
            'automatic transitions run as the system service account: include a role with service_account_only: true',
          );
        }
        for (const [name, input] of Object.entries(t.inputs)) {
          if (input.required) {
            this.error(`${p}.inputs.${name}`, 'automatic transitions cannot have required inputs');
          }
        }
      } else if (serviceRoles.length === t.roles.length) {
        this.warn(
          `${p}.roles`,
          'only service accounts can run this transition, but it is not automatic',
        );
      }

      for (const counter of t.increments) {
        if (!(counter in counters)) {
          this.error(
            `${p}.increments`,
            `unknown counter '${counter}'.${didYouMean(counter, this.env.counters)}`,
          );
        }
      }

      for (const [name, input] of Object.entries(t.inputs)) {
        const ip = `${p}.inputs.${name}`;
        if (input.type === 'enum') {
          if (!input.enum) this.error(`${ip}.enum`, 'required for type enum');
          else if (!this.env.enums[input.enum]) {
            this.error(
              `${ip}.enum`,
              `unknown enum '${input.enum}'.${didYouMean(input.enum, Object.keys(this.env.enums))}`,
            );
          }
        } else if (input.enum) {
          this.error(`${ip}.enum`, 'only valid for type enum');
        }
        if (input.role) {
          if (input.type !== 'user_ref') this.error(`${ip}.role`, 'only valid for type user_ref');
          else if (!(input.role in roles)) {
            this.error(
              `${ip}.role`,
              `unknown role '${input.role}'.${didYouMean(input.role, this.env.roles)}`,
            );
          }
        }
        if (
          (input.min !== undefined || input.max !== undefined) &&
          !['money', 'integer'].includes(input.type)
        ) {
          this.error(ip, '`min`/`max` are only valid for money and integer inputs');
        }
        if (input.max_length !== undefined && !['text', 'string'].includes(input.type)) {
          this.error(ip, '`max_length` is only valid for text and string inputs');
        }
        if (name === 'notes' && input.type !== 'text') {
          this.error(ip, '`notes` is reserved for free-text notes and must be type text');
        }
      }
    });
    return ok;
  }

  private checkCreation(t: TransitionDef, initial: string) {
    const p = `transitions.${t.id}`;
    if (!t.to) this.error(`${p}.to`, 'the creation transition must declare `to`');
    else if (t.to !== initial) {
      this.error(`${p}.to`, `the creation transition must lead to initial_state ${initial}`);
    }
    if (t.automatic) this.error(`${p}.automatic`, 'the creation transition cannot be automatic');
    const required: Record<string, (i: TransitionDef['inputs'][string]) => boolean> = {
      policy_id: (i) => i.type === 'policy_ref',
      claim_type: (i) => i.type === 'enum' && i.enum === 'claim_type',
      claimed_amount: (i) => i.type === 'money',
    };
    const expected: Record<string, string> = {
      policy_id: 'policy_ref',
      claim_type: 'enum claim_type',
      claimed_amount: 'money',
    };
    for (const [name, matches] of Object.entries(required)) {
      const input = t.inputs[name];
      if (!input || !matches(input) || !input.required) {
        this.error(
          `${p}.inputs.${name}`,
          `the creation transition must declare a required input '${name}' of type ${expected[name]}`,
        );
      }
    }
  }

  private checkGraph() {
    const counters = new Set(Object.keys(this.def.counters));
    const edges = buildEdges(this.def.transitions, counters);
    const initial = this.def.workflow.initial_state;
    const reachable = reachableFrom(initial, edges);
    const terminal = Object.entries(this.def.states)
      .filter(([, s]) => s.terminal)
      .map(([name]) => name);
    const canFinish = statesReaching(terminal, edges);
    for (const [name, state] of Object.entries(this.def.states)) {
      if (!reachable.has(name)) {
        this.error(`states.${name}`, `not reachable from the initial state ${initial}`);
      } else if (!state.terminal && !canFinish.has(name)) {
        this.error(`states.${name}`, 'cannot reach a terminal state (dead end)');
      }
    }
    const cycle = findUnboundedCycle(edges);
    if (cycle) {
      this.error(
        'transitions',
        `unbounded cycle ${describeCycle(cycle)}: add \`increments: [<counter>]\` to at least one of these transitions`,
      );
    }
  }

  // ── transitions: typed bodies ──────────────────────────────────────────────────────────────

  private checkTransitionBody(t: TransitionDef) {
    const p = `transitions.${t.id}`;
    const isCreate = t.from.length === 0;
    const conditionCtx = contextType(this.env, t, { claim: !isCreate, uuid: false });
    const effectCtx = contextType(this.env, t, { claim: true, uuid: true });
    const textCtx = contextType(this.env, t, { claim: true, uuid: false });
    t.authorization.forEach((c, i) => {
      this.checkCondition(c, conditionCtx, `${p}.authorization[${i}]`, [], isCreate);
    });
    t.preconditions.forEach((c, i) => {
      this.checkCondition(c, conditionCtx, `${p}.preconditions[${i}]`, [], isCreate);
    });
    t.effects.forEach((e, i) => {
      this.checkEffect(e, effectCtx, textCtx, `${p}.effects[${i}]`);
    });
  }

  private checkCondition(
    c: Condition,
    ctx: ObjectType,
    path: string,
    ruleStack: string[],
    isCreate: boolean,
  ) {
    switch (c.type) {
      case 'field_present':
        this.checkRef(c.path, ctx, `${path}.path`);
        break;
      case 'compare':
        this.checkCompare(c, ctx, path);
        break;
      case 'documents_present':
        if (isCreate) this.error(path, 'documents_present cannot be used before the claim exists');
        else this.checkDocumentsField(path);
        break;
      case 'received_since_state_entry':
        if (isCreate) {
          this.error(path, 'received_since_state_entry cannot be used before the claim exists');
          break;
        }
        c.paths.forEach((ref, i) => {
          const t = this.checkRef(ref, ctx, `${path}.paths[${i}]`);
          if (t && !isReceivedList(t)) {
            this.error(
              `${path}.paths[${i}]`,
              `${ref} must be a list of objects with a received_at timestamp`,
            );
          }
        });
        break;
      case 'duration_elapsed': {
        const since = this.checkRef(c.since, ctx, `${path}.since`);
        if (since && !isTemporal(since)) {
          this.error(
            `${path}.since`,
            `${c.since} is ${describeType(since)}, expected a date or timestamp`,
          );
        }
        if (c.duration.startsWith('$')) {
          const d = this.checkRef(c.duration, ctx, `${path}.duration`);
          if (d && !(d.kind === 'scalar' && d.type === 'duration')) {
            this.error(
              `${path}.duration`,
              `${c.duration} is ${describeType(d)}, expected a duration`,
            );
          }
        }
        break;
      }
      case 'has_role': {
        const user = this.checkRef(c.user, ctx, `${path}.user`);
        if (user && !isStringy(user)) {
          this.error(`${path}.user`, `${c.user} is ${describeType(user)}, expected a user id`);
        }
        if (!(c.role in this.def.roles)) {
          this.error(
            `${path}.role`,
            `unknown role '${c.role}'.${didYouMean(c.role, this.env.roles)}`,
          );
        }
        break;
      }
      case 'not_performed':
        if (isCreate) {
          this.error(path, 'not_performed cannot be used before the claim exists');
          break;
        }
        if (c.user) {
          const user = this.checkRef(c.user, ctx, `${path}.user`);
          if (user && !isStringy(user)) {
            this.error(`${path}.user`, `${c.user} is ${describeType(user)}, expected a user id`);
          }
        }
        for (const action of c.actions) {
          if (!this.transitionIds.has(action)) {
            this.error(
              `${path}.actions`,
              `unknown transition '${action}'.${didYouMean(action, this.transitionIds)}`,
            );
          }
        }
        break;
      case 'all_of':
      case 'any_of':
        c.conditions.forEach((child, i) => {
          this.checkCondition(child, ctx, `${path}.conditions[${i}]`, ruleStack, isCreate);
        });
        break;
      case 'not':
        this.checkCondition(c.condition, ctx, `${path}.condition`, ruleStack, isCreate);
        break;
      case 'ref': {
        this.usedRules.add(c.ref);
        const rule = this.def.rules[c.ref];
        if (!rule) {
          this.error(
            `${path}.ref`,
            `unknown rule '${c.ref}'.${didYouMean(c.ref, Object.keys(this.def.rules))}`,
          );
          break;
        }
        if (ruleStack.includes(c.ref)) {
          this.error(
            `${path}.ref`,
            `rule '${c.ref}' refers to itself: ${[...ruleStack, c.ref].join(' → ')}`,
          );
          break;
        }
        this.checkCondition(rule, ctx, `${path} → rules.${c.ref}`, [...ruleStack, c.ref], isCreate);
        break;
      }
    }
    if (c.message)
      this.checkText(c.message, ctx, `${path}.message`, CONDITION_LOCALS[c.type] ?? []);
  }

  private checkDocumentsField(path: string) {
    const docs = this.def.fields.documents;
    const ok =
      docs?.type === 'list' &&
      docs.of.type === 'object' &&
      docs.of.fields.type?.type === 'enum' &&
      docs.of.fields.type.enum === 'document_type' &&
      docs.of.fields.received_at?.type === 'timestamp';
    if (!ok) {
      this.error(
        path,
        'documents_present needs fields.documents: list of { type: enum document_type, received_at: timestamp }',
      );
    }
  }

  private checkCompare(c: Extract<Condition, { type: 'compare' }>, ctx: ObjectType, path: string) {
    const left = this.operand(c.left, ctx, `${path}.left`);
    const right = this.operand(c.right, ctx, `${path}.right`);
    if (!left || !right) return;

    if (c.op === 'in') {
      if (right.kind === 'literal') {
        if (!Array.isArray(right.value)) {
          this.error(`${path}.right`, "op 'in' needs a list on the right");
        } else if (left.kind === 'type') {
          for (const v of right.value) {
            const problem = literalProblem(left.type, v, false);
            if (problem) this.error(`${path}.right`, problem);
          }
        }
      } else if (right.type.kind !== 'list') {
        this.error(
          `${path}.right`,
          `${String(c.right)} is ${describeType(right.type)}; op 'in' needs a list`,
        );
      } else if (left.kind === 'type' && !equatable(left.type, right.type.of)) {
        this.error(
          path,
          `cannot look up ${describeType(left.type)} in ${describeType(right.type)}`,
        );
      } else if (left.kind === 'literal') {
        const problem = literalProblem(right.type.of, left.value, false);
        if (problem) this.error(`${path}.left`, problem);
      }
      return;
    }

    const ordering = ORDERING_OPS.has(c.op);
    if (left.kind === 'literal' && right.kind === 'literal') {
      this.warn(path, 'compares two literals');
      return;
    }
    if (left.kind === 'type' && right.kind === 'type') {
      const l = left.type;
      const r = right.type;
      if (ordering && !((isNumeric(l) && isNumeric(r)) || (isTemporal(l) && isTemporal(r)))) {
        this.error(
          path,
          `cannot order ${describeType(l)} (${String(c.left)}) and ${describeType(r)} (${String(c.right)}): '${c.op}' needs two numbers or two dates`,
        );
      } else if (!ordering && !equatable(l, r)) {
        this.error(
          path,
          `cannot compare ${describeType(l)} (${String(c.left)}) with ${describeType(r)} (${String(c.right)})`,
        );
      }
      return;
    }
    const [typed, literal, side] =
      left.kind === 'type'
        ? [left.type, right as Extract<OperandInfo, { kind: 'literal' }>, 'right']
        : [(right as Extract<OperandInfo, { kind: 'type' }>).type, left, 'left'];
    const problem = literalProblem(typed, literal.value, ordering);
    if (problem) this.error(`${path}.${side}`, problem);
  }

  private operand(op: Operand, ctx: ObjectType, path: string): OperandInfo | undefined {
    if (typeof op === 'string' && op.startsWith('$$'))
      return { kind: 'literal', value: op.slice(1) };
    if (typeof op === 'string' && op.startsWith('$')) {
      const type = this.checkRef(op, ctx, path);
      return type ? { kind: 'type', type } : undefined;
    }
    return { kind: 'literal', value: op };
  }

  private checkRef(ref: string, ctx: ObjectType, path: string): TypeNode | undefined {
    const [root, name] = ref.slice(1).split('.');
    if (root === 'uuid' && !ctx.fields.uuid) {
      this.error(path, '$uuid can only be used in effect values');
      return undefined;
    }
    if (root === 'claim' && !ctx.fields.claim) {
      this.error(path, `${ref}: the claim does not exist yet in the creation transition`);
      return undefined;
    }
    const input = ctx.fields.input;
    if (root === 'input' && name && input?.kind === 'object' && !input.fields[name]) {
      const hint = didYouMean(name, Object.keys(input.fields));
      this.error(
        path,
        `${ref}: input '${name}' is not declared in this transition's inputs.${hint}`,
      );
      return undefined;
    }
    const result = refType(ctx, ref);
    if (!result.ok) {
      this.error(path, result.error);
      return undefined;
    }
    return result.type;
  }

  private checkEffect(e: Effect, ctx: ObjectType, textCtx: ObjectType, path: string) {
    switch (e.type) {
      case 'set':
      case 'append':
      case 'clear': {
        const target = this.targetType(e.path, `${path}.path`);
        if (!target || e.type === 'clear') return;
        if (e.type === 'append') {
          if (target.kind !== 'list') {
            this.error(`${path}.path`, `${e.path} is ${describeType(target)}; append needs a list`);
            return;
          }
          this.checkValue(e.value, target.of, ctx, `${path}.value`);
        } else {
          this.checkValue(e.value, target, ctx, `${path}.value`);
        }
        return;
      }
      case 'notify': {
        this.usedTemplates.add(e.template);
        const tpl = this.def.templates[e.template];
        if (!tpl) {
          const hint = didYouMean(e.template, Object.keys(this.def.templates));
          this.error(`${path}.template`, `unknown template '${e.template}'.${hint}`);
          return;
        }
        const tp = `templates.${e.template}`;
        const usedBy = ` (used by ${path})`;
        if (tpl.to.startsWith('user:')) {
          const ref = tpl.to.slice(5);
          const t = this.checkRef(ref, textCtx, `${tp}.to${usedBy}`);
          if (t && !isStringy(t))
            this.error(`${tp}.to${usedBy}`, `${ref} is ${describeType(t)}, expected a user id`);
        }
        if (tpl.subject) this.checkText(tpl.subject, textCtx, `${tp}.subject${usedBy}`, []);
        this.checkText(tpl.body, textCtx, `${tp}.body${usedBy}`, []);
        return;
      }
      case 'trigger_payment': {
        const amount = this.checkRef(e.amount, ctx, `${path}.amount`);
        if (amount && !isNumeric(amount)) {
          this.error(`${path}.amount`, `${e.amount} is ${describeType(amount)}, expected money`);
        }
        const reference = this.checkRef(e.reference, ctx, `${path}.reference`);
        if (reference && !isStringy(reference)) {
          this.error(
            `${path}.reference`,
            `${e.reference} is ${describeType(reference)}, expected an id`,
          );
        }
        return;
      }
      case 'log':
        this.checkText(e.message, textCtx, `${path}.message`, []);
        return;
    }
  }

  /** Type of a writable `claim.<field>…` target; engine-managed columns are not writable. */
  private targetType(target: string, path: string): TypeNode | undefined {
    const segments = target.split('.').slice(1);
    const first = segments[0] as string;
    if ((CORE_CLAIM_FIELDS as readonly string[]).includes(first)) {
      this.error(path, `claim.${first} is managed by the engine and cannot be written by effects`);
      return undefined;
    }
    if (!this.def.fields[first]) {
      const hint = didYouMean(first, Object.keys(this.def.fields));
      this.error(
        path,
        `${target}: unknown claim field '${first}' (declare it under fields).${hint}`,
      );
      return undefined;
    }
    const root: TypeNode = {
      kind: 'object',
      fields: Object.fromEntries(
        Object.entries(this.def.fields).map(([k, f]) => [k, fieldType(f, this.env)]),
      ),
    };
    const result = typeAtPath(root, segments);
    if (!result.ok) {
      this.error(path, `${target}: ${result.error}`);
      return undefined;
    }
    return result.type;
  }

  private checkValue(expr: ValueExpr, target: TypeNode, ctx: ObjectType, path: string) {
    if (expr === null) return;
    if (typeof expr === 'string' && expr.startsWith('$') && !expr.startsWith('$$')) {
      const t = this.checkRef(expr, ctx, path);
      if (t && !assignable(t, target)) {
        this.error(
          path,
          `cannot store ${describeType(t)} (${expr}) in a field of type ${describeType(target)}`,
        );
      }
      return;
    }
    if (typeof expr === 'string' || typeof expr === 'number' || typeof expr === 'boolean') {
      const value = typeof expr === 'string' && expr.startsWith('$$') ? expr.slice(1) : expr;
      const problem =
        target.kind === 'object' || target.kind === 'list'
          ? `a literal cannot be stored in a field of type ${describeType(target)}`
          : literalProblem(target, value, false);
      if (problem) this.error(path, problem);
      return;
    }
    if (Array.isArray(expr)) {
      if (target.kind !== 'list') {
        this.error(path, `a list cannot be stored in a field of type ${describeType(target)}`);
        return;
      }
      expr.forEach((v, i) => {
        this.checkValue(v, target.of, ctx, `${path}[${i}]`);
      });
      return;
    }
    if (isFnCall(expr)) {
      const [start, duration] = expr.args;
      const s = this.valueType(start as ValueExpr, ctx, `${path}.args[0]`);
      const d = this.valueType(duration as ValueExpr, ctx, `${path}.args[1]`);
      if (s && !isTemporal(s))
        this.error(`${path}.args[0]`, 'add: the first argument must be a date or timestamp');
      if (d && !(d.kind === 'scalar' && d.type === 'duration')) {
        this.error(`${path}.args[1]`, 'add: the second argument must be a duration');
      }
      if (!assignable(scalar('timestamp'), target)) {
        this.error(
          path,
          `add returns a timestamp, which cannot be stored in ${describeType(target)}`,
        );
      }
      return;
    }
    if (target.kind !== 'object') {
      this.error(path, `an object cannot be stored in a field of type ${describeType(target)}`);
      return;
    }
    for (const [key, value] of Object.entries(expr)) {
      const fieldT = target.fields[key];
      if (!fieldT) {
        this.error(
          `${path}.${key}`,
          `unknown field '${key}'.${didYouMean(key, Object.keys(target.fields))}`,
        );
        continue;
      }
      this.checkValue(value, fieldT, ctx, `${path}.${key}`);
    }
  }

  private valueType(expr: ValueExpr, ctx: ObjectType, path: string): TypeNode | undefined {
    if (typeof expr === 'string' && expr.startsWith('$') && !expr.startsWith('$$')) {
      return this.checkRef(expr, ctx, path);
    }
    if (typeof expr === 'string') {
      if (isIsoDuration(expr)) return scalar('duration');
      if (toDate(expr)) return scalar('timestamp');
      return scalar('string');
    }
    if (typeof expr === 'number') return scalar('integer');
    if (typeof expr === 'boolean') return scalar('boolean');
    this.error(path, 'expected a reference or a literal');
    return undefined;
  }

  private checkText(text: string, ctx: ObjectType, path: string, locals: readonly string[]) {
    const { placeholders, issues } = parsePlaceholders(text);
    for (const issue of issues) this.error(path, issue.message);
    for (const ph of placeholders) {
      const segments = ph.path.split('.');
      let type: TypeNode | undefined;
      if (segments.length === 1 && locals.includes(segments[0] as string)) {
        type = undefined;
      } else {
        const result = typeAtPath(ctx, segments);
        if (!result.ok) {
          this.error(path, `{${ph.path}}: ${result.error}`);
          continue;
        }
        type = result.type;
      }
      for (const name of ph.filters) {
        const filter = FILTERS[name];
        if (!filter) {
          this.error(
            path,
            `unknown filter '${name}' in ${ph.raw}.${didYouMean(name, Object.keys(FILTERS))}`,
          );
          break;
        }
        if (type && !filter.accepts(type)) {
          this.error(
            path,
            `filter '${name}' expects ${filter.expects}, but {${ph.path}} is ${describeType(type)}`,
          );
          break;
        }
        type = filter.result;
      }
    }
  }

  private checkUnused() {
    for (const name of Object.keys(this.def.templates)) {
      if (!this.usedTemplates.has(name))
        this.warn(`templates.${name}`, 'not used by any notify effect');
    }
    for (const name of Object.keys(this.def.rules)) {
      if (!this.usedRules.has(name)) this.warn(`rules.${name}`, 'not used by any transition');
    }
    const incremented = new Set(this.def.transitions.flatMap((t) => t.increments));
    for (const name of Object.keys(this.def.counters)) {
      if (!incremented.has(name))
        this.warn(`counters.${name}`, 'not incremented by any transition');
    }
  }
}

function isReceivedList(t: TypeNode): boolean {
  return (
    t.kind === 'list' &&
    t.of.kind === 'object' &&
    !!t.of.fields.received_at &&
    isTemporal(t.of.fields.received_at)
  );
}

/** Why `value` cannot be compared with / stored as `type`, or undefined when it can. */
function literalProblem(type: TypeNode, value: Operand, ordering: boolean): string | undefined {
  if (value === null) return ordering ? 'null cannot be ordered' : undefined;
  if (Array.isArray(value)) return "a list literal is only valid with op 'in'";
  if (typeof value === 'number') {
    if (!isNumeric(type))
      return `${value} is a number, but the other side is ${describeType(type)}`;
    return Number.isInteger(value) ? undefined : `${value} is not an integer (money is whole VND)`;
  }
  if (typeof value === 'boolean') {
    return type.kind === 'scalar' && type.type === 'boolean'
      ? undefined
      : `${value} is a boolean, but the other side is ${describeType(type)}`;
  }
  if (isTemporal(type))
    return toDate(value) ? undefined : `'${value}' is not a valid date or timestamp`;
  if (ordering) return `ordering needs numbers or dates, got the string '${value}'`;
  if (type.kind === 'enum') {
    return type.values.includes(value)
      ? undefined
      : `'${value}' is not a value of enum ${type.name}.${didYouMean(value, type.values)}`;
  }
  if (type.kind === 'scalar' && type.type === 'duration') {
    return isIsoDuration(value) ? undefined : `'${value}' is not an ISO-8601 duration`;
  }
  if (isStringy(type)) return undefined;
  return `cannot use the string '${value}' with ${describeType(type)}`;
}
