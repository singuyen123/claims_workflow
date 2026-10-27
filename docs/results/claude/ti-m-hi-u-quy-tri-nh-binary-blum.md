# Kế hoạch: Claims Workflow Orchestrator (AI Challenge 14)

## 0. Context

- **Đề bài** ([requirement.md](D:\work\papaya\requirement.md)): xây engine state machine điều phối vòng đời claim gồm preconditions, side effects, phân quyền theo role, audit trail bất biến và giới hạn vòng lặp; có CLI hoặc web; tối thiểu 15 test; chạy 5 kịch bản; chứng minh thêm state/transition chỉ cần sửa config (kèm diff). Khung thời gian 5–8 giờ. Bài chấm cả **cách phân rã vấn đề, cách điều khiển AI tool** và yêu cầu **ước lượng timeline**.
- **Hiện trạng máy**:
  - thư mục chỉ có `requirement.md`, chưa có code để tái sử dụng;
  - Node v24.11.1, npm 11.6.2;
  - git 2.56 chỉ chạy được qua Git Bash;
  - **chưa có** `gh`, Docker, PostgreSQL hay WSL.
- **Đã chốt**:
  - Stack: TypeScript/Node.js + **PostgreSQL 17 cài trực tiếp trên Windows**.
  - Giao diện: CLI + Web UI gọn.
  - Quy tắc nghiệp vụ thêm: chỉ assessor được giao mới thao tác trên claim; SoD + maker-checker.
  - Kỹ thuật thêm: audit hash-chain; outbox + idempotency.
  - DENIED ghi vào bảng riêng, gộp theo phút.
  - Claim được **pin theo `config_hash`**.
  - **Giữ đủ phạm vi, ước lượng khoảng 12,5 giờ.**
  - Chỉ ghi vào phần đề xuất, không làm: kiểm tra hạn mức còn lại, SLA timer, báo cáo KPI.

### Thay đổi so với bản trước (theo review của bạn)

| Review | Áp dụng tại |
|---|---|
| Gộp commands vào transitions, khai báo `inputs` và `templates` trong config (mục 1, 2) | §2.1, §5 |
| Gọi transition theo id, dùng counter vòng lặp có tên (mục 4, 5) | §2.2, §6 |
| Kiểm tra tĩnh mọi path trong DSL, lưu config hash vào DB (mục 7, 8) | §2.3, §5.3, §7.4 |
| `BEGIN IMMEDIATE`, ghi idempotency trong cùng transaction, nhận việc outbox nguyên tử, lưu mock gateway vào DB (mục 11, 12). Với PostgreSQL: `SELECT … FOR UPDATE`, advisory lock, `SKIP LOCKED` + lease | §7.2, §7.5 |
| **A1**: lưu `changes` + `snapshot_hash` trong audit; verify claim row so với entry cuối | §2.5, §7.3 |
| **A2**: snapshot dữ liệu tham chiếu và config hash vào mỗi quyết định (`decision_context`) | §2.5, §7.3 |
| **A3 + B3**: FK, kiểu dữ liệu chặt, CHECK, generated column, danh sách index trong migration (bản PostgreSQL tương đương của `foreign_keys`/`STRICT`) | §7.1 |
| **B1**: lưu `counters` và `participants` trong claim; engine không đọc lịch sử audit; giới hạn ghi `*_DENIED` | §2.4, §7.1 |
| **B5/B6**: dispatch outbox không chặn CLI (worker tách riêng); scenario runner chạy cùng tiến trình | §7.5, §9 |
| Đổi SQLite sang PostgreSQL | §3, §7 |

---

## 1. Quy trình thực tế (tóm tắt nghiên cứu)

### 1.1 Bồi thường bảo hiểm sức khỏe dạng bồi hoàn tại Việt Nam, đối chiếu với state của spec

| Bước thực tế | Nội dung chính | State trong spec |
|---|---|---|
| Tiếp nhận | Giấy yêu cầu bồi thường + chứng từ y tế + hóa đơn. Luật cho thời hạn nộp **1 năm** kể từ sự kiện bảo hiểm (Điều 30 Luật KDBH 2022) | SUBMITTED |
| Kiểm tra hồ sơ | Kiểm tra đủ và hợp lệ. Ngoại trú: đơn thuốc/sổ khám, hóa đơn/biên lai, chỉ định + kết quả cận lâm sàng. Nội trú: giấy ra viện, bảng kê chi tiết, hóa đơn, giấy chứng nhận phẫu thuật (nếu có). Phải có dấu cơ sở y tế | DOCUMENTS_VERIFIED |
| Phân công & thẩm định | Hiệu lực hợp đồng, thời gian chờ, điều khoản loại trừ, bệnh có sẵn, hạn mức/đồng chi trả, tính hợp lý của chi phí, dấu hiệu trục lợi (FWA) | UNDER_ASSESSMENT |
| Yêu cầu bổ sung | Thời hạn chi trả tính từ khi nhận **đủ hồ sơ hợp lệ**, nên side effect "reset assessment timer" của spec khớp với thực tế | PENDING_INFO |
| Phê duyệt | Theo phân cấp thẩm quyền; hồ sơ giá trị lớn phải trình cấp trên (four-eyes) | APPROVED |
| Từ chối | Bắt buộc **giải thích bằng văn bản lý do** (Điều 20.2.e), kèm hướng dẫn khiếu nại | REJECTED |
| Thanh toán | Theo thời hạn hợp đồng; nếu không thỏa thuận thì **15 ngày** kể từ khi nhận đủ hồ sơ hợp lệ; chậm thì phải trả lãi (Điều 31) | PAYMENT_INITIATED |
| Đóng & lưu trữ | Lưu trữ hồ sơ theo quy định pháp luật (Điều 20.2.h) | CLOSED |
| Khiếu nại/tranh chấp | Thương lượng trước, sau đó hòa giải, trọng tài hoặc tòa án (Điều 32); giám định viên độc lập khi bất đồng (Điều 53) | *(spec chưa có)* |

**Bảo lãnh viện phí (direct billing)** là một workflow khác hẳn, với SLA tính bằng phút/giờ (ví dụ một DNBH công bố: ngoại trú 30 phút, nội trú 24h, xuất viện 2h). Vì vậy engine nên hỗ trợ nhiều workflow definition có version.

### 1.2 Ràng buộc pháp lý và dữ liệu

- Từ chối **bắt buộc có lý do**; thông báo gửi khách hàng phải kèm lý do, hạn khiếu nại và cách khiếu nại.
- Lưu mốc "đủ hồ sơ hợp lệ" và cập nhật lại mỗi lần nhận hồ sơ bổ sung (Điều 31).
- Thời hạn nộp hồ sơ: một số quy tắc DNBH ghi 90 ngày, Luật ghi 1 năm. Để là cấu hình (`filing_deadline`) và cần pháp chế xác nhận.
- **Dữ liệu sức khỏe là dữ liệu cá nhân nhạy cảm** (Luật BVDLCN 91/2025/QH15 và NĐ 356/2025, hiệu lực 01/01/2026). Vì vậy: tối thiểu hóa PII, che PII khi in log, không ghi chẩn đoán vào ô text tự do.

### 1.3 Thực tiễn vận hành

- Phân cấp thẩm quyền theo số tiền; maker-checker; tách người duyệt khỏi người chi tiền.
- Dấu hiệu FWA: claim phát sinh sớm sau ngày hiệu lực hợp đồng, hóa đơn trùng, tần suất bất thường, số tiền bất thường.
- KPI: TAT theo từng bước, pend rate, first-pass, STP, trễ SLA. Benchmark của vendor (chỉ tham khảo): chu kỳ ≤ 14 ngày, pend ≤ 10%.

### 1.4 Khoảng trống của spec

