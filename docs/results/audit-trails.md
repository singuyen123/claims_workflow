# Audit trails

Every claim created by the scenarios, read back from `audit_log` after the run (`claims audit <claim>`). Entries are append-only and hash-chained per claim; `verify` recomputes the chain, replays `changes` against each `snapshot_hash` and compares the claim row with the last entry.

Workflow hashes: v1 `2e402add27af98d8cfc8c12ea5d795d3f0a481afa0c9f6bd58174303c7b04fc0`, v2 `391ce068c8d682436597f15280d5914ff74b1d1e8d149c115b57e0d673a4993a`.

## CLM-2026-000001

Scenario 1 · outpatient · 2,500,000 VND · policy POL-001 · final state **CLOSED** · workflow v1 · verify: ✓ 12 entries, head `3b3fafa0c3044cd0`…

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

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state
6. `assign_assessor`: replace /updated_at, add /participants/assign_assessor, add /data/assessor_id, add /data/assigned_at, replace /version
7. `start_assessment`: replace /updated_at, add /participants/start_assessment, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
8. `submit_assessment`: replace /updated_at, add /participants/submit_assessment, add /data/assessment, replace /version
9. `approve`: replace /updated_at, add /participants/approve, add /data/payment_request, replace /version, replace /state_entered_at, replace /state
10. `initiate_payment`: replace /updated_at, add /participants/initiate_payment, replace /version, replace /state_entered_at, replace /state
11. `confirm_payment`: replace /updated_at, add /participants/confirm_payment, add /data/payment, replace /version
12. `close_paid`: replace /updated_at, add /participants/close_paid, replace /version, replace /state_entered_at, replace /state

## CLM-2026-000002

Scenario 2 · outpatient · 2,500,000 VND · policy POL-001 · final state **CLOSED** · workflow v1 · verify: ✓ 11 entries, head `affd296fd867f86a`…

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

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state
6. `assign_assessor`: replace /updated_at, add /participants/assign_assessor, add /data/assessor_id, add /data/assigned_at, replace /version
7. `start_assessment`: replace /updated_at, add /participants/start_assessment, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
8. `submit_assessment`: replace /updated_at, add /participants/submit_assessment, add /data/assessment, replace /version
9. `reject`: replace /updated_at, add /participants/reject, add /data/rejection, replace /version, replace /state_entered_at, replace /state
10. `acknowledge_rejection`: replace /updated_at, add /participants/acknowledge_rejection, add /data/rejection/acknowledged_at, replace /version
11. `close_rejected`: replace /updated_at, add /participants/close_rejected, add /data/archived_at, replace /version, replace /state_entered_at, replace /state

## CLM-2026-000003

Scenario 2 · outpatient · 900,000 VND · policy POL-001 · final state **CLOSED** · workflow v1 · verify: ✓ 10 entries, head `bf88d194fede2bd4`…

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

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state
6. `assign_assessor`: replace /updated_at, add /participants/assign_assessor, add /data/assessor_id, add /data/assigned_at, replace /version
7. `start_assessment`: replace /updated_at, add /participants/start_assessment, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
8. `submit_assessment`: replace /updated_at, add /participants/submit_assessment, add /data/assessment, replace /version
9. `reject`: replace /updated_at, add /participants/reject, add /data/rejection, replace /version, replace /state_entered_at, replace /state
10. `close_rejected`: replace /updated_at, add /participants/close_rejected, add /data/archived_at, replace /version, replace /state_entered_at, replace /state

## CLM-2026-000004

