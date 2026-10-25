# Domain research: how health claims are handled

Background gathered before designing the workflow, to check that the challenge's state machine
matches how reimbursement claims actually move through a Vietnamese health insurer, and to find
what it leaves out. It is a summary for engineers, not legal advice; items marked *to confirm*
need the business or legal team.

## The reimbursement process, mapped to the challenge's states

| Real-world step | What happens | State |
|---|---|---|
| Intake | The member files a claim form with medical documents and invoices. The Law on Insurance Business 2022 (art. 30) allows **one year** from the insured event to file. | `SUBMITTED` |
| Document check | Completeness and validity. Outpatient: prescription or medical book, invoices/receipts, test orders and results. Inpatient: discharge summary, itemised bill, invoices, surgery certificate if any. Documents must carry the provider's stamp. | `DOCUMENTS_VERIFIED` |
| Assignment and assessment | Policy in force, waiting periods, exclusions, pre-existing conditions, limits and co-payment, whether costs are reasonable, signs of fraud, waste and abuse (FWA). | `UNDER_ASSESSMENT` |
| Request for more information | The payment deadline runs from receipt of a **complete, valid** file, so restarting the assessment clock when new information arrives (the challenge's "reset assessment timer") matches practice. | `PENDING_INFO` |
| Approval | Within the approver's delegated authority; large amounts go to a second approver (four-eyes). | `APPROVED` |
| Rejection | The insurer must **explain the reason in writing** (art. 20.2.e) and say how to complain. | `REJECTED` |
| Payment | Within the contractual period, or **15 days** from the complete file when the contract is silent; late payment carries interest (art. 31). | `PAYMENT_INITIATED` |
| Closing and archiving | Files are kept as the law requires (art. 20.2.h). | `CLOSED` |
| Complaint or dispute | Negotiation first, then mediation, arbitration or court (art. 32); an independent assessor when the parties disagree (art. 53). | *not in the challenge* |

Direct billing at a hospital (*bảo lãnh viện phí*) is a different workflow with service levels in
minutes or hours: one insurer publishes 30 minutes for outpatient, 24 hours for inpatient admission
and 2 hours at discharge. The engine therefore supports several versioned workflow definitions
rather than one fixed lifecycle.

## Constraints that shaped the design

- **A rejection must state its reason.** `reject` requires a reason code and a written reason,
  and the notification sent to the member includes both, the appeal deadline and how to appeal.
- **The "complete file" timestamp matters**, because payment deadlines and interest run from it.
  It is recorded on verification and updated whenever new information is received.
- **Filing deadline.** Some insurers' rules say 90 days, the law says one year. It is a setting
  (`filing_deadline: P1Y`) *to confirm* per product.
- **Health data is sensitive personal data** under the Personal Data Protection Law
  (91/2025/QH15) and Decree 356/2025, in force from 1 January 2026. The implementation keeps PII
  out of console logs (notification bodies are never logged, member ids are masked), records only
  true/false for presence checks in the decision context, and uses standard reason codes instead of
  free-text diagnoses where it can.

## Operational practice

- Delegated authority by amount, maker-checker, and separating whoever decides from whoever
  pays. Implemented as segregation-of-duties rules and a four-eyes threshold
  (`four_eyes_threshold`, 50,000,000 VND, a placeholder *to confirm*).
- FWA signals: claims soon after the policy start, duplicate invoices, unusual frequency or
  amounts. Out of scope; a natural next primitive (see the README's future work).
- Typical KPIs: turnaround time per step, pend rate (share of claims sent back for information),
  first-pass rate, straight-through processing, SLA breaches. Vendor benchmarks (indicative only):
  cycle time of 14 days or less, pend rate of 10% or less. The audit trail records every state
  entry, so these can be computed from it.

## Gaps in the challenge's lifecycle

1. A claim with missing documents can only wait in `SUBMITTED`: there is no way to ask the member
   for them.
2. There is no state for a payment that fails at the bank.
3. There is no appeal, although the rejection notice must explain how to appeal.
4. There is no escalation, although the refusal of the fourth information request says
   "escalate to team lead".
5. There is no withdrawal, cancellation or reopening.

Gap 3 is implemented as workflow version 2 with a YAML-only change. Gaps 1, 2, 4 and 5 are
ready-to-paste recipes in [extending-the-workflow.md](extending-the-workflow.md), checked by a test.

## Interpretations of the challenge

- "Payment request created" (side effect of approval) is recorded on the claim in the same
  transaction, because the next transition's precondition depends on it; "trigger payment
  system" is an external effect delivered through the outbox.
- The cycle limit counts successful information requests over the claim's lifetime, and the
  fourth attempt is refused with exactly "Maximum information requests exceeded — escalate to team
  lead".
- "Reset assessment timer" clears `assessment_started_at` and records `assessment_reset_at`; the
  next `start_assessment` sets a fresh start time.
- The audit trail's `reason` and `notes` columns come from the transition inputs named `reason`
  and `notes` (every transition accepts optional notes).
- Appeal period (`P30D`), four-eyes threshold and the seed policies' limits are placeholders.

## Sources

- Law on Insurance Business 2022, arts. 20, 30, 31, 32 and 53:
  https://hethongphapluat.com/luat-kinh-doanh-bao-hiem-2022.html
- Health data under the 2025 personal data protection law:
  https://lsvn.vn/bao-ve-du-lieu-ca-nhan-doi-voi-thong-tin-suc-khoe-va-trong-hoat-dong-kinh-doanh-bao-hiem-a160288.html,
  https://luatvietnam.vn/tin-van-ban-moi/thong-tin-ve-suc-khoe-la-du-lieu-ca-nhan-nhay-cam-186-106394-article.html
- Claim documents required by insurers:
  https://pjico.com.vn/wp-content/uploads/2025/03/Huong-dan-thu-thap-HSBT-chi-tiet.pdf,
  https://www.pti.com.vn/wp-content/uploads/2025/09/Huongs-dan-chung-tu-boi-thuong-Viet-1.pdf,
  https://www.pjico.com.vn/wp-content/uploads/2025/03/VNM_Claim-handbook_FN.pdf
- Assessment and delegated authority:
  https://www.careerlink.vn/cam-nang-luong/nhan-vien-boi-thuong-bao-hiem/,
  https://www.manipalcigna.com/blog/claim-adjudication-in-health-insurance,
  https://hkqf.gov.hk/files/record/insurance-scs/3/EN/105616L6.pdf,
  https://openriskmanual.org/wiki/Four_Eyes_Principle
- Fraud, waste and abuse analytics:
  https://pkf.com.au/insights/case-study-forensic-data-analytics-for-a-government-insurer,
  https://bcajonline.org/journal/using-computer-assisted-audit-tools-caats-for-prevention-and-detection-of-frauds-in-healthcare-industry/
- Claims KPIs: https://simplifyhealthcare.com/insights1/,
  https://www.ilo.org/resource/article/emerging-insight-getting-bottom-claims-turnaround-time
- Tamper-evident audit trails in PostgreSQL:
  https://appmaster.io/blog/tamper-evident-audit-trails-postgresql