1. Không xử lý được hồ sơ thiếu ngay từ SUBMITTED.
2. Không có trạng thái thanh toán thất bại.
3. Không có luồng khiếu nại, dù spec có nhắc "appeal instructions".
4. Không có escalation, dù message lỗi yêu cầu "escalate to team lead".
5. Không có rút/hủy hay mở lại hồ sơ.

Cách xử lý: làm mục 3 **chỉ bằng config** (workflow v2) để demo diff. Mục 1, 2, 4 ghi thành đoạn YAML mẫu trong `docs/extending-the-workflow.md`.

---

## 2. Quyết định thiết kế chính

### 2.1 Mọi thao tác đều là transition khai báo trong config

Có 3 loại transition, phân biệt theo việc có khai báo `from`/`to` hay không:

| Loại | Cách khai báo | Ví dụ |
|---|---|---|
| Tạo claim | Không có `from` | `submit_claim`: tạo claim ở SUBMITTED |
| Đổi state | Có cả `from` và `to` | 9 transition của spec |
| In-state action | Không có `to` (giữ nguyên state) | `attach_document`, `provide_info`, `assign_assessor`, `submit_assessment`, `cosign_approval`, `confirm_payment`, `acknowledge_rejection` |

- Mỗi transition khai báo trong config: `inputs` (có kiểu), `roles`, `authorization`, `increments`, `preconditions`, `effects`.
- Effect `notify` tham chiếu tới `templates` cũng nằm trong config.
- Không còn handler command viết bằng code. Thêm state, thao tác, input, thông báo hay rule đều chỉ sửa YAML.
- Chỉ khi cần **loại** primitive mới hoặc **tích hợp** mới (ví dụ một payment gateway thật) mới phải viết code. Ranh giới này ghi rõ trong README.
- Web UI sinh form động từ `inputs`, nên UI cũng không cần sửa khi config đổi.

### 2.2 Gọi transition theo id; vòng lặp dùng counter có tên

- API: `POST /claims/:id/transitions/:transitionId`. CLI: `claims run <claim> <transition_id>`.
- Kịch bản 4 ("SUBMITTED → APPROVED") được thực hiện bằng cách gọi `approve` khi claim đang ở SUBMITTED. Kết quả là lỗi `INVALID_TRANSITION` kèm danh sách thao tác đang khả dụng và đường đi tới APPROVED.
- Khai báo `counters: { info_requests: { max: 3, message: "Maximum information requests exceeded — escalate to team lead" } }`. Transition `request_info` khai báo `increments: [info_requests]`. Engine chặn khi `counters.info_requests >= max`.
- Validator tĩnh: **mọi chu trình trên đồ thị state phải đi qua ít nhất một transition tăng một counter có `max`**. Vi phạm thì in ra đường đi của chu trình.
- In-state action không tính là chu trình. Chúng bị chặn trên bởi `max_actions_per_claim`.

### 2.3 DSL được kiểm tra tĩnh hoàn toàn

- Tham chiếu dùng cú pháp `$path`, ví dụ `$claim.assessment.approved_amount`, `$policy.coverage_limit`, `$input.reason`, `$settings.four_eyes_threshold`, `$actor.user_id`, `$now`, `$uuid`. Chèn giá trị vào message/template dùng `{path|filter}`.
- Kiểu của context được ghép từ:
  - field có sẵn của claim, policy và actor;
  - `fields` (schema dữ liệu claim khai báo trong config);
  - `inputs` của **đúng** transition đó;
  - `settings` (có kiểu);
  - `counters`, `participants`.
- Validator bắt được:
  - path sai, kèm gợi ý "did you mean";
  - `input.x` mà transition không khai báo;
  - `compare` giữa hai kiểu không so sánh được (ví dụ money với date);
  - effect `set`/`append` ghi vào field chưa khai báo hoặc sai kiểu;
  - placeholder trong template không hợp lệ;
  - tham chiếu role, enum, counter, rule, template hay transition id không tồn tại;
  - state không tới được, state cụt, transition tạo claim không hợp lệ.

### 2.4 Engine là hàm thuần, chỉ đọc snapshot của claim

- Claim row chứa `counters`, `participants` (danh sách user đã thực hiện từng transition id, dùng cho SoD) và `state_entered_at`.
- Engine **không đọc lịch sử audit** khi đánh giá. Nó chỉ nhận vào: snapshot + dữ liệu tham chiếu (policy, user) + input + `now`.

### 2.5 Audit chứng minh được toàn vẹn

Mỗi entry lưu:
- `changes`: JSON Patch theo RFC 6902;
- `snapshot_hash`: SHA-256 của claim sau thay đổi;
- `decision_context`: các giá trị engine đã đọc (hạn mức, ngưỡng, role user đang giữ…) cùng `config_hash`;
- `prev_hash` và `hash` (HMAC-SHA256).

`verify` kiểm tra 4 điều:
1. chain còn nguyên;
2. replay `changes` khớp từng `snapshot_hash`;
3. **claim row hiện tại khớp entry cuối**; nếu không khớp thì in ra diff các field đã bị sửa trực tiếp;
4. definition trong DB chưa bị sửa.

### 2.6 Bảo vệ ở tầng PostgreSQL

- Trigger append-only cho UPDATE, DELETE và cả TRUNCATE.
- Constraint trigger *deferred*: mọi UPDATE trên `claims` phải đi kèm một audit entry có cùng version.
- Trigger kiểm tra state phải có trong definition mà claim đã pin.
- Role DB tối thiểu quyền: app chỉ có `SELECT`/`INSERT` trên audit.

### 2.7 Config versioning

- `config_hash` = SHA-256 của config đã chuẩn hóa (bản canonical JSON, không phải text YAML), nên sửa comment hay format không làm đổi hash.
- Definition được lưu bất biến trong bảng `workflow_definitions`.
- Cùng `(workflow_id, version)` mà hash khác thì từ chối khởi động (`CONFIG_VERSION_NOT_BUMPED`).
- Claim mới lấy definition hiện tại; claim cũ chạy tiếp theo definition đã pin.

### 2.8 Side effects

- *Internal* (`set`, `append`, `clear`): áp dụng trong cùng transaction. Ví dụ tạo payment request phải là internal vì transition kế tiếp cần nó làm precondition.
- *External* (`notify`, `trigger_payment`, `log`): đi qua **transactional outbox**. Worker riêng xử lý theo kiểu at-least-once, handler idempotent, mock gateway và notification lưu trong DB.

### 2.9 Các lần bị từ chối

- Ghi vào bảng `denied_attempts` (append-only, **không** nằm trong hash chain/snapshot của claim).
- Mỗi bộ (claim, user, transition, mã lỗi) tối đa một dòng mỗi phút.

### 2.10 Vì sao không dùng XState

- Guard của XState chỉ trả về true/false, nên vẫn phải tự viết phần giải thích vì sao bị chặn.
- Graph của bài là graph phẳng.
- Engine tự viết khoảng 500 dòng, dễ giải thích khi phỏng vấn.

---

## 3. Tech stack

| Lớp | Lựa chọn |
|---|---|
| Runtime | Node.js 24 LTS (`engines >=22`), TypeScript strict, ESM, `tsx`; `.env` nạp bằng `process.loadEnvFile()` |
| Config | `yaml` + Zod 4 (sinh `workflow.schema.json` qua `z.toJSONSchema()` cho autocomplete trong VS Code) |
| DB | **PostgreSQL 17** (Windows bản native; repo có `docker-compose.yml` cho người chấm; CI dùng service `postgres:17`) |
| Truy cập DB | `pg` (node-postgres) + SQL viết tay; migration runner tự viết, có checksum (`schema_migrations`) |
| Toàn vẹn | `canonicalize` (RFC 8785), `fast-json-patch` (RFC 6902), `node:crypto` (SHA-256, HMAC) |
| CLI | `commander` + `@clack/prompts` + `picocolors` + `cli-table3` |
| API | Fastify 5 + Zod; lỗi theo RFC 9457 `problem+json` |
| Web | React 19 + Vite + TanStack Query + Tailwind v4 + Mermaid |
| Test | Vitest (+ coverage v8), PostgreSQL thật, mỗi file test một schema riêng |
| Chất lượng | Biome, `tsc --noEmit`, GitHub Actions |