Scenario 3 · outpatient · 2,500,000 VND · policy POL-001 · final state **CLOSED** · workflow v1 · verify: ✓ 16 entries, head `af0e09855e6a99b5`…

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

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state
6. `assign_assessor`: replace /updated_at, add /participants/assign_assessor, add /data/assessor_id, add /data/assigned_at, replace /version
7. `start_assessment`: replace /updated_at, add /participants/start_assessment, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
8. `request_info`: replace /updated_at, add /participants/request_info, add /counters/info_requests, add /data/info_requests, replace /version, replace /state_entered_at, replace /state
9. `attach_document`: replace /updated_at, add /data/documents/3, replace /version
10. `info_received`: replace /updated_at, add /participants/info_received, remove /data/timers/assessment_started_at, replace /data/timers/complete_docs_at, add /data/timers/assessment_reset_at, replace /version, replace /state_entered_at, replace /state
11. `start_assessment`: replace /updated_at, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
12. `submit_assessment`: replace /updated_at, add /participants/submit_assessment, add /data/assessment, replace /version
13. `approve`: replace /updated_at, add /participants/approve, add /data/payment_request, replace /version, replace /state_entered_at, replace /state
14. `initiate_payment`: replace /updated_at, add /participants/initiate_payment, replace /version, replace /state_entered_at, replace /state
15. `confirm_payment`: replace /updated_at, add /participants/confirm_payment, add /data/payment, replace /version
16. `close_paid`: replace /updated_at, add /participants/close_paid, replace /version, replace /state_entered_at, replace /state

## CLM-2026-000005

Scenario 4 · outpatient · 2,500,000 VND · policy POL-001 · final state **SUBMITTED** · workflow v1 · verify: ✓ 1 entries, head `7476d63b4510d575`…

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T03:50:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at

## CLM-2026-000006

Scenario 5 · outpatient · 2,500,000 VND · policy POL-001 · final state **DOCUMENTS_VERIFIED** · workflow v1 · verify: ✓ 5 entries, head `edd5c3069e4673e4`…

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T03:53:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-11-20T03:54:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-11-20T03:55:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-11-20T03:56:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-11-20T04:00:00.001Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state

## CLM-2026-000007

Scenario 6 · outpatient · 2,500,000 VND · policy POL-001 · final state **DOCUMENTS_VERIFIED** · workflow v1 · verify: ✓ 5 entries, head `63a010d2749d42be`…

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T04:01:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |
| 2 | 2026-11-20T04:02:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 3 | 2026-11-20T04:04:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 4 | 2026-11-20T04:05:00.001Z | `attach_document` | SUBMITTED → SUBMITTED (in-state) | u_member_01 (member) |  |
| 5 | 2026-11-20T04:06:00.001Z | `verify_documents` | SUBMITTED → DOCUMENTS_VERIFIED | u_clerk_01 (document_clerk) |  |

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state

## CLM-2026-000008

Scenario 6 · outpatient · 7,000,000 VND · policy POL-002 · final state **APPROVED** · workflow v1 · verify: ✓ 10 entries, head `126707bf2b5921a9`…

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

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state
6. `assign_assessor`: replace /updated_at, add /participants/assign_assessor, add /data/assessor_id, add /data/assigned_at, replace /version
7. `start_assessment`: replace /updated_at, add /participants/start_assessment, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
8. `submit_assessment`: replace /updated_at, add /participants/submit_assessment, add /data/assessment, replace /version
9. `submit_assessment`: replace /updated_at, replace /data/assessment/approved_amount, replace /data/assessment/submitted_at, replace /version
10. `approve`: replace /updated_at, add /participants/approve, add /data/payment_request, replace /version, replace /state_entered_at, replace /state

## CLM-2026-000009

