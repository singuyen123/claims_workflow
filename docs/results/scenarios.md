# Scenario results

Produced by `npm run scenarios -- --write`. Each scenario drives the real `ClaimService` on PostgreSQL in one process; after every step the outbox worker delivers the queued side effects (lines starting with ↳). The clock is simulated — it starts at 2026-10-20 10:00 ICT and moves one minute per action — so the output is reproducible.

- Base workflow: `config/workflow.yaml` — `health_claim_reimbursement` v1, config hash `2e402add27af98d8cfc8c12ea5d795d3f0a481afa0c9f6bd58174303c7b04fc0`
- Extension used by scenario 12: `config/examples/workflow.appeal.yaml` — v2, config hash `391ce068c8d682436597f15280d5914ff74b1d1e8d149c115b57e0d673a4993a`
- Full audit trails: [audit-trails.md](audit-trails.md) and [audit-trails.json](audit-trails.json). Refused attempts: [denied-attempts.md](denied-attempts.md).

| # | Scenario | In requirement.md | Result | Claims (final state) |
|---|---|---|---|---|
| 1 | [Happy path](#1-happy-path) | scenario 1 | ✅ PASS | CLM-2026-000001 (CLOSED) |
| 2 | [Rejection path](#2-rejection-path) | scenario 2 | ✅ PASS | CLM-2026-000002 (CLOSED), CLM-2026-000003 (CLOSED) |
| 3 | [Request-more-information loop](#3-request-more-information-loop) | scenario 3 | ✅ PASS | CLM-2026-000004 (CLOSED) |
| 4 | [Invalid transition: SUBMITTED → APPROVED](#4-invalid-transition-submitted--approved) | scenario 4 | ✅ PASS | CLM-2026-000005 (SUBMITTED) |
| 5 | [Unauthorized role](#5-unauthorized-role) | scenario 5 | ✅ PASS | CLM-2026-000006 (DOCUMENTS_VERIFIED) |
| 6 | [Failed precondition, then fixed](#6-failed-precondition-then-fixed) | — | ✅ PASS | CLM-2026-000007 (DOCUMENTS_VERIFIED), CLM-2026-000008 (APPROVED) |
| 7 | [Cycle limit](#7-cycle-limit) | — | ✅ PASS | CLM-2026-000009 (UNDER_ASSESSMENT) |
| 8 | [Only the assigned assessor decides](#8-only-the-assigned-assessor-decides) | — | ✅ PASS | CLM-2026-000010 (APPROVED), CLM-2026-000011 (SUBMITTED) |
| 9 | [Segregation of duties and four-eyes approval](#9-segregation-of-duties-and-four-eyes-approval) | — | ✅ PASS | CLM-2026-000012 (PAYMENT_INITIATED) |
| 10 | [Payment gateway failures, retries and idempotency](#10-payment-gateway-failures-retries-and-idempotency) | — | ✅ PASS | CLM-2026-000013 (CLOSED) |
| 11 | [Audit integrity of every claim](#11-audit-integrity-of-every-claim) | — | ✅ PASS |  |
| 12 | [New state by config only: appeal (workflow v2)](#12-new-state-by-config-only-appeal-workflow-v2) | — | ✅ PASS | CLM-2026-000014 (REJECTED), CLM-2026-000015 (CLOSED) |

**12/12 scenarios passed.**

---

## 1. Happy path

*Required scenario 1 of requirement.md.*

**Goal.** SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → APPROVED → PAYMENT_INITIATED → CLOSED, with notifications, a payment and a verifiable audit trail.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 1 | 2026-10-20 10:01 | u_member_01 (member) | CLM-2026-000001 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=2500000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000001 claim_received → member M*****1 via email: "Claim CLM-2026-000001 received" |

What `u_clerk_01` can do on CLM-2026-000001 now (`claims show CLM-2026-000001 --as u_clerk_01`):

| Transition | To | Roles | Status for this user |
|---|---|---|---|
| `attach_document` | (same state) | member, document_clerk | ✓ as document_clerk, needs document_type |
| `verify_documents` | DOCUMENTS_VERIFIED | document_clerk | ✗ Missing required documents for outpatient claim: claim_form, medical_invoice, prescription |

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 3 | 2026-10-20 10:02 | u_member_01 (member) | CLM-2026-000001 | `attach_document` · document_type=claim_form, file_name=claim_form.pdf | ✓ SUBMITTED (no state change) |
| 4 | 2026-10-20 10:03 | u_member_01 (member) | CLM-2026-000001 | `attach_document` · document_type=medical_invoice, file_name=medical_invoice.pdf | ✓ SUBMITTED (no state change) |
| 5 | 2026-10-20 10:04 | u_member_01 (member) | CLM-2026-000001 | `attach_document` · document_type=prescription, file_name=prescription.pdf | ✓ SUBMITTED (no state change) |
| 6 | 2026-10-20 10:05 | u_clerk_01 (document_clerk) | CLM-2026-000001 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000001 ready_for_assessment → role assessor via email: "Claim CLM-2026-000001 ready for assessment" |
| 7 | 2026-10-20 10:06 | u_lead_01 (team_lead) | CLM-2026-000001 | `assign_assessor` · assessor_id=u_assessor_01 | ✓ DOCUMENTS_VERIFIED (no state change)<br>↳ [notify] CLM-2026-000001 assessor_assigned → user u_assessor_01 via email: "Claim CLM-2026-000001 assigned to you" |
| 8 | 2026-10-20 10:07 | u_lead_01 (team_lead) | CLM-2026-000001 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000001 started at 2026-10-20 10:07 ICT; assessor u_assessor_01 |
| 9 | 2026-10-20 10:08 | u_assessor_01 (assessor) | CLM-2026-000001 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit., approved_amount=2300000 | ✓ UNDER_ASSESSMENT (no state change) |
| 10 | 2026-10-20 10:09 | u_assessor_01 (assessor) | CLM-2026-000001 | `approve` · notes=Within the outpatient benefit | ✓ UNDER_ASSESSMENT → APPROVED<br>↳ [notify] CLM-2026-000001 claim_approved → member M*****1 via email: "Claim CLM-2026-000001 approved" |
| 11 | 2026-10-20 10:10 | u_finance_01 (finance) | CLM-2026-000001 | `initiate_payment` | ✓ APPROVED → PAYMENT_INITIATED<br>↳ [payment] CLM-2026-000001 2,300,000 VND → MOCKPAY-8DC02978AB |
| 12 | 2026-10-20 10:11 | u_finance_01 (finance) | CLM-2026-000001 | `confirm_payment` · payment_reference=VCB-000001 | ✓ PAYMENT_INITIATED (no state change) |
| 13 | 2026-10-20 10:12 | u_finance_01 (finance) | CLM-2026-000001 | `close_paid` · notes=Payment confirmed by the bank | ✓ PAYMENT_INITIATED → CLOSED<br>↳ [notify] CLM-2026-000001 payment_completed → member M*****1 via email: "Claim CLM-2026-000001 paid" |
| 14 | 2026-10-20 10:12 |  | CLM-2026-000001 | integrity check (`claims verify`) | audit chain intact: 12 entries, replay matches, claim row matches the last entry |

**Checks**

- ✅ CLM-2026-000001 went through SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → APPROVED → PAYMENT_INITIATED → CLOSED
- ✅ exactly one payment reached the gateway

<details><summary>Audit trail of CLM-2026-000001 (12 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-10-20T03:01:00.000Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-10-20T03:02:00.000Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-10-20T03:03:00.000Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-10-20T03:04:00.000Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-10-20T03:05:00.000Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 6 | 2026-10-20T03:06:00.000Z | `assign_assessor` | DOCUMENTS_VERIFIED → DOCUMENTS_VERIFIED (in-state) | u_lead_01 (team_lead) |  |
| 7 | 2026-10-20T03:07:00.000Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 8 | 2026-10-20T03:08:00.000Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_assessor_01 (assessor) |  |
| 9 | 2026-10-20T03:09:00.000Z | `approve` | UNDER_ASSESSMENT → APPROVED | u_assessor_01 (assessor) | notes: Within the outpatient benefit |
| 10 | 2026-10-20T03:10:00.000Z | `initiate_payment` | APPROVED → PAYMENT_INITIATED | u_finance_01 (finance) |  |
| 11 | 2026-10-20T03:11:00.000Z | `confirm_payment` | PAYMENT_INITIATED → PAYMENT_INITIATED (in-state) | u_finance_01 (finance) |  |
| 12 | 2026-10-20T03:12:00.000Z | `close_paid` | PAYMENT_INITIATED → CLOSED | u_finance_01 (finance) | notes: Payment confirmed by the bank |

</details>

Result: ✅ **PASS**

---

## 2. Rejection path

*Required scenario 2 of requirement.md.*

**Goal.** SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → REJECTED → CLOSED. A reason is mandatory and reaches the member with appeal instructions; the system closes the claim when the member acknowledges it, or when the appeal window expires.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 1 | 2026-10-20 10:13 | u_member_01 (member) | CLM-2026-000002 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=2500000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000002 claim_received → member M*****1 via email: "Claim CLM-2026-000002 received" |
| 2 | 2026-10-20 10:14 | u_member_01 (member) | CLM-2026-000002 | `attach_document` · document_type=claim_form, file_name=claim_form.pdf | ✓ SUBMITTED (no state change) |
| 3 | 2026-10-20 10:15 | u_member_01 (member) | CLM-2026-000002 | `attach_document` · document_type=medical_invoice, file_name=medical_invoice.pdf | ✓ SUBMITTED (no state change) |
| 4 | 2026-10-20 10:16 | u_member_01 (member) | CLM-2026-000002 | `attach_document` · document_type=prescription, file_name=prescription.pdf | ✓ SUBMITTED (no state change) |
| 5 | 2026-10-20 10:17 | u_clerk_01 (document_clerk) | CLM-2026-000002 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000002 ready_for_assessment → role assessor via email: "Claim CLM-2026-000002 ready for assessment" |
| 6 | 2026-10-20 10:18 | u_lead_01 (team_lead) | CLM-2026-000002 | `assign_assessor` · assessor_id=u_assessor_01 | ✓ DOCUMENTS_VERIFIED (no state change)<br>↳ [notify] CLM-2026-000002 assessor_assigned → user u_assessor_01 via email: "Claim CLM-2026-000002 assigned to you" |
| 7 | 2026-10-20 10:19 | u_lead_01 (team_lead) | CLM-2026-000002 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000002 started at 2026-10-20 10:19 ICT; assessor u_assessor_01 |
| 8 | 2026-10-20 10:20 | u_assessor_01 (assessor) | CLM-2026-000002 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit. | ✓ UNDER_ASSESSMENT (no state change) |
| 9 | 2026-10-20 10:21 | u_assessor_01 | CLM-2026-000002 | `reject` · reason_code=exclusion | ✗ refused (expected): **PRECONDITION_FAILED** — Cannot run reject on claim CLM-2026-000002: Rejection reason (sent to the member) is required (input 'reason') |
| 10 | 2026-10-20 10:22 | u_assessor_01 (assessor) | CLM-2026-000002 | `reject` · reason_code=exclusion, reason=Cosmetic dermatology is excluded by section 4.2 of the policy | ✓ UNDER_ASSESSMENT → REJECTED<br>↳ [notify] CLM-2026-000002 claim_rejected → member M*****1 via email: "Claim CLM-2026-000002: decision" |
| 11 | 2026-10-20 10:23 | u_member_01 (member) | CLM-2026-000002 | `acknowledge_rejection` | ✓ REJECTED (no state change)<br>⚙ automatic: close_rejected: REJECTED → CLOSED by svc_system (system)<br>↳ [log] Claim CLM-2026-000002 archived |
| 12 | 2026-10-20 10:23 |  | CLM-2026-000002 | integrity check (`claims verify`) | audit chain intact: 11 entries, replay matches, claim row matches the last entry |

> Second claim: the member never acknowledges, so the appeal window decides.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 14 | 2026-10-20 10:24 | u_member_01 (member) | CLM-2026-000003 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=900000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000003 claim_received → member M*****1 via email: "Claim CLM-2026-000003 received" |
| 15 | 2026-10-20 10:25 | u_member_01 (member) | CLM-2026-000003 | `attach_document` · document_type=claim_form, file_name=claim_form.pdf | ✓ SUBMITTED (no state change) |
| 16 | 2026-10-20 10:26 | u_member_01 (member) | CLM-2026-000003 | `attach_document` · document_type=medical_invoice, file_name=medical_invoice.pdf | ✓ SUBMITTED (no state change) |
| 17 | 2026-10-20 10:27 | u_member_01 (member) | CLM-2026-000003 | `attach_document` · document_type=prescription, file_name=prescription.pdf | ✓ SUBMITTED (no state change) |
| 18 | 2026-10-20 10:28 | u_clerk_01 (document_clerk) | CLM-2026-000003 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000003 ready_for_assessment → role assessor via email: "Claim CLM-2026-000003 ready for assessment" |
| 19 | 2026-10-20 10:29 | u_lead_01 (team_lead) | CLM-2026-000003 | `assign_assessor` · assessor_id=u_assessor_01 | ✓ DOCUMENTS_VERIFIED (no state change)<br>↳ [notify] CLM-2026-000003 assessor_assigned → user u_assessor_01 via email: "Claim CLM-2026-000003 assigned to you" |
| 20 | 2026-10-20 10:30 | u_lead_01 (team_lead) | CLM-2026-000003 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000003 started at 2026-10-20 10:30 ICT; assessor u_assessor_01 |
| 21 | 2026-10-20 10:31 | u_assessor_01 (assessor) | CLM-2026-000003 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit. | ✓ UNDER_ASSESSMENT (no state change) |
| 22 | 2026-10-20 10:32 | u_assessor_01 (assessor) | CLM-2026-000003 | `reject` · reason_code=waiting_period, reason=Treatment falls within the 30-day waiting period | ✓ UNDER_ASSESSMENT → REJECTED<br>↳ [notify] CLM-2026-000003 claim_rejected → member M*****1 via email: "Claim CLM-2026-000003: decision" |
| 23 | 2026-10-20 10:32 | svc_system | CLM-2026-000003 | scheduler pass (`claims system run`) | nothing due |

> 31 days later: the appeal window has expired.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 25 | 2026-11-20 10:32 | svc_system |  | scheduler pass (`claims system run`) | 1 automatic transition(s)<br>⚙ automatic: CLM-2026-000003 close_rejected: REJECTED → CLOSED<br>↳ [log] Claim CLM-2026-000003 archived |
| 26 | 2026-11-20 10:32 |  | CLM-2026-000003 | integrity check (`claims verify`) | audit chain intact: 10 entries, replay matches, claim row matches the last entry |

**Checks**

- ✅ CLM-2026-000002 went through SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → REJECTED → CLOSED
- ✅ CLM-2026-000003 ends in REJECTED
- ✅ CLM-2026-000003 ends in CLOSED

<details><summary>Audit trail of CLM-2026-000002 (11 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-10-20T03:13:00.000Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-10-20T03:14:00.000Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-10-20T03:15:00.000Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-10-20T03:16:00.000Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-10-20T03:17:00.000Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 6 | 2026-10-20T03:18:00.000Z | `assign_assessor` | DOCUMENTS_VERIFIED → DOCUMENTS_VERIFIED (in-state) | u_lead_01 (team_lead) |  |
| 7 | 2026-10-20T03:19:00.000Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 8 | 2026-10-20T03:20:00.000Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_assessor_01 (assessor) |  |
| 9 | 2026-10-20T03:22:00.000Z | `reject` | UNDER_ASSESSMENT → REJECTED | u_assessor_01 (assessor) | Cosmetic dermatology is excluded by section 4.2 of the policy |
| 10 | 2026-10-20T03:23:00.000Z | `acknowledge_rejection` | REJECTED → REJECTED (in-state) | u_member_01 (member) |  |
| 11 | 2026-10-20T03:23:00.001Z | `close_rejected` | REJECTED → CLOSED | svc_system (system) |  |

</details>

<details><summary>Audit trail of CLM-2026-000003 (10 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-10-20T03:24:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-10-20T03:25:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-10-20T03:26:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-10-20T03:27:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-10-20T03:28:00.001Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 6 | 2026-10-20T03:29:00.001Z | `assign_assessor` | DOCUMENTS_VERIFIED → DOCUMENTS_VERIFIED (in-state) | u_lead_01 (team_lead) |  |
| 7 | 2026-10-20T03:30:00.001Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 8 | 2026-10-20T03:31:00.001Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_assessor_01 (assessor) |  |
| 9 | 2026-10-20T03:32:00.001Z | `reject` | UNDER_ASSESSMENT → REJECTED | u_assessor_01 (assessor) | Treatment falls within the 30-day waiting period |
| 10 | 2026-11-20T03:32:00.001Z | `close_rejected` | REJECTED → CLOSED | svc_system (system) |  |

</details>

Result: ✅ **PASS**

---

## 3. Request-more-information loop

*Required scenario 3 of requirement.md.*

**Goal.** SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → PENDING_INFO → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → APPROVED → PAYMENT_INITIATED → CLOSED. The loop needs new information, resets the assessment timer and is counted.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 1 | 2026-11-20 10:33 | u_member_01 (member) | CLM-2026-000004 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=2500000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000004 claim_received → member M*****1 via email: "Claim CLM-2026-000004 received" |
| 2 | 2026-11-20 10:34 | u_member_01 (member) | CLM-2026-000004 | `attach_document` · document_type=claim_form, file_name=claim_form.pdf | ✓ SUBMITTED (no state change) |
| 3 | 2026-11-20 10:35 | u_member_01 (member) | CLM-2026-000004 | `attach_document` · document_type=medical_invoice, file_name=medical_invoice.pdf | ✓ SUBMITTED (no state change) |
| 4 | 2026-11-20 10:36 | u_member_01 (member) | CLM-2026-000004 | `attach_document` · document_type=prescription, file_name=prescription.pdf | ✓ SUBMITTED (no state change) |
| 5 | 2026-11-20 10:37 | u_clerk_01 (document_clerk) | CLM-2026-000004 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000004 ready_for_assessment → role assessor via email: "Claim CLM-2026-000004 ready for assessment" |
| 6 | 2026-11-20 10:38 | u_lead_01 (team_lead) | CLM-2026-000004 | `assign_assessor` · assessor_id=u_assessor_01 | ✓ DOCUMENTS_VERIFIED (no state change)<br>↳ [notify] CLM-2026-000004 assessor_assigned → user u_assessor_01 via email: "Claim CLM-2026-000004 assigned to you" |
| 7 | 2026-11-20 10:39 | u_lead_01 (team_lead) | CLM-2026-000004 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000004 started at 2026-11-20 10:39 ICT; assessor u_assessor_01 |
| 8 | 2026-11-20 10:40 | u_assessor_01 (assessor) | CLM-2026-000004 | `request_info` · reason=Please send the blood test results | ✓ UNDER_ASSESSMENT → PENDING_INFO<br>↳ [notify] CLM-2026-000004 info_requested → member M*****1 via email: "More information needed for claim CLM-2026-000004" |
| 9 | 2026-11-20 10:41 | u_clerk_01 | CLM-2026-000004 | `info_received` | ✗ refused (expected): **PRECONDITION_FAILED** — Cannot run info_received on claim CLM-2026-000004: Nothing new has been received since the information request (2026-11-20 10:40 ICT) |
| 10 | 2026-11-20 10:42 | u_member_01 (member) | CLM-2026-000004 | `attach_document` · document_type=lab_result, file_name=blood-test.pdf | ✓ PENDING_INFO (no state change) |
| 11 | 2026-11-20 10:43 | u_clerk_01 (document_clerk) | CLM-2026-000004 | `info_received` | ✓ PENDING_INFO → DOCUMENTS_VERIFIED |
| 12 | 2026-11-20 10:44 | u_lead_01 (team_lead) | CLM-2026-000004 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000004 started at 2026-11-20 10:44 ICT; assessor u_assessor_01 |
| 13 | 2026-11-20 10:45 | u_assessor_01 (assessor) | CLM-2026-000004 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit., approved_amount=2500000 | ✓ UNDER_ASSESSMENT (no state change) |
| 14 | 2026-11-20 10:46 | u_assessor_01 (assessor) | CLM-2026-000004 | `approve` | ✓ UNDER_ASSESSMENT → APPROVED<br>↳ [notify] CLM-2026-000004 claim_approved → member M*****1 via email: "Claim CLM-2026-000004 approved" |
| 15 | 2026-11-20 10:47 | u_finance_01 (finance) | CLM-2026-000004 | `initiate_payment` | ✓ APPROVED → PAYMENT_INITIATED<br>↳ [payment] CLM-2026-000004 2,500,000 VND → MOCKPAY-8C759A2D47 |
| 16 | 2026-11-20 10:48 | u_finance_01 (finance) | CLM-2026-000004 | `confirm_payment` · payment_reference=VCB-000004 | ✓ PAYMENT_INITIATED (no state change) |
| 17 | 2026-11-20 10:49 | u_finance_01 (finance) | CLM-2026-000004 | `close_paid` · notes=Payment confirmed by the bank | ✓ PAYMENT_INITIATED → CLOSED<br>↳ [notify] CLM-2026-000004 payment_completed → member M*****1 via email: "Claim CLM-2026-000004 paid" |
| 18 | 2026-11-20 10:49 |  | CLM-2026-000004 | integrity check (`claims verify`) | audit chain intact: 16 entries, replay matches, claim row matches the last entry |

**Checks**

- ✅ CLM-2026-000004 went through SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → PENDING_INFO → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → APPROVED → PAYMENT_INITIATED → CLOSED
- ✅ the loop was counted once
- ✅ the assessment timer was reset and restarted

<details><summary>Audit trail of CLM-2026-000004 (16 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T03:33:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-11-20T03:34:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-11-20T03:35:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-11-20T03:36:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-11-20T03:37:00.001Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 6 | 2026-11-20T03:38:00.001Z | `assign_assessor` | DOCUMENTS_VERIFIED → DOCUMENTS_VERIFIED (in-state) | u_lead_01 (team_lead) |  |
| 7 | 2026-11-20T03:39:00.001Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 8 | 2026-11-20T03:40:00.001Z | `request_info` | UNDER_ASSESSMENT → PENDING_INFO | u_assessor_01 (assessor) | Please send the blood test results |
| 9 | 2026-11-20T03:42:00.001Z | `attach_document` | PENDING_INFO → PENDING_INFO (in-state) | u_member_01 (member) |  |
| 10 | 2026-11-20T03:43:00.001Z | `info_received` | PENDING_INFO → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 11 | 2026-11-20T03:44:00.001Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 12 | 2026-11-20T03:45:00.001Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_assessor_01 (assessor) |  |
| 13 | 2026-11-20T03:46:00.001Z | `approve` | UNDER_ASSESSMENT → APPROVED | u_assessor_01 (assessor) |  |
| 14 | 2026-11-20T03:47:00.001Z | `initiate_payment` | APPROVED → PAYMENT_INITIATED | u_finance_01 (finance) |  |
| 15 | 2026-11-20T03:48:00.001Z | `confirm_payment` | PAYMENT_INITIATED → PAYMENT_INITIATED (in-state) | u_finance_01 (finance) |  |
| 16 | 2026-11-20T03:49:00.001Z | `close_paid` | PAYMENT_INITIATED → CLOSED | u_finance_01 (finance) | notes: Payment confirmed by the bank |

</details>

Result: ✅ **PASS**

---

## 4. Invalid transition: SUBMITTED → APPROVED

*Required scenario 4 of requirement.md.*

**Goal.** Approving a claim whose documents were never verified is refused with a specific error: the current state, what can be done now, and the path to APPROVED.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 1 | 2026-11-20 10:50 | u_member_01 (member) | CLM-2026-000005 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=2500000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000005 claim_received → member M*****1 via email: "Claim CLM-2026-000005 received" |
| 2 | 2026-11-20 10:51 | u_assessor_01 | CLM-2026-000005 | `approve` | ✗ refused (expected): **INVALID_TRANSITION** — 'approve' (UNDER_ASSESSMENT → APPROVED) is not available: claim CLM-2026-000005 is SUBMITTED. Available from SUBMITTED: attach_document → (same state) [member, document_clerk], verify_documents → DOCUMENTS_VERIFIED [document_clerk]. To reach APPROVED: verify_documents → start_assessment → approve. |
| 3 | 2026-11-20 10:52 | u_assessor_01 | CLM-2026-000005 | `aprove` | ✗ refused (expected): **UNKNOWN_TRANSITION** — Unknown transition 'aprove'. Did you mean 'approve'? |

**Checks**

- ✅ the error names the current state
- ✅ the error shows the way to APPROVED
- ✅ CLM-2026-000005 ends in SUBMITTED

<details><summary>Audit trail of CLM-2026-000005 (1 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T03:50:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |

</details>

Result: ✅ **PASS**

---

## 5. Unauthorized role

*Required scenario 5 of requirement.md.*

**Goal.** A transition run by a role that is not authorized is refused, as is acting in a role the user does not hold or impersonating the system account.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 1 | 2026-11-20 10:53 | u_member_01 (member) | CLM-2026-000006 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=2500000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000006 claim_received → member M*****1 via email: "Claim CLM-2026-000006 received" |
| 2 | 2026-11-20 10:54 | u_member_01 (member) | CLM-2026-000006 | `attach_document` · document_type=claim_form, file_name=claim_form.pdf | ✓ SUBMITTED (no state change) |
| 3 | 2026-11-20 10:55 | u_member_01 (member) | CLM-2026-000006 | `attach_document` · document_type=medical_invoice, file_name=medical_invoice.pdf | ✓ SUBMITTED (no state change) |
| 4 | 2026-11-20 10:56 | u_member_01 (member) | CLM-2026-000006 | `attach_document` · document_type=prescription, file_name=prescription.pdf | ✓ SUBMITTED (no state change) |
| 5 | 2026-11-20 10:57 | u_assessor_01 | CLM-2026-000006 | `verify_documents` | ✗ refused (expected): **UNAUTHORIZED_ROLE** — Role 'assessor' cannot run verify_documents (SUBMITTED → DOCUMENTS_VERIFIED). Required: document_clerk. |
| 6 | 2026-11-20 10:58 | u_assessor_01 (document_clerk) | CLM-2026-000006 | `verify_documents` | ✗ refused (expected): **ROLE_NOT_ASSIGNED** — User u_assessor_01 does not hold role 'document_clerk' (holds: assessor) |
| 7 | 2026-11-20 10:59 | svc_system | CLM-2026-000006 | `verify_documents` | ✗ refused (expected): **SERVICE_ACCOUNT_ONLY** — svc_system is a service account and cannot be used directly |
| 8 | 2026-11-20 11:00 | u_clerk_01 (document_clerk) | CLM-2026-000006 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000006 ready_for_assessment → role assessor via email: "Claim CLM-2026-000006 ready for assessment" |

**Checks**

- ✅ CLM-2026-000006 ends in DOCUMENTS_VERIFIED

<details><summary>Audit trail of CLM-2026-000006 (5 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T03:53:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-11-20T03:54:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-11-20T03:55:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-11-20T03:56:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-11-20T04:00:00.001Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |

</details>

Result: ✅ **PASS**

---

## 6. Failed precondition, then fixed

**Goal.** Verification is refused while required documents are missing (listing them); once the member uploads them it succeeds. Policy cover and limits are enforced too.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 1 | 2026-11-20 11:01 | u_member_01 (member) | CLM-2026-000007 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=2500000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000007 claim_received → member M*****1 via email: "Claim CLM-2026-000007 received" |
| 2 | 2026-11-20 11:02 | u_member_01 (member) | CLM-2026-000007 | `attach_document` · document_type=claim_form, file_name=form.pdf | ✓ SUBMITTED (no state change) |
| 3 | 2026-11-20 11:03 | u_clerk_01 | CLM-2026-000007 | `verify_documents` | ✗ refused (expected): **PRECONDITION_FAILED** — Cannot run verify_documents on claim CLM-2026-000007: Missing required documents for outpatient claim: medical_invoice, prescription |
| 4 | 2026-11-20 11:04 | u_member_01 (member) | CLM-2026-000007 | `attach_document` · document_type=medical_invoice, file_name=invoice.pdf | ✓ SUBMITTED (no state change) |
| 5 | 2026-11-20 11:05 | u_member_01 (member) | CLM-2026-000007 | `attach_document` · document_type=prescription, file_name=rx.pdf | ✓ SUBMITTED (no state change) |
| 6 | 2026-11-20 11:06 | u_clerk_01 (document_clerk) | CLM-2026-000007 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000007 ready_for_assessment → role assessor via email: "Claim CLM-2026-000007 ready for assessment" |
| 7 | 2026-11-20 11:07 | u_lead_01 | CLM-2026-000007 | `start_assessment` | ✗ refused (expected): **PRECONDITION_FAILED** — Cannot run start_assessment on claim CLM-2026-000007: Assign an assessor before starting the assessment |

> Second claim on POL-002, whose coverage limit is 5,000,000 VND.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 9 | 2026-11-20 11:08 | u_member_02 (member) | CLM-2026-000008 | `submit_claim` · policy_id=POL-002, claim_type=outpatient, claimed_amount=7000000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000008 claim_received → member M*****2 via email: "Claim CLM-2026-000008 received" |
| 10 | 2026-11-20 11:09 | u_member_02 (member) | CLM-2026-000008 | `attach_document` · document_type=claim_form, file_name=claim_form.pdf | ✓ SUBMITTED (no state change) |
| 11 | 2026-11-20 11:10 | u_member_02 (member) | CLM-2026-000008 | `attach_document` · document_type=medical_invoice, file_name=medical_invoice.pdf | ✓ SUBMITTED (no state change) |
| 12 | 2026-11-20 11:11 | u_member_02 (member) | CLM-2026-000008 | `attach_document` · document_type=prescription, file_name=prescription.pdf | ✓ SUBMITTED (no state change) |
| 13 | 2026-11-20 11:12 | u_clerk_01 (document_clerk) | CLM-2026-000008 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000008 ready_for_assessment → role assessor via email: "Claim CLM-2026-000008 ready for assessment" |
| 14 | 2026-11-20 11:13 | u_lead_01 (team_lead) | CLM-2026-000008 | `assign_assessor` · assessor_id=u_assessor_01 | ✓ DOCUMENTS_VERIFIED (no state change)<br>↳ [notify] CLM-2026-000008 assessor_assigned → user u_assessor_01 via email: "Claim CLM-2026-000008 assigned to you" |
| 15 | 2026-11-20 11:14 | u_lead_01 (team_lead) | CLM-2026-000008 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000008 started at 2026-11-20 11:14 ICT; assessor u_assessor_01 |
| 16 | 2026-11-20 11:15 | u_assessor_01 (assessor) | CLM-2026-000008 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit., approved_amount=6000000 | ✓ UNDER_ASSESSMENT (no state change) |
| 17 | 2026-11-20 11:16 | u_assessor_01 | CLM-2026-000008 | `approve` | ✗ refused (expected): **PRECONDITION_FAILED** — Cannot run approve on claim CLM-2026-000008: Approved amount 6,000,000 VND exceeds the policy limit of 5,000,000 VND |
| 18 | 2026-11-20 11:17 | u_assessor_01 (assessor) | CLM-2026-000008 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit., approved_amount=5000000 | ✓ UNDER_ASSESSMENT (no state change) |
| 19 | 2026-11-20 11:18 | u_assessor_01 (assessor) | CLM-2026-000008 | `approve` | ✓ UNDER_ASSESSMENT → APPROVED<br>↳ [notify] CLM-2026-000008 claim_approved → member M*****2 via email: "Claim CLM-2026-000008 approved" |

**Checks**

- ✅ the missing documents are listed
- ✅ CLM-2026-000008 ends in APPROVED

<details><summary>Audit trail of CLM-2026-000007 (5 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T04:01:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-11-20T04:02:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-11-20T04:04:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-11-20T04:05:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-11-20T04:06:00.001Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |

</details>

<details><summary>Audit trail of CLM-2026-000008 (10 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T04:08:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_02 (member) |  |
| 2 | 2026-11-20T04:09:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_02 (member) |  |
| 3 | 2026-11-20T04:10:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_02 (member) |  |
| 4 | 2026-11-20T04:11:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_02 (member) |  |
| 5 | 2026-11-20T04:12:00.001Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 6 | 2026-11-20T04:13:00.001Z | `assign_assessor` | DOCUMENTS_VERIFIED → DOCUMENTS_VERIFIED (in-state) | u_lead_01 (team_lead) |  |
| 7 | 2026-11-20T04:14:00.001Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 8 | 2026-11-20T04:15:00.001Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_assessor_01 (assessor) |  |
| 9 | 2026-11-20T04:17:00.001Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_assessor_01 (assessor) |  |
| 10 | 2026-11-20T04:18:00.001Z | `approve` | UNDER_ASSESSMENT → APPROVED | u_assessor_01 (assessor) |  |

</details>

Result: ✅ **PASS**

---

## 7. Cycle limit

**Goal.** The information loop runs three times; the fourth request is refused with exactly "Maximum information requests exceeded — escalate to team lead" and the claim stays in assessment.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 1 | 2026-11-20 11:19 | u_member_01 (member) | CLM-2026-000009 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=2500000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000009 claim_received → member M*****1 via email: "Claim CLM-2026-000009 received" |
| 2 | 2026-11-20 11:20 | u_member_01 (member) | CLM-2026-000009 | `attach_document` · document_type=claim_form, file_name=claim_form.pdf | ✓ SUBMITTED (no state change) |
| 3 | 2026-11-20 11:21 | u_member_01 (member) | CLM-2026-000009 | `attach_document` · document_type=medical_invoice, file_name=medical_invoice.pdf | ✓ SUBMITTED (no state change) |
| 4 | 2026-11-20 11:22 | u_member_01 (member) | CLM-2026-000009 | `attach_document` · document_type=prescription, file_name=prescription.pdf | ✓ SUBMITTED (no state change) |
| 5 | 2026-11-20 11:23 | u_clerk_01 (document_clerk) | CLM-2026-000009 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000009 ready_for_assessment → role assessor via email: "Claim CLM-2026-000009 ready for assessment" |
| 6 | 2026-11-20 11:24 | u_lead_01 (team_lead) | CLM-2026-000009 | `assign_assessor` · assessor_id=u_assessor_01 | ✓ DOCUMENTS_VERIFIED (no state change)<br>↳ [notify] CLM-2026-000009 assessor_assigned → user u_assessor_01 via email: "Claim CLM-2026-000009 assigned to you" |
| 7 | 2026-11-20 11:25 | u_lead_01 (team_lead) | CLM-2026-000009 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000009 started at 2026-11-20 11:25 ICT; assessor u_assessor_01 |
| 8 | 2026-11-20 11:26 | u_assessor_01 (assessor) | CLM-2026-000009 | `request_info` · reason=Question 1 about the treatment | ✓ UNDER_ASSESSMENT → PENDING_INFO<br>↳ [notify] CLM-2026-000009 info_requested → member M*****1 via email: "More information needed for claim CLM-2026-000009" |
| 9 | 2026-11-20 11:27 | u_member_01 (member) | CLM-2026-000009 | `provide_info` · text=Answer 1 | ✓ PENDING_INFO (no state change) |
| 10 | 2026-11-20 11:28 | u_clerk_01 (document_clerk) | CLM-2026-000009 | `info_received` | ✓ PENDING_INFO → DOCUMENTS_VERIFIED |
| 11 | 2026-11-20 11:29 | u_lead_01 (team_lead) | CLM-2026-000009 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000009 started at 2026-11-20 11:29 ICT; assessor u_assessor_01 |
| 12 | 2026-11-20 11:30 | u_assessor_01 (assessor) | CLM-2026-000009 | `request_info` · reason=Question 2 about the treatment | ✓ UNDER_ASSESSMENT → PENDING_INFO<br>↳ [notify] CLM-2026-000009 info_requested → member M*****1 via email: "More information needed for claim CLM-2026-000009" |
| 13 | 2026-11-20 11:31 | u_member_01 (member) | CLM-2026-000009 | `provide_info` · text=Answer 2 | ✓ PENDING_INFO (no state change) |
| 14 | 2026-11-20 11:32 | u_clerk_01 (document_clerk) | CLM-2026-000009 | `info_received` | ✓ PENDING_INFO → DOCUMENTS_VERIFIED |
| 15 | 2026-11-20 11:33 | u_lead_01 (team_lead) | CLM-2026-000009 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000009 started at 2026-11-20 11:33 ICT; assessor u_assessor_01 |
| 16 | 2026-11-20 11:34 | u_assessor_01 (assessor) | CLM-2026-000009 | `request_info` · reason=Question 3 about the treatment | ✓ UNDER_ASSESSMENT → PENDING_INFO<br>↳ [notify] CLM-2026-000009 info_requested → member M*****1 via email: "More information needed for claim CLM-2026-000009" |
| 17 | 2026-11-20 11:35 | u_member_01 (member) | CLM-2026-000009 | `provide_info` · text=Answer 3 | ✓ PENDING_INFO (no state change) |
| 18 | 2026-11-20 11:36 | u_clerk_01 (document_clerk) | CLM-2026-000009 | `info_received` | ✓ PENDING_INFO → DOCUMENTS_VERIFIED |
| 19 | 2026-11-20 11:37 | u_lead_01 (team_lead) | CLM-2026-000009 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000009 started at 2026-11-20 11:37 ICT; assessor u_assessor_01 |

What `u_assessor_01` can do on CLM-2026-000009 now (`claims show CLM-2026-000009 --as u_assessor_01`):

| Transition | To | Roles | Status for this user |
|---|---|---|---|
| `assign_assessor` | (same state) | team_lead | ✗ requires team_lead |
| `submit_assessment` | (same state) | assessor | ✓ as assessor, needs summary |
| `cosign_approval` | (same state) | team_lead | ✗ requires team_lead |
| `approve` | APPROVED | assessor | ✗ The assessment report has not been submitted |
| `reject` | REJECTED | assessor | ✗ The assessment report has not been submitted |
| `request_info` | PENDING_INFO | assessor | ✗ Maximum information requests exceeded — escalate to team lead |

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 21 | 2026-11-20 11:38 | u_assessor_01 | CLM-2026-000009 | `request_info` · reason=Question 4 | ✗ refused (expected): **CYCLE_LIMIT_EXCEEDED** — Maximum information requests exceeded — escalate to team lead |

**Checks**

- ✅ the refusal carries the exact message
- ✅ the counter stopped at 3/3
- ✅ CLM-2026-000009 ends in UNDER_ASSESSMENT

<details><summary>Audit trail of CLM-2026-000009 (19 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T04:19:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-11-20T04:20:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-11-20T04:21:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-11-20T04:22:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-11-20T04:23:00.001Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 6 | 2026-11-20T04:24:00.001Z | `assign_assessor` | DOCUMENTS_VERIFIED → DOCUMENTS_VERIFIED (in-state) | u_lead_01 (team_lead) |  |
| 7 | 2026-11-20T04:25:00.001Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 8 | 2026-11-20T04:26:00.001Z | `request_info` | UNDER_ASSESSMENT → PENDING_INFO | u_assessor_01 (assessor) | Question 1 about the treatment |
| 9 | 2026-11-20T04:27:00.001Z | `provide_info` | PENDING_INFO → PENDING_INFO (in-state) | u_member_01 (member) |  |
| 10 | 2026-11-20T04:28:00.001Z | `info_received` | PENDING_INFO → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 11 | 2026-11-20T04:29:00.001Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 12 | 2026-11-20T04:30:00.001Z | `request_info` | UNDER_ASSESSMENT → PENDING_INFO | u_assessor_01 (assessor) | Question 2 about the treatment |
| 13 | 2026-11-20T04:31:00.001Z | `provide_info` | PENDING_INFO → PENDING_INFO (in-state) | u_member_01 (member) |  |
| 14 | 2026-11-20T04:32:00.001Z | `info_received` | PENDING_INFO → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 15 | 2026-11-20T04:33:00.001Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 16 | 2026-11-20T04:34:00.001Z | `request_info` | UNDER_ASSESSMENT → PENDING_INFO | u_assessor_01 (assessor) | Question 3 about the treatment |
| 17 | 2026-11-20T04:35:00.001Z | `provide_info` | PENDING_INFO → PENDING_INFO (in-state) | u_member_01 (member) |  |
| 18 | 2026-11-20T04:36:00.001Z | `info_received` | PENDING_INFO → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 19 | 2026-11-20T04:37:00.001Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |

</details>

Result: ✅ **PASS**

---

## 8. Only the assigned assessor decides

**Goal.** An assessor who holds the right role but is not assigned to the claim is refused (attribute-based check), and members cannot act on other members' claims.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 1 | 2026-11-20 11:39 | u_member_01 (member) | CLM-2026-000010 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=2500000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000010 claim_received → member M*****1 via email: "Claim CLM-2026-000010 received" |
| 2 | 2026-11-20 11:40 | u_member_01 (member) | CLM-2026-000010 | `attach_document` · document_type=claim_form, file_name=claim_form.pdf | ✓ SUBMITTED (no state change) |
| 3 | 2026-11-20 11:41 | u_member_01 (member) | CLM-2026-000010 | `attach_document` · document_type=medical_invoice, file_name=medical_invoice.pdf | ✓ SUBMITTED (no state change) |
| 4 | 2026-11-20 11:42 | u_member_01 (member) | CLM-2026-000010 | `attach_document` · document_type=prescription, file_name=prescription.pdf | ✓ SUBMITTED (no state change) |
| 5 | 2026-11-20 11:43 | u_clerk_01 (document_clerk) | CLM-2026-000010 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000010 ready_for_assessment → role assessor via email: "Claim CLM-2026-000010 ready for assessment" |
| 6 | 2026-11-20 11:44 | u_lead_01 (team_lead) | CLM-2026-000010 | `assign_assessor` · assessor_id=u_assessor_01 | ✓ DOCUMENTS_VERIFIED (no state change)<br>↳ [notify] CLM-2026-000010 assessor_assigned → user u_assessor_01 via email: "Claim CLM-2026-000010 assigned to you" |
| 7 | 2026-11-20 11:45 | u_lead_01 (team_lead) | CLM-2026-000010 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000010 started at 2026-11-20 11:45 ICT; assessor u_assessor_01 |
| 8 | 2026-11-20 11:46 | u_assessor_02 | CLM-2026-000010 | `submit_assessment` · summary=Looks fine | ✗ refused (expected): **ACCESS_DENIED** — Only the assigned assessor (u_assessor_01) can act on this claim |
| 9 | 2026-11-20 11:47 | u_assessor_01 (assessor) | CLM-2026-000010 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit., approved_amount=1800000 | ✓ UNDER_ASSESSMENT (no state change) |
| 10 | 2026-11-20 11:48 | u_assessor_02 | CLM-2026-000010 | `approve` | ✗ refused (expected): **ACCESS_DENIED** — Only the assigned assessor (u_assessor_01) can act on this claim |
| 11 | 2026-11-20 11:49 | u_assessor_01 (assessor) | CLM-2026-000010 | `approve` | ✓ UNDER_ASSESSMENT → APPROVED<br>↳ [notify] CLM-2026-000010 claim_approved → member M*****1 via email: "Claim CLM-2026-000010 approved" |
| 12 | 2026-11-20 11:50 | u_member_01 (member) | CLM-2026-000011 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=2500000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000011 claim_received → member M*****1 via email: "Claim CLM-2026-000011 received" |
| 13 | 2026-11-20 11:51 | u_member_02 | CLM-2026-000011 | `attach_document` · document_type=claim_form | ✗ refused (expected): **ACCESS_DENIED** — Members can only act on their own claims |

**Checks**

- ✅ CLM-2026-000010 ends in APPROVED

<details><summary>Audit trail of CLM-2026-000010 (9 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T04:39:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-11-20T04:40:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-11-20T04:41:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-11-20T04:42:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-11-20T04:43:00.001Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 6 | 2026-11-20T04:44:00.001Z | `assign_assessor` | DOCUMENTS_VERIFIED → DOCUMENTS_VERIFIED (in-state) | u_lead_01 (team_lead) |  |
| 7 | 2026-11-20T04:45:00.001Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 8 | 2026-11-20T04:47:00.001Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_assessor_01 (assessor) |  |
| 9 | 2026-11-20T04:49:00.001Z | `approve` | UNDER_ASSESSMENT → APPROVED | u_assessor_01 (assessor) |  |

</details>

<details><summary>Audit trail of CLM-2026-000011 (1 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T04:50:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |

</details>

Result: ✅ **PASS**

---

## 9. Segregation of duties and four-eyes approval

**Goal.** Whoever verified documents cannot assess; whoever decided cannot pay; approvals above 50,000,000 VND need a team lead co-sign for the exact amount, and a new assessment invalidates an old co-sign.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 1 | 2026-11-20 11:52 | u_member_01 (member) | CLM-2026-000012 | `submit_claim` · policy_id=POL-001, claim_type=inpatient, claimed_amount=90000000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000012 claim_received → member M*****1 via email: "Claim CLM-2026-000012 received" |
| 2 | 2026-11-20 11:53 | u_member_01 (member) | CLM-2026-000012 | `attach_document` · document_type=claim_form, file_name=claim_form.pdf | ✓ SUBMITTED (no state change) |
| 3 | 2026-11-20 11:54 | u_member_01 (member) | CLM-2026-000012 | `attach_document` · document_type=medical_invoice, file_name=medical_invoice.pdf | ✓ SUBMITTED (no state change) |
| 4 | 2026-11-20 11:55 | u_member_01 (member) | CLM-2026-000012 | `attach_document` · document_type=discharge_summary, file_name=discharge_summary.pdf | ✓ SUBMITTED (no state change) |
| 5 | 2026-11-20 11:56 | u_member_01 (member) | CLM-2026-000012 | `attach_document` · document_type=itemized_bill, file_name=itemized_bill.pdf | ✓ SUBMITTED (no state change) |
| 6 | 2026-11-20 11:57 | u_dual_ca (document_clerk) | CLM-2026-000012 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000012 ready_for_assessment → role assessor via email: "Claim CLM-2026-000012 ready for assessment" |
| 7 | 2026-11-20 11:58 | u_lead_01 | CLM-2026-000012 | `assign_assessor` · assessor_id=u_dual_ca | ✗ refused (expected): **PRECONDITION_FAILED** — Cannot run assign_assessor on claim CLM-2026-000012: Segregation of duties: u_dual_ca verified this claim's documents and cannot assess it |
| 8 | 2026-11-20 11:59 | u_lead_01 (team_lead) | CLM-2026-000012 | `assign_assessor` · assessor_id=u_dual_af | ✓ DOCUMENTS_VERIFIED (no state change)<br>↳ [notify] CLM-2026-000012 assessor_assigned → user u_dual_af via email: "Claim CLM-2026-000012 assigned to you" |
| 9 | 2026-11-20 12:00 | u_lead_01 (team_lead) | CLM-2026-000012 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000012 started at 2026-11-20 12:00 ICT; assessor u_dual_af |
| 10 | 2026-11-20 12:01 | u_dual_af (assessor) | CLM-2026-000012 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit., approved_amount=80000000 | ✓ UNDER_ASSESSMENT (no state change) |
| 11 | 2026-11-20 12:02 | u_dual_af (assessor) | CLM-2026-000012 | `approve` | ✗ refused (expected): **PRECONDITION_FAILED** — Cannot run approve on claim CLM-2026-000012: 80,000,000 VND exceeds the single-approver limit of 50,000,000 VND: a team lead must co-sign this exact amount |
| 12 | 2026-11-20 12:03 | u_lead_01 (team_lead) | CLM-2026-000012 | `cosign_approval` | ✓ UNDER_ASSESSMENT (no state change) |
| 13 | 2026-11-20 12:04 | u_dual_af (assessor) | CLM-2026-000012 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit., approved_amount=82000000 | ✓ UNDER_ASSESSMENT (no state change) |
| 14 | 2026-11-20 12:05 | u_dual_af (assessor) | CLM-2026-000012 | `approve` | ✗ refused (expected): **PRECONDITION_FAILED** — Cannot run approve on claim CLM-2026-000012: 82,000,000 VND exceeds the single-approver limit of 50,000,000 VND: a team lead must co-sign this exact amount |
| 15 | 2026-11-20 12:06 | u_lead_01 (team_lead) | CLM-2026-000012 | `cosign_approval` | ✓ UNDER_ASSESSMENT (no state change) |
| 16 | 2026-11-20 12:07 | u_dual_af (assessor) | CLM-2026-000012 | `approve` | ✓ UNDER_ASSESSMENT → APPROVED<br>↳ [notify] CLM-2026-000012 claim_approved → member M*****1 via email: "Claim CLM-2026-000012 approved" |
| 17 | 2026-11-20 12:08 | u_dual_af (finance) | CLM-2026-000012 | `initiate_payment` | ✗ refused (expected): **ACCESS_DENIED** — Segregation of duties: u_dual_af took part in the decision on this claim |
| 18 | 2026-11-20 12:09 | u_finance_01 (finance) | CLM-2026-000012 | `initiate_payment` | ✓ APPROVED → PAYMENT_INITIATED<br>↳ [payment] CLM-2026-000012 82,000,000 VND → MOCKPAY-25219EBBE3 |

**Checks**

- ✅ CLM-2026-000012 ends in PAYMENT_INITIATED
- ✅ the payment request is for the co-signed amount

<details><summary>Audit trail of CLM-2026-000012 (14 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T04:52:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-11-20T04:53:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-11-20T04:54:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-11-20T04:55:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-11-20T04:56:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 6 | 2026-11-20T04:57:00.001Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_dual_ca (document_clerk) |  |
| 7 | 2026-11-20T04:59:00.001Z | `assign_assessor` | DOCUMENTS_VERIFIED → DOCUMENTS_VERIFIED (in-state) | u_lead_01 (team_lead) |  |
| 8 | 2026-11-20T05:00:00.001Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 9 | 2026-11-20T05:01:00.001Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_dual_af (assessor) |  |
| 10 | 2026-11-20T05:03:00.001Z | `cosign_approval` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_lead_01 (team_lead) |  |
| 11 | 2026-11-20T05:04:00.001Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_dual_af (assessor) |  |
| 12 | 2026-11-20T05:06:00.001Z | `cosign_approval` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_lead_01 (team_lead) |  |
| 13 | 2026-11-20T05:07:00.001Z | `approve` | UNDER_ASSESSMENT → APPROVED | u_dual_af (assessor) |  |
| 14 | 2026-11-20T05:09:00.001Z | `initiate_payment` | APPROVED → PAYMENT_INITIATED | u_finance_01 (finance) |  |

</details>

Result: ✅ **PASS**

---

## 10. Payment gateway failures, retries and idempotency

**Goal.** The mock gateway fails twice; the outbox worker retries with backoff and the member is paid exactly once. Re-sending the same request with its idempotency key returns the first result without running anything again.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 1 | 2026-11-20 12:10 | u_member_01 (member) | CLM-2026-000013 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=2500000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000013 claim_received → member M*****1 via email: "Claim CLM-2026-000013 received" |
| 2 | 2026-11-20 12:11 | u_member_01 (member) | CLM-2026-000013 | `attach_document` · document_type=claim_form, file_name=claim_form.pdf | ✓ SUBMITTED (no state change) |
| 3 | 2026-11-20 12:12 | u_member_01 (member) | CLM-2026-000013 | `attach_document` · document_type=medical_invoice, file_name=medical_invoice.pdf | ✓ SUBMITTED (no state change) |
| 4 | 2026-11-20 12:13 | u_member_01 (member) | CLM-2026-000013 | `attach_document` · document_type=prescription, file_name=prescription.pdf | ✓ SUBMITTED (no state change) |
| 5 | 2026-11-20 12:14 | u_clerk_01 (document_clerk) | CLM-2026-000013 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000013 ready_for_assessment → role assessor via email: "Claim CLM-2026-000013 ready for assessment" |
| 6 | 2026-11-20 12:15 | u_lead_01 (team_lead) | CLM-2026-000013 | `assign_assessor` · assessor_id=u_assessor_01 | ✓ DOCUMENTS_VERIFIED (no state change)<br>↳ [notify] CLM-2026-000013 assessor_assigned → user u_assessor_01 via email: "Claim CLM-2026-000013 assigned to you" |
| 7 | 2026-11-20 12:16 | u_lead_01 (team_lead) | CLM-2026-000013 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000013 started at 2026-11-20 12:16 ICT; assessor u_assessor_01 |
| 8 | 2026-11-20 12:17 | u_assessor_01 (assessor) | CLM-2026-000013 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit., approved_amount=1500000 | ✓ UNDER_ASSESSMENT (no state change) |
| 9 | 2026-11-20 12:18 | u_assessor_01 (assessor) | CLM-2026-000013 | `approve` | ✓ UNDER_ASSESSMENT → APPROVED<br>↳ [notify] CLM-2026-000013 claim_approved → member M*****1 via email: "Claim CLM-2026-000013 approved" |

> Fault injection: the next 2 calls to the mock payment gateway fail.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 11 | 2026-11-20 12:19 | u_finance_01 (finance) | CLM-2026-000013 | `initiate_payment` | ✓ APPROVED → PAYMENT_INITIATED<br>↳ [retry] outbox #66 trigger_payment attempt 1/20 failed: mock payment gateway unavailable (injected fault); next try at 2026-11-20T05:19:22.501Z<br>↳ [retry] outbox #66 trigger_payment attempt 2/20 failed: mock payment gateway unavailable (injected fault); next try at 2026-11-20T05:20:07.501Z<br>↳ [payment] CLM-2026-000013 1,500,000 VND → MOCKPAY-06C263860C |
| 12 | 2026-11-20 12:19 | u_finance_01 (finance) | CLM-2026-000013 | `initiate_payment` | ✓ APPROVED → PAYMENT_INITIATED — replayed for the same idempotency key, nothing re-executed |
| 13 | 2026-11-20 12:22 | u_finance_01 (finance) | CLM-2026-000013 | `confirm_payment` · payment_reference=MOCKPAY-06C263860C | ✓ PAYMENT_INITIATED (no state change) |
| 14 | 2026-11-20 12:23 | u_finance_01 (finance) | CLM-2026-000013 | `close_paid` | ✓ PAYMENT_INITIATED → CLOSED<br>↳ [notify] CLM-2026-000013 payment_completed → member M*****1 via email: "Claim CLM-2026-000013 paid" |

**Checks**

- ✅ exactly one payment despite two failures and a repeated request
- ✅ the payment message succeeded on its third attempt
- ✅ the repeated request added no audit entry
- ✅ CLM-2026-000013 ends in CLOSED

<details><summary>Audit trail of CLM-2026-000013 (12 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T05:10:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-11-20T05:11:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-11-20T05:12:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-11-20T05:13:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-11-20T05:14:00.001Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 6 | 2026-11-20T05:15:00.001Z | `assign_assessor` | DOCUMENTS_VERIFIED → DOCUMENTS_VERIFIED (in-state) | u_lead_01 (team_lead) |  |
| 7 | 2026-11-20T05:16:00.001Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 8 | 2026-11-20T05:17:00.001Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_assessor_01 (assessor) |  |
| 9 | 2026-11-20T05:18:00.001Z | `approve` | UNDER_ASSESSMENT → APPROVED | u_assessor_01 (assessor) |  |
| 10 | 2026-11-20T05:19:00.001Z | `initiate_payment` | APPROVED → PAYMENT_INITIATED | u_finance_01 (finance) |  |
| 11 | 2026-11-20T05:22:07.501Z | `confirm_payment` | PAYMENT_INITIATED → PAYMENT_INITIATED (in-state) | u_finance_01 (finance) |  |
| 12 | 2026-11-20T05:23:07.501Z | `close_paid` | PAYMENT_INITIATED → CLOSED | u_finance_01 (finance) |  |

</details>

Result: ✅ **PASS**

---

## 11. Audit integrity of every claim

**Goal.** For every claim created above: the hash chain is intact, replaying the recorded changes reproduces each snapshot, and the claim row equals the last audited snapshot. Refused attempts were kept out of the chain.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 1 | 2026-11-20 12:23 |  | CLM-2026-000001 | integrity check (`claims verify`) | audit chain intact: 12 entries, replay matches, claim row matches the last entry |
| 2 | 2026-11-20 12:23 |  | CLM-2026-000002 | integrity check (`claims verify`) | audit chain intact: 11 entries, replay matches, claim row matches the last entry |
| 3 | 2026-11-20 12:23 |  | CLM-2026-000003 | integrity check (`claims verify`) | audit chain intact: 10 entries, replay matches, claim row matches the last entry |
| 4 | 2026-11-20 12:23 |  | CLM-2026-000004 | integrity check (`claims verify`) | audit chain intact: 16 entries, replay matches, claim row matches the last entry |
| 5 | 2026-11-20 12:23 |  | CLM-2026-000005 | integrity check (`claims verify`) | audit chain intact: 1 entries, replay matches, claim row matches the last entry |
| 6 | 2026-11-20 12:23 |  | CLM-2026-000006 | integrity check (`claims verify`) | audit chain intact: 5 entries, replay matches, claim row matches the last entry |
| 7 | 2026-11-20 12:23 |  | CLM-2026-000007 | integrity check (`claims verify`) | audit chain intact: 5 entries, replay matches, claim row matches the last entry |
| 8 | 2026-11-20 12:23 |  | CLM-2026-000008 | integrity check (`claims verify`) | audit chain intact: 10 entries, replay matches, claim row matches the last entry |
| 9 | 2026-11-20 12:23 |  | CLM-2026-000009 | integrity check (`claims verify`) | audit chain intact: 19 entries, replay matches, claim row matches the last entry |
| 10 | 2026-11-20 12:23 |  | CLM-2026-000010 | integrity check (`claims verify`) | audit chain intact: 9 entries, replay matches, claim row matches the last entry |
| 11 | 2026-11-20 12:23 |  | CLM-2026-000011 | integrity check (`claims verify`) | audit chain intact: 1 entries, replay matches, claim row matches the last entry |
| 12 | 2026-11-20 12:23 |  | CLM-2026-000012 | integrity check (`claims verify`) | audit chain intact: 14 entries, replay matches, claim row matches the last entry |
| 13 | 2026-11-20 12:23 |  | CLM-2026-000013 | integrity check (`claims verify`) | audit chain intact: 12 entries, replay matches, claim row matches the last entry |

**Checks**

- ✅ refused attempts were recorded separately

Result: ✅ **PASS**

---

## 12. New state by config only: appeal (workflow v2)

**Goal.** config/examples/workflow.appeal.yaml adds UNDER_APPEAL with two transitions and no code change. A claim rejected under v1 stays on v1 (no appeal possible); a claim created under v2 is appealed, re-assessed by a different assessor and paid.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 1 | 2026-11-20 12:24 | u_member_01 (member) | CLM-2026-000014 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=2500000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000014 claim_received → member M*****1 via email: "Claim CLM-2026-000014 received" |
| 2 | 2026-11-20 12:25 | u_member_01 (member) | CLM-2026-000014 | `attach_document` · document_type=claim_form, file_name=claim_form.pdf | ✓ SUBMITTED (no state change) |
| 3 | 2026-11-20 12:26 | u_member_01 (member) | CLM-2026-000014 | `attach_document` · document_type=medical_invoice, file_name=medical_invoice.pdf | ✓ SUBMITTED (no state change) |
| 4 | 2026-11-20 12:27 | u_member_01 (member) | CLM-2026-000014 | `attach_document` · document_type=prescription, file_name=prescription.pdf | ✓ SUBMITTED (no state change) |
| 5 | 2026-11-20 12:28 | u_clerk_01 (document_clerk) | CLM-2026-000014 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000014 ready_for_assessment → role assessor via email: "Claim CLM-2026-000014 ready for assessment" |
| 6 | 2026-11-20 12:29 | u_lead_01 (team_lead) | CLM-2026-000014 | `assign_assessor` · assessor_id=u_assessor_01 | ✓ DOCUMENTS_VERIFIED (no state change)<br>↳ [notify] CLM-2026-000014 assessor_assigned → user u_assessor_01 via email: "Claim CLM-2026-000014 assigned to you" |
| 7 | 2026-11-20 12:30 | u_lead_01 (team_lead) | CLM-2026-000014 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000014 started at 2026-11-20 12:30 ICT; assessor u_assessor_01 |
| 8 | 2026-11-20 12:31 | u_assessor_01 (assessor) | CLM-2026-000014 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit. | ✓ UNDER_ASSESSMENT (no state change) |
| 9 | 2026-11-20 12:32 | u_assessor_01 (assessor) | CLM-2026-000014 | `reject` · reason_code=not_covered, reason=Dental care is not covered | ✓ UNDER_ASSESSMENT → REJECTED<br>↳ [notify] CLM-2026-000014 claim_rejected → member M*****1 via email: "Claim CLM-2026-000014: decision" |

> Started the app with health_claim_reimbursement v2 (config hash 391ce068c8d6…): new claims use it.

| # | Time (ICT) | Who (role) | Claim | Transition · input | Outcome |
|---|---|---|---|---|---|
| 11 | 2026-11-20 12:33 | u_member_01 | CLM-2026-000014 | `file_appeal` · reason=Please reconsider | ✗ refused (expected): **UNKNOWN_TRANSITION** — Unknown transition 'file_appeal'. |
| 12 | 2026-11-20 12:34 | u_member_01 (member) | CLM-2026-000015 | `submit_claim` · policy_id=POL-001, claim_type=outpatient, claimed_amount=2500000, treatment_date=2026-10-15 | ✓ new → SUBMITTED<br>↳ [notify] CLM-2026-000015 claim_received → member M*****1 via email: "Claim CLM-2026-000015 received" |
| 13 | 2026-11-20 12:35 | u_member_01 (member) | CLM-2026-000015 | `attach_document` · document_type=claim_form, file_name=claim_form.pdf | ✓ SUBMITTED (no state change) |
| 14 | 2026-11-20 12:36 | u_member_01 (member) | CLM-2026-000015 | `attach_document` · document_type=medical_invoice, file_name=medical_invoice.pdf | ✓ SUBMITTED (no state change) |
| 15 | 2026-11-20 12:37 | u_member_01 (member) | CLM-2026-000015 | `attach_document` · document_type=prescription, file_name=prescription.pdf | ✓ SUBMITTED (no state change) |
| 16 | 2026-11-20 12:38 | u_clerk_01 (document_clerk) | CLM-2026-000015 | `verify_documents` | ✓ SUBMITTED → DOCUMENTS_VERIFIED<br>↳ [notify] CLM-2026-000015 ready_for_assessment → role assessor via email: "Claim CLM-2026-000015 ready for assessment" |
| 17 | 2026-11-20 12:39 | u_lead_01 (team_lead) | CLM-2026-000015 | `assign_assessor` · assessor_id=u_assessor_01 | ✓ DOCUMENTS_VERIFIED (no state change)<br>↳ [notify] CLM-2026-000015 assessor_assigned → user u_assessor_01 via email: "Claim CLM-2026-000015 assigned to you" |
| 18 | 2026-11-20 12:40 | u_lead_01 (team_lead) | CLM-2026-000015 | `start_assessment` | ✓ DOCUMENTS_VERIFIED → UNDER_ASSESSMENT<br>↳ [log] Assessment of CLM-2026-000015 started at 2026-11-20 12:40 ICT; assessor u_assessor_01 |
| 19 | 2026-11-20 12:41 | u_assessor_01 (assessor) | CLM-2026-000015 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit. | ✓ UNDER_ASSESSMENT (no state change) |
| 20 | 2026-11-20 12:42 | u_assessor_01 (assessor) | CLM-2026-000015 | `reject` · reason_code=not_medically_necessary, reason=The MRI was not medically necessary | ✓ UNDER_ASSESSMENT → REJECTED<br>↳ [notify] CLM-2026-000015 claim_rejected → member M*****1 via email: "Claim CLM-2026-000015: decision" |
| 21 | 2026-11-20 12:43 | u_member_01 (member) | CLM-2026-000015 | `file_appeal` · reason=My doctor ordered the MRI after two weeks of symptoms | ✓ REJECTED → UNDER_APPEAL<br>↳ [notify] CLM-2026-000015 appeal_received → member M*****1 via email: "Appeal for claim CLM-2026-000015 received"<br>↳ [notify] CLM-2026-000015 appeal_review_requested → role team_lead via email: "Appeal filed for claim CLM-2026-000015" |
| 22 | 2026-11-20 12:44 | u_lead_01 (team_lead) | CLM-2026-000015 | `assign_assessor` · assessor_id=u_assessor_01 | ✓ UNDER_APPEAL (no state change)<br>↳ [notify] CLM-2026-000015 assessor_assigned → user u_assessor_01 via email: "Claim CLM-2026-000015 assigned to you" |
| 23 | 2026-11-20 12:45 | u_lead_01 | CLM-2026-000015 | `reopen_assessment` | ✗ refused (expected): **PRECONDITION_FAILED** — Cannot run reopen_assessment on claim CLM-2026-000015: Segregation of duties: u_assessor_01 rejected this claim and cannot review the appeal |
| 24 | 2026-11-20 12:46 | u_lead_01 (team_lead) | CLM-2026-000015 | `assign_assessor` · assessor_id=u_assessor_02 | ✓ UNDER_APPEAL (no state change)<br>↳ [notify] CLM-2026-000015 assessor_assigned → user u_assessor_02 via email: "Claim CLM-2026-000015 assigned to you" |
| 25 | 2026-11-20 12:47 | u_lead_01 (team_lead) | CLM-2026-000015 | `reopen_assessment` | ✓ UNDER_APPEAL → UNDER_ASSESSMENT |
| 26 | 2026-11-20 12:48 | u_assessor_02 (assessor) | CLM-2026-000015 | `submit_assessment` · summary=Treatment and invoices reviewed; covered under the outpatient benefit., approved_amount=2500000 | ✓ UNDER_ASSESSMENT (no state change) |
| 27 | 2026-11-20 12:49 | u_assessor_02 (assessor) | CLM-2026-000015 | `approve` | ✓ UNDER_ASSESSMENT → APPROVED<br>↳ [notify] CLM-2026-000015 claim_approved → member M*****1 via email: "Claim CLM-2026-000015 approved" |
| 28 | 2026-11-20 12:50 | u_finance_01 (finance) | CLM-2026-000015 | `initiate_payment` | ✓ APPROVED → PAYMENT_INITIATED<br>↳ [payment] CLM-2026-000015 2,500,000 VND → MOCKPAY-D42CBC8E6A |
| 29 | 2026-11-20 12:51 | u_finance_01 (finance) | CLM-2026-000015 | `confirm_payment` · payment_reference=VCB-000015 | ✓ PAYMENT_INITIATED (no state change) |
| 30 | 2026-11-20 12:52 | u_finance_01 (finance) | CLM-2026-000015 | `close_paid` · notes=Payment confirmed by the bank | ✓ PAYMENT_INITIATED → CLOSED<br>↳ [notify] CLM-2026-000015 payment_completed → member M*****1 via email: "Claim CLM-2026-000015 paid" |
| 31 | 2026-11-20 12:52 |  | CLM-2026-000015 | integrity check (`claims verify`) | audit chain intact: 18 entries, replay matches, claim row matches the last entry |

**Checks**

- ✅ the v1 claim stays pinned to v1
- ✅ CLM-2026-000015 went through SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → REJECTED → UNDER_APPEAL → UNDER_ASSESSMENT → APPROVED → PAYMENT_INITIATED → CLOSED
- ✅ the new claim is pinned to v2

<details><summary>Audit trail of CLM-2026-000014 (9 entries, workflow v1, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T05:24:07.501Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-11-20T05:25:07.501Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-11-20T05:26:07.501Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-11-20T05:27:07.501Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-11-20T05:28:07.501Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 6 | 2026-11-20T05:29:07.501Z | `assign_assessor` | DOCUMENTS_VERIFIED → DOCUMENTS_VERIFIED (in-state) | u_lead_01 (team_lead) |  |
| 7 | 2026-11-20T05:30:07.501Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 8 | 2026-11-20T05:31:07.501Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_assessor_01 (assessor) |  |
| 9 | 2026-11-20T05:32:07.501Z | `reject` | UNDER_ASSESSMENT → REJECTED | u_assessor_01 (assessor) | Dental care is not covered |

</details>

<details><summary>Audit trail of CLM-2026-000015 (18 entries, workflow v2, verify ✓)</summary>

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T05:34:07.501Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-11-20T05:35:07.501Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-11-20T05:36:07.501Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-11-20T05:37:07.501Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-11-20T05:38:07.501Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |
| 6 | 2026-11-20T05:39:07.501Z | `assign_assessor` | DOCUMENTS_VERIFIED → DOCUMENTS_VERIFIED (in-state) | u_lead_01 (team_lead) |  |
| 7 | 2026-11-20T05:40:07.501Z | `start_assessment` | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 8 | 2026-11-20T05:41:07.501Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_assessor_01 (assessor) |  |
| 9 | 2026-11-20T05:42:07.501Z | `reject` | UNDER_ASSESSMENT → REJECTED | u_assessor_01 (assessor) | The MRI was not medically necessary |
| 10 | 2026-11-20T05:43:07.501Z | `file_appeal` | REJECTED → UNDER_APPEAL | u_member_01 (member) | My doctor ordered the MRI after two weeks of symptoms |
| 11 | 2026-11-20T05:44:07.501Z | `assign_assessor` | UNDER_APPEAL → UNDER_APPEAL (in-state) | u_lead_01 (team_lead) |  |
| 12 | 2026-11-20T05:46:07.501Z | `assign_assessor` | UNDER_APPEAL → UNDER_APPEAL (in-state) | u_lead_01 (team_lead) |  |
| 13 | 2026-11-20T05:47:07.501Z | `reopen_assessment` | UNDER_APPEAL → UNDER_ASSESSMENT | u_lead_01 (team_lead) |  |
| 14 | 2026-11-20T05:48:07.501Z | `submit_assessment` | UNDER_ASSESSMENT → UNDER_ASSESSMENT (in-state) | u_assessor_02 (assessor) |  |
| 15 | 2026-11-20T05:49:07.501Z | `approve` | UNDER_ASSESSMENT → APPROVED | u_assessor_02 (assessor) |  |
| 16 | 2026-11-20T05:50:07.501Z | `initiate_payment` | APPROVED → PAYMENT_INITIATED | u_finance_01 (finance) |  |
| 17 | 2026-11-20T05:51:07.501Z | `confirm_payment` | PAYMENT_INITIATED → PAYMENT_INITIATED (in-state) | u_finance_01 (finance) |  |
| 18 | 2026-11-20T05:52:07.501Z | `close_paid` | PAYMENT_INITIATED → CLOSED | u_finance_01 (finance) | notes: Payment confirmed by the bank |

</details>

Result: ✅ **PASS**