- Chỉ dùng **một `package.json`**; Vite đặt `root = web/`.
- Không dùng ORM: cần viết SQL cho trigger, CHECK và generated column.
- npm script phải chạy được trên cả Windows lẫn Unix; tham số truyền qua flag, không dùng biến môi trường inline.

---

## 4. Kiến trúc và cấu trúc repo

Phụ thuộc một chiều: `cli` / `api` / `web` → `app` → `engine` (pure). `infra` implement các port (repos, outbox, gateway, clock).

```
D:\work\papaya\                                  (giữ nguyên requirement.md)
├─ config/   workflow.yaml (v1) · seed.yaml · workflow.schema.json · examples/workflow.appeal.yaml (v2)
├─ src/
│  ├─ engine/   schema.ts · types-ctx.ts (kiểu của context) · validate.ts (tham chiếu, đồ thị, path/kiểu)
│  │            graph.ts · resolver.ts (đọc $path + ghi lại decision_context) · conditions.ts · effects.ts
│  │            templates.ts · engine.ts (evaluate, dry-run) · errors.ts · hash.ts · mermaid.ts
│  ├─ domain/   types.ts
│  ├─ app/      claim-service.ts · definition-registry.ts · auto-advance.ts · verify.ts · clock.ts
│  ├─ infra/    db/pool.ts · db/migrate.ts · db/migrations/001_init.sql … · repos/*.ts
│  │            outbox/worker.ts · outbox/handlers/(notify, trigger-payment, log).ts · mock-gateway.ts
│  ├─ cli/      index.ts · commands/*.ts · render.ts · interactive.ts
│  ├─ api/      server.ts · routes/*.ts · problem.ts
│  └─ scenarios/ run.ts · scenarios.ts
├─ scripts/  db-setup.ts (tạo role + database) · tamper-demo.ts
├─ web/src/  App · UserSwitcher · ClaimList · ClaimDetail · ActionsPanel (form động) · StateDiagram · AuditTimeline
├─ tests/    unit/ · integration/ · fixtures/*.yaml · helpers/pg-schema.ts
├─ docs/     design.md · domain-research.md · extending-the-workflow.md · ai-workflow.md · results/
└─ README.md · CLAUDE.md · docker-compose.yml · .env.example · biome.json · tsconfig.json · vitest.config.ts · .github/workflows/ci.yml
```

Quy ước đặt tên: dữ liệu (YAML, DB, JSON) dùng `snake_case`, khớp tên trường trong spec (`from_state`, `to_state`, `triggered_by`); identifier TypeScript dùng camelCase. Ghi vào `CLAUDE.md`.

---

## 5. Thiết kế config

### 5.1 Các phần của file

| Phần | Nội dung |
|---|---|
| `workflow` | `id`, `version`, `initial_state` |
| `settings` | Có khai báo kiểu: `appeal_period` (duration, P30D, placeholder), `four_eyes_threshold` (money, 50.000.000, placeholder), `filing_deadline` (duration, P1Y), `max_actions_per_claim` |
| `roles` | Danh sách role; `system` được đánh dấu `service_account_only` |
| `enums` | `document_type`, `rejection_reason` (mã lý do chuẩn) |
| `document_requirements` | Danh sách chứng từ bắt buộc theo loại claim; enum `claim_type` sinh từ các key này |
| `fields` | Schema dữ liệu claim: `documents`, `assessor_id`, `assessment`, `cosign`, `info_requests`, `info_responses`, `rejection`, `payment_request`, `payment`, `timers`, `archived_at` … |
| `counters` | Counter có tên, có `max` |
| `rules` | Điều kiện đặt tên, tái sử dụng |
| `templates` | Mẫu thông báo |
| `states` | Danh sách state |
| `transitions` | Danh sách transition |

**Primitive điều kiện**

| Primitive | Ý nghĩa |
|---|---|
| `field_present` | Một path có giá trị |
| `compare` | `eq, neq, lt, lte, gt, gte, in`; toán hạng là `$path` hoặc literal |
| `documents_present` | Đủ chứng từ theo loại claim |
| `received_since_state_entry` | Có mục mới kể từ khi vào state hiện tại |
| `duration_elapsed` | Đã qua một khoảng thời gian kể từ một mốc |
| `has_role` | Một user có role nhất định |
| `not_performed` | SoD, đọc từ `participants` |
| `all_of` / `any_of` / `not` | Kết hợp điều kiện |
| `ref` | Tham chiếu rule đã đặt tên |

**Effect**

| Loại | Primitive |
|---|---|
| Internal | `set`, `append`, `clear`; giá trị có thể là literal, `$path`, `$now`, `$uuid`, `{ fn: add, args: [$now, $settings.appeal_period] }` |
| External | `notify {template}`, `trigger_payment {amount, reference}`, `log {message}` |

**Path chưa có giá trị**: lúc chạy, mọi phép so sánh với path chưa có giá trị đều trả false, không throw. Muốn kiểm tra sự tồn tại thì dùng `field_present`. Validator vẫn bắt các path *không được khai báo* ngay khi load config.

**Input** có kiểu: `text`, `string`, `money`, `integer`, `date`, `timestamp`, `enum`, `user_ref` (có thể kèm `role`), `policy_ref`; các ràng buộc `required`, `min`, `max`, `max_length`.
- Quy ước tên: `input.reason` và `input.notes` được ghi vào cột `reason` và `notes` của audit.
- Mọi transition đều nhận `notes` (không bắt buộc).

### 5.2 Trích `config/workflow.yaml` (v1)