Scenario 7 · outpatient · 2,500,000 VND · policy POL-001 · final state **UNDER_ASSESSMENT** · workflow v1 · verify: ✓ 19 entries, head `074321566dabfd90`…

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

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state
6. `assign_assessor`: replace /updated_at, add /participants/assign_assessor, add /data/assessor_id, add /data/assigned_at, replace /version
7. `start_assessment`: replace /updated_at, add /participants/start_assessment, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
8. `request_info`: replace /updated_at, add /participants/request_info, add /counters/info_requests, add /data/info_requests, replace /version, replace /state_entered_at, replace /state
9. `provide_info`: replace /updated_at, add /participants/provide_info, add /data/info_responses, replace /version
10. `info_received`: replace /updated_at, add /participants/info_received, remove /data/timers/assessment_started_at, replace /data/timers/complete_docs_at, add /data/timers/assessment_reset_at, replace /version, replace /state_entered_at, replace /state
11. `start_assessment`: replace /updated_at, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
12. `request_info`: replace /updated_at, replace /counters/info_requests, add /data/info_requests/1, replace /version, replace /state_entered_at, replace /state
13. `provide_info`: replace /updated_at, add /data/info_responses/1, replace /version
14. `info_received`: replace /updated_at, remove /data/timers/assessment_started_at, replace /data/timers/assessment_reset_at, replace /data/timers/complete_docs_at, replace /version, replace /state_entered_at, replace /state
15. `start_assessment`: replace /updated_at, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
16. `request_info`: replace /updated_at, replace /counters/info_requests, add /data/info_requests/2, replace /version, replace /state_entered_at, replace /state
17. `provide_info`: replace /updated_at, add /data/info_responses/2, replace /version
18. `info_received`: replace /updated_at, remove /data/timers/assessment_started_at, replace /data/timers/assessment_reset_at, replace /data/timers/complete_docs_at, replace /version, replace /state_entered_at, replace /state
19. `start_assessment`: replace /updated_at, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state

## CLM-2026-000010

Scenario 8 · outpatient · 2,500,000 VND · policy POL-001 · final state **APPROVED** · workflow v1 · verify: ✓ 9 entries, head `426214f079ff898a`…

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

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state
6. `assign_assessor`: replace /updated_at, add /participants/assign_assessor, add /data/assessor_id, add /data/assigned_at, replace /version
7. `start_assessment`: replace /updated_at, add /participants/start_assessment, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
8. `submit_assessment`: replace /updated_at, add /participants/submit_assessment, add /data/assessment, replace /version
9. `approve`: replace /updated_at, add /participants/approve, add /data/payment_request, replace /version, replace /state_entered_at, replace /state

## CLM-2026-000011

Scenario 8 · outpatient · 2,500,000 VND · policy POL-001 · final state **SUBMITTED** · workflow v1 · verify: ✓ 1 entries, head `f6279b80bb4447ac`…

| # | occurred_at (UTC) | Transition | from_state → to_state | triggered_by (role) | Reason / notes |
|---|---|---|---|---|---|
| 1 | 2026-11-20T04:50:00.001Z | `submit_claim` | ∅ → SUBMITTED | u_member_01 (member) |  |

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at

## CLM-2026-000012

Scenario 9 · inpatient · 90,000,000 VND · policy POL-001 · final state **PAYMENT_INITIATED** · workflow v1 · verify: ✓ 14 entries, head `77a48cbfeb8fda96`…

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

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `attach_document`: replace /updated_at, add /data/documents/3, replace /version
6. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state
7. `assign_assessor`: replace /updated_at, add /participants/assign_assessor, add /data/assessor_id, add /data/assigned_at, replace /version
8. `start_assessment`: replace /updated_at, add /participants/start_assessment, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
9. `submit_assessment`: replace /updated_at, add /participants/submit_assessment, add /data/assessment, replace /version
10. `cosign_approval`: replace /updated_at, add /participants/cosign_approval, add /data/cosign, replace /version
11. `submit_assessment`: replace /updated_at, replace /data/assessment/approved_amount, replace /data/assessment/submitted_at, remove /data/cosign, replace /version
12. `cosign_approval`: replace /updated_at, add /data/cosign, replace /version
13. `approve`: replace /updated_at, add /participants/approve, add /data/payment_request, replace /version, replace /state_entered_at, replace /state
14. `initiate_payment`: replace /updated_at, add /participants/initiate_payment, replace /version, replace /state_entered_at, replace /state

## CLM-2026-000013

