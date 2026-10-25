// Demo scenarios. Unlike the engine, this file is allowed to name states, transitions and users
// of config/workflow.yaml: it is a script that drives that particular workflow.
import { DAY } from '../app/clock';
import type { ScenarioRun } from './harness';

export interface Scenario {
  id: number;
  title: string;
  /** Number of the scenario in requirement.md, for the five required ones. */
  spec?: number;
  goal: string;
  run(s: ScenarioRun): Promise<void>;
}

const MAX_INFO = 'Maximum information requests exceeded — escalate to team lead';

export const SCENARIOS: Scenario[] = [
  {
    id: 1,
    spec: 1,
    title: 'Happy path',
    goal: 'SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → APPROVED → PAYMENT_INITIATED → CLOSED, with notifications, a payment and a verifiable audit trail.',
    async run(s) {
      const c = await s.submit();
      await s.available(c, 'u_clerk_01');
      await s.toAssessment(c);
      await s.assess(c, 2_300_000);
      await s.act(c, 'approve', 'u_assessor_01', { notes: 'Within the outpatient benefit' });
      await s.pay(c);
      await s.expectPath(c, [
        'SUBMITTED',
        'DOCUMENTS_VERIFIED',
        'UNDER_ASSESSMENT',
        'APPROVED',
        'PAYMENT_INITIATED',
        'CLOSED',
      ]);
      const payments = await s.app.ops.payments((await s.claim(c)).id);
      s.check(
        'exactly one payment reached the gateway',
        payments.length === 1,
        `${payments.length} payment(s)`,
      );
      await s.verify(c);
    },
  },
  {
    id: 2,
    spec: 2,
    title: 'Rejection path',
    goal: 'SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → REJECTED → CLOSED. A reason is mandatory and reaches the member with appeal instructions; the system closes the claim when the member acknowledges it, or when the appeal window expires.',
    async run(s) {
      const c = await s.submit();
      await s.toAssessment(c);
      await s.assess(c);
      await s.act(
        c,
        'reject',
        'u_assessor_01',
        { reason_code: 'exclusion' },
        { expect: 'PRECONDITION_FAILED' },
      );
      await s.act(c, 'reject', 'u_assessor_01', {
        reason_code: 'exclusion',
        reason: 'Cosmetic dermatology is excluded by section 4.2 of the policy',
      });
      await s.act(c, 'acknowledge_rejection', 'u_member_01');
      await s.expectPath(c, [
        'SUBMITTED',
        'DOCUMENTS_VERIFIED',
        'UNDER_ASSESSMENT',
        'REJECTED',
        'CLOSED',
      ]);
      await s.verify(c);

      s.note('Second claim: the member never acknowledges, so the appeal window decides.');
      const c2 = await s.submit({ amount: 900_000 });
      await s.toAssessment(c2);
      await s.assess(c2);
      await s.act(c2, 'reject', 'u_assessor_01', {
        reason_code: 'waiting_period',
        reason: 'Treatment falls within the 30-day waiting period',
      });
      await s.system(c2);
      await s.expectState(c2, 'REJECTED');
      s.later(31 * DAY, '31 days later: the appeal window has expired.');
      await s.system();
      await s.expectState(c2, 'CLOSED');
      await s.verify(c2);
    },
  },
  {
    id: 3,
    spec: 3,
    title: 'Request-more-information loop',
    goal: 'SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → PENDING_INFO → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → APPROVED → PAYMENT_INITIATED → CLOSED. The loop needs new information, resets the assessment timer and is counted.',
    async run(s) {
      const c = await s.submit();
      await s.toAssessment(c);
      await s.act(c, 'request_info', 'u_assessor_01', {
        reason: 'Please send the blood test results',
      });
      await s.act(c, 'info_received', 'u_clerk_01', {}, { expect: 'PRECONDITION_FAILED' });
      await s.act(c, 'attach_document', 'u_member_01', {
        document_type: 'lab_result',
        file_name: 'blood-test.pdf',
      });
      await s.act(c, 'info_received', 'u_clerk_01');
      await s.act(c, 'start_assessment', 'u_lead_01');
      await s.assess(c, 2_500_000);
      await s.act(c, 'approve', 'u_assessor_01');
      await s.pay(c);
      await s.expectPath(c, [
        'SUBMITTED',
        'DOCUMENTS_VERIFIED',
        'UNDER_ASSESSMENT',
        'PENDING_INFO',
        'DOCUMENTS_VERIFIED',
        'UNDER_ASSESSMENT',
        'APPROVED',
        'PAYMENT_INITIATED',
        'CLOSED',
      ]);
      const claim = await s.claim(c);
      s.check(
        'the loop was counted once',
        claim.counters.info_requests === 1,
        JSON.stringify(claim.counters),
      );
      const timers = claim.data.timers as
        | { assessment_started_at?: string; assessment_reset_at?: string }
        | undefined;
      const { assessment_started_at: started = '', assessment_reset_at: reset = '' } = timers ?? {};
      s.check(
        'the assessment timer was reset and restarted',
        reset !== '' && started > reset,
        JSON.stringify(timers),
      );
      await s.verify(c);
    },
  },
  {
    id: 4,
    spec: 4,
    title: 'Invalid transition: SUBMITTED → APPROVED',
    goal: 'Approving a claim whose documents were never verified is refused with a specific error: the current state, what can be done now, and the path to APPROVED.',
    async run(s) {
      const c = await s.submit();
      await s.act(c, 'approve', 'u_assessor_01', {}, { expect: 'INVALID_TRANSITION' });
      const error = s.lastError();
      s.check(
        'the error names the current state',
        Boolean(error?.message.includes('is SUBMITTED')),
        error?.message,
      );
      s.check(
        'the error shows the way to APPROVED',
        Boolean(error?.message.includes('verify_documents → start_assessment → approve')),
      );
      await s.act(c, 'aprove', 'u_assessor_01', {}, { expect: 'UNKNOWN_TRANSITION' });
      await s.expectState(c, 'SUBMITTED');
    },
  },
  {
    id: 5,
    spec: 5,
    title: 'Unauthorized role',
    goal: 'A transition run by a role that is not authorized is refused, as is acting in a role the user does not hold or impersonating the system account.',
    async run(s) {
      const c = await s.submit();
      await s.attachRequired(c);
      await s.act(c, 'verify_documents', 'u_assessor_01', {}, { expect: 'UNAUTHORIZED_ROLE' });
      await s.act(
        c,
        'verify_documents',
        'u_assessor_01',
        {},
        { role: 'document_clerk', expect: 'ROLE_NOT_ASSIGNED' },
      );
      await s.act(c, 'verify_documents', 'svc_system', {}, { expect: 'SERVICE_ACCOUNT_ONLY' });
      await s.act(c, 'verify_documents', 'u_clerk_01');
      await s.expectState(c, 'DOCUMENTS_VERIFIED');
    },
  },
  {
    id: 6,
    title: 'Failed precondition, then fixed',
    goal: 'Verification is refused while required documents are missing (listing them); once the member uploads them it succeeds. Policy cover and limits are enforced too.',
    async run(s) {
      const c = await s.submit();
      await s.act(c, 'attach_document', 'u_member_01', {
        document_type: 'claim_form',
        file_name: 'form.pdf',
      });
      await s.act(c, 'verify_documents', 'u_clerk_01', {}, { expect: 'PRECONDITION_FAILED' });
      s.check(
        'the missing documents are listed',
        Boolean(s.lastError()?.message.includes('medical_invoice, prescription')),
        s.lastError()?.message,
      );
      await s.act(c, 'attach_document', 'u_member_01', {
        document_type: 'medical_invoice',
        file_name: 'invoice.pdf',
      });
      await s.act(c, 'attach_document', 'u_member_01', {
        document_type: 'prescription',
        file_name: 'rx.pdf',
      });
      await s.act(c, 'verify_documents', 'u_clerk_01');
      await s.act(c, 'start_assessment', 'u_lead_01', {}, { expect: 'PRECONDITION_FAILED' });

      s.note('Second claim on POL-002, whose coverage limit is 5,000,000 VND.');
      const c2 = await s.submit({ policy: 'POL-002', user: 'u_member_02', amount: 7_000_000 });
      await s.attachRequired(c2, 'u_member_02');
      await s.act(c2, 'verify_documents', 'u_clerk_01');
      await s.act(c2, 'assign_assessor', 'u_lead_01', { assessor_id: 'u_assessor_01' });
      await s.act(c2, 'start_assessment', 'u_lead_01');
      await s.assess(c2, 6_000_000);
      await s.act(c2, 'approve', 'u_assessor_01', {}, { expect: 'PRECONDITION_FAILED' });
      await s.assess(c2, 5_000_000);
      await s.act(c2, 'approve', 'u_assessor_01');
      await s.expectState(c2, 'APPROVED');
    },
  },
  {
    id: 7,
    title: 'Cycle limit',
    goal: 'The information loop runs three times; the fourth request is refused with exactly "Maximum information requests exceeded — escalate to team lead" and the claim stays in assessment.',
    async run(s) {
      const c = await s.submit();
      await s.toAssessment(c);
      for (let i = 1; i <= 3; i++) {
        await s.act(c, 'request_info', 'u_assessor_01', {
          reason: `Question ${i} about the treatment`,
        });
        await s.act(c, 'provide_info', 'u_member_01', { text: `Answer ${i}` });
        await s.act(c, 'info_received', 'u_clerk_01');
        await s.act(c, 'start_assessment', 'u_lead_01');
      }
      await s.available(c, 'u_assessor_01');
      await s.act(
        c,
        'request_info',
        'u_assessor_01',
        { reason: 'Question 4' },
        { expect: 'CYCLE_LIMIT_EXCEEDED' },
      );
      s.check(
        'the refusal carries the exact message',
        s.lastError()?.message === MAX_INFO,
        s.lastError()?.message,
      );
      const claim = await s.claim(c);
      s.check(
        'the counter stopped at 3/3',
        claim.counters.info_requests === 3,
        JSON.stringify(claim.counters),
      );
      await s.expectState(c, 'UNDER_ASSESSMENT');
    },
  },
  {
    id: 8,
    title: 'Only the assigned assessor decides',
    goal: "An assessor who holds the right role but is not assigned to the claim is refused (attribute-based check), and members cannot act on other members' claims.",
    async run(s) {
      const c = await s.submit();
      await s.toAssessment(c, 'u_assessor_01');
      await s.act(
        c,
        'submit_assessment',
        'u_assessor_02',
        { summary: 'Looks fine' },
        { expect: 'ACCESS_DENIED' },
      );
      await s.assess(c, 1_800_000, 'u_assessor_01');
      await s.act(c, 'approve', 'u_assessor_02', {}, { expect: 'ACCESS_DENIED' });
      await s.act(c, 'approve', 'u_assessor_01');
      const c2 = await s.submit();
      await s.act(
        c2,
        'attach_document',
        'u_member_02',
        { document_type: 'claim_form' },
        { expect: 'ACCESS_DENIED' },
      );
      await s.expectState(c, 'APPROVED');
    },
  },
  {
    id: 9,
    title: 'Segregation of duties and four-eyes approval',
    goal: 'Whoever verified documents cannot assess; whoever decided cannot pay; approvals above 50,000,000 VND need a team lead co-sign for the exact amount, and a new assessment invalidates an old co-sign.',
    async run(s) {
      const c = await s.submit({ type: 'inpatient', amount: 90_000_000 });
      await s.attachRequired(c);
      await s.act(c, 'verify_documents', 'u_dual_ca', {}, { role: 'document_clerk' });
      await s.act(
        c,
        'assign_assessor',
        'u_lead_01',
        { assessor_id: 'u_dual_ca' },
        { expect: 'PRECONDITION_FAILED' },
      );
      await s.act(c, 'assign_assessor', 'u_lead_01', { assessor_id: 'u_dual_af' });
      await s.act(c, 'start_assessment', 'u_lead_01');
      await s.assess(c, 80_000_000, 'u_dual_af');
      await s.act(
        c,
        'approve',
        'u_dual_af',
        {},
        { role: 'assessor', expect: 'PRECONDITION_FAILED' },
      );
      await s.act(c, 'cosign_approval', 'u_lead_01');
      await s.assess(c, 82_000_000, 'u_dual_af');
      await s.act(
        c,
        'approve',
        'u_dual_af',
        {},
        { role: 'assessor', expect: 'PRECONDITION_FAILED' },
      );
      await s.act(c, 'cosign_approval', 'u_lead_01');
      await s.act(c, 'approve', 'u_dual_af', {}, { role: 'assessor' });
      await s.act(
        c,
        'initiate_payment',
        'u_dual_af',
        {},
        { role: 'finance', expect: 'ACCESS_DENIED' },
      );
      await s.act(c, 'initiate_payment', 'u_finance_01');
      await s.expectState(c, 'PAYMENT_INITIATED');
      const claim = await s.claim(c);
      const payment = claim.data.payment_request as { amount?: number } | undefined;
      s.check(
        'the payment request is for the co-signed amount',
        payment?.amount === 82_000_000,
        JSON.stringify(payment),
      );
    },
  },
  {
    id: 10,
    title: 'Payment gateway failures, retries and idempotency',
    goal: 'The mock gateway fails twice; the outbox worker retries with backoff and the member is paid exactly once. Re-sending the same request with its idempotency key returns the first result without running anything again.',
    async run(s) {
      const c = await s.submit();
      await s.toAssessment(c);
      await s.assess(c, 1_500_000);
      await s.act(c, 'approve', 'u_assessor_01');
      await s.app.ops.failNextPayments(2);
      s.note('Fault injection: the next 2 calls to the mock payment gateway fail.');
      await s.act(c, 'initiate_payment', 'u_finance_01', {}, { key: `pay-${c}` });
      await s.act(c, 'initiate_payment', 'u_finance_01', {}, { key: `pay-${c}` });
      const id = (await s.claim(c)).id;
      const payments = await s.app.ops.payments(id);
      s.check(
        'exactly one payment despite two failures and a repeated request',
        payments.length === 1,
        `${payments.length}`,
      );
      const message = (await s.app.ops.outbox({ claimId: id })).find(
        (m) => m.effect_type === 'trigger_payment',
      );
      s.check(
        'the payment message succeeded on its third attempt',
        message?.attempts === 3 && message.status === 'DONE',
      );
      const { entries } = await s.service.audit(c);
      s.check(
        'the repeated request added no audit entry',
        entries.filter((e) => e.transition_id === 'initiate_payment').length === 1,
      );
      await s.act(c, 'confirm_payment', 'u_finance_01', {
        payment_reference: payments[0]?.gateway_ref ?? 'n/a',
      });
      await s.act(c, 'close_paid', 'u_finance_01');
      await s.expectState(c, 'CLOSED');
    },
  },
  {
    id: 11,
    title: 'Audit integrity of every claim',
    goal: 'For every claim created above: the hash chain is intact, replaying the recorded changes reproduces each snapshot, and the claim row equals the last audited snapshot. Refused attempts were kept out of the chain.',
    async run(s) {
      const claims = await s.service.listClaims({ limit: 1000 });
      for (const claim of [...claims].reverse()) await s.verify(claim.claim_no);
      const denied = await s.service.denied();
      s.check(
        'refused attempts were recorded separately',
        denied.length > 0,
        `${denied.length} refused attempt(s)`,
      );
    },
  },
  {
    id: 12,
    title: 'New state by config only: appeal (workflow v2)',
    goal: 'config/examples/workflow.appeal.yaml adds UNDER_APPEAL with two transitions and no code change. A claim rejected under v1 stays on v1 (no appeal possible); a claim created under v2 is appealed, re-assessed by a different assessor and paid.',
    async run(s) {
      const old = await s.submit();
      await s.toAssessment(old);
      await s.assess(old);
      await s.act(old, 'reject', 'u_assessor_01', {
        reason_code: 'not_covered',
        reason: 'Dental care is not covered',
      });
      const v1Hash = (await s.claim(old)).config_hash;

      await s.switchToExtension();
      await s.act(
        old,
        'file_appeal',
        'u_member_01',
        { reason: 'Please reconsider' },
        { expect: 'UNKNOWN_TRANSITION' },
      );
      s.check('the v1 claim stays pinned to v1', (await s.claim(old)).config_hash === v1Hash);

      const c = await s.submit();
      await s.toAssessment(c);
      await s.assess(c);
      await s.act(c, 'reject', 'u_assessor_01', {
        reason_code: 'not_medically_necessary',
        reason: 'The MRI was not medically necessary',
      });
      await s.act(c, 'file_appeal', 'u_member_01', {
        reason: 'My doctor ordered the MRI after two weeks of symptoms',
      });
      await s.act(c, 'assign_assessor', 'u_lead_01', { assessor_id: 'u_assessor_01' });
      await s.act(c, 'reopen_assessment', 'u_lead_01', {}, { expect: 'PRECONDITION_FAILED' });
      await s.act(c, 'assign_assessor', 'u_lead_01', { assessor_id: 'u_assessor_02' });
      await s.act(c, 'reopen_assessment', 'u_lead_01');
      await s.assess(c, 2_500_000, 'u_assessor_02');
      await s.act(c, 'approve', 'u_assessor_02');
      await s.pay(c);
      await s.expectPath(c, [
        'SUBMITTED',
        'DOCUMENTS_VERIFIED',
        'UNDER_ASSESSMENT',
        'REJECTED',
        'UNDER_APPEAL',
        'UNDER_ASSESSMENT',
        'APPROVED',
        'PAYMENT_INITIATED',
        'CLOSED',
      ]);
      const claim = await s.claim(c);
      s.check('the new claim is pinned to v2', claim.config_hash === s.service.workflow.hash);
      await s.verify(c);
    },
  },
];