```yaml
# yaml-language-server: $schema=./workflow.schema.json
workflow: { id: health_claim_reimbursement, version: 1, initial_state: SUBMITTED }
counters:
  info_requests: { max: 3, message: "Maximum information requests exceeded — escalate to team lead" }
rules:
  assigned_assessor: { type: compare, left: $actor.user_id, op: eq, right: $claim.assessor_id, code: NOT_ASSIGNED_ASSESSOR }
  not_decision_maker: { type: not_performed, user: $actor.user_id, actions: [submit_assessment, approve, cosign_approval], code: SOD_VIOLATION }
  four_eyes:
    type: any_of
    code: FOUR_EYES_REQUIRED
    message: "{claim.assessment.approved_amount|money} exceeds {settings.four_eyes_threshold|money}: team lead co-sign for this exact amount required"
    conditions:
      - { type: compare, left: $claim.assessment.approved_amount, op: lte, right: $settings.four_eyes_threshold }
      - type: all_of
        conditions:
          - { type: compare, left: $claim.cosign.amount, op: eq, right: $claim.assessment.approved_amount }
          - { type: compare, left: $claim.cosign.user_id, op: neq, right: $actor.user_id }
templates:
  claim_rejected:
    to: member
    subject: "Claim {claim.claim_no}: decision"
    body: "Not approved ({claim.rejection.reason_code}): {claim.rejection.reason}. You may appeal until {claim.rejection.appeal_deadline|date}."
transitions:
  - id: submit_claim                 # không có `from` → transition tạo claim
    to: SUBMITTED
    roles: [member, document_clerk]
    inputs:
      policy_id:      { type: policy_ref, required: true }
      claim_type:     { type: enum, enum: claim_type, required: true }
      claimed_amount: { type: money, min: 1, required: true }
      treatment_date: { type: date, required: true }
    preconditions:
      - { type: not, code: FILING_DEADLINE_PASSED,
          condition: { type: duration_elapsed, since: $input.treatment_date, duration: $settings.filing_deadline } }
  - id: attach_document              # không có `to` → in-state action
    from: [SUBMITTED, PENDING_INFO]
    roles: [member, document_clerk]
    inputs: { document_type: { type: enum, enum: document_type, required: true }, file_name: { type: string, max_length: 255 } }
    effects:
      - { type: append, path: claim.documents,
          value: { type: $input.document_type, file_name: $input.file_name, received_at: $now, received_by: $actor.user_id } }
  - id: request_info
    from: UNDER_ASSESSMENT
    to: PENDING_INFO
    roles: [assessor]
    inputs: { reason: { type: text, required: true, max_length: 2000 } }
    authorization: [{ ref: assigned_assessor }]
    increments: [info_requests]
    effects:
      - { type: append, path: claim.info_requests, value: { description: $input.reason, requested_by: $actor.user_id, requested_at: $now } }
      - { type: notify, template: info_requested }
  - id: reject
    from: UNDER_ASSESSMENT
    to: REJECTED
    roles: [assessor]
    inputs: { reason_code: { type: enum, enum: rejection_reason, required: true }, reason: { type: text, required: true } }
    authorization: [{ ref: assigned_assessor }]
    preconditions: [{ type: field_present, path: $claim.assessment.summary, code: ASSESSMENT_INCOMPLETE }]
    effects:
      - { type: set, path: claim.rejection, value: { reason_code: $input.reason_code, reason: $input.reason, rejected_at: $now,
                                                     appeal_deadline: { fn: add, args: [$now, $settings.appeal_period] } } }
      - { type: notify, template: claim_rejected }
  - id: close_rejected
    from: REJECTED
    to: CLOSED
    roles: [system]
    automatic: true
    preconditions:
      - type: any_of
        code: APPEAL_WINDOW_OPEN
        conditions:
          - { type: compare, left: $now, op: gte, right: $claim.rejection.appeal_deadline }
          - { type: field_present, path: $claim.rejection.acknowledged_at }
    effects: [{ type: set, path: claim.archived_at, value: $now }]
```

### 5.3 Transitions của config v1

**Đổi state** (đúng bảng spec, cộng các rule bạn đã chọn)

| id | from → to | Role | ABAC | Counter | Preconditions | Effects |
|---|---|---|---|---|---|---|
| verify_documents | SUBMITTED → DOCUMENTS_VERIFIED | document_clerk | – | – | `documents_present` | Ghi mốc đủ hồ sơ; notify assessor team |
| start_assessment | DOCUMENTS_VERIFIED → UNDER_ASSESSMENT | team_lead | – | – | Đã có assessor | Ghi thời điểm bắt đầu thẩm định; log |
| approve | UNDER_ASSESSMENT → APPROVED | assessor | assigned_assessor | – | Báo cáo thẩm định đủ; `approved_amount ≤ policy.coverage_limit`; `four_eyes` | `set payment_request {id: $uuid, amount}`; notify |
| reject | UNDER_ASSESSMENT → REJECTED | assessor | assigned_assessor | – | Báo cáo thẩm định đủ; `reason` + `reason_code` bắt buộc | Lưu lý do + hạn khiếu nại; notify kèm lý do và hướng dẫn khiếu nại |
| request_info | UNDER_ASSESSMENT → PENDING_INFO | assessor | assigned_assessor | info_requests (3) | `reason` bắt buộc | Lưu yêu cầu; notify |
| info_received | PENDING_INFO → DOCUMENTS_VERIFIED | document_clerk | – | – | `received_since_state_entry` (chứng từ hoặc thông tin mới) | Reset assessment timer; cập nhật mốc đủ hồ sơ |
| initiate_payment | APPROVED → PAYMENT_INITIATED | finance | not_decision_maker | – | Đã có payment request | `trigger_payment` (outbox) |
| close_paid | PAYMENT_INITIATED → CLOSED | finance | not_decision_maker | – | Đã có `payment.confirmation_ref` | notify kèm mã thanh toán |
| close_rejected | REJECTED → CLOSED | system (tự động) | – | – | Hết hạn khiếu nại **hoặc** khách hàng đã xác nhận | archive |

**Tạo claim và in-state action**

| id | Từ state | Role | Rule chính |
|---|---|---|---|
| submit_claim | (tạo mới) | member, document_clerk | Member chỉ tạo claim cho hợp đồng của mình; hợp đồng còn hiệu lực vào ngày điều trị; chưa quá `filing_deadline` |
| attach_document / provide_info | SUBMITTED, PENDING_INFO / PENDING_INFO | member, document_clerk | Member chỉ thao tác trên claim của mình |
| assign_assessor | DOCUMENTS_VERIFIED, UNDER_ASSESSMENT | team_lead | `has_role(input.assessor_id, assessor)`; SoD: người được giao chưa từng `verify_documents`/`info_received` claim này; xóa co-sign cũ |
| submit_assessment | UNDER_ASSESSMENT | assessor | assigned_assessor; xóa co-sign cũ (tránh co-sign cho số tiền cũ) |
| cosign_approval | UNDER_ASSESSMENT | team_lead | Đã có `approved_amount`; người co-sign khác assessor; ghi đúng số tiền tại thời điểm ký |
| confirm_payment | PAYMENT_INITIATED | finance | not_decision_maker; `payment_reference` bắt buộc |
| acknowledge_rejection | REJECTED | member | Chủ claim; sau khi chạy, `close_rejected` tự động chạy tiếp |

### 5.4 Seed data (`config/seed.yaml`)

- **Users đơn role**: `u_clerk_01`, `u_lead_01`, `u_assessor_01`, `u_assessor_02`, `u_finance_01`, `u_member_01`, `u_member_02`.
- **Users đa role** (để demo SoD): `u_dual_ca` (clerk + assessor), `u_dual_af` (assessor + finance).
- **Service account**: `svc_system`.
- **Hợp đồng**: `POL-001` hạn mức 100.000.000 VND; `POL-002` hạn mức 5.000.000 VND.

---

## 6. Engine: thứ tự kiểm tra và mã lỗi

Hàm thuần: `evaluate(definition, snapshot | null, { transition_id, actor, input, expected_version }, refs, now)`.

**Thứ tự kiểm tra**:
1. Transition id tồn tại.
2. State hiện tại không phải terminal.
3. State hiện tại nằm trong `from` của transition.
4. Version khớp (nếu client gửi `expected_version`).
5. Kiểu input hợp lệ.
6. RBAC.
7. ABAC.
8. Counter và giới hạn an toàn.
9. Preconditions (gồm input bắt buộc); **báo tất cả lỗi cùng lúc**.
10. Lập *plan*: snapshot mới (state, `state_entered_at`, version, counters, participants), `changes`, `snapshot_hash`, `decision_context`, các message outbox (template đã render), bản nháp audit entry.

`availableTransitions()` dùng cùng pipeline ở chế độ dry-run, trả về checklist ✓/✗ và danh sách input cần nhập.

