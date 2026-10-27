# Refused attempts

Refusals are stored in `denied_attempts`, outside the claims and their audit chains, so a refused request never changes a claim. Identical refusals (same claim, user, transition and code) are stored once per minute.

| Time (UTC) | Claim | User (role) | Transition | Code | Message |
|---|---|---|---|---|---|
| 2026-10-20T03:21:00.000Z | CLM-2026-000002 | u_assessor_01 (assessor) | `reject` | PRECONDITION_FAILED | Cannot run reject on claim CLM-2026-000002: Rejection reason (sent to the member) is required (input 'reason') |
| 2026-11-20T03:41:00.001Z | CLM-2026-000004 | u_clerk_01 (document_clerk) | `info_received` | PRECONDITION_FAILED | Cannot run info_received on claim CLM-2026-000004: Nothing new has been received since the information request (2026-11-20 10:40 ICT) |
| 2026-11-20T03:51:00.001Z | CLM-2026-000005 | u_assessor_01 (assessor) | `approve` | INVALID_TRANSITION | 'approve' (UNDER_ASSESSMENT → APPROVED) is not available: claim CLM-2026-000005 is SUBMITTED. Available from SUBMITTED: attach_document → (same state) [member, document_clerk], verify_documents → DOCUMENTS_VERIFIED [document_clerk]. To reach APPROVED: verify_documents → start_assessment → approve. |
| 2026-11-20T03:52:00.001Z | CLM-2026-000005 | u_assessor_01 (assessor) | `aprove` | UNKNOWN_TRANSITION | Unknown transition 'aprove'. Did you mean 'approve'? |
| 2026-11-20T03:57:00.001Z | CLM-2026-000006 | u_assessor_01 (assessor) | `verify_documents` | UNAUTHORIZED_ROLE | Role 'assessor' cannot run verify_documents (SUBMITTED → DOCUMENTS_VERIFIED). Required: document_clerk. |
| 2026-11-20T03:58:00.001Z | CLM-2026-000006 | u_assessor_01 (document_clerk) | `verify_documents` | ROLE_NOT_ASSIGNED | User u_assessor_01 does not hold role 'document_clerk' (holds: assessor) |
| 2026-11-20T03:59:00.001Z | CLM-2026-000006 | svc_system | `verify_documents` | SERVICE_ACCOUNT_ONLY | svc_system is a service account and cannot be used directly |
| 2026-11-20T04:03:00.001Z | CLM-2026-000007 | u_clerk_01 (document_clerk) | `verify_documents` | PRECONDITION_FAILED | Cannot run verify_documents on claim CLM-2026-000007: Missing required documents for outpatient claim: medical_invoice, prescription |
| 2026-11-20T04:07:00.001Z | CLM-2026-000007 | u_lead_01 (team_lead) | `start_assessment` | PRECONDITION_FAILED | Cannot run start_assessment on claim CLM-2026-000007: Assign an assessor before starting the assessment |
| 2026-11-20T04:16:00.001Z | CLM-2026-000008 | u_assessor_01 (assessor) | `approve` | PRECONDITION_FAILED | Cannot run approve on claim CLM-2026-000008: Approved amount 6,000,000 VND exceeds the policy limit of 5,000,000 VND |
| 2026-11-20T04:38:00.001Z | CLM-2026-000009 | u_assessor_01 (assessor) | `request_info` | CYCLE_LIMIT_EXCEEDED | Maximum information requests exceeded — escalate to team lead |
| 2026-11-20T04:46:00.001Z | CLM-2026-000010 | u_assessor_02 (assessor) | `submit_assessment` | ACCESS_DENIED | Only the assigned assessor (u_assessor_01) can act on this claim |
| 2026-11-20T04:48:00.001Z | CLM-2026-000010 | u_assessor_02 (assessor) | `approve` | ACCESS_DENIED | Only the assigned assessor (u_assessor_01) can act on this claim |
| 2026-11-20T04:51:00.001Z | CLM-2026-000011 | u_member_02 (member) | `attach_document` | ACCESS_DENIED | Members can only act on their own claims |
| 2026-11-20T04:58:00.001Z | CLM-2026-000012 | u_lead_01 (team_lead) | `assign_assessor` | PRECONDITION_FAILED | Cannot run assign_assessor on claim CLM-2026-000012: Segregation of duties: u_dual_ca verified this claim's documents and cannot assess it |
| 2026-11-20T05:02:00.001Z | CLM-2026-000012 | u_dual_af (assessor) | `approve` | PRECONDITION_FAILED | Cannot run approve on claim CLM-2026-000012: 80,000,000 VND exceeds the single-approver limit of 50,000,000 VND: a team lead must co-sign this exact amount |
| 2026-11-20T05:05:00.001Z | CLM-2026-000012 | u_dual_af (assessor) | `approve` | PRECONDITION_FAILED | Cannot run approve on claim CLM-2026-000012: 82,000,000 VND exceeds the single-approver limit of 50,000,000 VND: a team lead must co-sign this exact amount |
| 2026-11-20T05:08:00.001Z | CLM-2026-000012 | u_dual_af (finance) | `initiate_payment` | ACCESS_DENIED | Segregation of duties: u_dual_af took part in the decision on this claim |
| 2026-11-20T05:33:07.501Z | CLM-2026-000014 | u_member_01 (member) | `file_appeal` | UNKNOWN_TRANSITION | Unknown transition 'file_appeal'. |
| 2026-11-20T05:45:07.501Z | CLM-2026-000015 | u_lead_01 (team_lead) | `reopen_assessment` | PRECONDITION_FAILED | Cannot run reopen_assessment on claim CLM-2026-000015: Segregation of duties: u_assessor_01 rejected this claim and cannot review the appeal |