Scenario 10 · outpatient · 2,500,000 VND · policy POL-001 · final state **CLOSED** · workflow v1 · verify: ✓ 12 entries, head `9a7414735c1cd510`…

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

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state
6. `assign_assessor`: replace /updated_at, add /participants/assign_assessor, add /data/assessor_id, add /data/assigned_at, replace /version
7. `start_assessment`: replace /updated_at, add /participants/start_assessment, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
8. `submit_assessment`: replace /updated_at, add /participants/submit_assessment, add /data/assessment, replace /version
9. `approve`: replace /updated_at, add /participants/approve, add /data/payment_request, replace /version, replace /state_entered_at, replace /state
10. `initiate_payment`: replace /updated_at, add /participants/initiate_payment, replace /version, replace /state_entered_at, replace /state
11. `confirm_payment`: replace /updated_at, add /participants/confirm_payment, add /data/payment, replace /version
12. `close_paid`: replace /updated_at, add /participants/close_paid, replace /version, replace /state_entered_at, replace /state

## CLM-2026-000014

Scenario 12 · outpatient · 2,500,000 VND · policy POL-001 · final state **REJECTED** · workflow v1 · verify: ✓ 9 entries, head `ce757e7c758463d1`…

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

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state
6. `assign_assessor`: replace /updated_at, add /participants/assign_assessor, add /data/assessor_id, add /data/assigned_at, replace /version
7. `start_assessment`: replace /updated_at, add /participants/start_assessment, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
8. `submit_assessment`: replace /updated_at, add /participants/submit_assessment, add /data/assessment, replace /version
9. `reject`: replace /updated_at, add /participants/reject, add /data/rejection, replace /version, replace /state_entered_at, replace /state

## CLM-2026-000015

Scenario 12 · outpatient · 2,500,000 VND · policy POL-001 · final state **CLOSED** · workflow v2 · verify: ✓ 18 entries, head `a349873d57d52b72`…

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

Changes recorded per entry (JSON Patch paths):

1. `submit_claim`: add /id, add /claim_no, add /config_hash, add /policy_id, add /member_id, add /claim_type, add /claimed_amount, add /state, add /state_entered_at, add /version, add /data, add /counters, add /participants, add /created_at, add /updated_at
2. `attach_document`: replace /updated_at, add /participants/attach_document, add /data/documents, replace /version
3. `attach_document`: replace /updated_at, add /data/documents/1, replace /version
4. `attach_document`: replace /updated_at, add /data/documents/2, replace /version
5. `verify_documents`: replace /updated_at, add /participants/verify_documents, add /data/timers, replace /version, replace /state_entered_at, replace /state
6. `assign_assessor`: replace /updated_at, add /participants/assign_assessor, add /data/assessor_id, add /data/assigned_at, replace /version
7. `start_assessment`: replace /updated_at, add /participants/start_assessment, add /data/timers/assessment_started_at, replace /version, replace /state_entered_at, replace /state
8. `submit_assessment`: replace /updated_at, add /participants/submit_assessment, add /data/assessment, replace /version
9. `reject`: replace /updated_at, add /participants/reject, add /data/rejection, replace /version, replace /state_entered_at, replace /state
10. `file_appeal`: replace /updated_at, add /participants/file_appeal, add /counters/appeals, add /data/appeal, replace /version, replace /state_entered_at, replace /state
11. `assign_assessor`: replace /updated_at, replace /data/assigned_at, replace /version
12. `assign_assessor`: replace /updated_at, replace /data/assigned_at, replace /data/assessor_id, replace /version
13. `reopen_assessment`: replace /updated_at, add /participants/reopen_assessment, remove /data/assessment, replace /data/timers/assessment_started_at, add /data/appeal/reopened_at, replace /version, replace /state_entered_at, replace /state
14. `submit_assessment`: replace /updated_at, add /participants/submit_assessment/1, add /data/assessment, replace /version
15. `approve`: replace /updated_at, add /participants/approve, add /data/payment_request, replace /version, replace /state_entered_at, replace /state
16. `initiate_payment`: replace /updated_at, add /participants/initiate_payment, replace /version, replace /state_entered_at, replace /state
17. `confirm_payment`: replace /updated_at, add /participants/confirm_payment, add /data/payment, replace /version
18. `close_paid`: replace /updated_at, add /participants/close_paid, replace /version, replace /state_entered_at, replace /state