| Mã lỗi | HTTP | Ví dụ message |
|---|---|---|
| UNKNOWN_TRANSITION | 400 | `Unknown transition 'aprove'. Did you mean 'approve'?` |
| TERMINAL_STATE | 409 | `Claim CLM-2026-000001 is CLOSED (terminal)` |
| INVALID_TRANSITION | 409 | `'approve' (UNDER_ASSESSMENT → APPROVED) is not available: claim is SUBMITTED. Available: verify_documents → DOCUMENTS_VERIFIED [document_clerk], attach_document [member, document_clerk]. Path to APPROVED: verify_documents → start_assessment → approve` |
| CONCURRENT_MODIFICATION | 409 | `Expected version 3, current 4 — reload and retry` |
| INVALID_INPUT | 400 | `input.claimed_amount must be an integer ≥ 1 (got "abc")` |
| ROLE_NOT_ASSIGNED / SERVICE_ACCOUNT_ONLY | 403 | `User u_assessor_01 does not hold role 'finance'` |
| UNAUTHORIZED_ROLE | 403 | `Role 'assessor' cannot run verify_documents (SUBMITTED → DOCUMENTS_VERIFIED). Required: document_clerk` |
| ACCESS_DENIED (`NOT_ASSIGNED_ASSESSOR`, `SOD_VIOLATION`, `NOT_CLAIM_OWNER`) | 403 | `Segregation of duties: u_dual_af took part in the decision and cannot initiate payment` |
| CYCLE_LIMIT_EXCEEDED | 422 | `Maximum information requests exceeded — escalate to team lead` (counter info_requests 3/3) |
| PRECONDITION_FAILED (danh sách mã con) | 422 | `DOCUMENTS_MISSING: prescription` · `INPUT_REQUIRED: reason` · `FOUR_EYES_REQUIRED: …` |
| IDEMPOTENCY_KEY_REUSED | 422 | `Idempotency key reused with a different request` |

---

## 7. PostgreSQL: schema, transaction, audit, outbox

### 7.1 Migration `001_init.sql` (dữ liệu được ràng buộc chặt)

| Bảng | Cột chính | Ràng buộc và index |
|---|---|---|
| `workflow_definitions` | `config_hash` PK, `workflow_id`, `version`, `content` JSONB, `registered_at` | `UNIQUE(workflow_id, version)`; CHECK hash `^[0-9a-f]{64}$`; trigger chặn UPDATE/DELETE/TRUNCATE |
| `users`, `policies` | Seed | CHECK `cardinality(roles) > 0`; `coverage_limit > 0`; `effective_to > effective_from`; `currency = 'VND'` |
| `claims` | `id` UUID, `claim_no`, `config_hash` FK, `policy_id` FK, `member_id`, `claim_type`, `claimed_amount` BIGINT, `state`, `state_entered_at`, `version`, `data` / `counters` / `participants` JSONB, `created_at`, `updated_at` | CHECK amount trong khoảng `(0, 2^53)`, `version ≥ 1`, `claim_no ~ '^CLM-\d{4}-\d{6}$'`, các cột JSONB phải là object; **generated** `assessor_id` = `data->>'assessor_id'` STORED; index `(state)`, `(assessor_id) WHERE NOT NULL`, `(policy_id)`, `(member_id)` |
| `audit_log` | `id` identity, `entry_id`, `claim_id` FK, `claim_seq`, `transition_id`, `from_state`, `to_state`, `actor_user_id` FK, `actor_role`, `reason`, `notes`, `input`, `changes`, `decision_context`, `effects`, `config_hash` FK, `claim_version`, `snapshot_hash`, `prev_hash`, `hash`, `occurred_at` | `UNIQUE(claim_id, claim_seq)`; CHECK `(claim_seq = 1) = (from_state IS NULL)`; CHECK `changes` là array; CHECK format hash; **generated** `state_changed` = `from_state IS DISTINCT FROM to_state`; index `(actor_user_id, occurred_at)`, `(transition_id)`; trigger append-only |
| `denied_attempts` | `claim_id`, `actor_user_id`, `actor_role`, `transition_id`, `error_code`, `message`, `details`, `occurred_at`, `bucket_start` | **`UNIQUE NULLS NOT DISTINCT (claim_id, actor_user_id, transition_id, error_code, bucket_start)`** + `ON CONFLICT DO NOTHING` (gộp theo phút); trigger append-only; index `(occurred_at)` |
| `outbox` | `id`, `claim_id` FK, `audit_entry_id` FK, `effect_type`, `payload`, `idempotency_key` UNIQUE, `status`, `attempts`, `next_attempt_at`, `locked_by`, `locked_until`, `last_error`, `result`, `processed_at` | CHECK `status IN (PENDING, PROCESSING, DONE, FAILED, DEAD)`; CHECK `(status = 'PROCESSING') = (locked_until IS NOT NULL)`; partial index `(next_attempt_at) WHERE status IN ('PENDING','FAILED')` và `(locked_until) WHERE status = 'PROCESSING'` |
| `idempotency_keys` | `key` PK, `actor_user_id` FK, `request_hash`, `claim_id` FK, `response`, `created_at` | Index `(created_at)` để dọn dẹp |
| `mock_gateway_payments`, `mock_gateway_faults`, `mock_notifications` | Trạng thái của mock lưu trong DB | `UNIQUE(idempotency_key)`, `UNIQUE(gateway_ref)`; faults là một dòng duy nhất `CHECK (id = 1)`, `remaining_failures ≥ 0` |
| `schema_migrations` | `version`, `checksum`, `applied_at` | Runner từ chối chạy nếu một migration đã áp dụng bị sửa |

**Trigger**
- `forbid_mutation()`: `BEFORE UPDATE OR DELETE` (theo row) và `BEFORE TRUNCATE` (theo statement), áp cho `audit_log`, `denied_attempts`, `workflow_definitions`.
- Constraint trigger `DEFERRABLE INITIALLY DEFERRED` trên `claims`: phải tồn tại audit entry có `(claim_id, claim_version = NEW.version)`.
- `BEFORE INSERT OR UPDATE OF state` trên `claims`: `content->'states' ? NEW.state` trong definition đã pin.

**Role**
- `claims_owner` chạy migration.
- `claims_app` chạy runtime, được cấp quyền:
  - `SELECT`/`INSERT` trên audit, denied và definitions;
  - `SELECT`/`INSERT`/`UPDATE` trên claims, outbox và mock;
  - **không** có DELETE/TRUNCATE trên bảng nào.

### 7.2 Luồng ghi (một transaction, READ COMMITTED)

1. `BEGIN`.
2. Nếu có idempotency key: `pg_advisory_xact_lock(hashtextextended(key, 0))`.
3. `SELECT … FROM claims WHERE id = $1 FOR UPDATE`: khóa trước rồi mới đọc. Đây là bản tương đương `BEGIN IMMEDIATE` của SQLite. Thứ tự khóa luôn là advisory lock rồi tới row lock, để tránh deadlock.
   - Transition tạo claim (`submit_claim`) chưa có row để khóa nên bỏ qua bước này. Các request trùng idempotency key vẫn được tuần tự hóa nhờ advisory lock ở bước 2.
4. Kiểm tra idempotency:
   - đã có key và cùng `request_hash` → trả lại response đã lưu, `COMMIT`, không sinh effect mới;
   - cùng key nhưng request khác → `IDEMPOTENCY_KEY_REUSED`.
5. Lấy definition đã pin (registry, cache theo hash), policy và user → `engine.evaluate`.
6. **Nếu lỗi**: `ROLLBACK`, sau đó dùng một transaction ngắn riêng để `INSERT denied_attempts … ON CONFLICT DO NOTHING`, rồi trả lỗi.
7. **Nếu thành công**, trong cùng transaction:
   - `UPDATE claims … WHERE id = $1 AND version = $old`;
   - `INSERT audit_log` (đọc head của chain theo `(claim_id, claim_seq)`; đã khóa row nên an toàn);
   - `INSERT outbox`;
   - `INSERT idempotency_keys` (response);
   - `NOTIFY outbox_new`;
   - `COMMIT`.
8. Auto-advance: các transition `automatic` của state mới được chạy bằng `svc_system`, mỗi lần một transaction.

Mọi timestamp đều do app sinh từ clock đã inject, độ chính xác mili giây, để hash ổn định (Postgres lưu tới micro giây).

### 7.3 Audit và `verify`

- `hash = HMAC_SHA256(AUDIT_HMAC_KEY, canonical(entry không gồm hash) ‖ prev_hash)`; entry đầu dùng `prev_hash = "GENESIS"`.
- `snapshot_hash = SHA-256(canonical(claim snapshot))`.
- `decision_context = { config_hash, reads: { "policy.coverage_limit": 100000000, "settings.four_eyes_threshold": …, "actor.roles_held": [...] }, checks: [{ stage, code, ok }] }`. Với `field_present`, chỉ ghi true/false (không lưu text, để tránh lộ PII).
- `claims verify <claim>` (và `--all`) kiểm tra:
  1. `claim_seq` liên tục, chain đúng;
  2. replay `changes` từ trạng thái rỗng, khớp từng `snapshot_hash`;
  3. snapshot của claim row hiện tại khớp `snapshot_hash` và `claim_version` của entry cuối; nếu lệch thì báo **CLAIM_ROW_TAMPERED** kèm diff;
  4. hash của definition khớp nội dung đã lưu.

  Lệnh trả về lỗi đầu tiên tìm thấy, hoặc ✓.
- `scripts/tamper-demo.ts` chạy bằng quyền owner: sửa trực tiếp claim row hoặc một audit entry (sau khi tắt trigger), rồi cho `verify` phát hiện.

### 7.4 Definition registry và pinning

- Khi khởi động (CLI, API hay worker): load → validate → chuẩn hóa → hash → `INSERT … ON CONFLICT DO NOTHING`.
- Cùng version nhưng khác hash → `CONFIG_VERSION_NOT_BUMPED`.
- Claim mới pin definition hiện tại. Claim cũ được đánh giá bằng `content` của definition đã pin, đọc từ DB (validate lại và kiểm tra hash).
- `claims config list` liệt kê các definition đã đăng ký.

### 7.5 Outbox worker (không chặn CLI)

- CLI commit xong là thoát ngay và in "N effects queued". `claims worker` là tiến trình chạy lâu dài: `LISTEN outbox_new`, và poll mỗi 2 giây để dự phòng.
- Nhận việc nguyên tử:
  ```sql
  UPDATE outbox SET status = 'PROCESSING', locked_by = $w, locked_until = $now + interval '30 seconds', attempts = attempts + 1
  WHERE id IN (SELECT id FROM outbox
               WHERE (status IN ('PENDING','FAILED') AND next_attempt_at <= $now)
                  OR (status = 'PROCESSING' AND locked_until < $now)
               ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $n)
  RETURNING *
  ```
- Thành công → `DONE`. Lỗi → `FAILED` với backoff 1, 2, 4, 8 … giây; sau 5 lần → `DEAD`. Cập nhật luôn có điều kiện `locked_by = $w`.
- Handler idempotent:
  - `notify` → `INSERT mock_notifications ON CONFLICT DO NOTHING` + in console có che PII;
  - `trigger_payment` → mock gateway dùng DB: trừ `remaining_failures` (fault injection), rồi `INSERT mock_gateway_payments ON CONFLICT (idempotency_key) DO NOTHING`. Gọi lại với cùng key luôn nhận cùng `gateway_ref` → **không bao giờ chi trả hai lần**, kể cả khi CLI và worker chạy ở nhiều tiến trình.
- API server chạy worker ngay trong tiến trình (tắt bằng `--no-worker`). `claims outbox process --once` dùng để xử lý một lượt bằng tay.

---

## 8. Giao diện

### CLI (`npm run cli -- …`)

```
claims db setup|migrate|seed|reset            claims users
claims config validate|diagram|list [--config <file>]
claims create --as u_member_01 --policy POL-001 --type outpatient --amount 2500000 --treatment-date 2026-10-20
claims list [--state S] [--queue --as <user>]
claims show <claim> --as <user>               # state + transition khả dụng (id, đích, role, input cần nhập, checklist ✓/✗)
claims run <claim> <transition_id> --as <user> [--role r] [--input k=v …] [--reason ..] [--notes ..]
                                              [--expected-version n] [--idempotency-key k]
claims audit <claim> [--json] [--state-changes-only]      claims denied <claim>
claims verify <claim> | --all
claims worker        claims outbox list|process --once|retry <id>       claims system run [--claim id] [--now ISO]
claims mock gateway fail-next <n>|list        claims mock notifications [--claim id]
claims interactive   claims scenarios [--config <file>] [--write]
```

Mọi lệnh hỗ trợ `--json`; exit code khác 0 khi có lỗi; có gợi ý "did you mean". Lệnh `create` là cách gọi tắt của `run - submit_claim`.

### Web UI gọn (`npm run dev` chạy API + worker + Vite)

- **Bộ chọn "Acting as"**: đăng nhập giả lập qua header `X-User-Id` / `X-Role`, có ghi chú *demo only*.
- **Danh sách claim**: lọc theo state và theo hàng đợi của mình.
- **Chi tiết claim**:
  - sơ đồ Mermaid sinh từ definition đã pin, tô màu state hiện tại và đường đã đi;
  - **panel hành động sinh form động từ `inputs`**, kèm role cần và checklist ✓/✗; nút bị khóa có giải thích lý do; mục "Advanced: thử transition bất kỳ" để demo lỗi;
  - timeline audit: actor, role, lý do, `changes`, thời gian nằm ở mỗi state;
  - tab denied attempts; danh sách thông báo mock; nút **Verify integrity**.
- Lỗi theo RFC 9457 hiển thị dạng toast gồm mã lỗi, message và gợi ý.

---

## 9. Kiểm thử và kịch bản

- Vitest chạy trên PostgreSQL thật (DB `claims_test`), **mỗi file test một schema riêng** (`search_path`) và drop schema khi xong.
  - Lý do drop schema: TRUNCATE trên audit đã bị chặn.
- Test về phân quyền DB chạy với `SET ROLE claims_app`.
- Test đồng thời dùng 2 client riêng.
- Khoảng **65 test** (yêu cầu tối thiểu 15):

| Nhóm | Số test | Nội dung |
|---|---|---|
| DSL tĩnh | 10 | Config hợp lệ; tham chiếu không tồn tại (state/role/enum/template/counter/rule); `$path` sai (did-you-mean); input chưa khai báo; compare sai kiểu; `set` sai field/kiểu; placeholder sai; **chu trình không có counter**; state cụt/không tới được; transition tạo claim sai |
| Registry/pinning | 4 | Hash không đổi khi chỉ đổi format; `CONFIG_VERSION_NOT_BUMPED`; claim v1 chạy tiếp v1 sau khi có v2; phát hiện definition bị sửa |
| Luồng hợp lệ | 5 | 3 luồng của spec; system tự đóng claim khi khách hàng xác nhận; tự đóng khi hết hạn khiếu nại (`--now`) |
| Transition sai | 4 | `approve` từ SUBMITTED (nội dung message); id không tồn tại; từ CLOSED; in-state action sai state |
| Preconditions/input | 9 | Thiếu chứng từ; chưa có assessor; vượt hạn mức; reject thiếu lý do; request_info thiếu mô tả; không có gì mới; chưa xác nhận thanh toán; `INVALID_INPUT`; nhiều lỗi cùng lúc / quá hạn nộp |
| Phân quyền | 7 | Sai role; user không giữ role; người dùng giả system; assessor không được giao; SoD khi giao assessor; SoD khi chi tiền; four-eyes (thiếu co-sign / co-sign đã cũ) |
| Counter | 3 | 3 lần OK; **lần 4 trả đúng message**; engine đánh giá được chỉ với snapshot (không có lịch sử) |
| Audit/toàn vẹn | 9 | Đủ trường + `changes` + `snapshot_hash` + `decision_context`; UPDATE/DELETE/TRUNCATE bị chặn; sửa claim mà không có audit bị chặn khi commit; verify đúng; phát hiện chain bị sửa; phát hiện **claim row bị sửa** (có diff); phát hiện replay lệch |
| Denied | 2 | Ghi bảng riêng, không đổi claim/chain; lặp lại trong cùng phút chỉ ra 1 dòng |
| Đồng thời/idempotency | 5 | 2 thao tác cùng claim bị tuần tự hóa; version cũ; cùng key gửi đồng thời → chạy một lần; cùng key nhưng request khác; replay không sinh audit/outbox mới |
| Outbox/gateway | 5 | Rollback thì không có outbox; 2 worker không nhận trùng việc (`SKIP LOCKED`); hết lease thì nhận lại; gateway lỗi 2 lần rồi thành công, chỉ 1 payment; sang `DEAD` |
| Ràng buộc DB | 3 | Vi phạm CHECK; state không có trong definition bị trigger chặn; generated column đúng |
| Mở rộng | 2 | Appeal v2 chạy mà không sửa code (input/template mới); dry-run và sơ đồ có state mới |

**Scenario runner** (`npm run scenarios -- --write`):
- Chạy **cùng tiến trình**: gọi trực tiếp `ClaimService`, xử lý outbox bằng `drain()` trong tiến trình với clock giả (tua thời gian thay vì sleep).
- Mỗi lần chạy dùng một schema riêng (`scenarios_<ts>`).
- 12 kịch bản:
  - 1–5 đúng theo spec;
  - 6: precondition fail (thiếu chứng từ, sau đó bổ sung);
  - 7: giới hạn counter;
  - 8: assessor không được giao;
  - 9: SoD/four-eyes;
  - 10: outbox retry + idempotency;
  - 11: verify toàn bộ;
  - 12: appeal trên v2 + pinning của claim v1.
- Kết quả ghi ra `docs/results/scenarios.md`, `audit-trails.json` (kèm bảng `.md`), `denied-attempts.md`, `test-report.txt`.

**Config v2 (`examples/workflow.appeal.yaml`) chỉ sửa YAML**:
- `version: 2`;
- thêm state `UNDER_APPEAL`;
- `file_appeal` (member, còn trong hạn khiếu nại, `increments: [appeals]` với max 1, input `reason`, 2 template mới);
- `reopen_assessment` (team_lead, SoD: assessor mới phải khác người đã reject);
- `assign_assessor.from` thêm `UNDER_APPEAL`.

Validator sẽ từ chối bản bỏ `increments`, vì chu trình UNDER_ASSESSMENT → REJECTED → UNDER_APPEAL → UNDER_ASSESSMENT không có counter. Commit riêng → `git show --stat` chỉ có YAML.

---

## 10. Các phase triển khai và timeline (ước lượng)

| # | Phase | Kết quả cần đạt | Ước lượng |
|---|---|---|---|
| 0 | **Bạn cài PostgreSQL 17** (winget/EDB; hoặc cho phép tôi chạy winget). Bootstrap: `git init` (Git Bash), npm/TS/Biome/Vitest, CI với service postgres, `docker-compose.yml`, `.env.example`, `CLAUDE.md`, `db:setup` (role + DB qua `pg`, không cần psql), migration runner có checksum, test harness theo schema | `npm test` rỗng chạy được trên PG | 1,25h |
| 1 | DSL: Zod schema, loader, validator (tham chiếu, đồ thị + chu trình theo counter, `$path` + kiểu, template), config hash, Mermaid, JSON Schema | `config validate` + test DSL | 2,25h |
| 2 | Engine thuần: resolver ghi `decision_context`, conditions, biểu thức giá trị, effects, counters/participants, pipeline + lỗi + gợi ý, dry-run, JSON Patch + snapshot hash, render template | Unit test | 2,0h |
| 3 | PostgreSQL: migration (bảng/FK/CHECK/generated/index/trigger/grants), repos, transaction `FOR UPDATE` + advisory lock + idempotency trong cùng transaction, HMAC chain, denied (gộp theo phút), registry + pinning, auto-advance, `system run` | Integration test | 2,25h |
| 4 | Outbox worker (`SKIP LOCKED`, lease, backoff, `LISTEN/NOTIFY`), mock gateway/notification trong DB + fault injection, verify (chain + replay + claim row + definition), tamper demo | Test toàn vẹn + outbox | 1,25h |
| 5 | CLI (gọi theo id, interactive, `--json`, worker/outbox/mock/system) | Demo được bằng CLI | 0,75h |
| 6 | Scenario runner trong tiến trình + `docs/results` + **commit chỉ sửa YAML** cho v2 + `extending-the-workflow.md` | Đủ artefact nộp bài | 0,75h |
| 7 | API Fastify + Web UI (form động từ `inputs`) | Demo trên trình duyệt | 1,5h |
| 8 | README (quickstart cho Windows và Docker, quyết định thiết kế, estimate so với actual), `design.md`, `domain-research.md`, `ai-workflow.md`; CI xanh | Sẵn sàng push | 0,5h |
| | **Tổng** | | **≈ 12,5h (khoảng 11–14h)** |

- **Thứ tự cắt nếu bị trễ**: chế độ interactive → `LISTEN/NOTIFY` (chỉ giữ poll) → form động trên web (thay bằng form cố định) → gợi ý did-you-mean.
- **Git**:
  - Dùng Conventional Commits, ít nhất 1 commit mỗi phase; commit v2 tách riêng.
  - Ghi thời gian thực tế của từng phase vào README.
  - `docs/ai-workflow.md` ghi cách phân rã, các prompt chính, phần AI sinh ra và phần người review đã sửa (gồm cả vòng review plan này).
- **Push**: máy chưa có `gh`, nên cần bạn tạo repo và đưa remote URL. Tôi sẽ hỏi lại trước khi push.

---

## 11. Điểm cần chú ý

1. **Tầng DB không chặn được hết**: TRUNCATE bỏ qua trigger theo row (vì vậy có trigger theo statement); owner/superuser có thể tắt trigger. Cách bù: app chạy bằng role tối thiểu quyền, và HMAC chain + replay + kiểm tra claim row giúp **phát hiện** sửa đổi. Production nên: giữ khóa HMAC trong KMS; neo hash head định kỳ ra kho WORM.
2. **Hash phải ổn định**: dùng canonical JSON (JSONB tự đổi thứ tự key); timestamp mili giây do app sinh; `pg` trả BIGINT dạng string nên cần type parser, kèm CHECK số tiền < 2^53.
3. **Khóa**: dùng READ COMMITTED + `FOR UPDATE`, thứ tự khóa cố định, transaction ngắn, **không gọi hệ thống ngoài bên trong transaction**.
4. **Outbox là at-least-once**: handler phải idempotent. `NOTIFY` chỉ được gửi khi commit. `LISTEN` có phạm vi cả database, nên các test chạy song song trên nhiều schema có thể nghe được của nhau; worker luôn đọc trong schema của mình. Lease phải dài hơn thời gian xử lý tối đa của handler.
5. **Generated column `assessor_id` gắn DB với tên field trong config**: validator kiểm tra "hợp đồng projection" (config phải khai báo `assessor_id: user_ref`).
6. **Pinning**: claim v1 giữ luật của v1. Nếu cần sửa lỗi rule cho claim đang chạy thì phải có bước migration claim tường minh (ngoài phạm vi, ghi vào phần đề xuất).
7. **Diễn giải spec**:
   - "payment request created" là effect internal;
   - counter chỉ đếm `request_info` *thành công*, tính trên cả vòng đời claim, lần 4 bị chặn với đúng nguyên văn message;
   - "reset assessment timer" = xóa `assessment_started_at`, ghi `assessment_reset_at`;
   - cột audit `reason`/`notes` lấy từ `input.reason` và `input.notes`.
8. **Denied gộp theo phút** sẽ nén bằng chứng về các lần thử lặp lại: chỉ thấy "có lặp", không thấy số lần chính xác (ghi nhận là đánh đổi có chủ đích).
9. **Windows**: cài PostgreSQL cần quyền admin; dịch vụ chạy cổng 5432; không cần psql (setup bằng Node); npm script chạy được trên cả Windows và Unix; git chạy qua Git Bash.
10. **PII/dữ liệu sức khỏe**: che PII trong console; `decision_context` không lưu text; dùng mã lý do chuẩn.
11. **Thời gian**: lưu UTC, hiển thị theo Asia/Ho_Chi_Minh; ngày làm việc hay ngày lịch cần nghiệp vụ xác nhận.
12. **Vượt khung 5–8h** (khoảng 12,5h): README giải thích phần vượt bằng các yêu cầu toàn vẹn và vận hành.

---

## 12. Đề xuất thêm (ngoài phạm vi, ghi vào mục "Future work" của README)

**Hệ thống**
- Nhiều workflow (bồi hoàn và bảo lãnh viện phí).
- Migration claim giữa các version.
- Timer bền vững cho SLA/khiếu nại (Temporal hoặc pg-boss).
- Partition `audit_log` theo tháng; CDC sang kho dữ liệu phân tích.
- Neo hash chain ra bên ngoài; khóa HMAC trong KMS.
- Policy engine (Cedar/OPA) khi rule ABAC nhiều lên.
- Kiểm tra hạn mức còn lại theo từng quyền lợi.

**Vận hành**
- Hàng đợi theo role; tự động phân công theo khối lượng và thẩm quyền.
- SLA cho từng state, đếm ngược hạn 15 ngày (Điều 31), tự escalate.
- Ma trận thẩm quyền nhiều cấp.
- Dashboard KPI: TAT, pend rate, STP, trễ SLA, tỷ lệ khiếu nại được chấp nhận.
- Thay đổi config phải qua PR có nghiệp vụ và pháp chế review.
- Cảnh báo khi outbox có message `DEAD`; theo dõi số lần bị từ chối bất thường.

**UX**
- Luôn giải thích vì sao nút bị khóa và cần làm gì để mở.
- Hộp xác nhận cho thao tác không đảo ngược được.
- Mẫu soạn sẵn cho lý do.
- Trạng thái gửi khách hàng viết bằng tiếng Việt dễ hiểu, kèm danh sách cần bổ sung và hạn chót, mã thanh toán, cách khiếu nại.

**AI**
- OCR/IDP kiểm tra đủ chứng từ.
- Actor `ai_agent` có trần thẩm quyền và ngưỡng confidence; audit ghi rõ model version.
- Điểm FWA dùng làm precondition hoặc cờ cảnh báo.
- LLM soạn nháp thư từ chối, có người duyệt trước khi gửi.

---

## 13. Giả định đang dùng (bạn có thể sửa khi duyệt plan)

1. Repo đặt ở `D:\work\papaya`; giữ nguyên `requirement.md`.
2. Code, README, message và docs viết bằng tiếng Anh.
3. Giá trị tạm: `appeal_period = P30D`, `four_eyes_threshold = 50.000.000 VND`, danh sách chứng từ, hạn mức của hợp đồng seed. `filing_deadline = P1Y` lấy theo Điều 30.
4. Không có đăng nhập thật (`--as` hoặc header); `svc_system` chỉ dùng nội bộ.
5. Chứng từ chỉ lưu metadata; notify và payment là mock (lưu DB + in console).
6. Hạn mức là `coverage_limit` tĩnh, đúng theo spec.
7. PostgreSQL 17 cài trên Windows, kết nối qua `.env`. Người chấm dùng `docker compose up -d` rồi `npm run db:setup`.

---

## 14. Verification (end-to-end)

1. Cài PostgreSQL 17, tạo `.env`, chạy `npm run db:setup && npm run db:migrate && npm run db:seed`.
2. `npm run typecheck && npm run lint && npm test`: tất cả xanh, khoảng 65 test.
3. `npm run cli -- config validate` báo OK. Các fixture sai (chu trình không có counter, path sai, sai kiểu) bị từ chối với message chỉ đúng vị trí.
4. `npm run scenarios -- --write`: 12/12 PASS. Kiểm tra `docs/results` (mỗi transition có `timestamp`, `from_state`, `to_state`, `triggered_by` user + role, lý do/ghi chú, `changes`, `decision_context`).
5. Chạy tay bằng CLI: terminal 1 chạy `claims worker`; terminal 2 `create` → `show` → `run <id> approve` khi đang SUBMITTED (phải ra lỗi cụ thể) → đi hết happy path. CLI trả về ngay; effect hiện ở worker. Cuối cùng `verify <id>` báo ✓.
6. `npm run demo:tamper`: sửa trực tiếp claim row → `verify` báo `CLAIM_ROW_TAMPERED` kèm diff; sửa audit entry → báo chain hỏng.
7. `mock gateway fail-next 2` → `initiate_payment`: worker báo 2 lần lỗi rồi thành công; `mock gateway list` chỉ có 1 payment. Gửi lại cùng key → nhận cùng response, không có audit mới.
8. Chạy với `--config config/examples/workflow.appeal.yaml`: `config list` có 2 hash; claim v1 vẫn theo v1; claim mới có `file_appeal`; web hiện form `reason` mà không phải sửa code.
9. `npm run dev`: đổi user, chạy happy path qua form động, thấy nút bị khóa kèm lý do, toast lỗi, timeline audit và nút Verify.
10. GitHub Actions xanh sau khi push.

---

## 15. Nguồn tham khảo

- Luật Kinh doanh bảo hiểm 2022 (Điều 20, 30, 31, 32, 53): https://hethongphapluat.com/luat-kinh-doanh-bao-hiem-2022.html
- Dữ liệu sức khỏe và Luật BVDLCN 2025: https://lsvn.vn/bao-ve-du-lieu-ca-nhan-doi-voi-thong-tin-suc-khoe-va-trong-hoat-dong-kinh-doanh-bao-hiem-a160288.html · https://luatvietnam.vn/tin-van-ban-moi/thong-tin-ve-suc-khoe-la-du-lieu-ca-nhan-nhay-cam-186-106394-article.html
- Chứng từ bồi thường: https://pjico.com.vn/wp-content/uploads/2025/03/Huong-dan-thu-thap-HSBT-chi-tiet.pdf · https://www.pti.com.vn/wp-content/uploads/2025/09/Huongs-dan-chung-tu-boi-thuong-Viet-1.pdf · https://www.pjico.com.vn/wp-content/uploads/2025/03/VNM_Claim-handbook_FN.pdf
- Thẩm định và phân cấp thẩm quyền: https://www.careerlink.vn/cam-nang-luong/nhan-vien-boi-thuong-bao-hiem/ · https://www.manipalcigna.com/blog/claim-adjudication-in-health-insurance · https://hkqf.gov.hk/files/record/insurance-scs/3/EN/105616L6.pdf · https://openriskmanual.org/wiki/Four_Eyes_Principle
- FWA: https://pkf.com.au/insights/case-study-forensic-data-analytics-for-a-government-insurer · https://bcajonline.org/journal/using-computer-assisted-audit-tools-caats-for-prevention-and-detection-of-frauds-in-healthcare-industry/
- KPI: https://simplifyhealthcare.com/insights1/ · https://www.ilo.org/resource/article/emerging-insight-getting-bottom-claims-turnaround-time
- Papaya: https://itviec.com/viec-lam-it/seinor-sw-developer-typescript-react-native-ai-llm-papaya-insurtech-3423 · https://www.cbinsights.com/company/papaya
- XState serialization: https://prod.stately.ai/docs/xstate/v6/serialization · Hash-chain audit: https://appmaster.io/blog/tamper-evident-audit-trails-postgresql
