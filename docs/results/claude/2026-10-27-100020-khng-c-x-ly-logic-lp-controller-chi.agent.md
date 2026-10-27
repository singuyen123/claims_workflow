
> <ide_opened_file>The user opened the file d:\work\papaya\src\api\routes.ts in
  the IDE. This may or may not be related to the current
  task.</ide_opened_file>

> không được xử lý logic ở lớp controller chỉ nên gọi 1 service và return kết
  quả, mọi logic sẽ được xử lý ở lớp service. lớp service không được query trực
  tiếp mà tất cả đều phải thông qua interface của repository. rename những lớp
  hiện tại thành controler, service, repository. repository không nhất thiết
  phải nằm trong infra, restucture lại nếu cần thiết

  Searched for 2 patterns, read 22 files (ctrl+o to expand)

● Mình đang đọc code các lớp api/app/infra để lên kế hoạch tách controller →
  service → repository. Tiếp theo xem CLI, scenarios và tests.

  Searched for 5 patterns, read 9 files (ctrl+o to expand)

● Đã đọc xong api/app/infra/cli/tests; giờ kiểm tra tài liệu nào nhắc tới đường
  dẫn file để cập nhật theo.

  Searched for 3 patterns, read 6 files (ctrl+o to expand)

● Mình đã nắm được cấu trúc hiện tại. Còn hai điểm cần bạn chọn trước khi chốt
  plan:

● User answered Claude's questions:
  ⎿  · Quy tắc "controller chỉ gọi 1 service rồi trả kết quả" có áp dụng cho CLI
     (src/cli/index.ts, interactive.ts) không? Hiện CLI cũng tự xử lý logic:
     lọc work queue, ghép show (claim + workflow + policy + available), resolve
     claim ref trước khi gọi ops… → Áp dụng cho cả CLI (Recommended)
     · Bố cục thư mục mới nên theo kiểu nào? → Theo layer (Recommended)

  Searched for 3 patterns (ctrl+o to expand)

● Updated plan
  ⎿  /plan to preview

● Updated plan
  ⎿  /plan to preview

● Plan đã viết xong ở file plan; giờ mình trình để bạn duyệt.
  ⎿  Error: The user doesn't want to proceed with this tool use. The tool use
     was rejected (eg. if it was a file edit, the new_string was NOT written to
     the file). The user provided the following reason for the rejection:  sử
     dụng 1 sub agent khác để review plan hiện tại so sánh và cho tôi kết quả

● Mình sẽ cho một Plan agent độc lập review plan này, đối chiếu với code thực tế
  và yêu cầu của bạn.

● Plan(Review layering refactor plan)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)

● Agent review đang chạy nền. Nó sẽ:
  - tự phác một cách làm độc lập,
  - so sánh với plan hiện tại,
  - đối chiếu plan với code thật (file:line) để tìm chỗ thiếu, sai hoặc làm quá
    tay,
  - trả về danh sách sửa theo mức ưu tiên.

  Khi có kết quả mình sẽ báo lại bạn và cập nhật plan.

● Agent "Review layering refactor plan" finished · 11m 28s

● Review đã xong. Mình kiểm tra lại vài điểm quan trọng nhất của reviewer trước
  khi sửa plan.

  Searched for 2 patterns, read 1 file, ran 1 shell command (ctrl+o to expand)

● Xác nhận đúng các điểm reviewer nêu: thiếu docs/results khiến bước so sánh cũ
  vô hiệu, CI vẫn chạy demo:tamper và build:web, và report.ts:128 in tên
  ClaimService. Giờ tôi sẽ cập nhật lại plan.

● Updated plan
  ⎿  /plan to preview

● Agent đã review xong. Mình đã đối chiếu các điểm quan trọng với code thật
  trước khi sửa plan.

  Hai bên giống nhau: bố cục theo layer, chép nguyên SQL sang repository, dùng
  UnitOfWork với transaction(fn), đưa pg_notify / advisory lock / kiểm tra tên
  constraint của PG / nextDueAt ra sau repository, bootstrap.ts làm composition
  root, và có test chặn import sai lớp.

  Lỗi thật trong plan cũ (đã sửa):
  - Bước kiểm chứng không có tác dụng: plan cũ định git diff docs/results, nhưng
    thư mục này không có trong repo. Giờ mình chụp baseline trước khi sửa code
    (kết quả scenario, output --json của CLI, response các GET của API), rồi so
    lại trên cùng schema đó. Mình cũng thêm các bước CI mà plan cũ thiếu:
    demo:tamper, build:web, và validate file workflow.appeal.yaml.
  - LISTEN đặt sai chỗ: plan cũ để nó trong OutboxRepository, nhưng bản
    repository trong transaction dựng trên một connection riêng lẻ, không mở
    thêm được connection để LISTEN. Giờ tách thành port OutboxNotifications
    riêng, dựng từ pool.
  - Upsert seed không chạy được: plan cũ để upsert users/policies trong
    repository thường, nhưng role runtime không có quyền UPDATE users. Phần này
    chuyển sang postgres/admin.ts, chỉ owner dùng.
  - Controller vẫn phải import repository: render.ts cần các type như
    MockPayment, ClaimFilter. Các type này chuyển vào domain/types.ts. CLI cũng
    không nhận cả AppContext (có pool) nữa, chỉ nhận services.
  - Rủi ro cạn connection pool: hiện tại replay, autoAdvance và việc ghi refusal
    chạy khi vẫn giữ connection của transaction. Plan mới ghi rõ đây là thay
    đổi có chủ đích: ba việc này chạy sau khi transaction kết thúc.
  - Các hành vi phải giữ nguyên:
    - Key idempotency sai format vẫn không bị ghi vào denied_attempts.
    - Thứ tự newId → nextClaimNo giữ nguyên, nên kết quả scenario vẫn tái lập
      được.
    - create() vẫn nhận role và expected_version.
    - outbox retry trả false thì vẫn thoát với exit code 2.
    - Lỗi của runSystem vẫn không kèm details.
    - show --json giữ đúng shape.
    - Biểu thức limit giữ nguyên.
    - Dòng log của worker giữ nguyên, kể cả tên schema.
  - Test chặn import viết sai: quy tắc cho engine sẽ fail ngay, vì engine có
    dùng node:fs, yaml, zod. Giờ test chỉ quét import tương đối.

  Phần làm quá tay (đã gọn lại):
  - Số service: 9 service gom còn 4: ClaimService, ClaimQueryService,
    WorkflowService, OperationsService.
  - HTTP controller: 4 file controller gom lại thành một routes.ts cộng
    requests.ts.
  - Schema maintenance: bỏ SchemaService / SchemaRepository, dùng vài hàm admin
    gọi từ bootstrap.
  - Tên method: giữ nguyên (requireClaim, listClaims, audit…), chỉ đổi đường
    truy cập (services.queries.*).

  Chỗ mình không theo reviewer: reviewer muốn giữ app.service / app.ops để đỡ
  phải sửa test. Mình vẫn tách lệnh ghi (command) và truy vấn (query) thành
  ClaimService và ClaimQueryService, vì gộp vào một class thì class đó dài
  khoảng 550 dòng. Cái giá là các test phải đổi đường truy cập; việc này đổi
  theo một quy tắc cố định, còn tên method giữ nguyên.

  Plan đã cập nhật đầy đủ các điểm trên.

● User approved Claude's plan
  ⎿  Plan saved to:
     C:\Users\Admin\.claude\plans\kh-ng-c-x-ly-expressive-shore.md · /plan to
     edit
     Tách lớp controller → service → repository

     Context

     Hiện tại logic bị rải ở cả ba lớp:
     - Controller (src/api/routes.ts, src/cli/index.ts, src/cli/interactive.ts)
       tự ghép nhiều lời gọi. Ví dụ:
       - GET /api/claims?queue=1 lặp service.available() để lọc queue; CLI list
         --queue làm gần giống.
       - GET /api/claims/:ref gọi 6 thứ.
       - /notifications và /outbox (cùng CLI show, outbox list, mock payments)
         phải resolve claim trước rồi mới gọi ops.
     - Service (src/app/claim-service.ts) query thẳng PostgreSQL:
       - pool.connect, BEGIN/COMMIT/ROLLBACK, pg_advisory_xact_lock, pg_notify;
       - gọi thẳng các hàm trong src/infra/repos/*, không qua interface nào.

       Thêm vào đó:
       - definition-registry.ts (src/app/definition-registry.ts) bắt lỗi theo
         tên constraint của PG;
       - OutboxWorker (src/infra/outbox/worker.ts) tự SELECT và tự
         LISTEN/UNLISTEN.

     Mục tiêu:
     - Controller chỉ nhận input, gọi đúng một method service, rồi trả hoặc hiển
       thị kết quả.
     - Mọi logic nằm ở service.
     - Service chỉ truy cập dữ liệu qua interface repository.
     - Thư mục được tổ chức theo layer.
     - Hành vi bên ngoài giữ nguyên từng byte: HTTP contract, output và JSON của
       CLI, exit code, error code/details, file kết quả của scenario.

     Phạm vi đã chốt: cả HTTP API và CLI; bố cục theo layer. Đã có một agent
     review độc lập; các điểm cần sửa của nó đã được đưa vào plan này.

     Quy ước từng lớp (đưa vào CLAUDE.md)

     Controller được phép:
     - parse và validate input (zod, header X-User-Id/X-Role/Idempotency-Key,
       args CLI);
     - gọi 1 method service;
     - map kết quả sang HTTP status, exit code hoặc render.

     Controller không được nhận AppContext/pool, không import repositories/,
     infra/db hay pg.

     Service chứa toàn bộ logic. Transaction đi qua UnitOfWork. Service không
     import pg, infra/db hay repositories/postgres.

     Repository:
     - Interface đặt ở src/repositories/*.ts.
     - Bản PostgreSQL đặt ở src/repositories/postgres/*. Ngoài migrations, đây
       là nơi duy nhất có SQL.

     Chiều phụ thuộc:
     - controllers → services → repositories (interface) ← repositories/postgres
     - services → engine
     - src/bootstrap.ts là composition root duy nhất nối implementation vào
       service.

     Bố cục mới (dùng git mv để giữ history)

     src/
       bootstrap.ts               (app/bootstrap.ts) createApp +
     migrateSchema/seedSchema/dropSchema/resetSchema (giữ chữ ký)
       controllers/
         http/                    (src/api) server.ts, routes.ts
     (buildServer(services)), problem.ts,
                                  requests.ts (actor, optionalActor, parseBody,
     idempotencyKey, mapper query/body → input service)
         cli/                     (src/cli) index.ts, interactive.ts, render.ts
       services/
         claim-service.ts         ClaimService (giữ tên class, report.ts:128 in
     tên này): act, create, runSystem, autoAdvance
         claim-query-service.ts   ClaimQueryService: getClaim, requireClaim,
     listClaims (+queue), available, audit, auditEntries,
                                  denied, verify, verifyAll, verifyClaims,
     inspect, detail, diagram
         workflow-service.ts      WorkflowService (thay DefinitionRegistry):
     current, register, get, workflowFor, loadStored,
                                  definitions, health, describe, creationForm +
     hàm pure validateWorkflowFile, workflowFileDiagram
         operations-service.ts    OperationsService (operations.ts): users,
     people, policies, policy, inputChoices,
                                  outbox, retryOutbox, failNextPayments,
     payments, notifications
         outbox-worker.ts         (infra/outbox/worker.ts)
         effect-handlers.ts       (infra/outbox/handlers.ts)
         audit-chain.ts, verify.ts, clock.ts   (app/*, giữ nguyên nội dung)
       repositories/
         unit-of-work.ts          Repositories + UnitOfWork
         claim-repository.ts  audit-repository.ts  outbox-repository.ts (+
     OutboxNotifications port)
         reference-repository.ts (users, policies — chỉ đọc)
     definition-repository.ts  idempotency-repository.ts
         mock-gateway-repository.ts
         postgres/                Pg*Repository (SQL chép nguyên văn từ
     infra/repos/*), PgUnitOfWork, createPgRepositories(db),
                                  PgOutboxNotifications(pool), rows.ts (iso),
     admin.ts (owner-only: create/drop schema, upsert seed)
       infra/                     db/pool.ts, db/migrate.ts, db/migrations/
     (không đụng), env.ts, seed-file.ts (app/seed.ts)
       domain/types.ts            thêm các record type controller cần render:
     MockPayment, MockNotification,
                                  StoredDefinition/DefinitionSummary,
     ClaimFilter
       engine/, scenarios/        giữ chỗ cũ

     Xoá các thư mục src/app/, src/api/, src/cli/, src/infra/repos/,
     src/infra/outbox/. Tên file giữ kiểu kebab-case. Interface import bằng
     import type (vì verbatimModuleSyntax).

     Repository

     // src/repositories/unit-of-work.ts
     export interface Repositories {
       claims; audit; denied; outbox; users; policies; definitions; idempotency;
     mockGateway;
     }
     export interface UnitOfWork {
       /** Repositories trên pool: mỗi lời gọi tự commit. */
       readonly repos: Repositories;
       /** Chạy fn trong một transaction; mọi repository truyền vào dùng chung
     connection đó. */
       transaction<T>(fn: (tx: Repositories) => Promise<T>): Promise<T>;
     }

     PgUnitOfWork(pool):
     - repos được gán trong constructor, không dùng field initializer (tránh
       TS2729 / bị undefined khi chạy qua tsx).
     - transaction dùng lại inTransaction có sẵn ở pool.ts:42
       (src/infra/db/pool.ts#L42), với createPgRepositories(client).

     Các interface, method tương ứng với hàm hiện có:
     - ClaimRepository: find(ref, {lock}), insert, update(c, expectedVersion),
       nextClaimNo(year), list(filter).
     - AuditRepository: insert, list, find, head.
     - DeniedAttemptRepository: record, list.
     - OutboxRepository: enqueue, notifyWorkers() (lệnh pg_notify, vẫn gọi đúng
       chỗ cũ nên sequence diagram trong design.md (docs/design.md#L128) không
       đổi), lease, reapExpiredLeases, markDone, markFailed, list, retryDead,
       nextDueAt() (chuyển từ worker).
     - OutboxNotifications: port riêng, chỉ dựng từ Pool, không nằm trong
       Repositories, vì một PoolClient của transaction không mở được connection
       LISTEN.
       - listen({ onNotify, onError }) trả về { channel, schema, close() }.
       - Bên trong nó làm nốt phần LISTEN/UNLISTEN, lọc payload theo schema và
         destroy connection bị hỏng.
       - Trả về channel và schema để dòng log của worker giữ nguyên.
     - UserRepository.list, PolicyRepository.find/list: chỉ đọc. Upsert seed
       chuyển sang postgres/admin.ts, vì role runtime không có quyền UPDATE
       users.
     - DefinitionRepository: find, findByVersion, insert(wf, now): boolean,
       list. Lỗi race workflow_definitions_version_unique bị nuốt bên trong và
       trả false, nên service không còn biết tên constraint.
     - IdempotencyRepository: lock(key), find, save. Doc comment ghi rõ: lock,
       cũng như claims.find({lock:true}), chỉ có tác dụng bên trong
       transaction().
     - MockGatewayRepository: consumeFault, setFaults, recordPayment,
       listPayments, recordNotification, listNotifications.
     - postgres/admin.ts (owner pool, max=1, không chạy query song song):
       createSchema, dropSchema, upsertSeed. Phần migrate vẫn gọi
       infra/db/migrate.ts (src/infra/db/migrate.ts). bootstrap.ts gọi thẳng các
       hàm này.

     Service: các bất biến và logic được chuyển vào

     ClaimService.act viết lại trên store.transaction(tx => …), giữ các bất biến
     sau:
     1. Kiểm tra format idempotency key vẫn nằm trước và ngoài khối catch ghi
        refusal, nên key sai format không bị ghi vào denied_attempts (đúng như
        hiện tại).
     2. Thứ tự giữ nguyên: lock key → lock + đọc claim → idempotency.find →
        workflows.get(hash, tx.definitions) → users/policy → newId() →
        nextClaimNo() → evaluateTransition → update/insert → head → audit.insert
        → enqueue → idempotency.save → notifyWorkers(). Thứ tự gọi newId và
        sequence quyết định output của scenario.
     3. Callback trả về { replay: prior } hoặc { plan, entry, outboxIds }.
        Replay, autoAdvance và recordRefusal chạy sau khi transaction() resolve,
        tức là connection đã được trả về pool. Đây là thay đổi có chủ đích:
        hiện tại ba việc này chạy khi vẫn còn giữ client
        (claim-service.ts:166,244,255 (src/app/claim-service.ts#L166)), nên 10
        lệnh act đồng thời có thể làm cạn pool (max=10).
     4. Tham số repo của workflows.get(hash, definitions) là bắt buộc, không có
        default rơi về pool.
     5. State dùng chung giữa callback và catch (claim, role, now) được giữ
        trong một object, để TypeScript không narrow sai biến let trong closure.

     Các method khác của ClaimService:
     - create(req: Omit<ActRequest, 'claim' | 'transition_id'>) tự lấy
       workflows.current.creation.id, và vẫn nhận role lẫn expected_version như
       hiện nay.
     - runSystem(ref) vẫn ném CLAIM_NOT_FOUND không kèm details, như hiện tại.

     ClaimQueryService:
     - listClaims({ …ClaimFilter, queue_for?: { user_id, role? } }):
       - Logic queue (allowed && !automatic → can_run) được dùng chung: API
         truyền role, CLI không truyền.
       - Vẫn lặp từng claim, nên user lạ mà không có claim nào vẫn nhận [].
     - inspect(ref, as?, role?) trả { claim, workflow, policy, available? },
       trong đó available là nguyên object available() ({claim, roles,
       transitions}) để giữ shape của show --json.
     - detail(ref, actor?) trả đúng shape hiện tại của GET /api/claims/:ref.
     - diagram(ref, {roles}) phục vụ config diagram --claim.
     - auditEntries(ref, {stateChangesOnly}) và verifyClaims(ref?): mỗi cái là 1
       lời gọi cho audit và verify <claim>|--all.

     WorkflowService:
     - Gộp DefinitionRegistry với describeWorkflow (lấy từ routes.ts), health(),
       và definitions() (gắn cờ current).
     - creationForm(user?) trả { id, inputs (kèm giá trị enum, không thêm
       notes), acting_role }, thay cho creationFields và việc chọn role trong
       interactive.

     OperationsService:
     - people(): lọc bỏ service account, dùng cho /api/users.
     - inputChoices(fields): trả options cho từng field (enum, user_ref đã lọc
       theo role, policy_ref). Logic lọc user đủ điều kiện được chuyển ra khỏi
       interactive.
     - outbox({status, claim}), payments(ref?), notifications(ref?): tự resolve
       claim ref.
     - retryOutbox(id) vẫn trả boolean; CLI tự chuyển false thành UsageError
       (exit 2, JSON USAGE).

     OutboxWorker nhận { outbox, notifications, gateway, … } thay vì pool và
     schema. HandlerContext đổi db: pg.Pool thành gateway:
     MockGatewayRepository.

     Controller: mỗi route hoặc command một lời gọi

     ┌───────────────────┬─────────────────────────────────────────────────────┐
     │       HTTP        │                       Service                       │
     ├───────────────────┼─────────────────────────────────────────────────────┤
     │ GET /api/health / │                                                     │
     │  GET              │ workflows.health() / workflows.describe()           │
     │ /api/workflow     │                                                     │
     ├───────────────────┼─────────────────────────────────────────────────────┤
     │ GET /api/users /  │ operations.people() / operations.policies()         │
     │ GET /api/policies │                                                     │
     ├───────────────────┼─────────────────────────────────────────────────────┤
     │                   │ queries.listClaims(listClaimsInput(request)). Giữ   │
     │ GET /api/claims   │ nguyên biểu thức Math.min(Number(limit) || 100,     │
     │                   │ 500) (không dùng zod positive(), vì sẽ đổi sang trả │
     │                   │  400).                                              │
     ├───────────────────┼─────────────────────────────────────────────────────┤
     │ POST /api/claims  │ claims.create(…), status replayed ? 200 : 201       │
     ├───────────────────┼─────────────────────────────────────────────────────┤
     │ GET               │ queries.detail(ref, optionalActor(request))         │
     │ /api/claims/:ref  │                                                     │
     ├───────────────────┼─────────────────────────────────────────────────────┤
     │ POST              │ claims.act(…)                                       │
     │ …/transitions/:t  │                                                     │
     ├───────────────────┼─────────────────────────────────────────────────────┤
     │ …/audit ·         │ queries.auditEntries · queries.denied ·             │
     │ …/denied ·        │ queries.verify                                      │
     │ …/verify          │                                                     │
     ├───────────────────┼─────────────────────────────────────────────────────┤
     │ …/notifications · │ operations.notifications(ref) · operations.outbox({ │
     │  …/outbox         │  claim: ref })                                      │
     ├───────────────────┼─────────────────────────────────────────────────────┤
     │ POST              │ claims.runSystem(), trả { results }                 │
     │ /api/system/run   │                                                     │
     └───────────────────┴─────────────────────────────────────────────────────┘

     CLI, mỗi command một lời gọi:

     ┌──────────────────────────────────┬──────────────────────────────────────┐
     │             Command              │               Service                │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ run / create                     │ claims.act / claims.create           │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ show                             │ queries.inspect                      │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ list                             │ queries.listClaims                   │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ audit                            │ queries.auditEntries                 │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ denied                           │ queries.denied                       │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ verify                           │ queries.verifyClaims                 │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ users / policies                 │ operations.users /                   │
     │                                  │ operations.policies                  │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ config validate / config diagram │ hàm pure trong workflow-service.ts   │
     │  (đọc file)                      │                                      │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ config diagram --claim           │ queries.diagram                      │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ config list                      │ workflows.definitions                │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ db *                             │ helper trong bootstrap               │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ outbox list / outbox retry       │ operations.outbox /                  │
     │                                  │ operations.retryOutbox               │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ outbox process                   │ giữ ternary processOnce() / drain()  │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ system run                       │ claims.runSystem                     │
     ├──────────────────────────────────┼──────────────────────────────────────┤
     │ mock *                           │ operations.*                         │
     └──────────────────────────────────┴──────────────────────────────────────┘

     Thay đổi khác ở CLI:
     - withApp truyền { services, createWorker } cho command thay vì cả
       AppContext; runInteractive cũng vậy.
     - render.ts lấy type từ domain/ và services/.
     - renderClaimList nhận can_run thay cho Map; renderDefinitions nhận cờ
       current.
     - Interactive: mỗi bước prompt gọi một method. Việc lọc transition
       !automatic để dựng menu được coi là hiển thị.

     Composition root: src/bootstrap.ts

     export interface Services { claims: ClaimService; queries:
     ClaimQueryService; workflows: WorkflowService; operations:
     OperationsService }
     export interface AppContext {
       pool: pg.Pool;   // chỉ cho tests / tamper demo kiểm tra quyền DB;
     controller không nhận
       schema: string; clock: Clock; workflow: CompiledWorkflow;
       services: Services;
       createWorker(options?): OutboxWorker;
       close(): Promise<void>;
     }

     Cập nhật nơi gọi

     Tên method được giữ nguyên; chỉ đường truy cập thay đổi:
     - service.act / runSystem → services.claims.*
     - service.requireClaim / listClaims / available / audit / denied / verify →
       services.queries.*
     - service.workflow → services.workflows.current
     - service.workflowFor(pool, c) → services.workflows.workflowFor(c)
     - app.ops.* → services.operations.*, riêng definitions → services.workflows

     File cần sửa:
     - tests:
       - pg-schema.ts (tests/helpers/pg-schema.ts): Driver có thêm getter claims
         / queries.
       - outbox.test.ts (tests/integration/outbox.test.ts): leaseBatch(pool, …)
         → createPgRepositories(pool).outbox.lease(…); ctx { db } → { gateway }.
       - api.test.ts (tests/integration/api.test.ts):
         buildServer(db.app.services).
       - Import clock / claim-service trong concurrency, lifecycle, registry và
         extension.test.ts (tests/unit/extension.test.ts).
       - engine-harness.ts (tests/helpers/engine-harness.ts): import loadSeed từ
         infra/seed-file.
     - scenarios: harness.ts (src/scenarios/harness.ts), scenarios.ts
       (src/scenarios/scenarios.ts), run.ts (src/scenarios/run.ts),
       tamper-demo.ts (src/scenarios/tamper-demo.ts), report.ts
       (src/scenarios/report.ts).
     - config:
       - package.json: scripts trỏ sang src/controllers/cli/index.ts và
         src/controllers/http/server.ts.
       - vitest.config.ts: coverage exclude src/controllers/**.
     - docs:
       - CLAUDE.md: quy ước các lớp.
       - README.md: mục Project layout.
       - docs/design.md: mục Layers.
       - docs/extending-the-workflow.md:18 (docs/extending-the-workflow.md#L18):
         đường dẫn handler.
       - Comment ở web/src/types.ts:1 (web/src/types.ts#L1).

     Chốt chặn kiến trúc

     Thêm tests/unit/architecture.test.ts. Test này không cần DB, chỉ quét
     import tương đối và pg. Nó fail khi:
     - controllers/** import pg, repositories/, infra/db;
     - services/** import pg, infra/db, repositories/postgres;
     - repositories/*.ts (interface) import pg hoặc postgres/;
     - repositories/postgres/** import services/ hoặc controllers/;
     - engine/** import tương đối ra ngoài engine/ và domain/. Các package như
       node:*, yaml, zod, canonicalize vẫn được phép.

     Thứ tự làm

     0. Chụp baseline trên code hiện tại (chưa sửa gì):
        - npm run scenarios -- --write --no-tests --keep, rồi copy docs/results
          sang scratchpad. Hiện docs/results chưa có trong repo.
        - Trên schema vừa được giữ lại, lưu output --json của các lệnh CLI chỉ
          đọc (show --as, list, list --queue --as, audit, denied, verify --all,
          outbox list, config list, users, policies, mock gateway payments, mock
          notifications).
        - Lưu thêm response các GET của API.
     1. src/repositories (interface + postgres, admin.ts), domain types,
        infra/seed-file.ts.
     2. src/services (git mv các helper pure, viết lại ClaimService, các service
        mới, worker + handlers).
     3. src/bootstrap.ts → controllers/http → controllers/cli.
     4. Scenarios, tests, package.json, vitest; xoá thư mục cũ; architecture
        test; docs.

     Kiểm tra

     1. Chạy giống CI (ci.yml (.github/workflows/ci.yml)):
        - npm run typecheck, npm run lint
        - npm run cli -- config validate và config validate
          config/examples/workflow.appeal.yaml
        - npm test (cần TEST_DATABASE_URL)
        - npm run scenarios, npm run demo:tamper, npm run build:web
     2. Chạy npm run scenarios -- --write --no-tests, rồi diff -r với baseline ở
        scratchpad: scenarios.md, audit-trails.md/.json và denied-attempts.md
        phải trùng từng byte.
     3. Chạy lại đúng các lệnh CLI và GET API ở bước 0 trên cùng schema
        baseline, rồi diff với output đã lưu. Chỉ những transition phụ thuộc
        thời gian thực trong available được phép khác.
     4. Dọn dẹp: drop schema baseline; xoá docs/results vì trước khi làm thư mục
        này không tồn tại.

● Plan đã được duyệt. Bắt đầu với bước 0: chụp baseline trên code hiện tại.

  Ran 5 shell commands (ctrl+o to expand)

● Không kết nối được PostgreSQL vì .env vẫn đang là bản mẫu (password giả), nên
  mọi URL đều lỗi 28P01 — mình sẽ không đoán password hay sửa .env. Mình sẽ tiến
  hành refactor trước, baseline sẽ chụp sau bằng worktree riêng chạy commit
  HEAD; khi bạn cập nhật .env xong thì mình sẽ chạy các kiểm tra cần DB.

  Listed 1 directory (ctrl+o to expand)

● Bắt đầu di chuyển file bằng git mv để giữ history.

● Bash(mkdir -p src/controllers/http src/controllers/cli src/services
      src/repositories/postgres && \
      git mv src/api/server.ts src/controllers/http/server.ts && \…)  ⎿  ls: cannot access 'src/infra/outbox': No such file or directory
     src:
     api
     … +48 lines (ctrl+o to expand)
  ⎿  Deleted src\api\problem.ts (+0 -73)
       1 -import { WorkflowError } from '../engine/errors';              
       2 -                                                               
       3 -/** RFC 9457 problem details; `code` and the workflow error det
         -ails are extension members. */                                 
       4 -export interface Problem {                                     
       5 -  type: string;                                                
       6 -  title: string;                                               
       7 -  status: number;                                              
       8 -  detail: string;                                              
       9 -  code: string;                                                
      10 -  [extension: string]: unknown;                                
      11 -}                                                              
      12 -                                                               
      13 -/** An HTTP-level error that is not a workflow refusal (missing
         - user header, bad body, …). */                                 
      14 -export class HttpProblem extends Error {                       
      15 -  constructor(                                                 
      16 -    readonly status: number,                                   
      17 -    readonly code: string,                                     
      18 -    message: string,                                           
      19 -    readonly extensions: Record<string, unknown> = {},         
      20 -  ) {                                                          
      21 -    super(message);                                            
      22 -  }                                                            
      23 -}                                                              
      24 -                                                               
      25 -const typeFor = (code: string) =>                              
      26 -  `urn:claims-workflow:problem:${code.toLowerCase().replace(/_/
         -g, '-')}`;                                                     
      27 -                                                               
      28 -/** "INVALID_TRANSITION" → "Invalid transition". */            
      29 -const titleFor = (code: string) => {                           
      30 -  const words = code.toLowerCase().replace(/_/g, ' ');         
      31 -  return words.charAt(0).toUpperCase() + words.slice(1);       
      32 -};                                                             
      33 -                                                               
      34 -export function toProblem(error: unknown): Problem {           
      35 -  if (error instanceof WorkflowError) {                        
      36 -    return {                                                   
      37 -      type: typeFor(error.code),                               
      38 -      title: titleFor(error.code),                             
      39 -      status: error.status,                                    
      40 -      detail: error.message,                                   
     … 33 more lines (ctrl+o to expand)
  ⎿  Deleted src\api\routes.ts (+0 -224)
        1 -import Fastify, { type FastifyInstance, type FastifyRequest } 
          -from 'fastify';                                               
        2 -import { z } from 'zod';                                      
        3 -import type { AppContext } from '../app/bootstrap';           
        4 -import type { ActRequest } from '../app/claim-service';       
        5 -import type { CompiledWorkflow } from '../engine/load';       
        6 -import { toMermaid } from '../engine/mermaid';                
        7 -import { HttpProblem, toProblem } from './problem';           
        8 -                                                              
        9 -export interface ServerOptions {                              
       10 -  /** One line per request (method, path, status, duration); n
          -ever bodies, which hold PII. */                               
       11 -  log?: (line: string) => void;                               
       12 -}                                                             
       13 -                                                              
       14 -const ActBody = z.strictObject({                              
       15 -  input: z.record(z.string(), z.unknown()).optional(),        
       16 -  expected_version: z.number().int().min(1).optional(),       
       17 -  idempotency_key: z.string().optional(),                     
       18 -});                                                           
       19 -                                                              
       20 -function parseBody<T>(schema: z.ZodType<T>, body: unknown): T 
          -{                                                             
       21 -  const result = schema.safeParse(body ?? {});                
       22 -  if (!result.success) {                                      
       23 -    const issues = result.error.issues.map((i) => `${i.path.jo
          -in('.') || '(body)'}: ${i.message}`);                         
       24 -    throw new HttpProblem(400, 'BAD_REQUEST', `Invalid request
          - body: ${issues.join('; ')}`);                                
       25 -  }                                                           
       26 -  return result.data;                                         
       27 -}                                                             
       28 -                                                              
       29 -/**                                                           
       30 - * Demo authentication: the caller names the acting user (and 
          -optionally the role) in headers.                              
       31 - * A real deployment would take both from a verified identity 
          -token instead.                                                
       32 - */                                                           
       33 -function actor(request: FastifyRequest): { userId: string; rol
          -e?: string } {                                                
       34 -  const userId = request.headers['x-user-id'];                
       35 -  if (typeof userId !== 'string' || userId === '') {          
       36 -    throw new HttpProblem(                                    
       37 -      401,                                                    
       38 -      'AUTHENTICATION_REQUIRED',                              
       39 -      'Name the acting user in the X-User-Id header',         
       40 -    );                                                        
     … 184 more lines (ctrl+o to expand)
  ⎿  Deleted src\api\server.ts (+0 -47)
       1 -// HTTP API for the web UI. Usage: npm run api [-- --port 3000]
         - [-- --no-worker]                                              
       2 -// Runs the outbox worker in the same process unless --no-worke
         -r is given (then run `npm run worker`).                        
       3 -import pc from 'picocolors';                                   
       4 -import { createApp } from '../app/bootstrap';                  
       5 -import { buildServer } from './routes';                        
       6 -                                                               
       7 -function option(name: string): string | undefined {            
       8 -  const i = process.argv.indexOf(name);                        
       9 -  return i >= 0 ? process.argv[i + 1] : undefined;             
      10 -}                                                              
      11 -                                                               
      12 -async function main() {                                        
      13 -  const port = Number(option('--port') ?? process.env.PORT ?? 3
         -000);                                                          
      14 -  const host = option('--host') ?? '127.0.0.1';                
      15 -  const app = await createApp({                                
      16 -    ...(option('--config') ? { configPath: option('--config') }
         - : {}),                                                        
      17 -  });                                                          
      18 -  const server = await buildServer(app, { log: (line) => consol
         -e.log(pc.dim(line)) });                                        
      19 -                                                               
      20 -  const stop = new AbortController();                          
      21 -  const worker = process.argv.includes('--no-worker')          
      22 -    ? undefined                                                
      23 -    : app                                                      
      24 -        .createWorker({ log: (line) => console.log(line) })    
      25 -        .run(stop.signal)                                      
      26 -        .catch((error: Error) => console.error(pc.red(`[worker]
         - stopped: ${error.message}`)));                                
      27 -                                                               
      28 -  const shutdown = async () => {                               
      29 -    stop.abort();                                              
      30 -    await server.close();                                      
      31 -    await worker;                                              
      32 -    await app.close();                                         
      33 -  };                                                           
      34 -  process.once('SIGINT', () => void shutdown());               
      35 -  process.once('SIGTERM', () => void shutdown());              
      36 -                                                               
      37 -  await server.listen({ port, host });                         
      38 -  const wf = app.workflow;                                     
      39 -  console.log(                                                 
      40 -    `${pc.green('✓')} API on http://${host}:${port}/api · workf
         -low ${wf.id} v${wf.version} (${wf.hash.slice(0, 12)}) · schema 
         -${app.schema}${worker ? ' · outbox worker running' : ''}`,     
     … 7 more lines (ctrl+o to expand)
  ⎿  Deleted src\app\audit-chain.ts (+0 -66)
       1 -import type { AuditEntry } from '../domain/types';             
       2 -import type { TransitionPlan } from '../engine/engine';        
       3 -import { canonicalJson, hmacSha256Hex } from '../engine/hash'; 
       4 -                                                               
       5 -export const GENESIS = 'GENESIS';                              
       6 -                                                               
       7 -export type AuditEntryDraft = Omit<AuditEntry, 'hash'>;        
       8 -                                                               
       9 -/** The exact fields covered by an entry's HMAC. Listed explici
         -tly so DB-only columns never leak in. */                       
      10 -export function hashedFields(e: AuditEntryDraft): Record<string
         -, unknown> {                                                   
      11 -  return {                                                     
      12 -    entry_id: e.entry_id,                                      
      13 -    claim_id: e.claim_id,                                      
      14 -    claim_seq: e.claim_seq,                                    
      15 -    transition_id: e.transition_id,                            
      16 -    from_state: e.from_state,                                  
      17 -    to_state: e.to_state,                                      
      18 -    actor_user_id: e.actor_user_id,                            
      19 -    actor_role: e.actor_role,                                  
      20 -    reason: e.reason,                                          
      21 -    notes: e.notes,                                            
      22 -    input: e.input,                                            
      23 -    changes: e.changes,                                        
      24 -    decision_context: e.decision_context,                      
      25 -    effects: e.effects,                                        
      26 -    config_hash: e.config_hash,                                
      27 -    claim_version: e.claim_version,                            
      28 -    snapshot_hash: e.snapshot_hash,                            
      29 -    prev_hash: e.prev_hash,                                    
      30 -    occurred_at: e.occurred_at,                                
      31 -  };                                                           
      32 -}                                                              
      33 -                                                               
      34 -export function computeEntryHash(key: string, e: AuditEntryDraf
         -t): string {                                                   
      35 -  return hmacSha256Hex(key, canonicalJson(hashedFields(e)));   
      36 -}                                                              
      37 -                                                               
      38 -/** Turns an engine plan into the next link of the claim's chai
         -n. */                                                          
      39 -export function buildAuditEntry(                               
      40 -  plan: TransitionPlan,                                        
     … 26 more lines (ctrl+o to expand)
  ⎿  Deleted src\app\bootstrap.ts (+0 -123)
        1 -import type pg from 'pg';                                     
        2 -import { type CompiledWorkflow, loadWorkflowFile } from '../en
          -gine/load';                                                   
        3 -import { migrate } from '../infra/db/migrate';                
        4 -import { createPool, SCHEMA_RE } from '../infra/db/pool';     
        5 -import { env } from '../infra/env';                           
        6 -import { OutboxWorker, type WorkerOptions } from '../infra/out
          -box/worker';                                                  
        7 -import { upsertReference } from '../infra/repos/reference';   
        8 -import { ClaimService, type ServiceOptions } from './claim-ser
          -vice';                                                        
        9 -import { type Clock, systemClock } from './clock';            
       10 -import { DefinitionRegistry } from './definition-registry';   
       11 -import { Operations } from './operations';                    
       12 -import { loadSeed } from './seed';                            
       13 -                                                              
       14 -export interface AppContext {                                 
       15 -  pool: pg.Pool;                                              
       16 -  schema: string;                                             
       17 -  clock: Clock;                                               
       18 -  service: ClaimService;                                      
       19 -  ops: Operations;                                            
       20 -  workflow: CompiledWorkflow;                                 
       21 -  /** Outbox worker on this app's pool and clock. */          
       22 -  createWorker(options?: Omit<WorkerOptions, 'pool' | 'schema'
          - | 'clock'>): OutboxWorker;                                   
       23 -  close(): Promise<void>;                                     
       24 -}                                                             
       25 -                                                              
       26 -export interface AppOptions {                                 
       27 -  configPath?: string;                                        
       28 -  /** Already-loaded workflow; takes precedence over `configPa
          -th`. */                                                       
       29 -  workflow?: CompiledWorkflow;                                
       30 -  databaseUrl?: string;                                       
       31 -  schema?: string;                                            
       32 -  clock?: Clock;                                              
       33 -  /** Id generator (default random UUIDs); the scenario runner
          - makes ids reproducible. */                                   
       34 -  newId?: () => string;                                       
       35 -  onAutomatic?: ServiceOptions['onAutomatic'];                
       36 -}                                                             
       37 -                                                              
       38 -/** Connects as the runtime role, loads the workflow file and 
          -registers its definition. */                                  
       39 -export async function createApp(options: AppOptions = {}): Pro
          -mise<AppContext> {                                            
       40 -  const workflow = options.workflow ?? loadWorkflowFile(option
          -s.configPath ?? env.workflowConfig());                        
     … 83 more lines (ctrl+o to expand)
  ⎿  … 38 more files changed

  Ran 1 shell command (ctrl+o to expand)

● Bước tiếp: thêm các record type mà controller cần vào domain/types.ts.

● Update(src\domain\types.ts)
  ⎿  Added 41 lines
       97    occurred_at: string;
       98  }
       99  
      100 +/** Filter for listing claims. */                             
      101 +export interface ClaimFilter {                                
      102 +  states?: string[];                                          
      103 +  assessorId?: string;                                        
      104 +  memberId?: string;                                          
      105 +  limit?: number;                                             
      106 +}                                                             
      107 +                                                              
      108 +/** A workflow definition as registered in `workflow_definitio
          +ns`. */                                                       
      109 +export interface StoredDefinition {                           
      110 +  config_hash: string;                                        
      111 +  workflow_id: string;                                        
      112 +  version: number;                                            
      113 +  content: unknown;                                           
      114 +  registered_at: string;                                      
      115 +}                                                             
      116 +                                                              
      117 +export type DefinitionSummary = Omit<StoredDefinition, 'conten
          +t'>;                                                          
      118 +                                                              
      119 +/** A payment received by the mock payment gateway. */        
      120 +export interface MockPayment {                                
      121 +  idempotency_key: string;                                    
      122 +  claim_id: string;                                           
      123 +  amount: number;                                             
      124 +  reference: string;                                          
      125 +  gateway_ref: string;                                        
      126 +  created_at: string;                                         
      127 +}                                                             
      128 +                                                              
      129 +/** A notification "sent" through the mock notification channe
          +l. */                                                         
      130 +export interface MockNotification {                           
      131 +  idempotency_key: string;                                    
      132 +  claim_id: string;                                           
      133 +  template: string;                                           
      134 +  channel: string;                                            
      135 +  recipient: Record<string, unknown>;                         
      136 +  subject: string | null;                                     
      137 +  body: string;                                               
      138 +  sent_at: string;                                            
      139 +}                                                             
      140 +                                                              
      141  export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'DONE' |
            'FAILED' | 'DEAD';
      142  
      143  export interface OutboxMessage {

  Searched for 1 pattern (ctrl+o to expand)

● Viết các interface repository.

● Write(src\repositories\claim-repository.ts)
  ⎿  Wrote 16 lines to src\repositories\claim-repository.ts
       1 import type { ClaimFilter, ClaimSnapshot } from '../domain/types
       2
       3 export interface ClaimRepository {
       5    * Finds a claim by claim number (CLM-…) or id. `lock` takes a
          row lock that lasts until the
         rk.transaction`.
       7    */
         Snapshot | null>;
       9   insert(claim: ClaimSnapshot): Promise<void>;
         s no longer `expectedVersion`. */
     … +12 lines (ctrl+o to expand)

● Write(src\repositories\audit-repository.ts)
  ⎿  Wrote 37 lines to src\repositories\audit-repository.ts
       1 import type { AuditEntry, DeniedAttempt } from '../domain/types'
         ;
       2
       3 export interface ChainHead {
       4   claim_seq: number;
       6 }
       7
       8 /** The append-only, hash-chained audit trail. */
       9 export interface AuditRepository {
      10   insert(entry: AuditEntry): Promise<void>;
     … +30 lines (ctrl+o to expand)

● Write(src\repositories\outbox-repository.ts)
  ⎿  Wrote 66 lines to src\repositories\outbox-repository.ts
       1 import type { OutboxMessage, OutboxStatus } from '../domain/type
         s';
       2
       3 export interface OutboxInsert {
       4   claim_id: string;
       6   effect_type: OutboxMessage['effect_type'];
       7   payload: Record<string, unknown>;
       8   idempotency_key: string;
       9   created_at: string;
      10 }
     … +67 lines (ctrl+o to expand)

● Write(src\repositories\reference-repository.ts)
  ⎿  Wrote 11 lines to src\repositories\reference-repository.ts
       1 import type { Policy, User } from '../domain/types';
       2
       3 /** Users are reference data: the runtime role reads them, the s
         eed (owner role) writes them. */
       4 export interface UserRepository {
       6 }
       7
       8 export interface PolicyRepository {
       9   find(id: string | undefined): Promise<Policy | null>;
      10   list(): Promise<Policy[]>;
     … +2 lines (ctrl+o to expand)

● Write(src\repositories\definition-repository.ts)
  ⎿  Wrote 14 lines to src\repositories\definition-repository.ts
       1 import type { DefinitionSummary, StoredDefinition } from '../dom
       2 import type { CompiledWorkflow } from '../engine/load';
       3
          config hash. */
       5 export interface DefinitionRepository {
       7   findByVersion(workflowId: string, version: number): Promise<St
         oredDefinition | null>;
       9    * Stores a definition. Returns false when it is not stored by
          this call: the same hash is
         low version first.
     … +9 lines (ctrl+o to expand)

● Write(src\repositories\idempotency-repository.ts)
  ⎿  Wrote 18 lines to src\repositories\idempotency-repository.ts
       1 export interface IdempotencyRecord {
       2   key: string;
       3   actor_user_id: string;
       4   request_hash: string;
       5   claim_id: string | null;
       6   response: Record<string, unknown>;
       7   created_at: string;
       8 }
       9
      10 export interface IdempotencyRepository {
     … +10 lines (ctrl+o to expand)

● Write(src\repositories\mock-gateway-repository.ts)
  ⎿  Wrote 18 lines to src\repositories\mock-gateway-repository.ts
       1 import type { MockNotification, MockPayment } from '../domain/ty
       2
       3 /**
       4  * State of the mock payment gateway and notification channel. I
       5  * idempotency guarantees hold even when the CLI and the worker
         run as separate processes.
       7 export interface MockGatewayRepository {
       8   /** Consumes one injected failure; returns true when this call
          should fail. */
      10   /** Makes the next `count` payment calls fail. */
     … +16 lines (ctrl+o to expand)

● Write(src\repositories\unit-of-work.ts)
  ⎿  Wrote 31 lines to src\repositories\unit-of-work.ts
       1 import type { AuditRepository, DeniedAttemptRepository } from '.
       2 import type { ClaimRepository } from './claim-repository';
       3 import type { DefinitionRepository } from './definition-reposito
       4 import type { IdempotencyRepository } from './idempotency-reposi
       5 import type { MockGatewayRepository } from './mock-gateway-repos
         itory';
       7 import type { PolicyRepository, UserRepository } from './referen
         ce-repository';
       9 /** Repositories bound to one connection: the pool, or the conne
      10 export interface Repositories {
     … +29 lines (ctrl+o to expand)

● Giờ đến các bản PostgreSQL: chép nguyên SQL, bọc trong class.

● Write(src\repositories\postgres\rows.ts)
  ⎿  Wrote 4 lines to src\repositories\postgres\rows.ts
      1 export const iso = (value: unknown): string =>
      2   value instanceof Date ? value.toISOString() : String(value);
      3
      4 export const isoOrNull = (v: unknown) => (v === null || v === und
        efined ? null : iso(v));

● Write(src\repositories\postgres\claim-repository.ts)
  ⎿  Added 86 lines, removed 98 lines
      1 -import type { ClaimSnapshot } from '../../domain/types';        
      2 -import type { Db } from '../db/pool';                           
      1 +import type { ClaimFilter, ClaimSnapshot } from '../../domain/ty
        +pes';                                                           
      2 +import type { Db } from '../../infra/db/pool';                  
      3 +import type { ClaimRepository } from '../claim-repository';     
      4 +import { iso } from './rows';                                   
      5  
      6  export const CLAIM_NO_RE = /^CLM-\d{4}-\d{6}$/;
      7  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4
         }-[0-9a-f]{12}$/i;
     ...
      10    'id, claim_no, config_hash, policy_id, member_id, claim_type,
           claimed_amount, state, ' +
      11    'state_entered_at, version, data, counters, participants, cre
          ated_at, updated_at';
      12  
      11 -export const iso = (value: unknown): string =>                 
      12 -  value instanceof Date ? value.toISOString() : String(value); 
      13 -                                                               
      13  export function rowToClaim(row: Record<string, unknown>): Claim
          Snapshot {
      14    return {
      15      id: row.id as string,
     ...
       30    };
       31  }
       32  
       34 -/** Finds a claim by claim number (CLM-…) or id. `lock` takes 
          -a row lock for the transaction. */                            
       35 -export async function findClaim(                              
       36 -  db: Db,                                                     
       37 -  ref: string,                                                
       38 -  options: { lock?: boolean } = {},                           
       39 -): Promise<ClaimSnapshot | null> {                            
       40 -  const byNumber = CLAIM_NO_RE.test(ref);                     
       41 -  if (!byNumber && !UUID_RE.test(ref)) return null;           
       42 -  const { rows } = await db.query(                            
       43 -    `SELECT ${COLUMNS} FROM claims WHERE ${byNumber ? 'claim_n
          -o' : 'id'} = $1${options.lock ? ' FOR UPDATE' : ''}`,         
       44 -    [ref],                                                    
       45 -  );                                                          
       46 -  return rows[0] ? rowToClaim(rows[0]) : null;                
       47 -}                                                             
       33 +export class PgClaimRepository implements ClaimRepository {   
       34 +  constructor(private readonly db: Db) {}                     
       35  
       49 -export async function insertClaim(db: Db, c: ClaimSnapshot): P
          -romise<void> {                                                
       50 -  await db.query(                                             
       51 -    `INSERT INTO claims (${COLUMNS})                          
       52 -     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
          -, $13, $14, $15)`,                                            
       53 -    [                                                         
       54 -      c.id,                                                   
       55 -      c.claim_no,                                             
       56 -      c.config_hash,                                          
       57 -      c.policy_id,                                            
       58 -      c.member_id,                                            
       59 -      c.claim_type,                                           
       60 -      c.claimed_amount,                                       
       61 -      c.state,                                                
       62 -      c.state_entered_at,                                     
       63 -      c.version,                                              
       64 -      JSON.stringify(c.data),                                 
       65 -      JSON.stringify(c.counters),                             
       66 -      JSON.stringify(c.participants),                         
       67 -      c.created_at,                                           
       68 -      c.updated_at,                                           
       69 -    ],                                                        
       70 -  );                                                          
       71 -}                                                             
       36 +  async find(ref: string, options: { lock?: boolean } = {}): P
          +romise<ClaimSnapshot | null> {                                
       37 +    const byNumber = CLAIM_NO_RE.test(ref);                   
       38 +    if (!byNumber && !UUID_RE.test(ref)) return null;         
       39 +    const { rows } = await this.db.query(                     
       40 +      `SELECT ${COLUMNS} FROM claims WHERE ${byNumber ? 'claim
          +_no' : 'id'} = $1${options.lock ? ' FOR UPDATE' : ''}`,       
       41 +      [ref],                                                  
       42 +    );                                                        
       43 +    return rows[0] ? rowToClaim(rows[0]) : null;              
       44 +  }                                                           
       45  
       73 -/** Optimistic update: returns false when the stored version i
          -s no longer `expectedVersion`. */                             
       74 -export async function updateClaim(                            
       75 -  db: Db,                                                     
       76 -  c: ClaimSnapshot,                                           
       77 -  expectedVersion: number,                                    
       78 -): Promise<boolean> {                                         
       79 -  const result = await db.query(                              
       80 -    `UPDATE claims                                            
       81 -        SET state = $2, state_entered_at = $3, version = $4, d
          -ata = $5, counters = $6,                                      
       82 -            participants = $7, updated_at = $8                
       83 -      WHERE id = $1 AND version = $9`,                        
       84 -    [                                                         
       85 -      c.id,                                                   
       86 -      c.state,                                                
       87 -      c.state_entered_at,                                     
       88 -      c.version,                                              
       89 -      JSON.stringify(c.data),                                 
       90 -      JSON.stringify(c.counters),                             
       91 -      JSON.stringify(c.participants),                         
       92 -      c.updated_at,                                           
       93 -      expectedVersion,                                        
       94 -    ],                                                        
       95 -  );                                                          
       96 -  return result.rowCount === 1;                               
       97 -}                                                             
       46 +  async insert(c: ClaimSnapshot): Promise<void> {             
       47 +    await this.db.query(                                      
       48 +      `INSERT INTO claims (${COLUMNS})                        
       49 +       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $
          +12, $13, $14, $15)`,                                          
       50 +      [                                                       
       51 +        c.id,                                                 
       52 +        c.claim_no,                                           
       53 +        c.config_hash,                                        
       54 +        c.policy_id,                                          
       55 +        c.member_id,                                          
       56 +        c.claim_type,                                         
       57 +        c.claimed_amount,                                     
       58 +        c.state,                                              
       59 +        c.state_entered_at,                                   
       60 +        c.version,                                            
       61 +        JSON.stringify(c.data),                               
       62 +        JSON.stringify(c.counters),                           
       63 +        JSON.stringify(c.participants),                       
       64 +        c.created_at,                                         
       65 +        c.updated_at,                                         
       66 +      ],                                                      
       67 +    );                                                        
       68 +  }                                                           
       69  
       99 -export async function nextClaimNo(db: Db, year: number): Promi
          -se<string> {                                                  
      100 -  const { rows } = await db.query<{ n: number }>("SELECT nextv
          -al('claim_no_seq')::int AS n");                               
      101 -  return `CLM-${year}-${String(rows[0]?.n).padStart(6, '0')}`;
      102 -}                                                             
       70 +  async update(c: ClaimSnapshot, expectedVersion: number): Pro
          +mise<boolean> {                                               
       71 +    const result = await this.db.query(                       
       72 +      `UPDATE claims                                          
       73 +          SET state = $2, state_entered_at = $3, version = $4,
          + data = $5, counters = $6,                                    
       74 +              participants = $7, updated_at = $8              
       75 +        WHERE id = $1 AND version = $9`,                      
       76 +      [                                                       
       77 +        c.id,                                                 
       78 +        c.state,                                              
       79 +        c.state_entered_at,                                   
       80 +        c.version,                                            
       81 +        JSON.stringify(c.data),                               
       82 +        JSON.stringify(c.counters),                           
       83 +        JSON.stringify(c.participants),                       
       84 +        c.updated_at,                                         
       85 +        expectedVersion,                                      
       86 +      ],                                                      
       87 +    );                                                        
       88 +    return result.rowCount === 1;                             
       89 +  }                                                           
       90  
      104 -export interface ClaimFilter {                                
      105 -  states?: string[];                                          
      106 -  assessorId?: string;                                        
      107 -  memberId?: string;                                          
      108 -  limit?: number;                                             
      109 -}                                                             
       91 +  async nextClaimNo(year: number): Promise<string> {          
       92 +    const { rows } = await this.db.query<{ n: number }>(      
       93 +      "SELECT nextval('claim_no_seq')::int AS n",             
       94 +    );                                                        
       95 +    return `CLM-${year}-${String(rows[0]?.n).padStart(6, '0')}
          +`;                                                            
       96 +  }                                                           
       97  
      111 -export async function listClaims(db: Db, filter: ClaimFilter =
          - {}): Promise<ClaimSnapshot[]> {                              
      112 -  const where: string[] = [];                                 
      113 -  const params: unknown[] = [];                               
      114 -  if (filter.states?.length) {                                
      115 -    params.push(filter.states);                               
      116 -    where.push(`state = ANY($${params.length})`);             
       98 +  async list(filter: ClaimFilter = {}): Promise<ClaimSnapshot[
          +]> {                                                          
       99 +    const where: string[] = [];                               
      100 +    const params: unknown[] = [];                             
      101 +    if (filter.states?.length) {                              
      102 +      params.push(filter.states);                             
      103 +      where.push(`state = ANY($${params.length})`);           
      104 +    }                                                         
      105 +    if (filter.assessorId) {                                  
      106 +      params.push(filter.assessorId);                         
      107 +      where.push(`assessor_id = $${params.length}`);          
      108 +    }                                                         
      109 +    if (filter.memberId) {                                    
      110 +      params.push(filter.memberId);                           
      111 +      where.push(`member_id = $${params.length}`);            
      112 +    }                                                         
      113 +    params.push(filter.limit ?? 200);                         
      114 +    const { rows } = await this.db.query(                     
      115 +      `SELECT ${COLUMNS} FROM claims ${where.length ? `WHERE $
          +{where.join(' AND ')}` : ''}                                  
      116 +       ORDER BY created_at DESC, claim_no DESC LIMIT $${params
          +.length}`,                                                    
      117 +      params,                                                 
      118 +    );                                                        
      119 +    return rows.map(rowToClaim);                              
      120    }
      118 -  if (filter.assessorId) {                                    
      119 -    params.push(filter.assessorId);                           
      120 -    where.push(`assessor_id = $${params.length}`);            
      121 -  }                                                           
      122 -  if (filter.memberId) {                                      
      123 -    params.push(filter.memberId);                             
      124 -    where.push(`member_id = $${params.length}`);              
      125 -  }                                                           
      126 -  params.push(filter.limit ?? 200);                           
      127 -  const { rows } = await db.query(                            
      128 -    `SELECT ${COLUMNS} FROM claims ${where.length ? `WHERE ${w
          -here.join(' AND ')}` : ''}                                    
      129 -     ORDER BY created_at DESC, claim_no DESC LIMIT $${params.l
          -ength}`,                                                      
      130 -    params,                                                   
      131 -  );                                                          
      132 -  return rows.map(rowToClaim);                                
      121  }

● Write(src\repositories\postgres\audit-repository.ts)
  ⎿  Added 101 lines, removed 106 lines
       1  import type { AuditEntry, DeniedAttempt } from '../../domain/ty
          pes';
       2 -import type { Db } from '../db/pool';                          
       3 -import { iso } from './claims';                                
       2 +import type { Db } from '../../infra/db/pool';                 
       3 +import type {                                                  
       4 +  AuditRepository,                                             
       5 +  ChainHead,                                                   
       6 +  DeniedAttemptRepository,                                     
       7 +  DeniedRecord,                                                
       8 +} from '../audit-repository';                                  
       9 +import { iso } from './rows';                                  
      10  
      11  const COLUMNS =
      12    'entry_id, claim_id, claim_seq, transition_id, from_state, to
          _state, actor_user_id, actor_role, ' +
     ...
       38    };
       39  }
       40  
       35 -export async function insertEntry(db: Db, e: AuditEntry): Prom
          -ise<void> {                                                   
       36 -  await db.query(                                             
       37 -    `INSERT INTO audit_log (${COLUMNS})                       
       38 -     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
          -, $13, $14, $15, $16, $17, $18, $19, $20)`,                   
       39 -    [                                                         
       40 -      e.entry_id,                                             
       41 -      e.claim_id,                                             
       42 -      e.claim_seq,                                            
       43 -      e.transition_id,                                        
       44 -      e.from_state,                                           
       45 -      e.to_state,                                             
       46 -      e.actor_user_id,                                        
       47 -      e.actor_role,                                           
       48 -      e.reason,                                               
       49 -      e.notes,                                                
       50 -      JSON.stringify(e.input),                                
       51 -      JSON.stringify(e.changes),                              
       52 -      JSON.stringify(e.decision_context),                     
       53 -      JSON.stringify(e.effects),                              
       54 -      e.config_hash,                                          
       55 -      e.claim_version,                                        
       56 -      e.snapshot_hash,                                        
       57 -      e.prev_hash,                                            
       58 -      e.hash,                                                 
       59 -      e.occurred_at,                                          
       60 -    ],                                                        
       61 -  );                                                          
       62 -}                                                             
       41 +export class PgAuditRepository implements AuditRepository {   
       42 +  constructor(private readonly db: Db) {}                     
       43  
       64 -export async function listEntries(db: Db, claimId: string): Pr
          -omise<AuditEntry[]> {                                         
       65 -  const { rows } = await db.query(                            
       66 -    `SELECT ${COLUMNS} FROM audit_log WHERE claim_id = $1 ORDE
          -R BY claim_seq`,                                              
       67 -    [claimId],                                                
       68 -  );                                                          
       69 -  return rows.map(rowToEntry);                                
       70 -}                                                             
       44 +  async insert(e: AuditEntry): Promise<void> {                
       45 +    await this.db.query(                                      
       46 +      `INSERT INTO audit_log (${COLUMNS})                     
       47 +       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $
          +12, $13, $14, $15, $16, $17, $18, $19, $20)`,                 
       48 +      [                                                       
       49 +        e.entry_id,                                           
       50 +        e.claim_id,                                           
       51 +        e.claim_seq,                                          
       52 +        e.transition_id,                                      
       53 +        e.from_state,                                         
       54 +        e.to_state,                                           
       55 +        e.actor_user_id,                                      
       56 +        e.actor_role,                                         
       57 +        e.reason,                                             
       58 +        e.notes,                                              
       59 +        JSON.stringify(e.input),                              
       60 +        JSON.stringify(e.changes),                            
       61 +        JSON.stringify(e.decision_context),                   
       62 +        JSON.stringify(e.effects),                            
       63 +        e.config_hash,                                        
       64 +        e.claim_version,                                      
       65 +        e.snapshot_hash,                                      
       66 +        e.prev_hash,                                          
       67 +        e.hash,                                               
       68 +        e.occurred_at,                                        
       69 +      ],                                                      
       70 +    );                                                        
       71 +  }                                                           
       72  
       72 -export async function findEntry(db: Db, entryId: string): Prom
          -ise<AuditEntry | null> {                                      
       73 -  const { rows } = await db.query(`SELECT ${COLUMNS} FROM audi
          -t_log WHERE entry_id = $1`, [                                 
       74 -    entryId,                                                  
       75 -  ]);                                                         
       76 -  return rows[0] ? rowToEntry(rows[0]) : null;                
       77 -}                                                             
       73 +  async list(claimId: string): Promise<AuditEntry[]> {        
       74 +    const { rows } = await this.db.query(                     
       75 +      `SELECT ${COLUMNS} FROM audit_log WHERE claim_id = $1 OR
          +DER BY claim_seq`,                                            
       76 +      [claimId],                                              
       77 +    );                                                        
       78 +    return rows.map(rowToEntry);                              
       79 +  }                                                           
       80  
       79 -/** Last link of a claim's chain. Call after locking the claim
          - row. */                                                      
       80 -export async function chainHead(                              
       81 -  db: Db,                                                     
       82 -  claimId: string,                                            
       83 -): Promise<{ claim_seq: number; hash: string } | null> {      
       84 -  const { rows } = await db.query<{ claim_seq: number; hash: s
          -tring }>(                                                     
       85 -    'SELECT claim_seq, hash FROM audit_log WHERE claim_id = $1
          - ORDER BY claim_seq DESC LIMIT 1',                            
       86 -    [claimId],                                                
       87 -  );                                                          
       88 -  return rows[0] ?? null;                                     
       89 -}                                                             
       81 +  async find(entryId: string): Promise<AuditEntry | null> {   
       82 +    const { rows } = await this.db.query(`SELECT ${COLUMNS} FR
          +OM audit_log WHERE entry_id = $1`, [                          
       83 +      entryId,                                                
       84 +    ]);                                                       
       85 +    return rows[0] ? rowToEntry(rows[0]) : null;              
       86 +  }                                                           
       87  
       91 -export interface DeniedRecord {                               
       92 -  claim_id: string | null;                                    
       93 -  actor_user_id: string;                                      
       94 -  actor_role: string | null;                                  
       95 -  transition_id: string;                                      
       96 -  error_code: string;                                         
       97 -  message: string;                                            
       98 -  details: Record<string, unknown>;                           
       99 -  occurred_at: string;                                        
       88 +  async head(claimId: string): Promise<ChainHead | null> {    
       89 +    const { rows } = await this.db.query<ChainHead>(          
       90 +      'SELECT claim_seq, hash FROM audit_log WHERE claim_id = 
          +$1 ORDER BY claim_seq DESC LIMIT 1',                          
       91 +      [claimId],                                              
       92 +    );                                                        
       93 +    return rows[0] ?? null;                                   
       94 +  }                                                           
       95  }
       96  
      102 -/**                                                           
      103 - * Records a refused attempt, at most once per (claim, user, t
          -ransition, code) and minute.                                  
      104 - * Returns false when an identical refusal was already recorde
          -d in the same minute.                                         
      105 - */                                                           
      106 -export async function recordDenied(db: Db, d: DeniedRecord): P
          -romise<boolean> {                                             
      107 -  const bucket = new Date(d.occurred_at);                     
      108 -  bucket.setUTCSeconds(0, 0);                                 
      109 -  const result = await db.query(                              
      110 -    `INSERT INTO denied_attempts                              
      111 -       (claim_id, actor_user_id, actor_role, transition_id, er
          -ror_code, message, details, occurred_at, bucket_start)        
      112 -     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)              
      113 -     ON CONFLICT ON CONSTRAINT denied_attempts_dedupe DO NOTHI
          -NG`,                                                          
      114 -    [                                                         
      115 -      d.claim_id,                                             
      116 -      d.actor_user_id,                                        
      117 -      d.actor_role,                                           
      118 -      d.transition_id,                                        
      119 -      d.error_code,                                           
      120 -      d.message,                                              
      121 -      JSON.stringify(d.details),                              
      122 -      d.occurred_at,                                          
      123 -      bucket.toISOString(),                                   
      124 -    ],                                                        
      125 -  );                                                          
      126 -  return result.rowCount === 1;                               
      127 -}                                                             
       97 +export class PgDeniedAttemptRepository implements DeniedAttemp
          +tRepository {                                                 
       98 +  constructor(private readonly db: Db) {}                     
       99  
      129 -export async function listDenied(db: Db, claimId?: string): Pr
          -omise<DeniedAttempt[]> {                                      
      130 -  const { rows } = await db.query(                            
      131 -    `SELECT id, claim_id, actor_user_id, actor_role, transitio
          -n_id, error_code, message, details, occurred_at               
      132 -       FROM denied_attempts ${claimId ? 'WHERE claim_id = $1' 
          -: ''} ORDER BY id`,                                           
      133 -    claimId ? [claimId] : [],                                 
      134 -  );                                                          
      135 -  return rows.map((r) => ({                                   
      136 -    id: r.id,                                                 
      137 -    claim_id: r.claim_id,                                     
      138 -    actor_user_id: r.actor_user_id,                           
      139 -    actor_role: r.actor_role,                                 
      140 -    transition_id: r.transition_id,                           
      141 -    error_code: r.error_code,                                 
      142 -    message: r.message,                                       
      143 -    details: r.details,                                       
      144 -    occurred_at: iso(r.occurred_at),                          
      145 -  }));                                                        
      100 +  async record(d: DeniedRecord): Promise<boolean> {           
      101 +    const bucket = new Date(d.occurred_at);                   
      102 +    bucket.setUTCSeconds(0, 0);                               
      103 +    const result = await this.db.query(                       
      104 +      `INSERT INTO denied_attempts                            
      105 +         (claim_id, actor_user_id, actor_role, transition_id, 
          +error_code, message, details, occurred_at, bucket_start)      
      106 +       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)            
      107 +       ON CONFLICT ON CONSTRAINT denied_attempts_dedupe DO NOT
          +HING`,                                                        
      108 +      [                                                       
      109 +        d.claim_id,                                           
      110 +        d.actor_user_id,                                      
      111 +        d.actor_role,                                         
      112 +        d.transition_id,                                      
      113 +        d.error_code,                                         
      114 +        d.message,                                            
      115 +        JSON.stringify(d.details),                            
      116 +        d.occurred_at,                                        
      117 +        bucket.toISOString(),                                 
      118 +      ],                                                      
      119 +    );                                                        
      120 +    return result.rowCount === 1;                             
      121 +  }                                                           
      122 +                                                              
      123 +  async list(claimId?: string): Promise<DeniedAttempt[]> {    
      124 +    const { rows } = await this.db.query(                     
      125 +      `SELECT id, claim_id, actor_user_id, actor_role, transit
          +ion_id, error_code, message, details, occurred_at             
      126 +         FROM denied_attempts ${claimId ? 'WHERE claim_id = $1
          +' : ''} ORDER BY id`,                                         
      127 +      claimId ? [claimId] : [],                               
      128 +    );                                                        
      129 +    return rows.map((r) => ({                                 
      130 +      id: r.id,                                               
      131 +      claim_id: r.claim_id,                                   
      132 +      actor_user_id: r.actor_user_id,                         
      133 +      actor_role: r.actor_role,                               
      134 +      transition_id: r.transition_id,                         
      135 +      error_code: r.error_code,                               
      136 +      message: r.message,                                     
      137 +      details: r.details,                                     
      138 +      occurred_at: iso(r.occurred_at),                        
      139 +    }));                                                      
      140 +  }                                                           
      141  }

● Write(src\repositories\postgres\outbox-repository.ts)
  ⎿  Added 168 lines, removed 130 lines
       1 +import type pg from 'pg';                                      
       2  import type { OutboxMessage, OutboxStatus } from '../../domain/
          types';
       2 -import type { Db } from '../db/pool';                          
       3 -import { iso } from './claims';                                
       3 +import type { Db } from '../../infra/db/pool';                 
       4 +import type {                                                  
       5 +  OutboxFilter,                                                
       6 +  OutboxInsert,                                                
       7 +  OutboxNotifications,                                         
       8 +  OutboxRepository,                                            
       9 +  OutboxSubscription,                                          
      10 +} from '../outbox-repository';                                 
      11 +import { iso, isoOrNull } from './rows';                       
      12  
      13 +/** NOTIFY channel; the payload is the schema name so workers i
         +gnore other schemas' traffic. */                               
      14 +export const OUTBOX_CHANNEL = 'claims_outbox';                 
      15 +                                                               
      16  const COLUMNS =
      17    'id, claim_id, audit_entry_id, effect_type, payload, idempote
          ncy_key, status, attempts, ' +
      18    'max_attempts, next_attempt_at, locked_by, locked_until, last
          _error, result, created_at, processed_at';
      19  
       9 -const isoOrNull = (v: unknown) => (v === null || v === undefine
         -d ? null : iso(v));                                            
      10 -                                                               
      20  export function rowToMessage(row: Record<string, unknown>): Out
          boxMessage {
      21    return {
      22      id: row.id as number,
     ...
       38    };
       39  }
       40  
       32 -export interface OutboxInsert {                               
       33 -  claim_id: string;                                           
       34 -  audit_entry_id: string;                                     
       35 -  effect_type: OutboxMessage['effect_type'];                  
       36 -  payload: Record<string, unknown>;                           
       37 -  idempotency_key: string;                                    
       38 -  created_at: string;                                         
       39 -}                                                             
       41 +export class PgOutboxRepository implements OutboxRepository { 
       42 +  constructor(private readonly db: Db) {}                     
       43  
       41 -/** Inserts messages; a message whose idempotency key already 
          -exists is skipped. */                                         
       42 -export async function enqueue(db: Db, messages: OutboxInsert[]
          -): Promise<number[]> {                                        
       43 -  const ids: number[] = [];                                   
       44 -  for (const m of messages) {                                 
       45 -    const { rows } = await db.query<{ id: number }>(          
       46 -      `INSERT INTO outbox (claim_id, audit_entry_id, effect_ty
          -pe, payload, idempotency_key, next_attempt_at, created_at)    
       47 -       VALUES ($1, $2, $3, $4, $5, $6, $6)                    
       48 -       ON CONFLICT (idempotency_key) DO NOTHING               
       49 -       RETURNING id`,                                         
       50 -      [                                                       
       51 -        m.claim_id,                                           
       52 -        m.audit_entry_id,                                     
       53 -        m.effect_type,                                        
       54 -        JSON.stringify(m.payload),                            
       55 -        m.idempotency_key,                                    
       56 -        m.created_at,                                         
       57 -      ],                                                      
       44 +  async enqueue(messages: OutboxInsert[]): Promise<number[]> {
       45 +    const ids: number[] = [];                                 
       46 +    for (const m of messages) {                               
       47 +      const { rows } = await this.db.query<{ id: number }>(   
       48 +        `INSERT INTO outbox (claim_id, audit_entry_id, effect_
          +type, payload, idempotency_key, next_attempt_at, created_at)  
       49 +         VALUES ($1, $2, $3, $4, $5, $6, $6)                  
       50 +         ON CONFLICT (idempotency_key) DO NOTHING             
       51 +         RETURNING id`,                                       
       52 +        [                                                     
       53 +          m.claim_id,                                         
       54 +          m.audit_entry_id,                                   
       55 +          m.effect_type,                                      
       56 +          JSON.stringify(m.payload),                          
       57 +          m.idempotency_key,                                  
       58 +          m.created_at,                                       
       59 +        ],                                                    
       60 +      );                                                      
       61 +      if (rows[0]) ids.push(rows[0].id);                      
       62 +    }                                                         
       63 +    return ids;                                               
       64 +  }                                                           
       65 +                                                              
       66 +  async notifyWorkers(): Promise<void> {                      
       67 +    await this.db.query('SELECT pg_notify($1, current_schema()
          +)', [OUTBOX_CHANNEL]);                                        
       68 +  }                                                           
       69 +                                                              
       70 +  async lease(                                                
       71 +    workerId: string,                                         
       72 +    now: Date,                                                
       73 +    leaseMs: number,                                          
       74 +    limit: number,                                            
       75 +  ): Promise<OutboxMessage[]> {                               
       76 +    const { rows } = await this.db.query(                     
       77 +      `UPDATE outbox                                          
       78 +          SET status = 'PROCESSING', locked_by = $1, locked_un
          +til = $2, attempts = attempts + 1                             
       79 +        WHERE id IN (                                         
       80 +          SELECT id FROM outbox                               
       81 +           WHERE attempts < max_attempts                      
       82 +             AND ((status IN ('PENDING', 'FAILED') AND next_at
          +tempt_at <= $3)                                               
       83 +                  OR (status = 'PROCESSING' AND locked_until <
          + $3))                                                         
       84 +           ORDER BY id                                        
       85 +           LIMIT $4                                           
       86 +           FOR UPDATE SKIP LOCKED)                            
       87 +        RETURNING ${COLUMNS}`,                                
       88 +      [workerId, new Date(now.getTime() + leaseMs).toISOString
          +(), now.toISOString(), limit],                                
       89      );
       59 -    if (rows[0]) ids.push(rows[0].id);                        
       90 +    return rows.map(rowToMessage).sort((a, b) => a.id - b.id);
       91    }
       61 -  return ids;                                                 
       62 -}                                                             
       92  
       64 -/**                                                           
       65 - * Atomically leases up to `limit` due messages to `workerId`.
          - `SKIP LOCKED` lets several                                   
       66 - * workers run side by side without taking the same message; a
          -n expired lease (a worker that                                
       67 - * died mid-message) makes the message eligible again.        
       68 - */                                                           
       69 -export async function leaseBatch(                             
       70 -  db: Db,                                                     
       71 -  workerId: string,                                           
       72 -  now: Date,                                                  
       73 -  leaseMs: number,                                            
       74 -  limit: number,                                              
       75 -): Promise<OutboxMessage[]> {                                 
       76 -  const { rows } = await db.query(                            
       77 -    `UPDATE outbox                                            
       78 -        SET status = 'PROCESSING', locked_by = $1, locked_unti
          -l = $2, attempts = attempts + 1                               
       79 -      WHERE id IN (                                           
       80 -        SELECT id FROM outbox                                 
       81 -         WHERE attempts < max_attempts                        
       82 -           AND ((status IN ('PENDING', 'FAILED') AND next_atte
          -mpt_at <= $3)                                                 
       83 -                OR (status = 'PROCESSING' AND locked_until < $
          -3))                                                           
       84 -         ORDER BY id                                          
       85 -         LIMIT $4                                             
       86 -         FOR UPDATE SKIP LOCKED)                              
       87 -      RETURNING ${COLUMNS}`,                                  
       88 -    [workerId, new Date(now.getTime() + leaseMs).toISOString()
          -, now.toISOString(), limit],                                  
       89 -  );                                                          
       90 -  return rows.map(rowToMessage).sort((a, b) => a.id - b.id);  
       91 -}                                                             
       93 +  async reapExpiredLeases(now: Date): Promise<number> {       
       94 +    const r = await this.db.query(                            
       95 +      `UPDATE outbox                                          
       96 +          SET status = 'DEAD', locked_by = NULL, locked_until 
          += NULL,                                                       
       97 +              last_error = coalesce(last_error, 'lease expired
          + during the final attempt')                                   
       98 +        WHERE status = 'PROCESSING' AND locked_until < $1 AND 
          +attempts >= max_attempts`,                                    
       99 +      [now.toISOString()],                                    
      100 +    );                                                        
      101 +    return r.rowCount ?? 0;                                   
      102 +  }                                                           
      103  
       93 -/** Messages whose worker died during their final attempt beco
          -me DEAD instead of hanging. */                                
       94 -export async function reapExpiredLeases(db: Db, now: Date): Pr
          -omise<number> {                                               
       95 -  const r = await db.query(                                   
       96 -    `UPDATE outbox                                            
       97 -        SET status = 'DEAD', locked_by = NULL, locked_until = 
          -NULL,                                                         
       98 -            last_error = coalesce(last_error, 'lease expired d
          -uring the final attempt')                                     
       99 -      WHERE status = 'PROCESSING' AND locked_until < $1 AND at
          -tempts >= max_attempts`,                                      
      100 -    [now.toISOString()],                                      
      101 -  );                                                          
      102 -  return r.rowCount ?? 0;                                     
      103 -}                                                             
      104 +  async markDone(                                             
      105 +    id: number,                                               
      106 +    workerId: string,                                         
      107 +    now: Date,                                                
      108 +    result: Record<string, unknown>,                          
      109 +  ): Promise<boolean> {                                       
      110 +    const r = await this.db.query(                            
      111 +      `UPDATE outbox                                          
      112 +          SET status = 'DONE', processed_at = $3, result = $4,
          + locked_by = NULL, locked_until = NULL, last_error = NULL     
      113 +        WHERE id = $1 AND locked_by = $2 AND status = 'PROCESS
          +ING'`,                                                        
      114 +      [id, workerId, now.toISOString(), JSON.stringify(result)
          +],                                                            
      115 +    );                                                        
      116 +    return r.rowCount === 1;                                  
      117 +  }                                                           
      118  
      105 -export async function markDone(                               
      106 -  db: Db,                                                     
      107 -  id: number,                                                 
      108 -  workerId: string,                                           
      109 -  now: Date,                                                  
      110 -  result: Record<string, unknown>,                            
      111 -): Promise<boolean> {                                         
      112 -  const r = await db.query(                                   
      113 -    `UPDATE outbox                                            
      114 -        SET status = 'DONE', processed_at = $3, result = $4, l
          -ocked_by = NULL, locked_until = NULL, last_error = NULL       
      115 -      WHERE id = $1 AND locked_by = $2 AND status = 'PROCESSIN
          -G'`,                                                          
      116 -    [id, workerId, now.toISOString(), JSON.stringify(result)],
      117 -  );                                                          
      118 -  return r.rowCount === 1;                                    
      119 -}                                                             
      119 +  async markFailed(                                           
      120 +    id: number,                                               
      121 +    workerId: string,                                         
      122 +    retryAt: Date,                                            
      123 +    error: string,                                            
      124 +  ): Promise<OutboxStatus | null> {                           
      125 +    const { rows } = await this.db.query<{ status: OutboxStatu
          +s }>(                                                         
      126 +      `UPDATE outbox                                          
      127 +          SET status = CASE WHEN attempts >= max_attempts THEN
          + 'DEAD' ELSE 'FAILED' END,                                    
      128 +              next_attempt_at = $3, last_error = $4, locked_by
          + = NULL, locked_until = NULL                                  
      129 +        WHERE id = $1 AND locked_by = $2 AND status = 'PROCESS
          +ING'                                                          
      130 +        RETURNING status`,                                    
      131 +      [id, workerId, retryAt.toISOString(), error.slice(0, 200
          +0)],                                                          
      132 +    );                                                        
      133 +    return rows[0]?.status ?? null;                           
      134 +  }                                                           
      135  
      121 -/** Records a failure; the message is retried at `retryAt` or 
          -becomes DEAD after max_attempts. */                           
      122 -export async function markFailed(                             
      123 -  db: Db,                                                     
      124 -  id: number,                                                 
      125 -  workerId: string,                                           
      126 -  retryAt: Date,                                              
      127 -  error: string,                                              
      128 -): Promise<OutboxStatus | null> {                             
      129 -  const { rows } = await db.query<{ status: OutboxStatus }>(  
      130 -    `UPDATE outbox                                            
      131 -        SET status = CASE WHEN attempts >= max_attempts THEN '
          -DEAD' ELSE 'FAILED' END,                                      
      132 -            next_attempt_at = $3, last_error = $4, locked_by =
          - NULL, locked_until = NULL                                    
      133 -      WHERE id = $1 AND locked_by = $2 AND status = 'PROCESSIN
          -G'                                                            
      134 -      RETURNING status`,                                      
      135 -    [id, workerId, retryAt.toISOString(), error.slice(0, 2000)
          -],                                                            
      136 -  );                                                          
      137 -  return rows[0]?.status ?? null;                             
      138 -}                                                             
      136 +  async nextDueAt(): Promise<Date | null> {                   
      137 +    const { rows } = await this.db.query<{ next: Date | null }
          +>(                                                            
      138 +      `SELECT min(next_attempt_at) AS next FROM outbox        
      139 +        WHERE status IN ('PENDING', 'FAILED') AND attempts < m
          +ax_attempts`,                                                 
      140 +    );                                                        
      141 +    return rows[0]?.next ?? null;                             
      142 +  }                                                           
      143  
      140 -export async function listOutbox(                             
      141 -  db: Db,                                                     
      142 -  filter: { status?: OutboxStatus; claimId?: string } = {},   
      143 -): Promise<OutboxMessage[]> {                                 
      144 -  const where: string[] = [];                                 
      145 -  const params: unknown[] = [];                               
      146 -  if (filter.status) {                                        
      147 -    params.push(filter.status);                               
      148 -    where.push(`status = $${params.length}`);                 
      144 +  async list(filter: OutboxFilter = {}): Promise<OutboxMessage
          +[]> {                                                         
      145 +    const where: string[] = [];                               
      146 +    const params: unknown[] = [];                             
      147 +    if (filter.status) {                                      
      148 +      params.push(filter.status);                             
      149 +      where.push(`status = $${params.length}`);               
      150 +    }                                                         
      151 +    if (filter.claimId) {                                     
      152 +      params.push(filter.claimId);                            
      153 +      where.push(`claim_id = $${params.length}`);             
      154 +    }                                                         
      155 +    const { rows } = await this.db.query(                     
      156 +      `SELECT ${COLUMNS} FROM outbox ${where.length ? `WHERE $
          +{where.join(' AND ')}` : ''} ORDER BY id`,                    
      157 +      params,                                                 
      158 +    );                                                        
      159 +    return rows.map(rowToMessage);                            
      160    }
      150 -  if (filter.claimId) {                                       
      151 -    params.push(filter.claimId);                              
      152 -    where.push(`claim_id = $${params.length}`);               
      161 +                                                              
      162 +  async retryDead(id: number, now: Date): Promise<boolean> {  
      163 +    const r = await this.db.query(                            
      164 +      `UPDATE outbox                                          
      165 +          SET status = 'PENDING', attempts = 0, next_attempt_a
          +t = $2, last_error = NULL                                     
      166 +        WHERE id = $1 AND status = 'DEAD'`,                   
      167 +      [id, now.toISOString()],                                
      168 +    );                                                        
      169 +    return r.rowCount === 1;                                  
      170    }
      154 -  const { rows } = await db.query(                            
      155 -    `SELECT ${COLUMNS} FROM outbox ${where.length ? `WHERE ${w
          -here.join(' AND ')}` : ''} ORDER BY id`,                      
      156 -    params,                                                   
      157 -  );                                                          
      158 -  return rows.map(rowToMessage);                              
      171  }
      172  
      161 -/** Gives a DEAD message a fresh set of attempts. */          
      162 -export async function retryDead(db: Db, id: number, now: Date)
          -: Promise<boolean> {                                          
      163 -  const r = await db.query(                                   
      164 -    `UPDATE outbox                                            
      165 -        SET status = 'PENDING', attempts = 0, next_attempt_at 
          -= $2, last_error = NULL                                       
      166 -      WHERE id = $1 AND status = 'DEAD'`,                     
      167 -    [id, now.toISOString()],                                  
      168 -  );                                                          
      169 -  return r.rowCount === 1;                                    
      173 +/** LISTEN on a connection of its own; only notifications for 
          +`schema` wake the listener. */                                
      174 +export class PgOutboxNotifications implements OutboxNotificati
          +ons {                                                         
      175 +  constructor(                                                
      176 +    private readonly pool: pg.Pool,                           
      177 +    private readonly schema: string,                          
      178 +  ) {}                                                        
      179 +                                                              
      180 +  async listen(handlers: {                                    
      181 +    onNotify: () => void;                                     
      182 +    onError: (error: Error) => void;                          
      183 +  }): Promise<OutboxSubscription> {                           
      184 +    const listener = await this.pool.connect();               
      185 +    const onNotification = (n: pg.Notification) => {          
      186 +      if (n.channel === OUTBOX_CHANNEL && n.payload === this.s
          +chema) handlers.onNotify();                                   
      187 +    };                                                        
      188 +    listener.on('notification', onNotification);              
      189 +    listener.on('error', handlers.onError);                   
      190 +    const close = async () => {                               
      191 +      listener.off('notification', onNotification);           
      192 +      const unlistened = await listener.query(`UNLISTEN ${OUTB
          +OX_CHANNEL}`).then(                                           
      193 +        () => true,                                           
      194 +        () => false,                                          
      195 +      );                                                      
      196 +      listener.off('error', handlers.onError);                
      197 +      // A connection that could not UNLISTEN is broken: destr
          +oy it instead of returning it.                                
      198 +      listener.release(!unlistened);                          
      199 +    };                                                        
      200 +    try {                                                     
      201 +      await listener.query(`LISTEN ${OUTBOX_CHANNEL}`);       
      202 +    } catch (error) {                                         
      203 +      await close();                                          
      204 +      throw error;                                            
      205 +    }                                                         
      206 +    return { channel: OUTBOX_CHANNEL, schema: this.schema, clo
          +se };                                                         
      207 +  }                                                           
      208  }

● Write(src\repositories\postgres\reference-repository.ts)
  ⎿  Added 41 lines, removed 142 lines
        1 -import type { SeedData } from '../../app/seed';               
        1  import type { Policy, User } from '../../domain/types';
        3 -import type { CompiledWorkflow } from '../../engine/load';    
        4 -import type { Db } from '../db/pool';                         
        5 -import { iso } from './claims';                               
        2 +import type { Db } from '../../infra/db/pool';                
        3 +import type { PolicyRepository, UserRepository } from '../refe
          +rence-repository';                                            
        4  
        7 -export async function loadUsers(db: Db): Promise<User[]> {    
        8 -  const { rows } = await db.query(                            
        9 -    'SELECT id, display_name, roles, member_id, service_accoun
          -t FROM users ORDER BY id',                                    
       10 -  );                                                          
       11 -  return rows.map((r) => ({                                   
       12 -    id: r.id,                                                 
       13 -    display_name: r.display_name,                             
       14 -    roles: r.roles,                                           
       15 -    member_id: r.member_id ?? null,                           
       16 -    service_account: r.service_account,                       
       17 -  }));                                                        
       18 -}                                                             
        5 +export class PgUserRepository implements UserRepository {     
        6 +  constructor(private readonly db: Db) {}                     
        7  
       20 -export async function findPolicy(db: Db, id: string | undefine
          -d): Promise<Policy | null> {                                  
       21 -  if (!id) return null;                                       
       22 -  const { rows } = await db.query(                            
       23 -    `SELECT id, member_id, product, coverage_limit, currency, 
          -effective_from, effective_to                                  
       24 -       FROM policies WHERE id = $1`,                          
       25 -    [id],                                                     
       26 -  );                                                          
       27 -  const r = rows[0];                                          
       28 -  return r                                                    
       29 -    ? {                                                       
       30 -        id: r.id,                                             
       31 -        member_id: r.member_id,                               
       32 -        product: r.product,                                   
       33 -        coverage_limit: r.coverage_limit,                     
       34 -        currency: r.currency,                                 
       35 -        effective_from: r.effective_from,                     
       36 -        effective_to: r.effective_to,                         
       37 -      }                                                       
       38 -    : null;                                                   
        8 +  async list(): Promise<User[]> {                             
        9 +    const { rows } = await this.db.query(                     
       10 +      'SELECT id, display_name, roles, member_id, service_acco
          +unt FROM users ORDER BY id',                                  
       11 +    );                                                        
       12 +    return rows.map((r) => ({                                 
       13 +      id: r.id,                                               
       14 +      display_name: r.display_name,                           
       15 +      roles: r.roles,                                         
       16 +      member_id: r.member_id ?? null,                         
       17 +      service_account: r.service_account,                     
       18 +    }));                                                      
       19 +  }                                                           
       20  }
       21  
       41 -export async function listPolicies(db: Db): Promise<Policy[]> 
          -{                                                             
       42 -  const { rows } = await db.query('SELECT id FROM policies ORD
          -ER BY id');                                                   
       43 -  const policies = await Promise.all(rows.map((r) => findPolic
          -y(db, r.id as string)));                                      
       44 -  return policies.filter((p): p is Policy => p !== null);     
       45 -}                                                             
       22 +export class PgPolicyRepository implements PolicyRepository { 
       23 +  constructor(private readonly db: Db) {}                     
       24  
       47 -/** Inserts or updates users and policies (owner connection). 
          -*/                                                            
       48 -export async function upsertReference(db: Db, seed: SeedData):
          - Promise<void> {                                              
       49 -  for (const u of seed.users) {                               
       50 -    await db.query(                                           
       51 -      `INSERT INTO users (id, display_name, roles, member_id, 
          -service_account)                                              
       52 -       VALUES ($1, $2, $3, $4, $5)                            
       53 -       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.
          -display_name, roles = EXCLUDED.roles,                         
       54 -         member_id = EXCLUDED.member_id, service_account = EXC
          -LUDED.service_account`,                                       
       55 -      [u.id, u.display_name, u.roles, u.member_id, u.service_a
          -ccount],                                                      
       25 +  async find(id: string | undefined): Promise<Policy | null> {
       26 +    if (!id) return null;                                     
       27 +    const { rows } = await this.db.query(                     
       28 +      `SELECT id, member_id, product, coverage_limit, currency
          +, effective_from, effective_to                                
       29 +         FROM policies WHERE id = $1`,                        
       30 +      [id],                                                   
       31      );
       32 +    const r = rows[0];                                        
       33 +    return r                                                  
       34 +      ? {                                                     
       35 +          id: r.id,                                           
       36 +          member_id: r.member_id,                             
       37 +          product: r.product,                                 
       38 +          coverage_limit: r.coverage_limit,                   
       39 +          currency: r.currency,                               
       40 +          effective_from: r.effective_from,                   
       41 +          effective_to: r.effective_to,                       
       42 +        }                                                     
       43 +      : null;                                                 
       44    }
       58 -  for (const p of seed.policies) {                            
       59 -    await db.query(                                           
       60 -      `INSERT INTO policies (id, member_id, product, coverage_
          -limit, currency, effective_from, effective_to)                
       61 -       VALUES ($1, $2, $3, $4, $5, $6, $7)                    
       62 -       ON CONFLICT (id) DO UPDATE SET member_id = EXCLUDED.mem
          -ber_id, product = EXCLUDED.product,                           
       63 -         coverage_limit = EXCLUDED.coverage_limit, currency = 
          -EXCLUDED.currency,                                            
       64 -         effective_from = EXCLUDED.effective_from, effective_t
          -o = EXCLUDED.effective_to`,                                   
       65 -      [                                                       
       66 -        p.id,                                                 
       67 -        p.member_id,                                          
       68 -        p.product,                                            
       69 -        p.coverage_limit,                                     
       70 -        p.currency,                                           
       71 -        p.effective_from,                                     
       72 -        p.effective_to,                                       
       73 -      ],                                                      
       74 -    );                                                        
       45 +                                                              
       46 +  async list(): Promise<Policy[]> {                           
       47 +    const { rows } = await this.db.query('SELECT id FROM polic
          +ies ORDER BY id');                                            
       48 +    const policies = await Promise.all(rows.map((r) => this.fi
          +nd(r.id as string)));                                         
       49 +    return policies.filter((p): p is Policy => p !== null);   
       50    }
       51  }
       77 -                                                              
       78 -// ── workflow definitions ───────────────────────────────────
          -──────────────────────────────────                            
       79 -                                                              
       80 -export interface StoredDefinition {                           
       81 -  config_hash: string;                                        
       82 -  workflow_id: string;                                        
       83 -  version: number;                                            
       84 -  content: unknown;                                           
       85 -  registered_at: string;                                      
       86 -}                                                             
       87 -                                                              
       88 -export async function findDefinition(db: Db, hash: string): Pr
          -omise<StoredDefinition | null> {                              
       89 -  const { rows } = await db.query(                            
       90 -    'SELECT config_hash, workflow_id, version, content, regist
          -ered_at FROM workflow_definitions WHERE config_hash = $1',    
       91 -    [hash],                                                   
       92 -  );                                                          
       93 -  return rows[0] ? { ...rows[0], registered_at: iso(rows[0].re
          -gistered_at) } : null;                                        
       94 -}                                                             
       95 -                                                              
       96 -export async function findDefinitionByVersion(                
       97 -  db: Db,                                                     
       98 -  workflowId: string,                                         
       99 -  version: number,                                            
      100 -): Promise<StoredDefinition | null> {                         
      101 -  const { rows } = await db.query(                            
      102 -    `SELECT config_hash, workflow_id, version, content, regist
          -ered_at                                                       
      103 -       FROM workflow_definitions WHERE workflow_id = $1 AND ve
          -rsion = $2`,                                                  
      104 -    [workflowId, version],                                    
      105 -  );                                                          
      106 -  return rows[0] ? { ...rows[0], registered_at: iso(rows[0].re
          -gistered_at) } : null;                                        
      107 -}                                                             
      108 -                                                              
      109 -export async function insertDefinition(db: Db, wf: CompiledWor
          -kflow, now: Date): Promise<boolean> {                         
      110 -  const r = await db.query(                                   
      111 -    `INSERT INTO workflow_definitions (config_hash, workflow_i
          -d, version, content, registered_at)                           
      112 -     VALUES ($1, $2, $3, $4, $5)                              
      113 -     ON CONFLICT (config_hash) DO NOTHING`,                   
      114 -    [wf.hash, wf.id, wf.version, JSON.stringify(wf.file), now.
          -toISOString()],                                               
      115 -  );                                                          
      116 -  return r.rowCount === 1;                                    
      117 -}                                                             
      118 -                                                              
      119 -export async function listDefinitions(db: Db): Promise<Omit<St
          -oredDefinition, 'content'>[]> {                               
      120 -  const { rows } = await db.query(                            
      121 -    `SELECT config_hash, workflow_id, version, registered_at F
          -ROM workflow_definitions                                      
      122 -      ORDER BY workflow_id, version`,                         
      123 -  );                                                          
      124 -  return rows.map((r) => ({ ...r, registered_at: iso(r.registe
          -red_at) }));                                                  
      125 -}                                                             
      126 -                                                              
      127 -// ── idempotency keys ───────────────────────────────────────
          -──────────────────────────────────                            
      128 -                                                              
      129 -export interface IdempotencyRecord {                          
      130 -  key: string;                                                
      131 -  actor_user_id: string;                                      
      132 -  request_hash: string;                                       
      133 -  claim_id: string | null;                                    
      134 -  response: Record<string, unknown>;                          
      135 -  created_at: string;                                         
      136 -}                                                             
      137 -                                                              
      138 -export async function findIdempotency(db: Db, key: string): Pr
          -omise<IdempotencyRecord | null> {                             
      139 -  const { rows } = await db.query(                            
      140 -    'SELECT key, actor_user_id, request_hash, claim_id, respon
          -se, created_at FROM idempotency_keys WHERE key = $1',         
      141 -    [key],                                                    
      142 -  );                                                          
      143 -  return rows[0] ? { ...rows[0], created_at: iso(rows[0].creat
          -ed_at) } : null;                                              
      144 -}                                                             
      145 -                                                              
      146 -export async function saveIdempotency(db: Db, r: IdempotencyRe
          -cord): Promise<void> {                                        
      147 -  await db.query(                                             
      148 -    `INSERT INTO idempotency_keys (key, actor_user_id, request
          -_hash, claim_id, response, created_at)                        
      149 -     VALUES ($1, $2, $3, $4, $5, $6)`,                        
      150 -    [r.key, r.actor_user_id, r.request_hash, r.claim_id, JSON.
          -stringify(r.response), r.created_at],                         
      151 -  );                                                          
      152 -}                                                             

● Write(src\repositories\postgres\definition-repository.ts)
  ⎿  Wrote 51 lines to src\repositories\postgres\definition-repository.ts
       1 import type { DefinitionSummary, StoredDefinition } from '../../
         domain/types';
       3 import type { Db } from '../../infra/db/pool';
       4 import type { DefinitionRepository } from '../definition-reposit
         ory';
       6
       7 export class PgDefinitionRepository implements DefinitionReposit
         ory {
       9
      10   async find(hash: string): Promise<StoredDefinition | null> {
     … +56 lines (ctrl+o to expand)

● Write(src\repositories\postgres\idempotency-repository.ts)
  ⎿  Wrote 27 lines to src\repositories\postgres\idempotency-repository.ts
       1 import type { Db } from '../../infra/db/pool';
       2 import type { IdempotencyRecord, IdempotencyRepository } from '.
       3 import { iso } from './rows';
       4
       5 export class PgIdempotencyRepository implements IdempotencyRepos
       6   constructor(private readonly db: Db) {}
       7
       8   async lock(key: string): Promise<void> {
         tended($1, 0))', [key]);
      10   }
     … +24 lines (ctrl+o to expand)

● Write(src\repositories\postgres\mock-gateway-repository.ts)
  ⎿  Added 67 lines, removed 87 lines
       1 -import type { Db } from '../db/pool';                          
       2 -import { iso } from './claims';                                
       1 +import type { MockNotification, MockPayment } from '../../domai
         +n/types';                                                      
       2 +import type { Db } from '../../infra/db/pool';                 
       3 +import type { MockGatewayRepository } from '../mock-gateway-rep
         +ository';                                                      
       4 +import { iso } from './rows';                                  
       5  
       4 -// State of the mock payment gateway and notification channel l
         -ives in the database, so the                                   
       5 -// idempotency guarantees hold even when the CLI and the worker
         - run as separate processes.                                    
       6 +export class PgMockGatewayRepository implements MockGatewayRepo
         +sitory {                                                       
       7 +  constructor(private readonly db: Db) {}                      
       8  
       7 -/** Consumes one injected failure; returns true when this call 
         -should fail. */                                                
       8 -export async function consumeFault(db: Db): Promise<boolean> { 
       9 -  const r = await db.query(                                    
      10 -    `UPDATE mock_gateway_faults SET remaining_failures = remain
         -ing_failures - 1                                               
      11 -      WHERE id = 1 AND remaining_failures > 0`,                
      12 -  );                                                           
      13 -  return r.rowCount === 1;                                     
      14 -}                                                              
       9 +  async consumeFault(): Promise<boolean> {                     
      10 +    const r = await this.db.query(                             
      11 +      `UPDATE mock_gateway_faults SET remaining_failures = rema
         +ining_failures - 1                                             
      12 +        WHERE id = 1 AND remaining_failures > 0`,              
      13 +    );                                                         
      14 +    return r.rowCount === 1;                                   
      15 +  }                                                            
      16  
      16 -export async function setFaults(db: Db, count: number): Promise
         -<void> {                                                       
      17 -  await db.query('UPDATE mock_gateway_faults SET remaining_fail
         -ures = $1 WHERE id = 1', [count]);                             
      18 -}                                                              
      17 +  async setFaults(count: number): Promise<void> {              
      18 +    await this.db.query('UPDATE mock_gateway_faults SET remaini
         +ng_failures = $1 WHERE id = 1', [                              
      19 +      count,                                                   
      20 +    ]);                                                        
      21 +  }                                                            
      22  
      20 -export interface MockPayment {                                 
      21 -  idempotency_key: string;                                     
      22 -  claim_id: string;                                            
      23 -  amount: number;                                              
      24 -  reference: string;                                           
      25 -  gateway_ref: string;                                         
      26 -  created_at: string;                                          
      27 -}                                                              
      23 +  async recordPayment(p: MockPayment): Promise<MockPayment & { 
         +created: boolean }> {                                          
      24 +    const inserted = await this.db.query(                      
      25 +      `INSERT INTO mock_gateway_payments (idempotency_key, clai
         +m_id, amount, reference, gateway_ref, created_at)              
      26 +       VALUES ($1, $2, $3, $4, $5, $6)                         
      27 +       ON CONFLICT (idempotency_key) DO NOTHING`,              
      28 +      [p.idempotency_key, p.claim_id, p.amount, p.reference, p.
         +gateway_ref, p.created_at],                                    
      29 +    );                                                         
      30 +    const { rows } = await this.db.query(                      
      31 +      `SELECT idempotency_key, claim_id, amount, reference, gat
         +eway_ref, created_at                                           
      32 +         FROM mock_gateway_payments WHERE idempotency_key = $1`
         +,                                                              
      33 +      [p.idempotency_key],                                     
      34 +    );                                                         
      35 +    const row = rows[0];                                       
      36 +    return { ...row, created_at: iso(row.created_at), created: 
         +inserted.rowCount === 1 };                                     
      37 +  }                                                            
      38  
      29 -/** Records a payment once per idempotency key and returns the 
         -payment for that key. */                                       
      30 -export async function recordPayment(                           
      31 -  db: Db,                                                      
      32 -  p: MockPayment,                                              
      33 -): Promise<MockPayment & { created: boolean }> {               
      34 -  const inserted = await db.query(                             
      35 -    `INSERT INTO mock_gateway_payments (idempotency_key, claim_
         -id, amount, reference, gateway_ref, created_at)                
      36 -     VALUES ($1, $2, $3, $4, $5, $6)                           
      37 -     ON CONFLICT (idempotency_key) DO NOTHING`,                
      38 -    [p.idempotency_key, p.claim_id, p.amount, p.reference, p.ga
         -teway_ref, p.created_at],                                      
      39 -  );                                                           
      40 -  const { rows } = await db.query(                             
      41 -    `SELECT idempotency_key, claim_id, amount, reference, gatew
         -ay_ref, created_at                                             
      42 -       FROM mock_gateway_payments WHERE idempotency_key = $1`, 
      43 -    [p.idempotency_key],                                       
      44 -  );                                                           
      45 -  const row = rows[0];                                         
      46 -  return { ...row, created_at: iso(row.created_at), created: in
         -serted.rowCount === 1 };                                       
      47 -}                                                              
      39 +  async listPayments(claimId?: string): Promise<MockPayment[]> 
         +{                                                              
      40 +    const { rows } = await this.db.query(                      
      41 +      `SELECT idempotency_key, claim_id, amount, reference, gat
         +eway_ref, created_at                                           
      42 +         FROM mock_gateway_payments ${claimId ? 'WHERE claim_id
         + = $1' : ''} ORDER BY id`,                                     
      43 +      claimId ? [claimId] : [],                                
      44 +    );                                                         
      45 +    return rows.map((r) => ({ ...r, created_at: iso(r.created_a
         +t) }));                                                        
      46 +  }                                                            
      47  
      49 -export async function listPayments(db: Db, claimId?: string): P
         -romise<MockPayment[]> {                                        
      50 -  const { rows } = await db.query(                             
      51 -    `SELECT idempotency_key, claim_id, amount, reference, gatew
         -ay_ref, created_at                                             
      52 -       FROM mock_gateway_payments ${claimId ? 'WHERE claim_id =
         - $1' : ''} ORDER BY id`,                                       
      53 -    claimId ? [claimId] : [],                                  
      54 -  );                                                           
      55 -  return rows.map((r) => ({ ...r, created_at: iso(r.created_at)
         - }));                                                          
      56 -}                                                              
      48 +  async recordNotification(n: MockNotification): Promise<boolea
         +n> {                                                           
      49 +    const r = await this.db.query(                             
      50 +      `INSERT INTO mock_notifications (idempotency_key, claim_i
         +d, template, channel, recipient, subject, body, sent_at)       
      51 +       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)                 
      52 +       ON CONFLICT (idempotency_key) DO NOTHING`,              
      53 +      [                                                        
      54 +        n.idempotency_key,                                     
      55 +        n.claim_id,                                            
      56 +        n.template,                                            
      57 +        n.channel,                                             
      58 +        JSON.stringify(n.recipient),                           
      59 +        n.subject,                                             
      60 +        n.body,                                                
      61 +        n.sent_at,                                             
      62 +      ],                                                       
      63 +    );                                                         
      64 +    return r.rowCount === 1;                                   
      65 +  }                                                            
      66  
      58 -export interface MockNotification {                            
      59 -  idempotency_key: string;                                     
      60 -  claim_id: string;                                            
      61 -  template: string;                                            
      62 -  channel: string;                                             
      63 -  recipient: Record<string, unknown>;                          
      64 -  subject: string | null;                                      
      65 -  body: string;                                                
      66 -  sent_at: string;                                             
      67 +  async listNotifications(claimId?: string): Promise<MockNotifi
         +cation[]> {                                                    
      68 +    const { rows } = await this.db.query(                      
      69 +      `SELECT idempotency_key, claim_id, template, channel, rec
         +ipient, subject, body, sent_at                                 
      70 +         FROM mock_notifications ${claimId ? 'WHERE claim_id = 
         +$1' : ''} ORDER BY id`,                                        
      71 +      claimId ? [claimId] : [],                                
      72 +    );                                                         
      73 +    return rows.map((r) => ({ ...r, sent_at: iso(r.sent_at) }))
         +;                                                              
      74 +  }                                                            
      75  }
      68 -                                                               
      69 -export async function recordNotification(db: Db, n: MockNotific
         -ation): Promise<boolean> {                                     
      70 -  const r = await db.query(                                    
      71 -    `INSERT INTO mock_notifications (idempotency_key, claim_id,
         - template, channel, recipient, subject, body, sent_at)         
      72 -     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)                   
      73 -     ON CONFLICT (idempotency_key) DO NOTHING`,                
      74 -    [                                                          
      75 -      n.idempotency_key,                                       
      76 -      n.claim_id,                                              
      77 -      n.template,                                              
      78 -      n.channel,                                               
      79 -      JSON.stringify(n.recipient),                             
      80 -      n.subject,                                               
      81 -      n.body,                                                  
      82 -      n.sent_at,                                               
      83 -    ],                                                         
      84 -  );                                                           
      85 -  return r.rowCount === 1;                                     
      86 -}                                                              
      87 -                                                               
      88 -export async function listNotifications(db: Db, claimId?: strin
         -g): Promise<MockNotification[]> {                              
      89 -  const { rows } = await db.query(                             
      90 -    `SELECT idempotency_key, claim_id, template, channel, recip
         -ient, subject, body, sent_at                                   
      91 -       FROM mock_notifications ${claimId ? 'WHERE claim_id = $1
         -' : ''} ORDER BY id`,                                          
      92 -    claimId ? [claimId] : [],                                  
      93 -  );                                                           
      94 -  return rows.map((r) => ({ ...r, sent_at: iso(r.sent_at) })); 
      95 -}                                                              
● Write(src\repositories\postgres\unit-of-work.ts)
  ⎿  Wrote 37 lines to src\repositories\postgres\unit-of-work.ts
       1 import type pg from 'pg';
       3 import type { Repositories, UnitOfWork } from '../unit-of-work';
       4 import { PgAuditRepository, PgDeniedAttemptRepository } from './
       5 import { PgClaimRepository } from './claim-repository';
       6 import { PgDefinitionRepository } from './definition-repository'
       7 import { PgIdempotencyRepository } from './idempotency-repositor
         y';
         ry';
       9 import { PgOutboxRepository } from './outbox-repository';
         e-repository';
     … +31 lines (ctrl+o to expand)

● Write(src\repositories\postgres\admin.ts)
  ⎿  Wrote 55 lines to src\repositories\postgres\admin.ts
       1 // Owner-only maintenance: schema lifecycle and reference data.
       2 // for any of this, so these functions take the owner's pool and
          are not part of `Repositories`.
       3 // The owner pool has a single connection: never run these queri
       4 import type pg from 'pg';
       5 import type { Policy, User } from '../../domain/types';
       7
       8 function checkSchema(schema: string) {
       9   if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema n
      10 }
     … +60 lines (ctrl+o to expand)

  Searched for 2 patterns (ctrl+o to expand)

● Repository xong. Giờ đến service layer, bắt đầu với WorkflowService (thay cho
  DefinitionRegistry).

● Write(src\services\workflow-service.ts)
  ⎿  Added 141 lines, removed 28 lines
       1 -import { type CompiledWorkflow, ConfigError, workflowFromStored
         -Content } from '../engine/load';                               
       2 -import type { Db } from '../infra/db/pool';                    
       1 +import type { ClaimSnapshot, DefinitionSummary, User } from '..
         +/domain/types';                                                
       2 +import type { AvailableTransition } from '../engine/engine';   
       3  import {
       4 -  findDefinition,                                              
       5 -  findDefinitionByVersion,                                     
       6 -  insertDefinition,                                            
       7 -} from '../infra/repos/reference';                             
       4 +  type CompiledWorkflow,                                       
       5 +  ConfigError,                                                 
       6 +  loadWorkflowFile,                                            
       7 +  workflowFromStoredContent,                                   
       8 +} from '../engine/load';                                       
       9 +import { toMermaid } from '../engine/mermaid';                 
      10 +import type { DefinitionRepository } from '../repositories/defi
         +nition-repository';                                            
      11 +import type { Clock } from './clock';                          
      12  
      13 +/** An input as forms need it: its definition, plus the allowed
         + values of an enum. */                                         
      14 +export type InputField = AvailableTransition['inputs'][number];
      15 +                                                               
      16 +function inputFields(                                          
      17 +  wf: CompiledWorkflow,                                        
      18 +  inputs: CompiledWorkflow['creation']['inputs'],              
      19 +): InputField[] {                                              
      20 +  return Object.entries(inputs).map(([name, def]) => ({        
      21 +    name,                                                      
      22 +    ...def,                                                    
      23 +    ...(def.type === 'enum' ? { values: wf.enums[def.enum ?? ''
         +] ?? [] } : {}),                                               
      24 +  }));                                                         
      25 +}                                                              
      26 +                                                               
      27 +export interface CreationForm {                                
      28 +  id: string;                                                  
      29 +  inputs: InputField[];                                        
      30 +  /** The first creation role the user holds; null when the use
         +r cannot submit claims. */                                     
      31 +  acting_role: string | null;                                  
      32 +}                                                              
      33 +                                                               
      34  /**
      35   * Keeps every workflow definition a claim may be pinned to. Ne
          w claims use `current`; existing
      36   * claims are always evaluated with the definition stored under
           their own `config_hash`.
      37   */
      13 -export class DefinitionRegistry {                              
      38 +export class WorkflowService {                                 
      39    private readonly cache = new Map<string, CompiledWorkflow>();
      40  
      16 -  constructor(readonly current: CompiledWorkflow) {            
      41 +  constructor(                                                 
      42 +    readonly current: CompiledWorkflow,                        
      43 +    private readonly store: DefinitionRepository,              
      44 +    private readonly clock: Clock,                             
      45 +  ) {                                                          
      46      this.cache.set(current.hash, current);
      47    }
      48  
      49    /**
      21 -   * Stores the current definition. Changing a workflow without
         - bumping `workflow.version` is                                 
      22 -   * refused, so a version number always identifies exactly one
         - definition.                                                   
      50 +   * Stores the current definition (call once at startup). Chan
         +ging a workflow without bumping                                
      51 +   * `workflow.version` is refused, so a version number always 
         +identifies exactly one definition.                             
      52     */
      24 -  async registerCurrent(db: Db, now: Date): Promise<'registered
         -' | 'known'> {                                                 
      53 +  async register(): Promise<'registered' | 'known'> {          
      54      const wf = this.current;
      26 -    const existing = await findDefinitionByVersion(db, wf.id, w
         -f.version);                                                    
      55 +    const existing = await this.store.findByVersion(wf.id, wf.v
         +ersion);                                                       
      56      if (existing && existing.config_hash !== wf.hash)
      57        throw this.versionNotBumped(existing.config_hash);
      58      if (existing) return 'known';
      30 -    try {                                                      
      31 -      await insertDefinition(db, wf, now);                     
      32 -    } catch (error) {                                          
      33 -      if ((error as { constraint?: string }).constraint === 'wo
         -rkflow_definitions_version_unique') {                          
      34 -        const winner = await findDefinitionByVersion(db, wf.id,
         - wf.version);                                                  
      35 -        if (winner && winner.config_hash !== wf.hash)          
      36 -          throw this.versionNotBumped(winner.config_hash);     
      37 -        return 'known';                                        
      38 -      }                                                        
      39 -      throw error;                                             
      40 -    }                                                          
      41 -    return 'registered';                                       
      59 +    if (await this.store.insert(wf, this.clock.now())) return '
         +registered';                                                   
      60 +    const winner = await this.store.findByVersion(wf.id, wf.ver
         +sion);                                                         
      61 +    if (winner && winner.config_hash !== wf.hash) throw this.ve
         +rsionNotBumped(winner.config_hash);                            
      62 +    return 'known';                                            
      63    }
      64  
      65    private versionNotBumped(storedHash: string): ConfigError {
     ...
       72      ]);
       73    }
       74  
       54 -  async get(db: Db, hash: string): Promise<CompiledWorkflow> {
       75 +  /**                                                         
       76 +   * The definition stored under `hash`. Pass the transaction'
          +s repository when called inside                               
       77 +   * one, so a cache miss does not need a second connection.  
       78 +   */                                                         
       79 +  async get(hash: string, definitions: DefinitionRepository): 
          +Promise<CompiledWorkflow> {                                   
       80      const cached = this.cache.get(hash);
       81      if (cached) return cached;
       57 -    const wf = await this.loadStored(db, hash);               
       82 +    const wf = await this.loadFrom(definitions, hash);        
       83      this.cache.set(hash, wf);
       84      return wf;
       85    }
       86  
       87 +  /** The definition a claim is pinned to. */                 
       88 +  workflowFor(claim: ClaimSnapshot): Promise<CompiledWorkflow>
          + {                                                            
       89 +    return this.get(claim.config_hash, this.store);           
       90 +  }                                                           
       91 +                                                              
       92    /** Reloads a definition from the database (bypassing the ca
           che) and checks its hash. */
       63 -  async loadStored(db: Db, hash: string): Promise<CompiledWork
          -flow> {                                                       
       64 -    const stored = await findDefinition(db, hash);            
       93 +  loadStored(hash: string): Promise<CompiledWorkflow> {       
       94 +    return this.loadFrom(this.store, hash);                   
       95 +  }                                                           
       96 +                                                              
       97 +  private async loadFrom(definitions: DefinitionRepository, ha
          +sh: string) {                                                 
       98 +    const stored = await definitions.find(hash);              
       99      if (!stored) throw new Error(`Workflow definition ${hash} 
           is not registered`);
      100      return workflowFromStoredContent(
      101        stored.content,
     ...
      103        `workflow_definitions[${hash.slice(0, 12)}]`,
      104      );
      105    }
      106 +                                                              
      107 +  /** Registered definitions; `current` marks the one new clai
          +ms use. */                                                    
      108 +  async definitions(): Promise<Array<DefinitionSummary & { cur
          +rent: boolean }>> {                                           
      109 +    return (await this.store.list()).map((d) => ({            
      110 +      ...d,                                                   
      111 +      current: d.config_hash === this.current.hash,           
      112 +    }));                                                      
      113 +  }                                                           
      114 +                                                              
      115 +  health() {                                                  
      116 +    return {                                                  
      117 +      ok: true,                                               
      118 +      workflow: { id: this.current.id, version: this.current.v
          +ersion, config_hash: this.current.hash },                     
      119 +    };                                                        
      120 +  }                                                           
      121 +                                                              
      122 +  /** What the UI needs to render forms and labels without kno
          +wing the workflow. */                                         
      123 +  describe(wf: CompiledWorkflow = this.current) {             
      124 +    const d = wf.definition;                                  
      125 +    return {                                                  
      126 +      id: wf.id,                                              
      127 +      version: wf.version,                                    
      128 +      label: d.workflow.label ?? wf.id,                       
      129 +      config_hash: wf.hash,                                   
      130 +      states: Object.entries(d.states).map(([name, s]) => ({ n
          +ame, ...s })),                                                
      131 +      roles: Object.entries(d.roles).map(([name, r]) => ({ nam
          +e, ...r })),                                                  
      132 +      counters: Object.entries(d.counters).map(([name, c]) => 
          +({ name, max: c.max })),                                      
      133 +      document_requirements: d.document_requirements,         
      134 +      creation: {                                             
      135 +        id: wf.creation.id,                                   
      136 +        label: wf.creation.label ?? wf.creation.id,           
      137 +        roles: wf.creation.roles,                             
      138 +        inputs: inputFields(wf, wf.creation.inputs),          
      139 +      },                                                      
      140 +      transitions: [...wf.transitions.values()].map((t) => ({ 
      141 +        id: t.id,                                             
      142 +        label: t.label ?? t.id,                               
      143 +        kind: t.kind,                                         
      144 +        from: t.from,                                         
      145 +        to: t.to ?? null,                                     
      146 +        roles: t.roles,                                       
      147 +        automatic: t.automatic,                               
      148 +      })),                                                    
      149 +      diagram: toMermaid(wf),                                 
      150 +    };                                                        
      151 +  }                                                           
      152 +                                                              
      153 +  /** The creation transition's form, and the role `user` woul
          +d submit a claim in. */                                       
      154 +  creationForm(user?: User): CreationForm {                   
      155 +    const t = this.current.creation;                          
      156 +    return {                                                  
      157 +      id: t.id,                                               
      158 +      inputs: inputFields(this.current, t.inputs),            
      159 +      acting_role: t.roles.find((r) => user?.roles.includes(r)
          +) ?? null,                                                    
      160 +    };                                                        
      161 +  }                                                           
      162  }
      163 +                                                              
      164 +// ── workflow files (no database) ───────────────────────────
          +──────────────────────────────────                            
      165 +                                                              
      166 +/** Loads and fully validates a workflow file; throws ConfigEr
          +ror when it is invalid. */                                    
      167 +export function validateWorkflowFile(source: string) {        
      168 +  const workflow = loadWorkflowFile(source);                  
      169 +  return {                                                    
      170 +    workflow,                                                 
      171 +    summary: {                                                
      172 +      ok: true,                                               
      173 +      source,                                                 
      174 +      workflow: workflow.id,                                  
      175 +      version: workflow.version,                              
      176 +      config_hash: workflow.hash,                             
      177 +      warnings: workflow.warnings,                            
      178 +    },                                                        
      179 +  };                                                          
      180 +}                                                             
      181 +                                                              
      182 +/** Mermaid state diagram of a workflow file. */              
      183 +export function workflowFileDiagram(source: string, options: {
          + roles?: boolean } = {}): string {                            
      184 +  return toMermaid(loadWorkflowFile(source), options);        
      185 +}                                                             

● Giờ viết lại ClaimService trên UnitOfWork, giữ nguyên thứ tự các bước.

● Write(src\services\claim-service.ts)
  ⎿  Added 148 lines, removed 283 lines
       1  import { randomUUID } from 'node:crypto';
       2 -import type pg from 'pg';                                      
       3 -import type { AuditEntry, ClaimSnapshot, DeniedAttempt, User } 
         -from '../domain/types';                                        
       4 -import {                                                       
       5 -  type AvailableTransition,                                    
       6 -  availableTransitions,                                        
       7 -  evaluateTransition,                                          
       8 -  resolveActor,                                                
       9 -} from '../engine/engine';                                     
       2 +import type { AuditEntry, ClaimSnapshot } from '../domain/types
         +';                                                             
       3 +import { evaluateTransition, resolveActor, type TransitionPlan 
         +} from '../engine/engine';                                     
       4  import { WorkflowError } from '../engine/errors';
       5  import { hashValue } from '../engine/hash';
      12 -import { type CompiledWorkflow, ConfigError } from '../engine/l
         -oad';                                                          
      13 -import type { Db } from '../infra/db/pool';                    
      14 -import { OUTBOX_CHANNEL } from '../infra/outbox/channel';      
      15 -import {                                                       
      16 -  chainHead,                                                   
      17 -  findEntry,                                                   
      18 -  insertEntry,                                                 
      19 -  listDenied,                                                  
      20 -  listEntries,                                                 
      21 -  recordDenied,                                                
      22 -} from '../infra/repos/audit';                                 
      23 -import {                                                       
      24 -  type ClaimFilter,                                            
      25 -  findClaim,                                                   
      26 -  insertClaim,                                                 
      27 -  listClaims,                                                  
      28 -  nextClaimNo,                                                 
      29 -  updateClaim,                                                 
      30 -} from '../infra/repos/claims';                                
      31 -import { enqueue } from '../infra/repos/outbox';               
      32 -import {                                                       
      33 -  findIdempotency,                                             
      34 -  findPolicy,                                                  
      35 -  type IdempotencyRecord,                                      
      36 -  loadUsers,                                                   
      37 -  saveIdempotency,                                             
      38 -} from '../infra/repos/reference';                             
       6 +import type { IdempotencyRecord } from '../repositories/idempot
         +ency-repository';                                              
       7 +import type { UnitOfWork } from '../repositories/unit-of-work';
       8  import { buildAuditEntry } from './audit-chain';
       9  import { type Clock, monotonic, systemClock } from './clock';
      41 -import type { DefinitionRegistry } from './definition-registry'
         -;                                                              
      42 -import { type VerifyReport, verifyClaimChain } from './verify';
      10 +import type { WorkflowService } from './workflow-service';     
      11  
      12  export const SYSTEM_USER = 'svc_system';
      13  
      14  const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{8,200}$/;
      15  
      48 -export interface ServiceOptions {                              
      49 -  pool: pg.Pool;                                               
      50 -  registry: DefinitionRegistry;                                
      16 +export interface ClaimServiceOptions {                         
      17 +  store: UnitOfWork;                                           
      18 +  workflows: WorkflowService;                                  
      19    auditKey: string;
      20    clock?: Clock;
      21    newId?: () => string;
     ...
      35    idempotency_key?: string;
      36  }
      37  
      38 +/** A request for the creation transition of the current workfl
         +ow. */                                                         
      39 +export type CreateRequest = Omit<ActRequest, 'claim' | 'transit
         +ion_id'>;                                                      
      40 +                                                               
      41  export interface ActResult {
      42    /** The claim after this action and any automatic transitions
           it triggered. */
      43    claim: ClaimSnapshot;
     ...
       54    autoAdvance?: boolean;
       55  }
       56  
       57 +type Committed = { plan: TransitionPlan; entry: AuditEntry; ou
          +tboxIds: number[] };                                          
       58 +                                                              
       59 +/** Runs transitions: the only way a claim changes. */        
       60  export class ClaimService {
       61    private readonly clock: Clock;
       62    private readonly newId: () => string;
       63    private readonly systemUser: string;
       64  
       91 -  constructor(private readonly options: ServiceOptions) {     
       65 +  constructor(private readonly options: ClaimServiceOptions) {
       66      this.clock = options.clock ?? systemClock;
       67      this.newId = options.newId ?? randomUUID;
       68      this.systemUser = options.systemUserId ?? SYSTEM_USER;
       69    }
       70  
       97 -  get workflow(): CompiledWorkflow {                          
       98 -    return this.options.registry.current;                     
       71 +  /** Submits a new claim with the current workflow's creation
          + transition. */                                               
       72 +  create(req: CreateRequest): Promise<ActResult> {            
       73 +    return this.act({                                         
       74 +      ...req,                                                 
       75 +      claim: null,                                            
       76 +      transition_id: this.options.workflows.current.creation.i
          +d,                                                            
       77 +    });                                                       
       78    }
       79  
      101 -  get pool(): pg.Pool {                                       
      102 -    return this.options.pool;                                 
      103 -  }                                                           
      104 -                                                              
      105 -  /** Registers the current workflow definition (call once at 
          -startup). */                                                  
      106 -  async init(): Promise<void> {                               
      107 -    await this.options.registry.registerCurrent(this.options.p
          -ool, this.clock.now());                                       
      108 -  }                                                           
      109 -                                                              
      110 -  workflowFor(db: Db, claim: ClaimSnapshot): Promise<CompiledW
          -orkflow> {                                                    
      111 -    return this.options.registry.get(db, claim.config_hash);  
      112 -  }                                                           
      113 -                                                              
       80    /**
       81     * Runs one transition in a single transaction: lock → idemp
           otency check → evaluate with the
       82     * claim's pinned definition → update claim + append audit e
           ntry + enqueue effects.
      117 -   * Refusals are thrown as WorkflowError and recorded in `den
          -ied_attempts`.                                                
       83 +   * Refusals are thrown as WorkflowError and recorded in `den
          +ied_attempts`. Replays, automatic                             
       84 +   * transitions and the refusal record run after the transact
          +ion has released its connection.                              
       85     */
       86    async act(req: ActRequest, internal: InternalOptions = {}): 
           Promise<ActResult> {
      120 -    const { pool, registry } = this.options;                  
       87 +    const { store, workflows } = this.options;                
       88      if (req.idempotency_key !== undefined && !IDEMPOTENCY_KEY_
           RE.test(req.idempotency_key)) {
       89        throw new WorkflowError(
       90          'INVALID_INPUT',
     ...
       98        input: req.input ?? {},
       99        expected_version: req.expected_version ?? null,
      100      });
      134 -    let claim: ClaimSnapshot | null = null;                   
      135 -    let actingRole: string | null = req.role ?? null;         
      136 -    let now = this.clock.now();                               
      137 -    const client = await pool.connect();                      
      101 +    // What a refusal is recorded with; filled in as the trans
          +action learns it.                                             
      102 +    const attempt: { claim: ClaimSnapshot | null; role: string
          + | null; now: Date } = {                                      
      103 +      claim: null,                                            
      104 +      role: req.role ?? null,                                 
      105 +      now: this.clock.now(),                                  
      106 +    };                                                        
      107 +    let outcome: { replay: IdempotencyRecord } | Committed;   
      108      try {
      139 -      await client.query('BEGIN');                            
      140 -      if (req.idempotency_key) {                              
      141 -        // Serialises requests that share a key (including cre
          -ations, which have no row to lock).                           
      142 -        await client.query('SELECT pg_advisory_xact_lock(hasht
          -extextended($1, 0))', [                                       
      143 -          req.idempotency_key,                                
      144 -        ]);                                                   
      145 -      }                                                       
      146 -      if (req.claim) {                                        
      147 -        // Lock first, then read: concurrent actions on one cl
          -aim run one after another.                                    
      148 -        claim = await findClaim(client, req.claim, { lock: tru
          -e });                                                         
      149 -        if (!claim) {                                         
      150 -          throw new WorkflowError('CLAIM_NOT_FOUND', `Claim ${
          -req.claim} not found`, {                                      
      151 -            claim_no: req.claim,                              
      152 -          });                                                 
      109 +      outcome = await store.transaction(async (tx) => {       
      110 +        if (req.idempotency_key) await tx.idempotency.lock(req
          +.idempotency_key);                                            
      111 +        let claim: ClaimSnapshot | null = null;               
      112 +        if (req.claim) {                                      
      113 +          // Lock first, then read: concurrent actions on one 
          +claim run one after another.                                  
      114 +          claim = await tx.claims.find(req.claim, { lock: true
          + });                                                          
      115 +          if (!claim) {                                       
      116 +            throw new WorkflowError('CLAIM_NOT_FOUND', `Claim 
          +${req.claim} not found`, {                                    
      117 +              claim_no: req.claim,                            
      118 +            });                                               
      119 +          }                                                   
      120 +          attempt.claim = claim;                              
      121 +          attempt.now = monotonic(attempt.now, claim.updated_a
          +t);                                                           
      122          }
      154 -        now = monotonic(now, claim.updated_at);               
      155 -      }                                                       
      156 -      if (req.idempotency_key) {                              
      157 -        const prior = await findIdempotency(client, req.idempo
          -tency_key);                                                   
      158 -        if (prior) {                                          
      159 -          if (prior.actor_user_id !== req.user_id || prior.req
          -uest_hash !== requestHash) {                                  
      160 -            throw new WorkflowError(                          
      161 -              'IDEMPOTENCY_KEY_REUSED',                       
      162 -              `Idempotency key '${req.idempotency_key}' was al
          -ready used for a different request`,                          
      163 -            );                                                
      123 +        const now = attempt.now;                              
      124 +        if (req.idempotency_key) {                            
      125 +          const prior = await tx.idempotency.find(req.idempote
          +ncy_key);                                                     
      126 +          if (prior) {                                        
      127 +            if (prior.actor_user_id !== req.user_id || prior.r
          +equest_hash !== requestHash) {                                
      128 +              throw new WorkflowError(                        
      129 +                'IDEMPOTENCY_KEY_REUSED',                     
      130 +                `Idempotency key '${req.idempotency_key}' was 
          +already used for a different request`,                        
      131 +              );                                              
      132 +            }                                                 
      133 +            return { replay: prior };                         
      134            }
      165 -          await client.query('COMMIT');                       
      166 -          return await this.replay(prior);                    
      135          }
      168 -      }                                                       
      136  
      170 -      const wf = claim ? await registry.get(client, claim.conf
          -ig_hash) : registry.current;                                  
      171 -      const users = await loadUsers(client);                  
      172 -      const getUser = (id: string) => users.find((u) => u.id =
          -== id);                                                       
      173 -      const user = getUser(req.user_id);                      
      174 -      if (user?.service_account && !internal.asSystem) {      
      175 -        throw new WorkflowError(                              
      176 -          'SERVICE_ACCOUNT_ONLY',                             
      177 -          `${req.user_id} is a service account and cannot be u
          -sed directly`,                                                
      178 -        );                                                    
      179 -      }                                                       
      180 -      const actor = resolveActor(wf, user, req.user_id, req.ro
          -le, req.transition_id);                                       
      181 -      actingRole = actor.role;                                
      182 -      const policyId = claim ? claim.policy_id : req.input?.po
          -licy_id;                                                      
      183 -      const policy = await findPolicy(client, typeof policyId 
          -=== 'string' ? policyId : undefined);                         
      184 -      const isCreation = !claim && wf.transitions.get(req.tran
          -sition_id)?.kind === 'create';                                
      185 -      const newClaim = isCreation                             
      186 -        ? { id: this.newId(), claim_no: await nextClaimNo(clie
          -nt, now.getUTCFullYear()) }                                   
      187 -        : undefined;                                          
      188 -                                                              
      189 -      const result = evaluateTransition(                      
      190 -        wf,                                                   
      191 -        claim,                                                
      192 -        {                                                     
      193 -          transition_id: req.transition_id,                   
      194 -          actor,                                              
      195 -          input: req.input ?? {},                             
      196 -          ...(req.expected_version !== undefined ? { expected_
          -version: req.expected_version } : {}),                        
      197 -          ...(newClaim ? { new_claim: newClaim } : {}),       
      198 -        },                                                    
      199 -        { policy, getUser },                                  
      200 -        { now, newId: this.newId },                           
      201 -      );                                                      
      202 -      if (!result.ok) throw result.error;                     
      203 -      const plan = result.plan;                               
      204 -                                                              
      205 -      if (claim) {                                            
      206 -        if (!(await updateClaim(client, plan.after, claim.vers
          -ion))) {                                                      
      137 +        const wf = claim ? await workflows.get(claim.config_ha
          +sh, tx.definitions) : workflows.current;                      
      138 +        const users = await tx.users.list();                  
      139 +        const getUser = (id: string) => users.find((u) => u.id
          + === id);                                                     
      140 +        const user = getUser(req.user_id);                    
      141 +        if (user?.service_account && !internal.asSystem) {    
      142            throw new WorkflowError(
      208 -            'CONCURRENT_MODIFICATION',                        
      209 -            `Claim ${claim.claim_no} changed concurrently`,   
      143 +            'SERVICE_ACCOUNT_ONLY',                           
      144 +            `${req.user_id} is a service account and cannot be
          + used directly`,                                              
      145            );
      146          }
      212 -      } else {                                                
      213 -        await insertClaim(client, plan.after);                
      214 -      }                                                       
      215 -      const head = claim ? await chainHead(client, claim.id) :
          - null;                                                        
      216 -      const entry = buildAuditEntry(plan, head, this.options.a
          -uditKey);                                                     
      217 -      await insertEntry(client, entry);                       
      218 -      const outboxIds = await enqueue(                        
      219 -        client,                                               
      220 -        plan.outbox.map((m) => ({                             
      221 -          claim_id: plan.after.id,                            
      222 -          audit_entry_id: entry.entry_id,                     
      223 -          effect_type: m.effect_type,                         
      224 -          payload: m.payload,                                 
      225 -          idempotency_key: m.idempotency_key,                 
      226 -          created_at: plan.occurred_at,                       
      227 -        })),                                                  
      228 -      );                                                      
      229 -      if (req.idempotency_key) {                              
      230 -        await saveIdempotency(client, {                       
      231 -          key: req.idempotency_key,                           
      232 -          actor_user_id: req.user_id,                         
      233 -          request_hash: requestHash,                          
      234 -          claim_id: plan.after.id,                            
      235 -          response: { claim_id: plan.after.id, entry_id: entry
          -.entry_id, outbox_ids: outboxIds },                           
      236 -          created_at: plan.occurred_at,                       
      237 -        });                                                   
      238 -      }                                                       
      239 -      if (outboxIds.length) {                                 
      240 -        await client.query('SELECT pg_notify($1, current_schem
          -a())', [OUTBOX_CHANNEL]);                                     
      241 -      }                                                       
      242 -      await client.query('COMMIT');                           
      147 +        const actor = resolveActor(wf, user, req.user_id, req.
          +role, req.transition_id);                                     
      148 +        attempt.role = actor.role;                            
      149 +        const policyId = claim ? claim.policy_id : req.input?.
          +policy_id;                                                    
      150 +        const policy = await tx.policies.find(typeof policyId 
          +=== 'string' ? policyId : undefined);                         
      151 +        const isCreation = !claim && wf.transitions.get(req.tr
          +ansition_id)?.kind === 'create';                              
      152 +        const newClaim = isCreation                           
      153 +          ? { id: this.newId(), claim_no: await tx.claims.next
          +ClaimNo(now.getUTCFullYear()) }                               
      154 +          : undefined;                                        
      155  
      244 -      const automatic = internal.autoAdvance === false ? [] : 
          -await this.autoAdvance(plan.after.id);                        
      245 -      return {                                                
      246 -        claim: automatic.at(-1)?.claim ?? plan.after,         
      247 -        entry,                                                
      248 -        outbox_ids: outboxIds,                                
      249 -        automatic,                                            
      250 -        replayed: false,                                      
      251 -      };                                                      
      156 +        const result = evaluateTransition(                    
      157 +          wf,                                                 
      158 +          claim,                                              
      159 +          {                                                   
      160 +            transition_id: req.transition_id,                 
      161 +            actor,                                            
      162 +            input: req.input ?? {},                           
      163 +            ...(req.expected_version !== undefined            
      164 +              ? { expected_version: req.expected_version }    
      165 +              : {}),                                          
      166 +            ...(newClaim ? { new_claim: newClaim } : {}),     
      167 +          },                                                  
      168 +          { policy, getUser },                                
      169 +          { now, newId: this.newId },                         
      170 +        );                                                    
      171 +        if (!result.ok) throw result.error;                   
      172 +        const plan = result.plan;                             
      173 +                                                              
      174 +        if (claim) {                                          
      175 +          if (!(await tx.claims.update(plan.after, claim.versi
          +on))) {                                                       
      176 +            throw new WorkflowError(                          
      177 +              'CONCURRENT_MODIFICATION',                      
      178 +              `Claim ${claim.claim_no} changed concurrently`, 
      179 +            );                                                
      180 +          }                                                   
      181 +        } else {                                              
      182 +          await tx.claims.insert(plan.after);                 
      183 +        }                                                     
      184 +        const head = claim ? await tx.audit.head(claim.id) : n
          +ull;                                                          
      185 +        const entry = buildAuditEntry(plan, head, this.options
          +.auditKey);                                                   
      186 +        await tx.audit.insert(entry);                         
      187 +        const outboxIds = await tx.outbox.enqueue(            
      188 +          plan.outbox.map((m) => ({                           
      189 +            claim_id: plan.after.id,                          
      190 +            audit_entry_id: entry.entry_id,                   
      191 +            effect_type: m.effect_type,                       
      192 +            payload: m.payload,                               
      193 +            idempotency_key: m.idempotency_key,               
      194 +            created_at: plan.occurred_at,                     
      195 +          })),                                                
      196 +        );                                                    
      197 +        if (req.idempotency_key) {                            
      198 +          await tx.idempotency.save({                         
      199 +            key: req.idempotency_key,                         
      200 +            actor_user_id: req.user_id,                       
      201 +            request_hash: requestHash,                        
      202 +            claim_id: plan.after.id,                          
      203 +            response: { claim_id: plan.after.id, entry_id: ent
          +ry.entry_id, outbox_ids: outboxIds },                         
      204 +            created_at: plan.occurred_at,                     
      205 +          });                                                 
      206 +        }                                                     
      207 +        if (outboxIds.length) await tx.outbox.notifyWorkers();
      208 +        return { plan, entry, outboxIds };                    
      209 +      });                                                     
      210      } catch (error) {
      253 -      await client.query('ROLLBACK').catch(() => undefined);  
      211        if (error instanceof WorkflowError && internal.recordDen
           ied !== false) {
      255 -        await this.recordRefusal(claim, req, actingRole, error
          -, now);                                                       
      212 +        await this.recordRefusal(attempt.claim, req, attempt.r
          +ole, error, attempt.now);                                     
      213        }
      214        throw error;
      258 -    } finally {                                               
      259 -      client.release();                                       
      215      }
      216 +                                                              
      217 +    if ('replay' in outcome) return this.replay(outcome.replay
          +);                                                            
      218 +    const { plan, entry, outboxIds } = outcome;               
      219 +    const automatic = internal.autoAdvance === false ? [] : aw
          +ait this.autoAdvance(plan.after.id);                          
      220 +    return {                                                  
      221 +      claim: automatic.at(-1)?.claim ?? plan.after,           
      222 +      entry,                                                  
      223 +      outbox_ids: outboxIds,                                  
      224 +      automatic,                                              
      225 +      replayed: false,                                        
      226 +    };                                                        
      227    }
      228  
      229    private async replay(prior: IdempotencyRecord): Promise<ActR
           esult> {
      264 -    const entry = await findEntry(this.options.pool, prior.res
          -ponse.entry_id as string);                                    
      265 -    const claim = prior.claim_id ? await findClaim(this.option
          -s.pool, prior.claim_id) : null;                               
      230 +    const { repos } = this.options.store;                     
      231 +    const entry = await repos.audit.find(prior.response.entry_
          +id as string);                                                
      232 +    const claim = prior.claim_id ? await repos.claims.find(pri
          +or.claim_id) : null;                                          
      233      if (!entry || !claim) throw new Error(`Idempotency record 
           ${prior.key} points to missing data`);
      234      return {
      235        claim,
     ...
      248      now: Date,
      249    ) {
      250      try {
      284 -      await recordDenied(this.options.pool, {                 
      251 +      await this.options.store.repos.denied.record({          
      252          claim_id: claim?.id ?? null,
      253          actor_user_id: req.user_id,
      254          actor_role: role,
     ...
      265  
      266    /** Runs automatic transitions (as the system service accoun
           t) while their conditions hold. */
      267    async autoAdvance(claimId: string): Promise<ActResult[]> {
      268 +    const { store, workflows } = this.options;                
      269      const results: ActResult[] = [];
      270      for (let step = 0; step < 10; step++) {
      303 -      const claim = await findClaim(this.options.pool, claimId
          -);                                                            
      271 +      const claim = await store.repos.claims.find(claimId);   
      272        if (!claim) break;
      305 -      const wf = await this.workflowFor(this.options.pool, cla
          -im);                                                          
      273 +      const wf = await workflows.workflowFor(claim);          
      274        const candidates = (wf.outgoing.get(claim.state) ?? []).
           filter((t) => t.automatic);
      275        let moved = false;
      276        for (const t of candidates) {
     ...
      300  
      301    /** Checks time-based automatic transitions for one claim or
            every open claim. */
      302    async runSystem(claimRef?: string): Promise<ActResult[]> {
      303 +    const { store, workflows } = this.options;                
      304      if (claimRef) {
      336 -      const claim = await this.getClaim(claimRef);            
      305 +      const claim = await store.repos.claims.find(claimRef);  
      306        if (!claim) throw new WorkflowError('CLAIM_NOT_FOUND', `
           Claim ${claimRef} not found`);
      307        return this.autoAdvance(claim.id);
      308      }
      309      const results: ActResult[] = [];
      341 -    for (const claim of await listClaims(this.options.pool, { 
          -limit: 1000 })) {                                             
      342 -      const wf = await this.workflowFor(this.options.pool, cla
          -im);                                                          
      310 +    for (const claim of await store.repos.claims.list({ limit:
          + 1000 })) {                                                   
      311 +      const wf = await workflows.workflowFor(claim);          
      312        if (wf.isTerminal(claim.state)) continue;
      313        results.push(...(await this.autoAdvance(claim.id)));
      314      }
      315      return results;
      316    }
      348 -                                                              
      349 -  // ── queries ──────────────────────────────────────────────
          -──────────────────────────────────                            
      350 -                                                              
      351 -  getClaim(ref: string): Promise<ClaimSnapshot | null> {      
      352 -    return findClaim(this.options.pool, ref);                 
      353 -  }                                                           
      354 -                                                              
      355 -  async requireClaim(ref: string): Promise<ClaimSnapshot> {   
      356 -    const claim = await this.getClaim(ref);                   
      357 -    if (!claim)                                               
      358 -      throw new WorkflowError('CLAIM_NOT_FOUND', `Claim ${ref}
          - not found`, { claim_no: ref });                              
      359 -    return claim;                                             
      360 -  }                                                           
      361 -                                                              
      362 -  listClaims(filter: ClaimFilter = {}): Promise<ClaimSnapshot[
          -]> {                                                          
      363 -    return listClaims(this.options.pool, filter);             
      364 -  }                                                           
      365 -                                                              
      366 -  users(): Promise<User[]> {                                  
      367 -    return loadUsers(this.options.pool);                      
      368 -  }                                                           
      369 -                                                              
      370 -  /**                                                         
      371 -   * Dry-run of the transitions available to a user. Users hol
          -ding several roles get, for each                              
      372 -   * transition, the result for the first of their roles that 
          -is allowed to run it.                                         
      373 -   */                                                         
      374 -  async available(                                            
      375 -    claimRef: string,                                         
      376 -    userId: string,                                           
      377 -    role?: string,                                            
      378 -  ): Promise<{                                                
      379 -    claim: ClaimSnapshot;                                     
      380 -    roles: string[];                                          
      381 -    transitions: Array<AvailableTransition & { acting_role: st
          -ring }>;                                                      
      382 -  }> {                                                        
      383 -    const claim = await this.requireClaim(claimRef);          
      384 -    const wf = await this.workflowFor(this.options.pool, claim
          -);                                                            
      385 -    const users = await loadUsers(this.options.pool);         
      386 -    const getUser = (id: string) => users.find((u) => u.id ===
          - id);                                                         
      387 -    const user = getUser(userId);                             
      388 -    if (!user) throw new WorkflowError('UNKNOWN_USER', `Unknow
          -n user '${userId}'`);                                         
      389 -    const roles = role ? [role] : user.roles;                 
      390 -    const policy = await findPolicy(this.options.pool, claim.p
          -olicy_id);                                                    
      391 -    const env = { now: monotonic(this.clock.now(), claim.updat
          -ed_at), newId: this.newId };                                  
      392 -    const perRole = roles.map((r) => ({                       
      393 -      role: r,                                                
      394 -      list: availableTransitions(                             
      395 -        wf,                                                   
      396 -        claim,                                                
      397 -        resolveActor(wf, user, userId, r),                    
      398 -        { policy, getUser },                                  
      399 -        env,                                                  
      400 -      ),                                                      
      401 -    }));                                                      
      402 -    const first = perRole[0]?.list ?? [];                     
      403 -    const transitions = first.map((t, i) => {                 
      404 -      const options = perRole.map((p) => ({ role: p.role, t: p
          -.list[i] as AvailableTransition }));                          
      405 -      const best =                                            
      406 -        options.find((o) => o.t.allowed) ?? options.find((o) =
          -> o.t.role_ok) ?? options[0];                                 
      407 -      return { ...(best?.t ?? t), acting_role: best?.role ?? r
          -oles[0] ?? '' };                                              
      408 -    });                                                       
      409 -    return { claim, roles, transitions };                     
      410 -  }                                                           
      411 -                                                              
      412 -  async audit(claimRef: string): Promise<{ claim: ClaimSnapsho
          -t; entries: AuditEntry[] }> {                                 
      413 -    const claim = await this.requireClaim(claimRef);          
      414 -    return { claim, entries: await listEntries(this.options.po
          -ol, claim.id) };                                              
      415 -  }                                                           
      416 -                                                              
      417 -  async denied(claimRef?: string): Promise<DeniedAttempt[]> { 
      418 -    if (!claimRef) return listDenied(this.options.pool);      
      419 -    const claim = await this.requireClaim(claimRef);          
      420 -    return listDenied(this.options.pool, claim.id);           
      421 -  }                                                           
      422 -                                                              
      423 -  /** Verifies the audit chain, the replay, the claim row and 
          -every definition involved. */                                 
      424 -  async verify(claimRef: string): Promise<VerifyReport> {     
      425 -    const { claim, entries } = await this.audit(claimRef);    
      426 -    const report = verifyClaimChain(claim, entries, this.optio
          -ns.auditKey);                                                 
      427 -    const hashes = new Set([claim.config_hash, ...entries.map(
          -(e) => e.config_hash)]);                                      
      428 -    for (const hash of hashes) {                              
      429 -      try {                                                   
      430 -        await this.options.registry.loadStored(this.options.po
          -ol, hash);                                                    
      431 -      } catch (error) {                                       
      432 -        const message =                                       
      433 -          error instanceof ConfigError                        
      434 -            ? error.issues.map((i) => i.message).join('; ')   
      435 -            : String(error);                                  
      436 -        report.issues.push({                                  
      437 -          code: 'DEFINITION_TAMPERED',                        
      438 -          message: `Definition ${hash.slice(0, 12)}…: ${messag
          -e}`,                                                          
      439 -        });                                                   
      440 -      }                                                       
      441 -    }                                                         
      442 -    report.ok = report.issues.length === 0;                   
      443 -    return report;                                            
      444 -  }                                                           
      445 -                                                              
      446 -  async verifyAll(): Promise<VerifyReport[]> {                
      447 -    const claims = await listClaims(this.options.pool, { limit
          -: 10_000 });                                                  
      448 -    const reports: VerifyReport[] = [];                       
      449 -    for (const c of claims) reports.push(await this.verify(c.i
          -d));                                                          
      450 -    return reports;                                           
      451 -  }                                                           
      317  }

● Tiếp theo là ClaimQueryService: gom các truy vấn và logic trước đây nằm trong
  controller (queue, detail, inspect, diagram).

● Write(src\services\claim-query-service.ts)
  ⎿  Wrote 223 lines to src\services\claim-query-service.ts
       1 import { randomUUID } from 'node:crypto';
         mpt } from '../domain/types';
       3 import { type AvailableTransition, availableTransitions, resolve
       4 import { WorkflowError } from '../engine/errors';
       5 import { type CompiledWorkflow, ConfigError } from '../engine/lo
       6 import { toMermaid } from '../engine/mermaid';
       7 import type { ClaimRepository } from '../repositories/claim-repo
       8 import type { Repositories } from '../repositories/unit-of-work'
         ;
      10 import { type VerifyReport, verifyClaimChain } from './verify';
     … +250 lines (ctrl+o to expand)

● Bash(python - <<'EOF'
      import re,io…)
  ⎿  2:import type { AuditEntry, ClaimFilter, ClaimSnapshot, DeniedAttempt,
      Policy } from '../domain/types';
     126:    policy: Policy | null;
  ⎿  Updated src\services\claim-query-service.ts (+2 -2)
      1  import { randomUUID } from 'node:crypto';
      2 -import type { AuditEntry, ClaimFilter, ClaimSnapshot, DeniedAtte
        -mpt } from '../domain/types';                                   
      2 +import type { AuditEntry, ClaimFilter, ClaimSnapshot, DeniedAtte
        +mpt, Policy } from '../domain/types';                           
      3  import { type AvailableTransition, availableTransitions, resolve
         Actor } from '../engine/engine';
      4  import { WorkflowError } from '../engine/errors';
      5  import { type CompiledWorkflow, ConfigError } from '../engine/lo
         ad';
     ...
      123    ): Promise<{
      124      claim: ClaimSnapshot;
      125      workflow: CompiledWorkflow;
      126 -    policy: Awaited<ReturnType<Repositories['policies']['find'
          -]>>;                                                          
      126 +    policy: Policy | null;                                    
      127      available: AvailableResult | undefined;
      128    }> {
      129      const claim = await this.requireClaim(claimRef);

● Giờ đến OperationsService (thay cho Operations).

● Write(src\services\operations-service.ts)
  ⎿  Added 74 lines, removed 40 lines
       1 -import type pg from 'pg';                                      
       2 -import type { OutboxMessage, OutboxStatus, Policy } from '../do
         -main/types';                                                   
       3 -import {                                                       
       4 -  listNotifications,                                           
       5 -  listPayments,                                                
       6 -  type MockNotification,                                       
       7 -  type MockPayment,                                            
       8 -  setFaults,                                                   
       9 -} from '../infra/repos/mock';                                  
      10 -import { listOutbox, retryDead } from '../infra/repos/outbox'; 
      11 -import {                                                       
      12 -  findPolicy,                                                  
      13 -  listDefinitions,                                             
      14 -  listPolicies,                                                
      15 -  type StoredDefinition,                                       
      16 -} from '../infra/repos/reference';                             
       1 +import type {                                                  
       2 +  MockNotification,                                            
       3 +  MockPayment,                                                 
       4 +  OutboxMessage,                                               
       5 +  OutboxStatus,                                                
       6 +  Policy,                                                      
       7 +  User,                                                        
       8 +} from '../domain/types';                                      
       9 +import type { Repositories } from '../repositories/unit-of-work
         +';                                                             
      10 +import { requireClaim } from './claim-query-service';          
      11  import { type Clock, systemClock } from './clock';
      12 +import type { InputField } from './workflow-service';          
      13  
      19 -export { describeRecipient } from '../infra/outbox/handlers';  
      20 -export type { MockNotification, MockPayment };                 
      21 -export type DefinitionSummary = Omit<StoredDefinition, 'content
         -'>;                                                            
      14 +/** One allowed value of a form input; user references carry th
         +e user, for labels. */                                         
      15 +export interface InputChoice {                                 
      16 +  value: string;                                               
      17 +  user?: User;                                                 
      18 +}                                                              
      19  
      23 -/** Operator queries and controls that sit next to the workflow
         -: outbox, mocks, definitions. */                               
      24 -export class Operations {                                      
      20 +/** Reference data and operator controls that sit next to the w
         +orkflow: outbox, mocks. */                                     
      21 +export class OperationsService {                               
      22    constructor(
      26 -    private readonly pool: pg.Pool,                            
      23 +    private readonly repos: Repositories,                      
      24      private readonly clock: Clock = systemClock,
      25    ) {}
      26  
      30 -  outbox(filter: { status?: OutboxStatus; claimId?: string } = 
         -{}): Promise<OutboxMessage[]> {                                
      31 -    return listOutbox(this.pool, filter);                      
      27 +  /** Every user, service accounts included. */                
      28 +  users(): Promise<User[]> {                                   
      29 +    return this.repos.users.list();                            
      30    }
      31  
      34 -  /** Gives a DEAD message a fresh set of attempts; false if it
         - is not DEAD. */                                               
      35 -  retryOutbox(id: number): Promise<boolean> {                  
      36 -    return retryDead(this.pool, id, this.clock.now());         
      32 +  /** Users a person can act as (no service accounts). */      
      33 +  async people(): Promise<User[]> {                            
      34 +    return (await this.repos.users.list()).filter((u) => !u.ser
         +vice_account);                                                 
      35    }
      36  
      39 -  /** Makes the next `count` calls to the mock payment gateway 
         -fail. */                                                       
      40 -  failNextPayments(count: number): Promise<void> {             
      41 -    return setFaults(this.pool, count);                        
      37 +  policies(): Promise<Policy[]> {                              
      38 +    return this.repos.policies.list();                         
      39    }
      40  
      44 -  payments(claimId?: string): Promise<MockPayment[]> {         
      45 -    return listPayments(this.pool, claimId);                   
      41 +  policy(id: string): Promise<Policy | null> {                 
      42 +    return this.repos.policies.find(id);                       
      43    }
      44  
      48 -  notifications(claimId?: string): Promise<MockNotification[]> 
         -{                                                              
      49 -    return listNotifications(this.pool, claimId);              
      45 +  /**                                                          
      46 +   * The values each choice input accepts: enum values, existin
         +g policies, and the people who                                 
      47 +   * hold the role a user reference asks for.                  
      48 +   */                                                          
      49 +  async inputChoices(fields: InputField[]): Promise<Record<stri
         +ng, InputChoice[]>> {                                          
      50 +    const users = await this.repos.users.list();               
      51 +    const policies = await this.repos.policies.list();         
      52 +    const choices: Record<string, InputChoice[]> = {};         
      53 +    for (const field of fields) {                              
      54 +      if (field.type === 'enum') choices[field.name] = (field.v
         +alues ?? []).map((v) => ({ value: v }));                       
      55 +      if (field.type === 'policy_ref') choices[field.name] = po
         +licies.map((p) => ({ value: p.id }));                          
      56 +      if (field.type === 'user_ref') {                         
      57 +        choices[field.name] = users                            
      58 +          .filter((u) => !u.service_account && (!field.role || 
         +u.roles.includes(field.role)))                                 
      59 +          .map((u) => ({ value: u.id, user: u }));             
      60 +      }                                                        
      61 +    }                                                          
      62 +    return choices;                                            
      63    }
      64  
      52 -  definitions(): Promise<DefinitionSummary[]> {                
      53 -    return listDefinitions(this.pool);                         
      65 +  // ── outbox ────────────────────────────────────────────────
         +─────────────────────────────────                              
      66 +                                                               
      67 +  /** Outbox messages, optionally of one claim (number or id) a
         +nd one status. */                                              
      68 +  async outbox(filter: { status?: OutboxStatus; claim?: string 
         +} = {}): Promise<OutboxMessage[]> {                            
      69 +    const claimId = filter.claim ? (await requireClaim(this.rep
         +os.claims, filter.claim)).id : undefined;                      
      70 +    return this.repos.outbox.list({                            
      71 +      ...(filter.status ? { status: filter.status } : {}),     
      72 +      ...(claimId ? { claimId } : {}),                         
      73 +    });                                                        
      74    }
      75  
      56 -  policies(): Promise<Policy[]> {                              
      57 -    return listPolicies(this.pool);                            
      76 +  /** Gives a DEAD message a fresh set of attempts; false if it
         + is not DEAD. */                                               
      77 +  retryOutbox(id: number): Promise<boolean> {                  
      78 +    return this.repos.outbox.retryDead(id, this.clock.now());  
      79    }
      80  
      60 -  policy(id: string): Promise<Policy | null> {                 
      61 -    return findPolicy(this.pool, id);                          
      81 +  // ── mock payment gateway and notification channel ─────────
         +─────────────────────────────────                              
      82 +                                                               
      83 +  /** Makes the next `count` calls to the mock payment gateway 
         +fail. */                                                       
      84 +  failNextPayments(count: number): Promise<void> {             
      85 +    return this.repos.mockGateway.setFaults(count);            
      86    }
      87 +                                                               
      88 +  async payments(claim?: string): Promise<MockPayment[]> {     
      89 +    const claimId = claim ? (await requireClaim(this.repos.clai
         +ms, claim)).id : undefined;                                    
      90 +    return this.repos.mockGateway.listPayments(claimId);       
      91 +  }                                                            
      92 +                                                               
      93 +  async notifications(claim?: string): Promise<MockNotification
         +[]> {                                                          
      94 +    const claimId = claim ? (await requireClaim(this.repos.clai
         +ms, claim)).id : undefined;                                    
      95 +    return this.repos.mockGateway.listNotifications(claimId);  
      96 +  }                                                            
      97  }

● Tiếp theo là effect handlers và outbox worker.

● Bash(python - <<'EOF'
      p='src/services/effect-handlers.ts'…)
  ⎿  import type { OutboxMessage } from '../domain/types';
     import { sha256Hex } from '../engine/hash';
     import { formatMoney, maskValue } from '../engine/templates';
     … +27 lines (ctrl+o to expand)
  ⎿  Updated src\services\effect-handlers.ts (+10 -11)
       1 -import type pg from 'pg';                                      
       2 -import type { OutboxMessage } from '../../domain/types';       
       3 -import { sha256Hex } from '../../engine/hash';                 
       4 -import { formatMoney, maskValue } from '../../engine/templates'
         -;                                                              
       5 -import { consumeFault, recordNotification, recordPayment } from
         - '../repos/mock';                                              
       1 +import type { OutboxMessage } from '../domain/types';          
       2 +import { sha256Hex } from '../engine/hash';                    
       3 +import { formatMoney, maskValue } from '../engine/templates';  
       4 +import type { MockGatewayRepository } from '../repositories/moc
         +k-gateway-repository';                                         
       5  
       6  export interface HandlerContext {
       8 -  db: pg.Pool;                                                 
       7 +  gateway: MockGatewayRepository;                              
       8    now: Date;
       9    log: (line: string) => void;
      10  }
     ...
      24  
      25  // Console output never includes notification bodies: they can 
          carry medical details, which are
      26  // sensitive personal data. The full text is kept in mock_notif
          ications (the "sent mail" box).
      28 -const notify: Handler = async (m, { db, now, log }) => {       
      27 +const notify: Handler = async (m, { gateway, now, log }) => {  
      28    const p = m.payload;
      30 -  const inserted = await recordNotification(db, {              
      29 +  const inserted = await gateway.recordNotification({          
      30      idempotency_key: m.idempotency_key,
      31      claim_id: m.claim_id,
      32      template: String(p.template),
     ...
      42    return { delivered: true, duplicate: !inserted };
      43  };
      44  
      46 -const triggerPayment: Handler = async (m, { db, now, log }) => 
         -{                                                              
      45 +const triggerPayment: Handler = async (m, { gateway, now, log }
         +) => {                                                         
      46    const p = m.payload;
      48 -  if (await consumeFault(db)) {                                
      47 +  if (await gateway.consumeFault()) {                          
      48      throw new Error('mock payment gateway unavailable (injected
           fault)');
      49    }
      50    const gatewayRef = `MOCKPAY-${sha256Hex(m.idempotency_key).sl
          ice(0, 10).toUpperCase()}`;
      52 -  const payment = await recordPayment(db, {                    
      51 +  const payment = await gateway.recordPayment({                
     … 3 more lines (ctrl+o to expand)

● Giờ viết lại worker để nó chỉ đi qua OutboxRepository và OutboxNotifications.

● Bash(python - <<'EOF'
      p='src/services/outbox-worker.ts'…)
  ⎿    private readonly log: (line: string) => void;
       private readonly handlers: Record<string, Handler>;
     … +92 lines (ctrl+o to expand)
  ⎿  Updated src\services\outbox-worker.ts (+28 -46)
       1  import { hostname } from 'node:os';
       2 -import type pg from 'pg';                                      
       3 -import { type Clock, ManualClock, systemClock } from '../../app
         -/clock';                                                       
       4 -import { leaseBatch, markDone, markFailed, reapExpiredLeases } 
         -from '../repos/outbox';                                        
       5 -import { OUTBOX_CHANNEL } from './channel';                    
       6 -import { HANDLERS, type Handler } from './handlers';           
       2 +import type { MockGatewayRepository } from '../repositories/moc
         +k-gateway-repository';                                         
       3 +import type { OutboxNotifications, OutboxRepository } from '../
         +repositories/outbox-repository';                               
       4 +import { type Clock, ManualClock, systemClock } from './clock';
       5 +import { HANDLERS, type Handler } from './effect-handlers';    
       6  
       7  export interface WorkerOptions {
       9 -  pool: pg.Pool;                                               
      10 -  schema: string;                                              
       8 +  outbox: OutboxRepository;                                    
       9 +  notifications: OutboxNotifications;                          
      10 +  /** What the handlers deliver to. */                         
      11 +  gateway: MockGatewayRepository;                              
      12    clock?: Clock;
      13    workerId?: string;
      14    leaseMs?: number;
     ...
      48    }
      49  
      50    async processOnce(): Promise<RoundResult> {
      50 -    const { pool } = this.options;                             
      51 +    const { outbox, gateway } = this.options;                  
      52      const now = this.clock.now();
      52 -    const reaped = await reapExpiredLeases(pool, now);         
      53 -    const batch = await leaseBatch(                            
      54 -      pool,                                                    
      53 +    const reaped = await outbox.reapExpiredLeases(now);        
      54 +    const batch = await outbox.lease(                          
      55        this.workerId,
      56        now,
      57        this.options.leaseMs ?? 30_000,
     ...
      62        const handler = this.handlers[message.effect_type];
      63        try {
      64          if (!handler) throw new Error(`no handler for effect ty
          pe ${message.effect_type}`);
      65 -        const output = await handler(message, { db: pool, now: 
         -this.clock.now(), log: this.log });                            
      66 -        await markDone(pool, message.id, this.workerId, this.cl
         -ock.now(), output);                                            
     … 84 more lines (ctrl+o to expand)

● Service layer xong. Tiếp theo là composition root src/bootstrap.ts.

● Write(src\bootstrap.ts)
  ⎿  Added 81 lines, removed 58 lines
       1 +// Composition root: the only module that wires PostgreSQL impl
         +ementations into the services.                                 
       2 +import { randomUUID } from 'node:crypto';                      
       3  import type pg from 'pg';
       2 -import { type CompiledWorkflow, loadWorkflowFile } from '../eng
         -ine/load';                                                     
       3 -import { migrate } from '../infra/db/migrate';                 
       4 -import { createPool, SCHEMA_RE } from '../infra/db/pool';      
       5 -import { env } from '../infra/env';                            
       6 -import { OutboxWorker, type WorkerOptions } from '../infra/outb
         -ox/worker';                                                    
       7 -import { upsertReference } from '../infra/repos/reference';    
       8 -import { ClaimService, type ServiceOptions } from './claim-serv
         -ice';                                                          
       9 -import { type Clock, systemClock } from './clock';             
      10 -import { DefinitionRegistry } from './definition-registry';    
      11 -import { Operations } from './operations';                     
      12 -import { loadSeed } from './seed';                             
       4 +import { type CompiledWorkflow, loadWorkflowFile } from './engi
         +ne/load';                                                      
       5 +import { migrate } from './infra/db/migrate';                  
       6 +import { createPool } from './infra/db/pool';                  
       7 +import { env } from './infra/env';                             
       8 +import { loadSeed } from './infra/seed-file';                  
       9 +import { createSchema, dropSchema as dropSchemaIn, upsertRefere
         +nce } from './repositories/postgres/admin';                    
      10 +import { PgOutboxNotifications } from './repositories/postgres/
         +outbox-repository';                                            
      11 +import { PgUnitOfWork } from './repositories/postgres/unit-of-w
         +ork';                                                          
      12 +import { ClaimQueryService } from './services/claim-query-servi
         +ce';                                                           
      13 +import { ClaimService, type ClaimServiceOptions } from './servi
         +ces/claim-service';                                            
      14 +import { type Clock, systemClock } from './services/clock';    
      15 +import { OperationsService } from './services/operations-servic
         +e';                                                            
      16 +import { OutboxWorker, type WorkerOptions } from './services/ou
         +tbox-worker';                                                  
      17 +import { WorkflowService } from './services/workflow-service'; 
      18  
      19 +/** What controllers use: they call these, never the database. 
         +*/                                                             
      20 +export interface Services {                                    
      21 +  claims: ClaimService;                                        
      22 +  queries: ClaimQueryService;                                  
      23 +  workflows: WorkflowService;                                  
      24 +  operations: OperationsService;                               
      25 +}                                                              
      26 +                                                               
      27 +/** Options of an outbox worker that callers may set (the rest 
         +comes from the app). */                                        
      28 +export type WorkerSettings = Omit<WorkerOptions, 'outbox' | 'no
         +tifications' | 'gateway' | 'clock'>;                           
      29 +                                                               
      30  export interface AppContext {
      31 +  /** Runtime-role pool, for tests and demos that check databas
         +e privileges directly. */                                      
      32    pool: pg.Pool;
      33    schema: string;
      34    clock: Clock;
      18 -  service: ClaimService;                                       
      19 -  ops: Operations;                                             
      35    workflow: CompiledWorkflow;
      36 +  services: Services;                                          
      37    /** Outbox worker on this app's pool and clock. */
      22 -  createWorker(options?: Omit<WorkerOptions, 'pool' | 'schema' 
         -| 'clock'>): OutboxWorker;                                     
      38 +  createWorker(options?: WorkerSettings): OutboxWorker;        
      39    close(): Promise<void>;
      40  }
      41  
     ...
      48    clock?: Clock;
      49    /** Id generator (default random UUIDs); the scenario runner 
          makes ids reproducible. */
      50    newId?: () => string;
      35 -  onAutomatic?: ServiceOptions['onAutomatic'];                 
      51 +  onAutomatic?: ClaimServiceOptions['onAutomatic'];            
      52  }
      53  
      54  /** Connects as the runtime role, loads the workflow file and r
          egisters its definition. */
     ...
      56    const workflow = options.workflow ?? loadWorkflowFile(options
          .configPath ?? env.workflowConfig());
      57    const schema = options.schema ?? env.schema();
      58    const clock = options.clock ?? systemClock;
      59 +  // One generator for writes and dry runs, so reproducible ids
         + stay reproducible.                                            
      60 +  const newId = options.newId ?? randomUUID;                   
      61    const pool = createPool(options.databaseUrl ?? env.databaseUr
          l(), schema);
      44 -  const service = new ClaimService({                           
      45 -    pool,                                                      
      46 -    registry: new DefinitionRegistry(workflow),                
      47 -    auditKey: env.auditKey(),                                  
      48 -    clock,                                                     
      49 -    ...(options.newId ? { newId: options.newId } : {}),        
      50 -    ...(options.onAutomatic ? { onAutomatic: options.onAutomati
         -c } : {}),                                                     
      51 -  });                                                          
      62 +  const store = new PgUnitOfWork(pool);                        
      63 +  const auditKey = env.auditKey();                             
      64 +  const workflows = new WorkflowService(workflow, store.repos.d
         +efinitions, clock);                                            
      65 +  const services: Services = {                                 
      66 +    claims: new ClaimService({                                 
      67 +      store,                                                   
      68 +      workflows,                                               
      69 +      auditKey,                                                
      70 +      clock,                                                   
      71 +      newId,                                                   
      72 +      ...(options.onAutomatic ? { onAutomatic: options.onAutoma
         +tic } : {}),                                                   
      73 +    }),                                                        
      74 +    queries: new ClaimQueryService({ repos: store.repos, workfl
         +ows, auditKey, clock, newId }),                                
      75 +    workflows,                                                 
      76 +    operations: new OperationsService(store.repos, clock),     
      77 +  };                                                           
      78    try {
      53 -    await service.init();                                      
      79 +    await workflows.register();                                
      80    } catch (error) {
      81      await pool.end();
      82      throw error;
     ...
       85      pool,
       86      schema,
       87      clock,
       62 -    service,                                                  
       63 -    ops: new Operations(pool, clock),                         
       88      workflow,
       65 -    createWorker: (workerOptions = {}) =>                     
       66 -      new OutboxWorker({ ...workerOptions, pool, schema, clock
          - }),                                                          
       89 +    services,                                                 
       90 +    createWorker: (settings = {}) =>                          
       91 +      new OutboxWorker({                                      
       92 +        ...settings,                                          
       93 +        outbox: store.repos.outbox,                           
       94 +        notifications: new PgOutboxNotifications(pool, schema)
          +,                                                             
       95 +        gateway: store.repos.mockGateway,                     
       96 +        clock,                                                
       97 +      }),                                                     
       98      close: () => pool.end(),
       99    };
      100  }
      101  
       71 -function checkSchema(schema: string) {                        
       72 -  if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema
          - name '${schema}'`);                                          
       73 -}                                                             
      102 +// ── owner-only maintenance: migrations, seed data and (devel
          +opment only) a full reset ─────────                           
      103  
       75 -/** Owner-only maintenance: migrations, seed data and (develop
          -ment only) a full reset. */                                   
       76 -export async function migrateSchema(ownerUrl = env.ownerUrl(),
          - schema = env.schema()) {                                     
       77 -  checkSchema(schema);                                        
       78 -  const pool = createPool(ownerUrl, schema, 1);               
      104 +async function asOwner<T>(                                    
      105 +  ownerUrl: string,                                           
      106 +  schema: string,                                             
      107 +  fn: (owner: pg.Pool) => Promise<T>,                         
      108 +): Promise<T> {                                               
      109 +  const owner = createPool(ownerUrl, schema, 1);              
      110    try {
       80 -    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
       81 -    return await migrate(pool);                               
      111 +    return await fn(owner);                                   
      112    } finally {
       83 -    await pool.end();                                         
      113 +    await owner.end();                                        
      114    }
      115  }
      116  
       87 -export async function seedSchema(                             
       88 -  ownerUrl = env.ownerUrl(),                                  
       89 -  schema = env.schema(),                                      
       90 -  seedPath?: string,                                          
       91 -) {                                                           
       92 -  checkSchema(schema);                                        
       93 -  const pool = createPool(ownerUrl, schema, 1);               
       94 -  try {                                                       
      117 +export function migrateSchema(ownerUrl = env.ownerUrl(), schem
          +a = env.schema()) {                                           
      118 +  return asOwner(ownerUrl, schema, async (owner) => {         
      119 +    await createSchema(owner, schema);                        
      120 +    return migrate(owner);                                    
      121 +  });                                                         
      122 +}                                                             
      123 +                                                              
      124 +export function seedSchema(ownerUrl = env.ownerUrl(), schema =
          + env.schema(), seedPath?: string) {                           
      125 +  return asOwner(ownerUrl, schema, async (owner) => {         
      126      const seed = loadSeed(seedPath);
       96 -    await upsertReference(pool, seed);                        
      127 +    await upsertReference(owner, seed);                       
      128      return { users: seed.users.length, policies: seed.policies
           .length };
       98 -  } finally {                                                 
       99 -    await pool.end();                                         
      100 -  }                                                           
      129 +  });                                                         
      130  }
      131  
      132  /**
      133   * Drops the schema with all its data. Audit tables are append
           -only, so this is the only way to
      134   * start over; never point it at real data.
      135   */
      107 -export async function dropSchema(ownerUrl = env.ownerUrl(), sc
          -hema = env.schema()) {                                        
      108 -  checkSchema(schema);                                        
      109 -  const pool = createPool(ownerUrl, schema, 1);               
      110 -  try {                                                       
      111 -    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`
          -);                                                            
      112 -  } finally {                                                 
      113 -    await pool.end();                                         
      114 -  }                                                           
      136 +export function dropSchema(ownerUrl = env.ownerUrl(), schema =
          + env.schema()) {                                              
      137 +  return asOwner(ownerUrl, schema, (owner) => dropSchemaIn(own
          +er, schema));                                                 
      138  }
      139  
      140  /** Drops, migrates and seeds the schema (development only). *
           /

● Giờ đến HTTP controller. Mình đặt type Services trong src/services/index.ts để
  controller chỉ phụ thuộc vào lớp service.

● Write(src\services\index.ts)
  ⎿  Wrote 12 lines to src\services\index.ts
       1 import type { ClaimQueryService } from './claim-query-service';
       2 import type { ClaimService } from './claim-service';
       3 import type { OperationsService } from './operations-service';
       4 import type { WorkflowService } from './workflow-service';
       5
         /
       7 export interface Services {
       8   claims: ClaimService;
       9   queries: ClaimQueryService;
      10   workflows: WorkflowService;
     … +2 lines (ctrl+o to expand)

● Update(src\bootstrap.ts)
  ⎿  Added 2 lines, removed 7 lines
      12  import { ClaimQueryService } from './services/claim-query-servi
          ce';
      13  import { ClaimService, type ClaimServiceOptions } from './servi
          ces/claim-service';
      14  import { type Clock, systemClock } from './services/clock';
      15 +import type { Services } from './services/index';              
      16  import { OperationsService } from './services/operations-servic
          e';
      17  import { OutboxWorker, type WorkerOptions } from './services/ou
          tbox-worker';
      18  import { WorkflowService } from './services/workflow-service';
      19  
      19 -/** What controllers use: they call these, never the database. 
         -*/                                                             
      20 -export interface Services {                                    
      21 -  claims: ClaimService;                                        
      22 -  queries: ClaimQueryService;                                  
      23 -  workflows: WorkflowService;                                  
      24 -  operations: OperationsService;                               
      25 -}                                                              
      20 +export type { Services };                                      
      21  
      22  /** Options of an outbox worker that callers may set (the rest 
          comes from the app). */
      23  export type WorkerSettings = Omit<WorkerOptions, 'outbox' | 'no
          tifications' | 'gateway' | 'clock'>;

● Write(src\controllers\http\requests.ts)
  ⎿  Wrote 95 lines to src\controllers\http\requests.ts
       1 // Maps HTTP requests to service inputs: headers, body and query
          parameters. No business rules.
       3 import { z } from 'zod';
       4 import type { ActorRef, ClaimListQuery } from '../../services/cl
         aim-query-service';
         laim-service';
       6 import { HttpProblem } from './problem';
       7
       9   ref: string;
      10 }
     … +102 lines (ctrl+o to expand)

● Bash(python - <<'EOF'
      p='src/controllers/http/requests.ts'…)
  ⎿  65:export function actionInput(request: FastifyRequest): CreateRequest
      {
     81:    ...actionInput(request),
  ⎿  Updated src\controllers\http\requests.ts (+3 -3)
      61    return typeof header === 'string' && header !== '' ? header :
           body.idempotency_key;
      62  }
      63  
      64 -/** POST /api/claims */                                        
      65 -export function creationInput(request: FastifyRequest): CreateR
         -equest {                                                       
      64 +/** The acting user and the body of POST /api/claims and of a t
         +ransition. */                                                  
      65 +export function actionInput(request: FastifyRequest): CreateReq
         +uest {                                                         
      66    const who = actor(request);
      67    const body = parseBody(ActBody, request.body);
      68    const key = idempotencyKey(request, body);
     ...
      78  /** POST /api/claims/:ref/transitions/:transition */
      79  export function transitionInput(request: FastifyRequest<{ Param
          s: TransitionParams }>): ActRequest {
      80    return {
      81 -    ...creationInput(request),                                 
      81 +    ...actionInput(request),                                   
      82      claim: request.params.ref,
      83      transition_id: request.params.transition,
      84    };

● Viết lại routes.ts: mỗi route chỉ còn một lời gọi service.

● Write(src\controllers\http\routes.ts)
  ⎿  Added 40 lines, removed 165 lines
       1 -import Fastify, { type FastifyInstance, type FastifyRequest } f
         -rom 'fastify';                                                 
       2 -import { z } from 'zod';                                       
       3 -import type { AppContext } from '../app/bootstrap';            
       4 -import type { ActRequest } from '../app/claim-service';        
       5 -import type { CompiledWorkflow } from '../engine/load';        
       6 -import { toMermaid } from '../engine/mermaid';                 
       1 +import Fastify, { type FastifyInstance } from 'fastify';       
       2 +import type { Services } from '../../services/index';          
       3  import { HttpProblem, toProblem } from './problem';
       4 +import {                                                       
       5 +  actionInput,                                                 
       6 +  type ClaimParams,                                            
       7 +  type ClaimsQuery,                                            
       8 +  listClaimsInput,                                             
       9 +  optionalActor,                                               
      10 +  type TransitionParams,                                       
      11 +  transitionInput,                                             
      12 +} from './requests';                                           
      13  
      14  export interface ServerOptions {
      15    /** One line per request (method, path, status, duration); ne
          ver bodies, which hold PII. */
      16    log?: (line: string) => void;
      17  }
      18  
      14 -const ActBody = z.strictObject({                               
      15 -  input: z.record(z.string(), z.unknown()).optional(),         
      16 -  expected_version: z.number().int().min(1).optional(),        
      17 -  idempotency_key: z.string().optional(),                      
      18 -});                                                            
      19 -                                                               
      20 -function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
      21 -  const result = schema.safeParse(body ?? {});                 
      22 -  if (!result.success) {                                       
      23 -    const issues = result.error.issues.map((i) => `${i.path.joi
         -n('.') || '(body)'}: ${i.message}`);                           
      24 -    throw new HttpProblem(400, 'BAD_REQUEST', `Invalid request 
         -body: ${issues.join('; ')}`);                                  
      25 -  }                                                            
      26 -  return result.data;                                          
      27 -}                                                              
      28 -                                                               
      29 -/**                                                            
      30 - * Demo authentication: the caller names the acting user (and o
         -ptionally the role) in headers.                                
      31 - * A real deployment would take both from a verified identity t
         -oken instead.                                                  
      32 - */                                                            
      33 -function actor(request: FastifyRequest): { userId: string; role
         -?: string } {                                                  
      34 -  const userId = request.headers['x-user-id'];                 
      35 -  if (typeof userId !== 'string' || userId === '') {           
      36 -    throw new HttpProblem(                                     
      37 -      401,                                                     
      38 -      'AUTHENTICATION_REQUIRED',                               
      39 -      'Name the acting user in the X-User-Id header',          
      40 -    );                                                         
      41 -  }                                                            
      42 -  const role = request.headers['x-role'];                      
      43 -  return { userId, ...(typeof role === 'string' && role !== '' 
         -? { role } : {}) };                                            
      44 -}                                                              
      45 -                                                               
      46 -function idempotencyKey(request: FastifyRequest, body: { idempo
         -tency_key?: string | undefined }) {                            
      47 -  const header = request.headers['idempotency-key'];           
      48 -  return typeof header === 'string' && header !== '' ? header :
         - body.idempotency_key;                                         
      49 -}                                                              
      50 -                                                               
      51 -/** What the UI needs to render forms and labels without knowin
         -g the workflow. */                                             
      52 -export function describeWorkflow(wf: CompiledWorkflow) {       
      53 -  const d = wf.definition;                                     
      54 -  const withValues = (inputs: CompiledWorkflow['creation']['inp
         -uts']) =>                                                      
      55 -    Object.entries(inputs).map(([name, def]) => ({             
      56 -      name,                                                    
      57 -      ...def,                                                  
      58 -      ...(def.type === 'enum' ? { values: wf.enums[def.enum ?? 
         -''] ?? [] } : {}),                                             
      59 -    }));                                                       
      60 -  return {                                                     
      61 -    id: wf.id,                                                 
      62 -    version: wf.version,                                       
      63 -    label: d.workflow.label ?? wf.id,                          
      64 -    config_hash: wf.hash,                                      
      65 -    states: Object.entries(d.states).map(([name, s]) => ({ name
         -, ...s })),                                                    
      66 -    roles: Object.entries(d.roles).map(([name, r]) => ({ name, 
         -...r })),                                                      
      67 -    counters: Object.entries(d.counters).map(([name, c]) => ({ 
         -name, max: c.max })),                                          
      68 -    document_requirements: d.document_requirements,            
      69 -    creation: {                                                
      70 -      id: wf.creation.id,                                      
      71 -      label: wf.creation.label ?? wf.creation.id,              
      72 -      roles: wf.creation.roles,                                
      73 -      inputs: withValues(wf.creation.inputs),                  
      74 -    },                                                         
      75 -    transitions: [...wf.transitions.values()].map((t) => ({    
      76 -      id: t.id,                                                
      77 -      label: t.label ?? t.id,                                  
      78 -      kind: t.kind,                                            
      79 -      from: t.from,                                            
      80 -      to: t.to ?? null,                                        
      81 -      roles: t.roles,                                          
      82 -      automatic: t.automatic,                                  
      83 -    })),                                                       
      84 -    diagram: toMermaid(wf),                                    
      85 -  };                                                           
      86 -}                                                              
      87 -                                                               
      19 +/** HTTP controller: every route maps the request, calls one se
         +rvice method and returns. */                                   
      20  export async function buildServer(
      89 -  app: AppContext,                                             
      21 +  services: Services,                                          
      22    options: ServerOptions = {},
      23  ): Promise<FastifyInstance> {
      92 -  const { service, ops } = app;                                
      24 +  const { claims, queries, workflows, operations } = services; 
      25    const server = Fastify({ logger: false });
      26  
      27    server.setErrorHandler((error, request, reply) => {
     ...
       45      });
       46    }
       47  
      116 -  const act = async (request: FastifyRequest, claim: string | 
          -null, transition: string) => {                                
      117 -    const who = actor(request);                               
      118 -    const body = parseBody(ActBody, request.body);            
      119 -    const key = idempotencyKey(request, body);                
      120 -    const req: ActRequest = {                                 
      121 -      claim,                                                  
      122 -      transition_id: transition,                              
      123 -      user_id: who.userId,                                    
      124 -      input: body.input ?? {},                                
      125 -      ...(who.role ? { role: who.role } : {}),                
      126 -      ...(body.expected_version !== undefined ? { expected_ver
          -sion: body.expected_version } : {}),                          
      127 -      ...(key ? { idempotency_key: key } : {}),               
      128 -    };                                                        
      129 -    return service.act(req);                                  
      130 -  };                                                          
       48 +  server.get('/api/health', async () => workflows.health());  
       49  
      132 -  server.get('/api/health', async () => ({                    
      133 -    ok: true,                                                 
      134 -    workflow: {                                               
      135 -      id: service.workflow.id,                                
      136 -      version: service.workflow.version,                      
      137 -      config_hash: service.workflow.hash,                     
      138 -    },                                                        
      139 -  }));                                                        
       50 +  server.get('/api/workflow', async () => workflows.describe()
          +);                                                            
       51  
      141 -  server.get('/api/workflow', async () => describeWorkflow(ser
          -vice.workflow));                                              
       52 +  server.get('/api/users', async () => operations.people());  
       53  
      143 -  server.get('/api/users', async () => (await service.users())
          -.filter((u) => !u.service_account));                          
       54 +  server.get('/api/policies', async () => operations.policies(
          +));                                                           
       55  
      145 -  server.get('/api/policies', async () => ops.policies());    
      146 -                                                              
      147 -  server.get<{ Querystring: { state?: string; queue?: string; 
          -limit?: string } }>(                                          
      148 -    '/api/claims',                                            
      149 -    async (request) => {                                      
      150 -      const { state, queue, limit } = request.query;          
      151 -      const claims = await service.listClaims({               
      152 -        limit: Math.min(Number(limit) || 100, 500),           
      153 -        ...(state ? { states: state.split(',') } : {}),       
      154 -      });                                                     
      155 -      if (queue !== '1' && queue !== 'true') return claims;   
      156 -      const who = actor(request);                             
      157 -      const queued = [];                                      
      158 -      for (const claim of claims) {                           
      159 -        const { transitions } = await service.available(claim.
          -id, who.userId, who.role);                                    
      160 -        const ready = transitions.filter((t) => t.allowed && !
          -t.automatic).map((t) => t.id);                                
      161 -        if (ready.length) queued.push({ ...claim, can_run: rea
          -dy });                                                        
      162 -      }                                                       
      163 -      return queued;                                          
      164 -    },                                                        
       56 +  server.get<{ Querystring: ClaimsQuery }>('/api/claims', asyn
          +c (request) =>                                                
       57 +    queries.listClaims(listClaimsInput(request)),             
       58    );
       59  
       60    server.post('/api/claims', async (request, reply) => {
      168 -    const result = await act(request, null, service.workflow.c
          -reation.id);                                                  
       61 +    const result = await claims.create(actionInput(request)); 
       62      reply.status(result.replayed ? 200 : 201);
       63      return result;
       64    });
       65  
      173 -  server.get<{ Params: { ref: string } }>('/api/claims/:ref', 
          -async (request) => {                                          
      174 -    const claim = await service.requireClaim(request.params.re
          -f);                                                           
      175 -    const wf = await service.workflowFor(app.pool, claim);    
      176 -    const { entries } = await service.audit(claim.id);        
      177 -    const who = request.headers['x-user-id'] ? actor(request) 
          -: undefined;                                                  
      178 -    const available = who ? await service.available(claim.id, 
          -who.userId, who.role) : undefined;                            
      179 -    return {                                                  
      180 -      claim,                                                  
      181 -      policy: await ops.policy(claim.policy_id),              
      182 -      workflow: describeWorkflow(wf),                         
      183 -      diagram: toMermaid(wf, { current: claim.state, visited: 
          -entries.map((e) => e.to_state) }),                            
      184 -      ...(available                                           
      185 -        ? {                                                   
      186 -            acting: { user_id: who?.userId, roles: available.r
          -oles },                                                       
      187 -            available: available.transitions,                 
      188 -          }                                                   
      189 -        : {}),                                                
      190 -    };                                                        
      191 -  });                                                         
       66 +  server.get<{ Params: ClaimParams }>('/api/claims/:ref', asyn
          +c (request) =>                                                
       67 +    queries.detail(request.params.ref, optionalActor(request))
          +,                                                             
       68 +  );                                                          
       69  
      193 -  server.post<{ Params: { ref: string; transition: string } }>
          -(                                                             
       70 +  server.post<{ Params: TransitionParams }>(                  
       71      '/api/claims/:ref/transitions/:transition',
      195 -    async (request) => act(request, request.params.ref, reques
          -t.params.transition),                                         
       72 +    async (request) => claims.act(transitionInput(request)),  
       73    );
       74  
      198 -  server.get<{ Params: { ref: string } }>('/api/claims/:ref/au
          -dit', async (request) => {                                    
      199 -    return (await service.audit(request.params.ref)).entries; 
      200 -  });                                                         
       75 +  server.get<{ Params: ClaimParams }>('/api/claims/:ref/audit'
          +, async (request) =>                                          
       76 +    queries.auditEntries(request.params.ref),                 
       77 +  );                                                          
       78  
      202 -  server.get<{ Params: { ref: string } }>('/api/claims/:ref/de
          -nied', async (request) =>                                     
      203 -    service.denied(request.params.ref),                       
       79 +  server.get<{ Params: ClaimParams }>('/api/claims/:ref/denied
          +', async (request) =>                                         
       80 +    queries.denied(request.params.ref),                       
       81    );
       82  
      206 -  server.get<{ Params: { ref: string } }>('/api/claims/:ref/ve
          -rify', async (request) =>                                     
      207 -    service.verify(request.params.ref),                       
       83 +  server.get<{ Params: ClaimParams }>('/api/claims/:ref/verify
          +', async (request) =>                                         
       84 +    queries.verify(request.params.ref),                       
       85    );
       86  
      210 -  server.get<{ Params: { ref: string } }>('/api/claims/:ref/no
          -tifications', async (request) => {                            
      211 -    const claim = await service.requireClaim(request.params.re
          -f);                                                           
      212 -    return ops.notifications(claim.id);                       
      213 -  });                                                         
       87 +  server.get<{ Params: ClaimParams }>('/api/claims/:ref/notifi
          +cations', async (request) =>                                  
       88 +    operations.notifications(request.params.ref),             
       89 +  );                                                          
       90  
      215 -  server.get<{ Params: { ref: string } }>('/api/claims/:ref/ou
          -tbox', async (request) => {                                   
      216 -    const claim = await service.requireClaim(request.params.re
          -f);                                                           
      217 -    return ops.outbox({ claimId: claim.id });                 
      218 -  });                                                         
       91 +  server.get<{ Params: ClaimParams }>('/api/claims/:ref/outbox
          +', async (request) =>                                         
       92 +    operations.outbox({ claim: request.params.ref }),         
       93 +  );                                                          
       94  
       95    /** Fires time-based automatic transitions now (what a sched
           uler would do periodically). */
      221 -  server.post('/api/system/run', async () => ({ results: await
          - service.runSystem() }));                                     
       96 +  server.post('/api/system/run', async () => ({ results: await
          + claims.runSystem() }));                                      
       97  
       98    return server;
       99  }
● Bash(python - <<'EOF'
      p='src/controllers/http/server.ts'…)
  ⎿  // HTTP API for the web UI. Usage: npm run api [-- --port 3000] [-- --
     no-worker]
     // Runs the outbox worker in the same process unless --no-worker is gi
     … +8 lines (ctrl+o to expand)
  ⎿  Updated src\controllers\http\server.ts (+2 -2)
      1  // HTTP API for the web UI. Usage: npm run api [-- --port 3000] 
         [-- --no-worker]
      2  // Runs the outbox worker in the same process unless --no-worker
          is given (then run `npm run worker`).
      3  import pc from 'picocolors';
      4 -import { createApp } from '../app/bootstrap';                   
      4 +import { createApp } from '../../bootstrap';                    
      5  import { buildServer } from './routes';
      6  
      7  function option(name: string): string | undefined {
     ...
      15    const app = await createApp({
      16      ...(option('--config') ? { configPath: option('--config') }
           : {}),
      17    });
      18 -  const server = await buildServer(app, { log: (line) => consol
         -e.log(pc.dim(line)) });                                        
      18 +  const server = await buildServer(app.services, { log: (line) 
         +=> console.log(pc.dim(line)) });                               
      19  
      20    const stop = new AbortController();
      21    const worker = process.argv.includes('--no-worker')

● Bash(sed -i "s#import { WorkflowError } from '../engine/errors';#import {
      WorkflowError } from '../../engine/errors';#"
      src/controllers/http/problem.ts && head -1 sr…)
  ⎿  import { WorkflowError } from '../../engine/errors';
       }
       const t = table(['Transition', 'To', 'Roles', 'Inputs']);
     … +50 lines (ctrl+o to expand)
  ⎿  Updated src\controllers\http\problem.ts (+1 -1)
      1 -import { WorkflowError } from '../engine/errors';               
      1 +import { WorkflowError } from '../../engine/errors';            
      2  
      3  /** RFC 9457 problem details; `code` and the workflow error deta
         ils are extension members. */
      4  export interface Problem {

● Bash(python - <<'EOF'
      p='src/controllers/cli/render.ts'…)
  ⎿  5:  ClaimSnapshot,
     39:export function renderClaim(claim: ClaimSnapshot, wf: CompiledWorkf
     low, policy?: Policy | null) {
     … +2 lines (ctrl+o to expand)
  ⎿  Updated src\controllers\cli\render.ts (+18 -19)
       1  import Table from 'cli-table3';
       2  import pc from 'picocolors';
       3 -import type { ActResult } from '../app/claim-service';         
       4 -import {                                                       
       5 -  type DefinitionSummary,                                      
       6 -  describeRecipient,                                           
       7 -  type MockNotification,                                       
       8 -  type MockPayment,                                            
       9 -} from '../app/operations';                                    
      10 -import type { VerifyReport } from '../app/verify';             
       3  import type {
       4    AuditEntry,
       5    ClaimSnapshot,
       6 +  DefinitionSummary,                                           
       7    DeniedAttempt,
       8 +  MockNotification,                                            
       9 +  MockPayment,                                                 
      10    OutboxMessage,
      11    Policy,
      12    User,
      18 -} from '../domain/types';                                      
      19 -import type { AvailableTransition } from '../engine/engine';   
      20 -import { WorkflowError } from '../engine/errors';              
      21 -import { type CompiledWorkflow, ConfigError } from '../engine/l
         -oad';                                                          
      22 -import { formatDateTime, formatMoney } from '../engine/template
         -s';                                                            
      13 +} from '../../domain/types';                                   
      14 +import type { AvailableTransition } from '../../engine/engine';
      15 +import { WorkflowError } from '../../engine/errors';           
      16 +import { type CompiledWorkflow, ConfigError } from '../../engin
         +e/load';                                                       
      17 +import { formatDateTime, formatMoney } from '../../engine/templ
         +ates';                                                         
      18 +import type { ClaimListItem } from '../../services/claim-query-
         +service';                                                      
      19 +import type { ActResult } from '../../services/claim-service'; 
      20 +import { describeRecipient } from '../../services/effect-handle
         +rs';                                                           
      21 +import type { VerifyReport } from '../../services/verify';     
      22  
      23  export const out = (line = '') => process.stdout.write(`${line}
          \n`);
      24  
     ...
      108    out(pc.dim('Add --as <user> to see which of these that user 
           can run now and why.'));
      109  }
      110  
     … 34 more lines (ctrl+o to expand)

● Giờ đến CLI controller (index.ts).

  Ran 1 shell command (ctrl+o to expand)

● Script quá dài nên heredoc bị lỗi quoting. Mình chuyển sang ghi script vào
  scratchpad bằng Write rồi chạy.

  Made 1 scratchpad edit +259, ran 1 shell command (ctrl+o to expand)

● Bash(python "C:/Users/Admin/AppData/Local/Temp/claude/d--work-papaya/66278519-
      af57-4993-b369-a8053c43aad4/scratchpad/cli_index.py"
      src/controllers/cli/index.ts && gr…)
  ⎿  ok
     84:    await fn({ services: app.services, createWorker: (o) => app.cre
     ateWorker(o) }, g);
     86:    await app.close();
  ⎿  Updated src\controllers\cli\index.ts (+84 -113)
       6    migrateSchema,
       7    resetSchema,
       8    seedSchema,
       9 -} from '../app/bootstrap';                                     
      10 -import type { ActRequest } from '../app/claim-service';        
      11 -import { type Clock, ManualClock } from '../app/clock';        
      12 -import type { OutboxStatus } from '../domain/types';           
      13 -import { WorkflowError } from '../engine/errors';              
      14 -import { ConfigError, loadWorkflowFile } from '../engine/load';
      15 -import { toMermaid } from '../engine/mermaid';                 
      16 -import { env } from '../infra/env';                            
       9 +} from '../../bootstrap';                                      
      10 +import type { OutboxStatus } from '../../domain/types';        
      11 +import { WorkflowError } from '../../engine/errors';           
      12 +import { ConfigError } from '../../engine/load';               
      13 +import { env } from '../../infra/env';                         
      14 +import type { ActRequest, CreateRequest } from '../../services/
         +claim-service';                                                
      15 +import { type Clock, ManualClock } from '../../services/clock';
      16 +import type { Services } from '../../services/index';          
      17 +import { validateWorkflowFile, workflowFileDiagram } from '../.
         +./services/workflow-service';                                  
      18  import { runInteractive } from './interactive';
      19  import {
      20    out,
     ...
      63    return input;
      64  }
      65  
      66 +/** What a command gets: the services, and the outbox worker fo
         +r the commands that run it. */                                 
      67 +interface CommandContext {                                     
      68 +  services: Services;                                          
      69 +  createWorker: AppContext['createWorker'];                    
      70 +}                                                              
      71 +                                                               
      72  async function withApp(
      73    cmd: Command,
      67 -  fn: (app: AppContext, g: GlobalOptions) => Promise<void>,    
      74 +  fn: (ctx: CommandContext, g: GlobalOptions) => Promise<void>,
      75    clock?: Clock,
      76  ) {
      77    const g = cmd.optsWithGlobals<GlobalOptions>();
     ...
      81      ...(clock ? { clock } : {}),
     … 333 more lines (ctrl+o to expand)

  Ran 1 shell command (ctrl+o to expand)

● CLI index.ts xong. Giờ viết lại interactive.ts, để mỗi bước prompt chỉ gọi một
  method service.

● Write(src\controllers\cli\interactive.ts)
  ⎿  Added 45 lines, removed 67 lines
       1  import * as p from '@clack/prompts';
       2  import pc from 'picocolors';
       3 -import type { AppContext } from '../app/bootstrap';            
       4 -import type { ClaimSnapshot, User } from '../domain/types';    
       5 -import type { AvailableTransition } from '../engine/engine';   
       6 -import { WorkflowError } from '../engine/errors';              
       7 -import type { CompiledTransition } from '../engine/load';      
       8 -import type { InputDef } from '../engine/schema';              
       3 +import type { ClaimSnapshot, User } from '../../domain/types'; 
       4 +import type { AvailableTransition } from '../../engine/engine';
       5 +import { WorkflowError } from '../../engine/errors';           
       6 +import type { Services } from '../../services/index';          
       7 +import type { InputChoice } from '../../services/operations-ser
         +vice';                                                         
       8 +import type { InputField } from '../../services/workflow-servic
         +e';                                                            
       9  import {
      10    out,
      11    renderAudit,
     ...
      16    renderVerify,
      17  } from './render';
      18  
      19 -type InputField = { name: string } & InputDef & { values?: read
         -only string[] };                                               
      20 -                                                               
      19  class Cancelled extends Error {}
      20  
      21  /** Ctrl+C in any prompt leaves interactive mode. */
     ...
      34  /** Prompts for one input based on its declared type; returns u
          ndefined when an optional one is skipped. */
      35  async function promptInput(
      36    def: InputField,
      39 -  users: User[],                                               
      40 -  policies: string[],                                          
      37 +  choices: InputChoice[] | undefined,                          
      38  ): Promise<string | undefined> {
      39    const label = `${def.label ?? def.name}${def.required ? '' : 
          pc.dim(' (optional)')}`;
      40    const skip = { value: '', label: pc.dim('(skip)') };
      44 -  const choose = async (options: Array<{ value: string; label?:
         - string; hint?: string }>) => {                                
      41 +  if (choices) {                                               
      42 +    const options = choices.map(({ value, user }) => ({        
      43 +      value,                                                   
      44 +      ...(user ? { hint: `${user.display_name} · ${user.roles.j
         +oin(', ')}` } : {}),                                           
      45 +    }));                                                       
      46      const value = check(
      47        await p.select({ message: label, options: def.required ? 
          options : [...options, skip] }),
      48      );
      49      return value === '' ? undefined : value;
      49 -  };                                                           
      50 -  if (def.type === 'enum') return choose((def.values ?? []).map
         -((v) => ({ value: v })));                                      
      51 -  if (def.type === 'user_ref') {                               
      52 -    const eligible = users.filter(                             
      53 -      (u) => !u.service_account && (!def.role || u.roles.includ
         -es(def.role)),                                                 
      54 -    );                                                         
      55 -    return choose(                                             
      56 -      eligible.map((u) => ({ value: u.id, hint: `${u.display_na
         -me} · ${u.roles.join(', ')}` })),                              
      57 -    );                                                         
      50    }
      59 -  if (def.type === 'policy_ref') return choose(policies.map((id
         -) => ({ value: id })));                                        
      51    if (def.type === 'boolean') return String(check(await p.confi
          rm({ message: label })));
      52    const placeholder = inputHint(def);
      53    const value = check(
     ...
       71  
       72  async function promptInputs(
       73    fields: InputField[],
       83 -  app: AppContext,                                            
       74 +  services: Services,                                         
       75  ): Promise<Record<string, string>> {
       85 -  const users = await app.service.users();                    
       86 -  const policies = (await app.ops.policies()).map((pol) => pol
          -.id);                                                         
       76 +  const choices = await services.operations.inputChoices(field
          +s);                                                           
       77    const input: Record<string, string> = {};
       78    for (const field of fields) {
       89 -    const value = await promptInput(field, users, policies);  
       79 +    const value = await promptInput(field, choices[field.name]
          +);                                                            
       80      if (value !== undefined) input[field.name] = value;
       81    }
       82    return input;
       83  }
       84  
       95 -function creationFields(t: CompiledTransition, app: AppContext
          -): InputField[] {                                             
       96 -  return Object.entries(t.inputs).map(([name, def]) => ({     
       97 -    name,                                                     
       98 -    ...def,                                                   
       99 -    ...(def.type === 'enum' ? { values: app.workflow.enums[def
          -.enum ?? ''] ?? [] } : {}),                                   
      100 -  }));                                                        
      101 -}                                                             
      102 -                                                              
       85  /** Runs an action and prints the outcome; refusals are shown,
            not thrown. */
       86  async function attempt(fn: () => Promise<void>) {
       87    try {
     ...
      103    };
      104  }
      105  
      124 -async function claimMenu(app: AppContext, user: User, claimId:
          - string) {                                                    
      106 +async function claimMenu(services: Services, user: User, claim
          +Id: string) {                                                 
      107    for (;;) {
      126 -    const { claim, roles, transitions } = await app.service.av
          -ailable(claimId, user.id);                                    
      127 -    const wf = await app.service.workflowFor(app.pool, claim);
      108 +    const { claim, workflow, policy, available } = await servi
          +ces.queries.inspect(                                          
      109 +      claimId,                                                
      110 +      user.id,                                                
      111 +    );                                                        
      112 +    if (!available) return;                                   
      113      out();
      129 -    renderClaim(claim, wf, await app.ops.policy(claim.policy_i
          -d));                                                          
      130 -    renderAvailable(user.id, roles, transitions);             
      131 -    const manual = transitions.filter((t) => !t.automatic);   
      114 +    renderClaim(claim, workflow, policy);                     
      115 +    renderAvailable(user.id, available.roles, available.transi
          +tions);                                                       
      116 +    const manual = available.transitions.filter((t) => !t.auto
          +matic);                                                       
      117      const choice = check(
      118        await p.select({
      119          message: 'What next?',
     ...
      127      );
      128      if (choice === ':back') return;
      129      if (choice === ':audit') {
      145 -      renderAudit((await app.service.audit(claim.id)).entries)
          -;                                                             
      130 +      renderAudit(await services.queries.auditEntries(claim.id
          +));                                                           
      131        continue;
      132      }
      133      if (choice === ':verify') {
      149 -      renderVerify(await app.service.verify(claim.id));       
      134 +      renderVerify(await services.queries.verify(claim.id));  
      135        continue;
      136      }
      137      const t = manual.find((x) => x.id === choice);
      138      if (!t) continue;
      139      await attempt(async () => {
      155 -      const input = await promptInputs(t.inputs, app);        
      140 +      const input = await promptInputs(t.inputs, services);   
      141        if (
      142          !check(
      143            await p.confirm({
     ...
      147        ) {
      148          return;
      149        }
      165 -      const result = await app.service.act({                  
      150 +      const result = await services.claims.act({              
      151          claim: claim.id,
      152          transition_id: t.id,
      153          user_id: user.id,
     ...
      160    }
      161  }
      162  
      178 -async function submitClaim(app: AppContext, user: User) {     
      179 -  const t = app.workflow.creation;                            
      180 -  const role = t.roles.find((r) => user.roles.includes(r));   
      163 +async function submitClaim(services: Services, user: User) {  
      164 +  const form = services.workflows.creationForm(user);         
      165 +  const role = form.acting_role;                              
      166    if (!role) return;
      167    await attempt(async () => {
      183 -    const input = await promptInputs(creationFields(t, app), a
          -pp);                                                          
      184 -    const result = await app.service.act({                    
      185 -      claim: null,                                            
      186 -      transition_id: t.id,                                    
      187 -      user_id: user.id,                                       
      188 -      role,                                                   
      189 -      input,                                                  
      190 -    });                                                       
      168 +    const input = await promptInputs(form.inputs, services);  
      169 +    const result = await services.claims.create({ user_id: use
          +r.id, role, input });                                         
      170      renderResult(result);
      192 -    await claimMenu(app, user, result.claim.id);              
      171 +    await claimMenu(services, user, result.claim.id);         
      172    });
      173  }
      174  
      196 -async function pickClaim(app: AppContext, user: User): Promise
          -<string | undefined> {                                        
      197 -  const claims: ClaimSnapshot[] = await app.service.listClaims
          -({ limit: 30 });                                              
      175 +async function pickClaim(services: Services, user: User): Prom
          +ise<string | undefined> {                                     
      176 +  const claims: ClaimSnapshot[] = await services.queries.listC
          +laims({ limit: 30 });                                         
      177    if (claims.length === 0) {
      178      p.log.info('No claims yet.');
      179      return undefined;
     ...
      195    return id || undefined;
      196  }
      197  
      219 -export async function runInteractive(app: AppContext): Promise
          -<void> {                                                      
      220 -  p.intro(pc.bold(`Claims workflow · ${app.workflow.id} v${app
          -.workflow.version}`));                                        
      198 +export async function runInteractive(services: Services): Prom
          +ise<void> {                                                   
      199 +  const wf = services.workflows.current;                      
      200 +  p.intro(pc.bold(`Claims workflow · ${wf.id} v${wf.version}`)
          +);                                                            
      201    p.log.info('Side effects are queued; run `npm run worker` in
            another terminal to deliver them.');
      202    try {
      203      for (;;) {
      224 -      const users = (await app.service.users()).filter((u) => 
          -!u.service_account);                                          
      204 +      const users = await services.operations.people();       
      205        const userId = check(
      206          await p.select({
      207            message: 'Act as',
     ...
      217        const user = users.find((u) => u.id === userId);
      218        if (!user) break;
      219        for (;;) {
      240 -        const canSubmit = app.workflow.creation.roles.some((r)
          - => user.roles.includes(r));                                  
      220 +        const form = services.workflows.creationForm(user);   
      221          const action = check(
      222            await p.select({
      223              message: `${user.id}: what would you like to do?`,
      224              options: [
      225                { value: 'open', label: 'Open a claim' },
      246 -              ...(canSubmit                                   
      247 -                ? [{ value: 'new', label: `New claim (${app.wo
          -rkflow.creation.id})` }]                                      
      248 -                : []),                                        
      226 +              ...(form.acting_role ? [{ value: 'new', label: `
          +New claim (${form.id})` }] : []),                             
      227                { value: 'switch', label: 'Switch user' },
      228              ],
      229            }),
      230          );
      231          if (action === 'switch') break;
      254 -        if (action === 'new') await submitClaim(app, user);   
      232 +        if (action === 'new') await submitClaim(services, user
          +);                                                            
      233          if (action === 'open') {
      256 -          const claimId = await pickClaim(app, user);         
      257 -          if (claimId) await claimMenu(app, user, claimId);   
      234 +          const claimId = await pickClaim(services, user);    
      235 +          if (claimId) await claimMenu(services, user, claimId
          +);                                                            
      236          }
      237        }
      238      }

● Controller xong. Giờ cập nhật scenarios.

  Searched for 1 pattern (ctrl+o to expand)

● Mình dùng một script cho các thay đổi cơ học (đường dẫn import, đường truy cập
  service) trên scenarios và tests.

  Made 3 scratchpad edits +51 -3 (ctrl+o to expand)

● Bash(python "C:/Users/Admin/AppData/Local/Temp/claude/d--work-papaya/66278519-
      af57-4993-b369-a8053c43aad4/scratchpad/callers.py" src/scenarios/*.ts
      tests/helpers/*.t…)
  ⎿  updated src/scenarios/harness.ts
     updated src/scenarios/report.ts
     updated src/scenarios/run.ts
     … +13 lines (ctrl+o to expand)
  ⎿  Updated src\scenarios\harness.ts (+14 -14)
      1 -import type { AppContext } from '../app/bootstrap';             
      2 -import type { ActResult } from '../app/claim-service';          
      3 -import { type ManualClock, MINUTE } from '../app/clock';        
      4 -import type { VerifyReport } from '../app/verify';              
      1 +import type { AppContext } from '../bootstrap';                 
      2 +import type { ActResult } from '../services/claim-service';     
      3 +import { type ManualClock, MINUTE } from '../services/clock';   
      4 +import type { VerifyReport } from '../services/verify';         
      5  import type { ClaimSnapshot } from '../domain/types';
      6  import { type Failure, WorkflowError } from '../engine/errors';
      7  
     ...
      74      return this.current;
      75    }
      76  
      77 -  get service() {                                              
      78 -    return this.current.service;                               
      77 +  get services() {                                             
      78 +    return this.current.services;                              
      79    }
      80  
      81    /** Switches new claims to the extended workflow; existing cl
          aims keep their pinned version. */
     ...
      120        ...(claim ? { claim } : {}),
      121      };
      122      try {
      123 -      const result = await this.service.act({                 
      123 +      const result = await this.services.claims.act({         
      124          claim,
      125          transition_id: transition,
      126          user_id: user,
     ...
      167  
      168    /** Records what `user` may do on the claim right now (the "
           available transitions" view). */
      169    async available(claimNo: string, user: string): Promise<void
           > {
      170 -    const { transitions } = await this.service.available(claim
          -No, user);                                                    
      170 +    const { transitions } = await this.services.queries.availa
          +ble(claimNo, user);                                           
      171      this.steps.push({
      172        kind: 'available',
      173        at: this.now(),
     ...
      214  
      215    /** Runs the scheduler pass that fires time-based automatic 
           transitions. */
      216    async system(claimNo?: string): Promise<ActResult[]> {
     … 45 more lines (ctrl+o to expand)
  ⎿  Updated src\scenarios\report.ts (+1 -1)
      1 -import type { VerifyReport } from '../app/verify';              
      1 +import type { VerifyReport } from '../services/verify';         
      2  import type { AuditEntry, ClaimSnapshot, DeniedAttempt } from '.
         ./domain/types';
      3  import { formatDateTime } from '../engine/templates';
      4  import type { ScenarioRun, StepRecord } from './harness';
  ⎿  Updated src\scenarios\run.ts (+7 -7)
      10    dropSchema,
      11    migrateSchema,
      12    seedSchema,
      13 -} from '../app/bootstrap';                                     
      14 -import { ManualClock } from '../app/clock';                    
      13 +} from '../bootstrap';                                         
      14 +import { ManualClock } from '../services/clock';               
      15  import { formatDateTime } from '../engine/templates';
      16  import { env } from '../infra/env';
      17  import { type ScenarioEnv, ScenarioRun } from './harness';
     ...
      162        }
      163        const trails: ClaimTrail[] = [];
      164        for (const claimNo of run.claims) {
      165 -        const { claim, entries } = await run.service.audit(cla
          -imNo);                                                        
      166 -        const wf = await run.service.workflowFor(run.app.pool,
          - claim);                                                      
      165 +        const { claim, entries } = await run.services.queries.
          +audit(claimNo);                                               
      166 +        const wf = await run.services.workflows.workflowFor(cl
          +aim);                                                         
      167          trails.push({
      168            scenario: scenario.id,
      169            claim,
      170            workflow_version: wf.version,
      171            entries,
      172 -          verify: await run.service.verify(claimNo),          
      172 +          verify: await run.services.queries.verify(claimNo), 
      173          });
      174        }
      175        const result = { scenario, run, trails };
     ...
      203        };
      204        const trails = results.flatMap((r) => r.trails);
      205        const claimNos = new Map(
      206 -        (await base.service.listClaims({ limit: 10_000 })).map
          -((c) => [c.id, c.claim_no]),                                  
      206 +        (await base.services.queries.listClaims({ limit: 10_00
          +0 })).map((c) => [c.id, c.claim_no]),                         
      207        );
      208        mkdirSync(RESULTS_DIR, { recursive: true });
      209        writeFileSync(join(RESULTS_DIR, 'scenarios.md'), scenari
           osMarkdown(results, meta));
     ...
      226        );
      227        writeFileSync(
      228          join(RESULTS_DIR, 'denied-attempts.md'),
      229 -        deniedMarkdown(await base.service.denied(), (id) => (i
          -d ? (claimNos.get(id) ?? id) : '—')),                         
      229 +        deniedMarkdown(await base.services.queries.denied(), (
          +id) => (id ? (claimNos.get(id) ?? id) : '—')),                
     … 3 more lines (ctrl+o to expand)
  ⎿  Updated src\scenarios\scenarios.ts (+9 -9)
      1  // Demo scenarios. Unlike the engine, this file is allowed to na
         me states, transitions and users
      2  // of config/workflow.yaml: it is a script that drives that part
         icular workflow.
      3 -import { DAY } from '../app/clock';                             
      3 +import { DAY } from '../services/clock';                        
      4  import type { ScenarioRun } from './harness';
      5  
      6  export interface Scenario {
     ...
      35          'PAYMENT_INITIATED',
      36          'CLOSED',
      37        ]);
      38 -      const payments = await s.app.ops.payments((await s.claim(
         -c)).id);                                                       
      38 +      const payments = await s.app.services.operations.payments
         +((await s.claim(c)).id);                                       
      39        s.check(
      40          'exactly one payment reached the gateway',
      41          payments.length === 1,
     ...
      351        await s.toAssessment(c);
      352        await s.assess(c, 1_500_000);
      353        await s.act(c, 'approve', 'u_assessor_01');
      354 -      await s.app.ops.failNextPayments(2);                    
      354 +      await s.app.services.operations.failNextPayments(2);    
      355        s.note('Fault injection: the next 2 calls to the mock pa
           yment gateway fail.');
      356        await s.act(c, 'initiate_payment', 'u_finance_01', {}, {
            key: `pay-${c}` });
      357        await s.act(c, 'initiate_payment', 'u_finance_01', {}, {
            key: `pay-${c}` });
      358        const id = (await s.claim(c)).id;
      359 -      const payments = await s.app.ops.payments(id);          
      359 +      const payments = await s.app.services.operations.payment
          +s(id);                                                        
      360        s.check(
      361          'exactly one payment despite two failures and a repeat
           ed request',
      362          payments.length === 1,
      363          `${payments.length}`,
      364        );
      365 -      const message = (await s.app.ops.outbox({ claimId: id })
          -).find(                                                       
      365 +      const message = (await s.app.services.operations.outbox(
          +{ claim: id })).find(                                         
      366          (m) => m.effect_type === 'trigger_payment',
      367        );
      368        s.check(
      369          'the payment message succeeded on its third attempt',
      370          message?.attempts === 3 && message.status === 'DONE',
      371        );
      372 -      const { entries } = await s.service.audit(c);           
     … 23 more lines (ctrl+o to expand)
  ⎿  Updated src\scenarios\tamper-demo.ts (+7 -7)
       4  // Usage: npm run demo:tamper [-- --keep]
       5  import type pg from 'pg';
       6  import pc from 'picocolors';
       7 -import { createApp, dropSchema, migrateSchema, seedSchema } fro
         -m '../app/bootstrap';                                          
       8 -import { ManualClock } from '../app/clock';                    
       9 -import type { VerifyReport } from '../app/verify';             
       7 +import { createApp, dropSchema, migrateSchema, seedSchema } fro
         +m '../bootstrap';                                              
       8 +import { ManualClock } from '../services/clock';               
       9 +import type { VerifyReport } from '../services/verify';        
      10  import { createPool } from '../infra/db/pool';
      11  import { env } from '../infra/env';
      12  import { ScenarioRun } from './harness';
     ...
      81          `${claimNo} approved for 2,000,000 VND (${claim.version
          } audit entries) in schema ${schema}`,
      82        ),
      83      );
      84 -    printReport(await app.service.verify(claimNo));            
      84 +    printReport(await app.services.queries.verify(claimNo));   
      85  
      86      say();
      87      say(pc.bold('1. The database refuses edits made behind the 
          engine'));
     ...
      102          claim.id,
      103        ]),
      104      );
      105 -    printReport(await app.service.verify(claimNo));           
      105 +    printReport(await app.services.queries.verify(claimNo));  
      106  
      107      say();
      108      say(pc.bold('2. An owner disables the triggers and edits t
           he claim row'));
     ...
      112        `UPDATE claims SET data = jsonb_set(data, '{assessment,a
           pproved_amount}', '90000000') WHERE id = $1`,
      113        [claim.id],
      114      );
      115 -    printReport(await app.service.verify(claimNo));           
      115 +    printReport(await app.services.queries.verify(claimNo));  
      116  
      117      say();
      118      say(pc.bold('3. … and rewrites who approved it in the audi
           t log'));
     ...
      122        `UPDATE audit_log SET actor_user_id = 'u_lead_01' WHERE 
           claim_id = $1 AND transition_id = 'approve'`,
      123        [claim.id],
      124      );
      125 -    printReport(await app.service.verify(claimNo));           
     … 4 more lines (ctrl+o to expand)
  ⎿  … 9 more files changed

  Ran 1 shell command (ctrl+o to expand)

● Phần cơ học trông ổn. Còn vài chỗ cần sửa tay: outbox.test.ts, api.test.ts, và
  cho scenarios.ts dùng thống nhất getter services.

● Bash(sed -i 's/s\.app\.services\./s.services./g' src/scenarios/scenarios.ts &&
      sed -i 's/server = await buildServer(db\.app);/server = await
      buildServer(db.app.servi…)
  ⎿  26:    server = await buildServer(db.app.services);
  ⎿  Updated src\scenarios\scenarios.ts (+4 -4)
      35          'PAYMENT_INITIATED',
      36          'CLOSED',
      37        ]);
      38 -      const payments = await s.app.services.operations.payments
         -((await s.claim(c)).id);                                       
      38 +      const payments = await s.services.operations.payments((aw
         +ait s.claim(c)).id);                                           
      39        s.check(
      40          'exactly one payment reached the gateway',
      41          payments.length === 1,
     ...
      351        await s.toAssessment(c);
      352        await s.assess(c, 1_500_000);
      353        await s.act(c, 'approve', 'u_assessor_01');
      354 -      await s.app.services.operations.failNextPayments(2);    
      354 +      await s.services.operations.failNextPayments(2);        
      355        s.note('Fault injection: the next 2 calls to the mock pa
           yment gateway fail.');
      356        await s.act(c, 'initiate_payment', 'u_finance_01', {}, {
            key: `pay-${c}` });
      357        await s.act(c, 'initiate_payment', 'u_finance_01', {}, {
            key: `pay-${c}` });
      358        const id = (await s.claim(c)).id;
      359 -      const payments = await s.app.services.operations.payment
          -s(id);                                                        
      359 +      const payments = await s.services.operations.payments(id
          +);                                                            
      360        s.check(
      361          'exactly one payment despite two failures and a repeat
           ed request',
      362          payments.length === 1,
      363          `${payments.length}`,
      364        );
      365 -      const message = (await s.app.services.operations.outbox(
          -{ claim: id })).find(                                         
      365 +      const message = (await s.services.operations.outbox({ cl
          +aim: id })).find(                                             
      366          (m) => m.effect_type === 'trigger_payment',
      367        );
      368        s.check(
  ⎿  Updated tests\integration\api.test.ts (+1 -1)
      23  
      24    beforeAll(async () => {
      25      db = await createTestDb('api');
      26 -    server = await buildServer(db.app);                        
      26 +    server = await buildServer(db.app.services);               
      27    });
      28    afterAll(async () => {
      29      await server?.close();
  ⎿  Updated tests\integration\outbox.test.ts (+8 -3)
      1  import { afterAll, beforeAll, describe, expect, it } from 'vites
         t';
      2  import type { OutboxMessage } from '../../src/domain/types';
      3 +import { createPgRepositories } from '../../src/repositories/pos
        +tgres/unit-of-work';                                            
      4  import { HANDLERS } from '../../src/services/effect-handlers';
      4 -import { leaseBatch } from '../../src/infra/repos/outbox';      
      5  import { createTestDb, Driver, hasDatabase, type TestDb } from '
         ../helpers/pg-schema';
      6  
      7  async function until(check: () => Promise<boolean>, timeoutMs = 
         5000) {
     ...
      64    it('a message whose worker died is taken again after the leas
          e expires', async () => {
      65      const claimNo = await d.submit();
      66      const claim = await d.services.queries.requireClaim(claimNo
          );
      67 -    const [leased] = await leaseBatch(db.app.pool, 'crashed-wor
         -ker', db.clock.now(), 30_000, 1);                              
      67 +    const { outbox } = createPgRepositories(db.app.pool);      
      68 +    const [leased] = await outbox.lease('crashed-worker', db.cl
         +ock.now(), 30_000, 1);                                         
      69      expect(leased?.claim_id).toBe(claim.id);
      70  
      71      expect((await worker('rescuer').processOnce()).leased).toBe
          (0);
     ...
      120      const [message] = (await db.app.services.operations.outbox
           ({ claim: started.claim.id })).filter(
      121        (m) => m.effect_type === 'trigger_payment',
      122      );
      122 -    const ctx = { db: db.app.pool, now: db.clock.now(), log: (
          -) => undefined };                                             
      123 +    const ctx = {                                             
      124 +      gateway: createPgRepositories(db.app.pool).mockGateway, 
      125 +      now: db.clock.now(),                                    
      126 +      log: () => undefined,                                   
      127 +    };                                                        
      128      const first = await HANDLERS.trigger_payment(message as Ou
           tboxMessage, ctx);
      129      const second = await HANDLERS.trigger_payment(message as O
           utboxMessage, ctx);
      130      expect(second).toEqual({ gateway_ref: first.gateway_ref, d
           uplicate: true });

● Typecheck không báo lỗi. Giờ chạy đầy đủ npm run typecheck (cả web) và lint.

  Ran 1 shell command (ctrl+o to expand)

● Typecheck đã qua. Lỗi lint chỉ là format và thứ tự import, đều sửa tự động
  được.

● Bash(npx biome check --write . 2>&1 | tail -5; npm run lint 2>&1 | tail -30;
      git status --short)
  ⎿  Checked 103 files in 89ms. Fixed 20 files.

     > claims-workflow-orchestrator@0.1.0 lint
     … +58 lines (ctrl+o to expand)
  ⎿  Updated src\bootstrap.ts (+5 -1)
       6  import { createPool } from './infra/db/pool';
       7  import { env } from './infra/env';
       8  import { loadSeed } from './infra/seed-file';
       9 -import { createSchema, dropSchema as dropSchemaIn, upsertRefere
         -nce } from './repositories/postgres/admin';                    
       9 +import {                                                       
      10 +  createSchema,                                                
      11 +  dropSchema as dropSchemaIn,                                  
      12 +  upsertReference,                                             
      13 +} from './repositories/postgres/admin';                        
      14  import { PgOutboxNotifications } from './repositories/postgres/
          outbox-repository';
      15  import { PgUnitOfWork } from './repositories/postgres/unit-of-w
          ork';
      16  import { ClaimQueryService } from './services/claim-query-servi
          ce';
  ⎿  Updated src\controllers\cli\interactive.ts (+1 -4)
      105  
      106  async function claimMenu(services: Services, user: User, claim
           Id: string) {
      107    for (;;) {
      108 -    const { claim, workflow, policy, available } = await servi
          -ces.queries.inspect(                                          
      109 -      claimId,                                                
      110 -      user.id,                                                
      111 -    );                                                        
      108 +    const { claim, workflow, policy, available } = await servi
          +ces.queries.inspect(claimId, user.id);                        
      109      if (!available) return;
      110      out();
      111      renderClaim(claim, workflow, policy);
  ⎿  Updated src\controllers\http\requests.ts (+3 -1)
      85  }
      86  
      87  /** GET /api/claims?state=A,B&limit=100&queue=1 (the queue need
          s the acting user). */
      88 -export function listClaimsInput(request: FastifyRequest<{ Query
         -string: ClaimsQuery }>): ClaimListQuery {                      
      88 +export function listClaimsInput(                               
      89 +  request: FastifyRequest<{ Querystring: ClaimsQuery }>,       
      90 +): ClaimListQuery {                                            
      91    const { state, queue, limit } = request.query;
      92    return {
      93      limit: Math.min(Number(limit) || 100, 500),
  ⎿  Updated src\repositories\postgres\claim-repository.ts (+1 -3)
      89    }
      90  
      91    async nextClaimNo(year: number): Promise<string> {
      92 -    const { rows } = await this.db.query<{ n: number }>(       
      93 -      "SELECT nextval('claim_no_seq')::int AS n",              
      94 -    );                                                         
      92 +    const { rows } = await this.db.query<{ n: number }>("SELECT
         + nextval('claim_no_seq')::int AS n");                          
      93      return `CLM-${year}-${String(rows[0]?.n).padStart(6, '0')}`
          ;
      94    }
      95  
  ⎿  Updated src\repositories\postgres\idempotency-repository.ts (+8 -1)
      21      await this.db.query(
      22        `INSERT INTO idempotency_keys (key, actor_user_id, reques
          t_hash, claim_id, response, created_at)
      23         VALUES ($1, $2, $3, $4, $5, $6)`,
      24 -      [r.key, r.actor_user_id, r.request_hash, r.claim_id, JSON
         -.stringify(r.response), r.created_at],                         
      24 +      [                                                        
      25 +        r.key,                                                 
      26 +        r.actor_user_id,                                       
      27 +        r.request_hash,                                        
      28 +        r.claim_id,                                            
      29 +        JSON.stringify(r.response),                            
      30 +        r.created_at,                                          
      31 +      ],                                                       
      32      );
      33    }
      34  }
  ⎿  … 15 more files changed

● Lint đã sạch. Giờ cập nhật package.json và vitest.config.ts.

● Bash(sed -i 's#src/cli/index\.ts#src/controllers/cli/index.ts#g;
      s#src/api/server\.ts#src/controllers/http/server.ts#g' package.json && sed
      -i "s#exclude: \['src/cli…)
  ⎿  --- a/package.json
     +++ b/package.json
     -    "cli": "tsx src/cli/index.ts",
     … +17 lines (ctrl+o to expand)
  ⎿  Updated package.json (+7 -7)
       8      "node": ">=22"
       9    },
      10    "scripts": {
      11 -    "cli": "tsx src/cli/index.ts",                             
      12 -    "worker": "tsx src/cli/index.ts worker",                   
      11 +    "cli": "tsx src/controllers/cli/index.ts",                 
      12 +    "worker": "tsx src/controllers/cli/index.ts worker",       
      13      "scenarios": "tsx src/scenarios/run.ts",
      14      "db:setup": "tsx scripts/db-setup.ts",
      15 -    "db:migrate": "tsx src/cli/index.ts db migrate",           
      16 -    "db:seed": "tsx src/cli/index.ts db seed",                 
      15 +    "db:migrate": "tsx src/controllers/cli/index.ts db migrate"
         +,                                                              
      16 +    "db:seed": "tsx src/controllers/cli/index.ts db seed",     
      17      "demo:tamper": "tsx src/scenarios/tamper-demo.ts",
      18 -    "config:validate": "tsx src/cli/index.ts config validate", 
      18 +    "config:validate": "tsx src/controllers/cli/index.ts config
         + validate",                                                    
      19      "config:schema": "tsx scripts/gen-json-schema.ts",
      20 -    "api": "tsx src/api/server.ts",                            
      21 -    "dev": "concurrently -n api,web -c blue,green \"tsx watch s
         -rc/api/server.ts\" \"vite --config web/vite.config.ts\"",      
      20 +    "api": "tsx src/controllers/http/server.ts",               
      21 +    "dev": "concurrently -n api,web -c blue,green \"tsx watch s
         +rc/controllers/http/server.ts\" \"vite --config web/vite.config
         +.ts\"",                                                        
      22      "build:web": "vite build --config web/vite.config.ts",
      23      "test": "vitest run",
      24      "test:unit": "vitest run tests/unit",
  ⎿  Updated vitest.config.ts (+1 -1)
      10      coverage: {
      11        provider: 'v8',
      12        include: ['src/**/*.ts'],
      13 -      exclude: ['src/cli/**', 'src/api/**', 'src/scenarios/**']
         -,                                                              
      13 +      exclude: ['src/controllers/**', 'src/scenarios/**'],     
      14      },
      15    },
      16  });

● Thêm test chốt chặn kiến trúc (không cần DB).

● Write(tests\unit\architecture.test.ts)
  ⎿  Wrote 79 lines to tests\unit\architecture.test.ts
       1 import { readdirSync, readFileSync } from 'node:fs';
       2 import { dirname, join, relative, resolve } from 'node:path';
       3 import { fileURLToPath } from 'node:url';
       4 import { describe, expect, it } from 'vitest';
       5
         ;
       7
       8 interface Import {
       9   /** Importing file, relative to src/. */
      10   file: string;
     … +86 lines (ctrl+o to expand)

● Bash(npx biome check --write tests/unit/architecture.test.ts 2>&1 | tail -2;
      npm run test:unit 2>&1 | tail -25)
  ⎿  Checked 1 file in 9ms. Fixed 1 file.

     > claims-workflow-orchestrator@0.1.0 test:unit
     … +10 lines (ctrl+o to expand)
  ⎿  Updated tests\unit\architecture.test.ts (+14 -5)
      34  const imports = allImports();
      35  
      36  function violations(layer: RegExp, forbidden: (i: Import) => bo
          olean): string[] {
      37 -  return imports.filter((i) => layer.test(i.file) && forbidden(
         -i)).map((i) => `${i.file} → ${i.specifier}`);                  
      37 +  return imports                                               
      38 +    .filter((i) => layer.test(i.file) && forbidden(i))         
      39 +    .map((i) => `${i.file} → ${i.specifier}`);                 
      40  }
      41  
      42  const targets = (re: RegExp) => (i: Import) => i.target !== nul
          l && re.test(i.target);
     ...
      49  
      50    it('controllers call services, never repositories or the data
          base', () => {
      51      expect(
      50 -      violations(/^controllers\//, (i) => i.specifier === 'pg' 
         -|| targets(/^(repositories|infra\/db)\//)(i)),                 
      52 +      violations(                                              
      53 +        /^controllers\//,                                      
      54 +        (i) => i.specifier === 'pg' || targets(/^(repositories|
         +infra\/db)\//)(i),                                             
      55 +      ),                                                       
      56      ).toEqual([]);
      57    });
      58  
     ...
      60      expect(
      61        violations(
      62          /^services\//,
      58 -        (i) => i.specifier === 'pg' || targets(/^(infra\/db|rep
         -ositories\/postgres|controllers)\//)(i),                       
      63 +        (i) =>                                                 
      64 +          i.specifier === 'pg' || targets(/^(infra\/db|reposito
         +ries\/postgres|controllers)\//)(i),                            
      65        ),
      66      ).toEqual([]);
      67    });
     ...
      70      expect(
      71        violations(
      72          /^repositories\/[^/]+$/,
      67 -        (i) => i.specifier === 'pg' || targets(/^(repositories\
         -/postgres|services|controllers)\//)(i),                        
      73 +        (i) =>                                                 
      74 +          i.specifier === 'pg' || targets(/^(repositories\/post
         +gres|services|controllers)\//)(i),                             
      75        ),
      76      ).toEqual([]);
      77    });
      78  
     … 8 more lines (ctrl+o to expand)

● Unit test qua cả 66 test. Giờ kiểm tra test kiến trúc có thật sự bắt được vi
  phạm không: tạm thêm một import sai rồi chạy lại.
  Ran 1 shell command (ctrl+o to expand)

● Test kiến trúc bắt được cả hai import sai; file tạm đã xoá. Giờ chạy các bước
  CI không cần DB: validate hai workflow, diagram, build web.

  Ran 1 shell command (ctrl+o to expand)

● Các bước không cần DB đã chạy ổn. Mình sẽ dựng một worktree của HEAD trong
  scratchpad (chia sẻ node_modules qua junction) để so byte với code gốc, và
  dùng worktree này để chụp baseline DB sau này.

  Made 1 scratchpad edit +29, ran 2 shell commands (ctrl+o to expand)

● Các lệnh không cần DB cho output giống hệt bản gốc, chỉ khác đường dẫn tuyệt
  đối trong thông báo ENOENT, đúng như dự kiến. Giờ cập nhật docs.

  Read 2 files, ran 1 shell command (ctrl+o to expand)

● Update(CLAUDE.md)
  ⎿  Added 13 lines, removed 1 line
      18  
      19  ## Architecture rules
      20  
      21 -- Dependencies point one way: `cli` / `api` → `app` → `engine`.
         - `infra` implements ports used by `app`.                       
      21 +- Three layers, dependencies pointing one way: `controllers` → 
         +`services` → `repositories`                                    
      22 +  (interfaces) ← `repositories/postgres` (implementations); ser
         +vices also use `engine`.                                       
      23 +  `src/bootstrap.ts` is the only place that wires implementatio
         +ns into services.                                              
      24 +  `tests/unit/architecture.test.ts` enforces the import rules. 
      25 +  - **Controllers** (`src/controllers/http`, `src/controllers/c
         +li`): parse and validate input                                 
      26 +    (zod, headers, CLI args), call exactly one service method, 
         +then return, render or map the                                 
      27 +    result to an HTTP status or exit code. No business rules, n
         +o `AppContext`/pool, no imports                                
      28 +    from `repositories/`, `infra/db` or `pg`.                  
      29 +  - **Services** (`src/services`): all logic. Data access only 
         +through repository interfaces;                                 
      30 +    transactions through `UnitOfWork.transaction`. Never import
         + `pg`, `infra/db` or                                           
      31 +    `repositories/postgres`.                                   
      32 +  - **Repositories**: interfaces in `src/repositories/*.ts`, Po
         +stgreSQL implementations in                                    
      33 +    `src/repositories/postgres/`, the only place with SQL besid
         +es migrations.                                                 
      34  - `src/engine` is pure: no I/O, no `Date.now()`, no randomness.
           Time and ids are injected.
      35  - Never add workflow-specific behaviour (state names, transitio
          n ids, roles) to TypeScript.
      36    If a new behaviour is needed, add a generic condition/effect 
          primitive and use it from config.

● Update(docs\design.md)
  ⎿  Added 21 lines, removed 14 lines
       8  
       9  ```mermaid
      10  flowchart LR
      11 -  cli[CLI<br/>src/cli] --> app                                 
      12 -  api[HTTP API<br/>src/api] --> app                            
      11 +  cli[CLI controller<br/>src/controllers/cli] --> services     
      12 +  api[HTTP controller<br/>src/controllers/http] --> services   
      13    web[Web UI<br/>web/] -. HTTP .-> api
      14 -  scenarios[Scenario runner<br/>src/scenarios] --> app         
      15 -  app[Application<br/>ClaimService, registry, verify] --> engin
         -e[Engine<br/>pure functions]                                   
      16 -  app --> infra[Infrastructure<br/>PostgreSQL repos, outbox wor
         -ker, mocks]                                                    
      14 +  scenarios[Scenario runner<br/>src/scenarios] --> services    
      15 +  services[Services<br/>ClaimService, ClaimQueryService,<br/>Wo
         +rkflowService, OperationsService,<br/>outbox worker] --> engine
         +[Engine<br/>pure functions]                                    
      16 +  services --> repos[Repository interfaces<br/>src/repositories
         +]                                                              
      17 +  pg[PostgreSQL repositories<br/>src/repositories/postgres] -. 
         +implements .-> repos                                           
      18 +  boot[Composition root<br/>src/bootstrap.ts] -. wires .-> pg  
      19    config[(config/workflow.yaml)] --> engine
      20  ```
      21  
     ...
      23    is pure: no I/O, no clock, no randomness. Time and id generat
          ion are passed in. It knows nothing
      24    about claims beyond a small contract (a claim has a policy, a
           member, a type, an amount, a state,
      25    counters and participants).
      24 -- **Application** (`src/app`): `ClaimService` runs one transiti
         -on per database transaction,                                   
      25 -  `DefinitionRegistry` stores and pins workflow versions, `veri
         -fy` checks the audit trail,                                    
      26 -  `Operations` exposes the outbox and mocks.                   
      27 -- **Infrastructure** (`src/infra`): SQL migrations and reposito
         -ries, the outbox worker and its                                
      28 -  handlers, the mock payment gateway and notification channel. 
      29 -- **Interfaces**: the CLI, the HTTP API and the web UI share th
         -e application layer; the scenario                              
      30 -  runner drives it in-process.                                 
      26 +- **Controllers** (`src/controllers`): the CLI commands, intera
         +ctive mode and the HTTP routes.                                
      27 +  Each one parses its input, calls one service method and rende
         +rs or returns the result; the web                              
      28 +  UI talks to the HTTP controller.                             
      29 +- **Services** (`src/services`): all the logic. `ClaimService` 
         +runs one transition per database                               
      30 +  transaction; `ClaimQueryService` answers lists, work queues, 
         +"what can I do now", the audit                                 
      31 +  trail and `verify`; `WorkflowService` stores and pins workflo
         +w versions; `OperationsService`                                
      32 +  exposes reference data, the outbox and the mocks; the outbox 
         +worker and its handlers deliver                                
      33 +  side effects.                                                
      34 +- **Repositories** (`src/repositories`): the interfaces service
         +s use for every query, plus a                                  
      35 +  `UnitOfWork` for transactions. The PostgreSQL implementations
         + (`src/repositories/postgres`) hold                            
      36 +  all the SQL apart from the migrations in `src/infra/db`.     
      37  
      32 -Dependencies point one way (interfaces → application → engine),
         - so the engine's unit tests run                                
      33 -without a database.                                            
      38 +Dependencies point one way (controllers → services → repository
         + interfaces), and only                                         
      39 +`src/bootstrap.ts` knows the PostgreSQL implementations, so the
         + engine's unit tests run without a                             
      40 +database and `tests/unit/architecture.test.ts` keeps the layers
         + apart.                                                        
      41  
      42  ## The workflow file
      43  

● Update(docs\design.md)
  ⎿  Added 2 lines
      147    `SELECT … FOR UPDATE` plays the role SQLite's `BEGIN IMMEDIA
           TE` would: concurrent actions on one
      148    claim run one after the other, and the loser re-evaluates ag
           ainst the new state (usually an
      149    `INVALID_TRANSITION`).
      150 +- Replays, automatic transitions and the refusal record run af
          +ter the transaction has released                              
      151 +  its connection, so a burst of concurrent actions cannot exha
          +ust the connection pool.                                      
      152  - The idempotency record is written in the same transaction as
            the change, so a retried request
      153    either sees it or performs the change, never both. A key reu
           sed with a different request or by
      154    another user is refused.

● Bash(python - <<'EOF'
      import io…)
  ⎿   CLAUDE.md                      | 14 +++++++++++++-
      docs/design.md                 | 39 ++++++++++++++++++++++++---------
     ------
     … +17 lines (ctrl+o to expand)
  ⎿  Updated README.md (+5 -4)
      145  ```
      146  config/            workflow.yaml (v1), examples/workflow.appea
           l.yaml (v2), seed.yaml, workflow.schema.json
      147  src/engine/        schema, loader, validator, conditions, effe
           cts, templates, evaluation, Mermaid
      148 -src/app/           ClaimService, definition registry, audit ch
          -ain, verify, clock, bootstrap                                 
      149 -src/infra/         migrations, repositories, outbox worker and
          - handlers, environment                                        
      150 -src/cli/           commands, rendering, interactive mode      
      151 -src/api/           Fastify routes, RFC 9457 problem details   
      148 +src/controllers/   cli/ (commands, rendering, interactive mode
          +), http/ (Fastify routes, RFC 9457 problem details)           
      149 +src/services/      claim commands and queries, workflow versio
          +ns, operations, outbox worker and handlers, verify            
      150 +src/repositories/  repository interfaces and UnitOfWork; postg
          +res/ holds the SQL implementations                            
      151 +src/infra/         database pool, migrations, environment, see
          +d file                                                        
      152 +src/bootstrap.ts   composition root: wires the PostgreSQL repo
          +sitories into the services                                    
      153  src/scenarios/     scenario runner and report writer, tamper d
           emo
      154  web/               React UI
      155  tests/             unit/ (engine, config, extension, recipes) 
           and integration/ (PostgreSQL)
  ⎿  Updated docs\extending-the-workflow.md (+1 -1)
      15  | New loop limit (a named counter with `max` and the refusal me
          ssage) | workflow YAML |
      16  | New claim data (`fields`), required documents per claim type,
           settings such as thresholds | workflow YAML |
      17  | A new *kind* of condition or effect (say, a fraud score looku
          p) | a TypeScript primitive in `src/engine`, its type check in 
          `validate.ts`, and a test |
      18 -| A new external system (a real payment gateway or e-mail provi
         -der) | an outbox handler in `src/infra/outbox` |               
      18 +| A new external system (a real payment gateway or e-mail provi
         +der) | an outbox handler in `src/services/effect-handlers.ts` (
         +and a repository for any state it keeps) |                     
      19  
      20  Every change to the workflow file needs a new `workflow.version
          `: the definition is stored by
      21  content hash and a claim stays on the definition it was created
           with (see
  ⎿  Updated web\src\types.ts (+1 -1)
      1 -// Shapes returned by the API (src/api/routes.ts). Domain record
        -s are shared with the server.                                   
      1 +// Shapes returned by the API (src/controllers/http/routes.ts). 
        +Domain records are shared with the server.                      
      2  import type {
      3    AuditEntry,
      4    ClaimSnapshot,

● Bash(sed -i 's#^tests/             unit/ (engine, config, extension, recipes)
      and integration/ (PostgreSQL)#tests/             unit/ (engine, config,
      extension, reci…)
  ⎿  Updated README.md (+1 -1)
      152  src/bootstrap.ts   composition root: wires the PostgreSQL repo
           sitories into the services
      153  src/scenarios/     scenario runner and report writer, tamper d
           emo
      154  web/               React UI
      155 -tests/             unit/ (engine, config, extension, recipes) 
          -and integration/ (PostgreSQL)                                 
      155 +tests/             unit/ (engine, config, extension, recipes, 
          +layering) and integration/ (PostgreSQL)                       
      156  docs/              design, domain research, extension guide, A
           I workflow, results/
      157  ```
      158  

● Không còn chỗ nào nhắc tới đường dẫn cũ. Kiểm tra lại git status (xem web/dist
  có bị ignore không) và chạy lại toàn bộ kiểm tra tĩnh.

  Ran 1 shell command (ctrl+o to expand)

● Kiểm tra tĩnh đều qua: typecheck exit 0, lint sạch, 66/66 unit test. Mình đọc
  lại ClaimService.act sau khi Biome format để tự soát lần cuối.

  Read 1 file (ctrl+o to expand)

● Refactor đã xong và các kiểm tra không cần DB đều qua. Phần kiểm tra cần
  PostgreSQL thì chưa chạy được: file .env hiện giống hệt .env.example, chỉ có
  password mẫu, nên cả bốn URL đều bị từ chối (28P01). Mình không đoán password
  và không sửa .env.

  Kết quả:
  - Controller (src/controllers/http/routes.ts, src/controllers/cli/index.ts,
    src/controllers/cli/interactive.ts): mỗi route hoặc command chỉ parse input,
    gọi một method service rồi trả hoặc render kết quả. Việc chuyển header,
    body và query thành input của service nằm trong requests.ts
    (src/controllers/http/requests.ts). Controller chỉ nhận services, không còn
    được truyền pool.
  - Service (src/services/): gồm ClaimService, ClaimQueryService,
    WorkflowService, OperationsService, cùng worker và handler của outbox. Không
    file nào import pg; transaction đi qua UnitOfWork.transaction.
  - Repository: interface ở src/repositories/, bản PostgreSQL ở
    src/repositories/postgres/. Toàn bộ SQL ngoài migrations nằm ở đây. Lệnh
    pg_notify, advisory lock, LISTEN/UNLISTEN và việc bắt lỗi theo tên
    constraint cũng đã chuyển vào đây.
  - src/bootstrap.ts là nơi duy nhất nối bản PostgreSQL vào service.
  - File được di chuyển bằng git mv để giữ history. Đã cập nhật CLAUDE.md,
    README.md, docs/design.md, docs/extending-the-workflow.md và đường dẫn trong
    package.json.

  Đã kiểm tra:
  - npm run typecheck, npm run lint đều qua; npm run test:unit qua 66/66.
  - Test mới architecture.test.ts (tests/unit/architecture.test.ts) chặn import
    sai lớp. Mình đã thử thêm một import sai và test fail đúng như mong đợi.
  - So với code gốc (chạy từ một worktree của HEAD), output CLI giống từng byte
    cho các lệnh không cần DB: config validate, config diagram, các trang help
    và lỗi dùng sai lệnh. Riêng thông báo file không tồn tại chỉ khác đường dẫn
    tuyệt đối.
  - npm run build:web chạy được.

  Thay đổi hành vi có chủ đích: replay, automatic transition và việc ghi refusal
  giờ chạy sau khi transaction đã trả connection, nên nhiều lệnh act đồng thời
  không làm cạn pool được nữa.

  Chưa kiểm tra (cần DB): npm test (integration), so từng byte kết quả scenario
  với baseline, demo:tamper, và so output CLI --json / GET API trên cùng một
  schema baseline. Bạn điền password thật vào .env rồi báo mình, mình sẽ chạy
  hết các bước này. Worktree baseline đang nằm ở
  C:\Users\Admin\AppData\Local\Temp\claude\d--work-papaya\66278519-af57-4993-b36
  9-a8053c43aad4\scratchpad\baseline; mình sẽ gỡ nó sau khi so xong.

  Mình chưa commit gì.

> <ide_opened_file>The user opened the file
  d:\work\papaya\src\services\claim-service.ts in the IDE. This may or may not
  be related to the current task.</ide_opened_file>

> commit

  Ran 2 shell commands (ctrl+o to expand)

● Đã commit b1e453c trên nhánh mới refactor/layered-architecture, tạo từ main
  (mình không commit thẳng lên main).

  - Không có trong commit: README.md và docs/ai-workflow.md. Hai file này vốn đã
    untracked từ trước và có thể là bản nháp của bạn. Riêng README.md có chỗ
    mình sửa mục Project layout cho khớp cấu trúc mới; bạn tự quyết có commit
    chung không.
  - Chưa kiểm tra với DB: commit này mới qua typecheck, lint, unit test và bước
    so output CLI không cần DB. Integration test, so kết quả scenario và
    demo:tamper vẫn chờ password thật trong .env. Message commit cũng không ghi
    là đã kiểm tra những phần này.
  - Chưa push.

> <ide_selection>The user selected the lines 72 to 72 from
  d:\work\papaya\src\controllers\http\routes.ts:
  request

  This may or may not be related to the current task.</ide_selection>

> sử dụng entity framework thay vì raw query

● Entity Framework là ORM của .NET, không dùng được cho dự án Node/TypeScript
  này, nên cần chọn một ORM TypeScript tương đương. Trước khi hỏi bạn, mình xem
  schema hiện tại để biết những tính năng PostgreSQL nào ORM phải hỗ trợ.

  Listed 1 directory (ctrl+o to expand)

● User answered Claude's questions:
  ⎿  · Entity Framework chỉ có cho .NET. Với dự án TypeScript/Node này, bạn muốn
     dùng ORM nào thay cho SQL viết tay? Dù chọn cái nào, vẫn còn vài lệnh đặc
     thù PostgreSQL không ORM nào có sẵn: advisory lock, pg_notify, LISTEN,
     nextval(claim_no_seq). Các lệnh này sẽ được gom gọn trong repository. →
     TypeORM
     · Còn migrations thì sao? Hiện có migration SQL viết tay, gồm trigger
     append-only, constraint trigger deferred, cột GENERATED, GRANT cho role
     runtime, và được runner kiểm tra checksum. → Chuyển sang migration của ORM

● Mình sẽ đọc toàn bộ migration hiện tại để lên kế hoạch chuyển đổi chính xác
  sang TypeORM, đồng thời kiểm tra phiên bản TypeORM đang dùng.

  Read 1 file, ran 2 shell commands (ctrl+o to expand)

● TypeORM 1.1.2 (phát hành 2026-10-08) tương thích với Node 24 đang dùng. Giờ
  mình sẽ xem thêm docs về migration SQL/checksum và các test phụ thuộc vào
  migrateSchema.

  Searched for 1 pattern, ran 1 shell command (ctrl+o to expand)

● Đã đủ thông tin. Đây là việc mới, nên mình viết lại file plan từ đầu.

● Updated plan
  ⎿  /plan to preview

● Updated plan  ⎿  /plan to preview

● Plan đã sẵn sàng để duyệt: chuyển sang TypeORM 1.1.2 dùng EntitySchema (không
  decorator) cho migration/table trong src/repositories/postgres, src/infra/db,
  bootstrap.ts, giữ nguyên interface/service/controller, raw SQL (function,
  trigger, GRANT, advisory lock...) vẫn giữ nguyên và append-only được bảo đảm
  qua unit test checksum thay cho runner checksum. Các bước cần DB thật (so
  schema, scenario, integration test, demo:tamper) vẫn đang bị chặn do thiếu kết
  nối DB.

● User approved Claude's plan
  ⎿  Plan saved to:
     C:\Users\Admin\.claude\plans\kh-ng-c-x-ly-expressive-shore.md · /plan to
     edit
     Chuyển repository sang TypeORM (thay SQL viết tay)

     Context

     Sau commit b1e453c, mọi truy cập dữ liệu đã nằm sau interface trong
     src/repositories/*.ts, nhưng phần cài đặt ở src/repositories/postgres/ vẫn
     là SQL viết tay trên pg. Migration cũng là SQL viết tay (001_init.sql
     (src/infra/db/migrations/001_init.sql)), chạy bằng runner tự viết có kiểm
     tra checksum (migrate.ts (src/infra/db/migrate.ts)).

     Bạn muốn dùng một ORM kiểu Entity Framework thay cho raw query. Đã chốt:
     - TypeORM làm ORM.
     - Migration của TypeORM thay cho migration SQL và runner checksum.

     Vì service chỉ thấy interface, thay đổi gói gọn trong
     repositories/postgres, infra/db, bootstrap.ts và test helper. Interface
     repository, service, controller giữ nguyên. Hành vi bên ngoài vẫn phải giữ
     từng byte: HTTP, CLI, kết quả scenario, hash của audit chain.

     Quyết định chính

     Phiên bản:
     - typeorm@1.1.2 (phát hành 2026-10-08), pin chính xác như các dependency
       khác.
     - Không thêm reflect-metadata vào code: nó đã là dependency của typeorm, và
       ta không dùng decorator.

     Dùng EntitySchema, không dùng decorator:
     - tsx/esbuild không emit decorator metadata, còn TypeScript 7 cộng
       verbatimModuleSyntax thì rủi ro với experimentalDecorators.
     - EntitySchema<Row> khai báo bảng bằng object thuần; domain type vẫn là
       interface như cũ.

     Tên property = tên cột (snake_case): domain type vốn đã snake_case, nên
     không cần map tên.

     Map kết quả về domain type bằng hàm toClaim / toEntry / toMessage (hiện là
     rowToClaim…):
     - Hàm này chuẩn hoá timestamp về ISO, bỏ các cột chỉ có ở DB (id,
       assessor_id, state_changed, bucket_start).
     - Nhờ vậy hashValue(claim) và verify cho kết quả như cũ.

     Raw SQL còn lại. Không ORM nào có sẵn những thứ này; tất cả gom trong
     repository/migration, có comment giải thích:
     - nextval('claim_no_seq'), pg_advisory_xact_lock(hashtextextended(…)),
       pg_notify: dùng createQueryBuilder().select(expr).fromDummy() nếu bản 1.x
       có fromDummy, không thì manager.query.
     - LISTEN/UNLISTEN trên connection riêng.
     - Biểu thức trong .set() của QueryBuilder: attempts + 1, CASE WHEN attempts
       >= max_attempts…, coalesce(last_error, …), remaining_failures - 1.
     - Trong migration: function plpgsql, trigger, constraint trigger deferred,
       CREATE SEQUENCE, GRANT, khối DO, UNIQUE NULLS NOT DISTINCT (nếu
       TableUnique không hỗ trợ).

     Cấu trúc file

     src/repositories/postgres/
       entities.ts          EntitySchema cho 11 bảng + Row types (domain type +
     cột chỉ có ở DB)
       data-source.ts       createDataSource({ url, schema, max }): DataSource
       unit-of-work.ts      PgUnitOfWork(dataSource): repos trên
     dataSource.manager;
                            transaction = dataSource.transaction(m =>
     fn(createPgRepositories(m)))
       *-repository.ts      cùng tên class Pg*Repository, nhận EntityManager
     thay vì Db
       outbox-repository.ts PgOutboxNotifications nhận pg.Pool lấy từ
     (dataSource.driver as PostgresDriver).master
       admin.ts             createSchema / dropSchema
     (queryRunner.createSchema/dropSchema), upsertReference (manager.upsert)
     src/infra/db/
       pool.ts              giữ createPool + SCHEMA_RE + export `types` (raw pg
     cho tests/tamper demo); bỏ inTransaction
       migrations/1761350400000-Init.ts   TypeORM migration thay cho
     001_init.sql
       migrations/index.ts  MIGRATIONS = [Init1761350400000]   (khai báo tường
     minh, không glob)
       migrations/checksums.json         sha256 của từng file migration (giữ
     nguyên tắc append-only)
       migrate.ts           xoá (runner cũ)

     DataSource

     new DataSource({
       type: 'postgres', url, schema, entities: ENTITIES, migrations:
     MIGRATIONS,
       migrationsTableName: 'migrations', migrationsTransactionMode: 'each',
       synchronize: false, migrationsRun: false, logging: false,
       extra: { max, types, options: `-c search_path=${schema} -c TimeZone=UTC`
     },
     })

     extra.types: dùng lại type parser của pool.ts (src/infra/db/pool.ts):
     BIGINT thành number an toàn, DATE thành 'YYYY-MM-DD'.

     search_path: vẫn cần cho nextval, cho các function có SET search_path FROM
     CURRENT, và cho khối DO … current_schema().

     schema: TypeORM tự thêm tên schema vào trước tên bảng, nên mỗi file test
     vẫn chạy trên schema riêng.

     Kiểm tra lúc cài:
     - extra có thật sự được truyền vào pg.Pool không.
     - Không entity nào dùng generationStrategy: 'uuid', để TypeORM không cố
       CREATE EXTENSION: role runtime không có quyền này.

     Repository: từ SQL sang TypeORM

     Method: claims.find(ref,{lock})
     TypeORM: findOne({ where: {claim_no}|{id}, lock: { mode:
     'pessimistic_write' }
     }); giữ kiểm tra regex CLM/UUID
     ────────────────────────────────────────
     Method: claims.insert/update
     TypeORM: insert(row); update({ id, version: expected }, {…}) → affected ===
     1
     ────────────────────────────────────────
     Method: claims.list(filter)
     TypeORM: find({ where: { state: In(…), assessor_id, member_id }, order: {
     created_at: 'DESC', claim_no: 'DESC' }, take }). assessor_id khai báo
     generatedType: 'STORED', insert:false, update:false, select:false
     ────────────────────────────────────────
     Method: audit.*
     TypeORM: insert, find(order claim_seq), findOneBy, head = findOne({ select:

     ['claim_seq','hash'], order: { claim_seq: 'DESC' } })
     ────────────────────────────────────────
     Method: denied.record
     TypeORM: insert().values(…).orIgnore() (ON CONFLICT DO NOTHING; bảng chỉ có

     unique là dedupe) → inserted = raw.length === 1
     ────────────────────────────────────────
     Method: outbox.enqueue
     TypeORM: insert().orIgnore().returning('id') cho từng message
     ────────────────────────────────────────
     Method: outbox.lease
     TypeORM: update().set({ status, locked_by, locked_until, attempts: () =>
     'attempts + 1' }).where('id IN ' +
     subQuery…orderBy.limit.setLock('pessimistic_write').setOnLocked('skip_locke
     d')).returning(COLUMNS)
      → raw map bằng toMessage, sort theo id
     ────────────────────────────────────────
     Method: reapExpiredLeases / markDone / markFailed / retryDead
     TypeORM: update().set(…).where(…); affected / returning('status')
     ────────────────────────────────────────
     Method: outbox.nextDueAt / list
     TypeORM: select('min(o.next_attempt_at)','next').getRawOne(); find({ where,

     order: { id } })
     ────────────────────────────────────────
     Method: users.list, policies.find/list
     TypeORM: find({ order: { id } }), findOneBy (bỏ kiểu N+1 trong
     listPolicies)
     ────────────────────────────────────────
     Method: definitions.insert
     TypeORM: insert().orIgnore(): không target nên bỏ qua cả xung đột hash lẫn
     version_unique; bỏ luôn việc bắt lỗi theo tên constraint
     ────────────────────────────────────────
     Method: idempotency.lock/find/save
     TypeORM: lock = raw expression; findOneBy; insert
     ────────────────────────────────────────
     Method: mockGateway.*
     TypeORM: update().set({ remaining_failures: () => 'remaining_failures - 1'
     }).where('id = 1 AND remaining_failures > 0'); insert().orIgnore() +
     findOneBy; find({ where, order: { id } })
     ────────────────────────────────────────
     Method: LISTEN
     TypeORM: PgOutboxNotifications(pool) giữ nguyên cách làm hiện tại trên pool

     master của driver (release(true) khi UNLISTEN lỗi)

     Migration TypeORM — Init1761350400000

     up(q):
     1. Nhận schema cũ: nếu await q.hasTable('schema_migrations') và bảng đó có
        dòng '001_init', thì schema đã được runner cũ tạo đúng 001 (đã kiểm
        checksum), nên return. Dev DB claims không phải reset.
     2. Bảng, cột, PK/UNIQUE/CHECK/FK, index: dùng API của TypeORM, gồm
        q.createTable(new Table({ … })), TableColumn, TableCheck, TableUnique,
        TableForeignKey, TableIndex (có where cho partial index). Mọi constraint
        được đặt tên tường minh, trùng tên Postgres đang tự sinh, ví dụ
        claims_pkey, claims_claim_no_key, claims_claim_no_check, claims_check,
        claims_check1, claims_policy_id_fkey, audit_log_seq_unique. Danh sách
        tên thật lấy từ pg_constraint của một schema baseline.
        - Cột identity: generationStrategy: 'identity', generatedIdentity:
          'ALWAYS'.
        - Cột GENERATED: generatedType: 'STORED', asExpression.
        - Thứ tự cột giữ như file SQL.
     3. Raw (q.query): forbid_mutation và các function/trigger khác, CREATE
        SEQUENCE claim_no_seq, denied_attempts_dedupe (UNIQUE NULLS NOT
        DISTINCT), constraint trigger claims_require_audit, khối DO … GRANT
        USAGE, các GRANT.
     4. Dòng mock_gateway_faults (1, 0) thêm bằng q.manager.insert.

     down(q): drop theo thứ tự ngược (bảng, function, sequence).

     Runner mới trong bootstrap.ts (src/bootstrap.ts):
     - migrateSchema(ownerUrl, schema) mở DataSource bằng quyền owner,
       queryRunner.createSchema(schema, true), rồi runMigrations().
     - Trả { applied, skipped } như cũ. skipped là các migration còn lại trong
       MIGRATIONS, nên output của db migrate giữ dạng cũ. Chỉ tên migration đổi:
       001_init thành Init1761350400000, đây là thay đổi output duy nhất có chủ
       đích.
     - seedSchema dùng manager.upsert(UserEntity/PolicyEntity, rows, ['id']);
       dropSchema dùng queryRunner.dropSchema(schema, true, true).

     Giữ nguyên tắc append-only: thêm tests/unit/migrations.test.ts.
     - Test so sha256 của từng file trong MIGRATIONS (đã chuẩn hoá CRLF) với
       checksums.json.
     - Sửa một migration đã có thì CI fail; migration mới phải được thêm vào
       index.ts và checksums.json.

     Script mới: "db:migration:create": "typeorm migration:create", dùng kiểu
     npm run db:migration:create -- src/infra/db/migrations/AddX.
     - Ghi rõ trong CLAUDE.md: không dùng migration:generate, vì entity không mô
       tả trigger, check hay grant, nên lệnh này sẽ đề xuất drop chúng.

     Composition root, test và script

     AppContext: pool được thay bằng dataSource: DataSource. Field này chỉ cho
     tests; controller vẫn chỉ nhận services.
     - createApp làm theo thứ tự: createDataSource → initialize() → PgUnitOfWork
       → register().
     - close = dataSource.destroy().
     - createWorker truyền PgOutboxNotifications(driver.master, schema).

     Test helper pg-schema.ts (tests/helpers/pg-schema.ts): thêm appPool (pg
     thuần, role runtime, qua createPool) cho các test kiểm quyền DB.
     integrity.test.ts (tests/integration/integrity.test.ts) đổi db.app.pool →
     db.appPool.

     Các nơi gọi khác:
     - outbox.test.ts (tests/integration/outbox.test.ts):
       createPgRepositories(db.app.dataSource.manager).
     - tamper-demo.ts (src/scenarios/tamper-demo.ts): tự tạo pool runtime bằng
       createPool(env.databaseUrl(), schema, 2) để thử DELETE/UPDATE.

     Test mới tests/integration/entities.test.ts:
     - Sau khi migrate, mọi cột của entity metadata phải khớp
       information_schema.columns về tên, kiểu và nullable.
     - Mọi cột của bảng phải được entity map.

     architecture.test.ts (tests/unit/architecture.test.ts): thêm luật typeorm
     chỉ được import trong repositories/postgres/**, infra/db/** và
     bootstrap.ts. Service, controller và interface repository không được
     import.

     Docs:
     - CLAUDE.md: mục migrations (TypeORM, append-only qua checksums.json, không
       migration:generate), lệnh mới, raw SQL chỉ ở các chỗ đã liệt kê.
     - docs/design.md: dòng 161 trỏ tới file migration mới, dòng 175 về
       checksum.
     - README.md: stack (thêm TypeORM).

     Giữ nguyên: scripts/db-setup.ts vẫn dùng pg thuần. Nó tạo role và database
     bằng superuser, nằm ngoài app.

     Rủi ro cần kiểm ngay sau khi cài

     Kiểm trên node_modules/typeorm/**/*.d.ts của bản 1.1.2:
     - API fromDummy, setOnLocked, orIgnore, returning, generatedIdentity,
       generatedType/asExpression.
     - TypeORM có cần bảng typeorm_metadata cho cột GENERATED không.
     - TableUnique có nullsNotDistinct không.
     - QueryRunner.createSchema/dropSchema.

     Nếu thiếu thứ gì, dùng q.query hoặc manager.query cho đúng chỗ đó và ghi
     chú lại.

     Thứ tự làm

     0. Điều kiện tiên quyết: .env phải có password thật. Hiện cả 4 URL đều trả
        28P01, nên toàn bộ phần kiểm tra bên dưới đang bị chặn.
     1. Chụp baseline từ worktree f4b4a2c (đã có ở scratchpad). Baseline này
        dùng để kiểm luôn phần DB còn treo của refactor trước:
        - kết quả scenario (--write --no-tests --keep);
        - output --json của các lệnh CLI chỉ đọc, response các GET của API;
        - pg_dump -s của một schema mới migrate bằng runner cũ;
        - danh sách tên constraint.
     2. npm i typeorm@1.1.2 --save-exact. Viết entities.ts, data-source.ts,
        migration Init, index.ts, checksums.json.
     3. Viết lại các Pg*Repository, PgUnitOfWork, admin.ts, bootstrap.ts; xoá
        migrate.ts và 001_init.sql.
     4. Test helper, outbox/integrity test, tamper demo; test mới (entities,
        migrations, architecture); docs.

     Kiểm tra

     1. Chạy như CI: npm run typecheck, npm run lint, config validate cho cả 2
        file, npm test (cần DB), npm run scenarios, npm run demo:tamper, npm run
        build:web.
     2. Schema tương đương: pg_dump -s cho schema mới do TypeORM migrate và
        schema baseline do runner cũ migrate (thay tên schema trước khi diff).
        - Chỉ được khác ở bảng theo dõi migration (migrations, và
          typeorm_metadata nếu có, thay cho schema_migrations).
        - Trigger, function, constraint, index và grant phải trùng.
     3. Hành vi: chạy npm run scenarios -- --write --no-tests rồi diff -r với
        baseline; scenarios.md, audit-trails.md/.json, denied-attempts.md phải
        trùng từng byte.
     4. Chạy lại các lệnh CLI --json và GET API trên schema baseline, diff với
        output đã lưu.
     5. Nhận schema cũ: chạy npm run db:migrate trên schema baseline do runner
        cũ tạo. Kết quả mong đợi: Init được đánh dấu đã chạy, không đụng vào
        bảng nào, rồi verify --all vẫn ok.
     6. Dọn dẹp: drop các schema baseline/test, gỡ worktree trong scratchpad,
        xoá docs/results do bước chụp baseline tạo ra.

● Plan đã được duyệt. Trước hết kiểm tra lại DB đã kết nối được chưa (bước 0).

  Ran 1 shell command (ctrl+o to expand)

● Vẫn chưa kết nối được: .env vẫn là bản mẫu. Mình làm phần code trước; baseline
  lấy từ worktree f4b4a2c nên chụp lúc nào cũng được. Cài TypeORM:

● Bash(npm i typeorm@1.1.2 --save-exact 2>&1 | tail -5 && grep -n
      '"typeorm"\|"reflect-metadata"' package.json && ls node_modules/typeorm |
      head -30)
  ⎿  57 packages are looking for funding
       run `npm fund` for details
     … +32 lines (ctrl+o to expand)
  ⎿  Updated package.json (+1 -0)
      41      "picocolors": "1.1.1",
      42      "react": "19.3.1",
      43      "react-dom": "19.3.1",
      44 +    "typeorm": "1.1.2",                                        
      45      "yaml": "2.9.1",
      46      "zod": "4.6.7"
      47    },
  ⎿  … 1 more file changed

● Đã cài. Giờ kiểm tra các API 1.x mà plan dựa vào, đọc trực tiếp từ file .d.ts
  và mã nguồn đã cài.

  Searched for 2 patterns, ran 4 shell commands (ctrl+o to expand)

● Đã xác nhận các API TypeORM mà plan cần đều tồn tại, trừ nullsNotDistinct nên
  constraint đó sẽ viết raw, và cột GENERATED cần thêm bảng typeorm_metadata.
  Giờ tôi sẽ bắt đầu viết các entities.

  Searched for 3 patterns, ran 3 shell commands (ctrl+o to expand)

● Xác nhận cách TypeORM chuyển đổi dữ liệu (timestamp→Date,
  jsonb→JSON.stringify, date giữ chuỗi), và sẽ dùng updateEntity(false) để tránh
  TypeORM tự gán ngược các cột như id vào object gốc. Tiếp theo mình viết
  entities.ts.

● Write(src\repositories\postgres\entities.ts)
  ⎿  Wrote 257 lines to src\repositories\postgres\entities.ts
       1 // TypeORM mappings of the tables. Property names are the column
          names (snake_case, like the
         ndexes, triggers and grants live
       3 // in the migrations (src/infra/db/migrations), so never derive
         migrations from these schemas.
       5 import type {
       6   AuditEntry,
       7   ClaimSnapshot,
       9   MockNotification,
      10   MockPayment,
     … +260 lines (ctrl+o to expand)

● Update(src\repositories\postgres\entities.ts)
  ⎿  Added 1 line, removed 1 line
      17  
      18  /** A row as the driver returns it: timestamptz columns come ba
          ck as Date objects. */
      19  type Row<T, Timestamps extends keyof T> = Omit<T, Timestamps> &
           {
      20 -  [K in Timestamps]: T[K] extends null ? Date | null : Date | s
         -tring;                                                         
      20 +  [K in Timestamps]: Date | string;                            
      21  };
      22  
      23  export type DefinitionRow = Row<StoredDefinition, 'registered_a
          t'>;

● Giờ đến pool.ts (export types, bỏ inTransaction) và data-source.ts.

● Bash(cd /d/work/papaya && python - <<'EOF'
      p='src/infra/db/pool.ts'…)
  ⎿  import pg from 'pg';

     const INT8_OID = 20;
     … +38 lines (ctrl+o to expand)
  ⎿  Updated src\infra\db\pool.ts (+13 -30)
      11  
      12  // BIGINT → number (amounts are CHECKed below 2^53); DATE → 'YY
          YY-MM-DD' string, because the
      13  // default parser turns dates into local-midnight Date objects 
          that shift across time zones.
      14 -const types = {                                                
      14 +export const types = {                                         
      15    getTypeParser(oid: number, format?: 'text' | 'binary') {
      16      if (oid === INT8_OID) return parseInt8;
      17      if (oid === DATE_OID) return (value: string) => value;
     ...
      21  
      22  export const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;
      23  
      24 -/** A pool whose connections all use `schema` as their search_p
         -ath. */                                                        
      25 -export function createPool(connectionString: string, schema: st
         -ring, max = 10): pg.Pool {                                     
      24 +/** Connection settings every connection gets: `schema` as its 
         +search_path, and UTC. */                                       
      25 +export function connectionOptions(schema: string): string {    
      26    if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema 
          name '${schema}'`);
      27 -  const pool = new pg.Pool({                                   
      28 -    connectionString,                                          
      29 -    max,                                                       
      30 -    types,                                                     
      31 -    options: `-c search_path=${schema} -c TimeZone=UTC`,       
      32 -  });                                                          
      27 +  return `-c search_path=${schema} -c TimeZone=UTC`;           
      28 +}                                                              
      29 +                                                               
      30 +/**                                                            
      31 + * A plain pg pool whose connections all use `schema` as their 
         +search_path. The application                                   
      32 + * goes through TypeORM; this is for database maintenance scrip
         +ts and for tests and demos that                                
      33 + * check privileges and triggers directly.                     
      34 + */                                                            
      35 +export function createPool(connectionString: string, schema: st
         +ring, max = 10): pg.Pool {                                     
      36 +  const pool = new pg.Pool({ connectionString, max, types, opti
         +ons: connectionOptions(schema) });                             
      37    // An idle connection dropped by the server (restart, timeout
          ) must not crash the process;
      38    // the pool replaces it on the next query.
      39    pool.on('error', (error) => process.emitWarning(`PostgreSQL c
          onnection lost: ${error.message}`));
      40    return pool;
      41  }
      38 -                                                               
      39 -export type Db = pg.Pool | pg.PoolClient;                      
      40 -                                                               
     … 18 more lines (ctrl+o to expand)

● Write(src\repositories\postgres\data-source.ts)
  ⎿  Wrote 31 lines to src\repositories\postgres\data-source.ts
       1 import { DataSource } from 'typeorm';
       2 import { MIGRATIONS } from '../../infra/db/migrations/index';
       3 import { connectionOptions, types } from '../../infra/db/pool';
       5
       6 /**
       7  * A TypeORM data source on one schema. Every connection uses th
         e schema as its search_path
         safe BIGINT/DATE parsers.
       9  * Call `initialize()` before use and `destroy()` when done.
      10  */
     … +27 lines (ctrl+o to expand)

● Giờ viết lại từng repository trên EntityManager, bắt đầu với claims và audit.

● Write(src\repositories\postgres\claim-repository.ts)
  ⎿  Added 46 lines, removed 72 lines
       1 +import { type EntityManager, In } from 'typeorm';              
       2  import type { ClaimFilter, ClaimSnapshot } from '../../domain/t
          ypes';
       2 -import type { Db } from '../../infra/db/pool';                 
       3  import type { ClaimRepository } from '../claim-repository';
       4 +import { ClaimEntity } from './entities';                      
       5  import { iso } from './rows';
       6  
       7  export const CLAIM_NO_RE = /^CLM-\d{4}-\d{6}$/;
       8  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{
          4}-[0-9a-f]{12}$/i;
       9  
       9 -const COLUMNS =                                                
      10 -  'id, claim_no, config_hash, policy_id, member_id, claim_type,
         - claimed_amount, state, ' +                                    
      11 -  'state_entered_at, version, data, counters, participants, cre
         -ated_at, updated_at';                                          
      12 -                                                               
      10 +/** The domain snapshot of a row: exactly the hashed fields, ti
         +mestamps as ISO strings. */                                    
      11  export function rowToClaim(row: Record<string, unknown>): Claim
          Snapshot {
      12    return {
      13      id: row.id as string,
     ...
       29  }
       30  
       31  export class PgClaimRepository implements ClaimRepository {
       34 -  constructor(private readonly db: Db) {}                     
       32 +  constructor(private readonly manager: EntityManager) {}     
       33  
       34 +  private get repo() {                                        
       35 +    return this.manager.getRepository(ClaimEntity);           
       36 +  }                                                           
       37 +                                                              
       38    async find(ref: string, options: { lock?: boolean } = {}): P
           romise<ClaimSnapshot | null> {
       39      const byNumber = CLAIM_NO_RE.test(ref);
       40      if (!byNumber && !UUID_RE.test(ref)) return null;
       39 -    const { rows } = await this.db.query(                     
       40 -      `SELECT ${COLUMNS} FROM claims WHERE ${byNumber ? 'claim
          -_no' : 'id'} = $1${options.lock ? ' FOR UPDATE' : ''}`,       
       41 -      [ref],                                                  
       42 -    );                                                        
       43 -    return rows[0] ? rowToClaim(rows[0]) : null;              
       41 +    const row = await this.repo.findOne({                     
       42 +      where: byNumber ? { claim_no: ref } : { id: ref },      
       43 +      ...(options.lock ? { lock: { mode: 'pessimistic_write' a
          +s const } } : {}),                                            
       44 +    });                                                       
       45 +    return row ? rowToClaim(row) : null;                      
       46    }
       47  
       48    async insert(c: ClaimSnapshot): Promise<void> {
       47 -    await this.db.query(                                      
       48 -      `INSERT INTO claims (${COLUMNS})                        
       49 -       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $
          -12, $13, $14, $15)`,                                          
       50 -      [                                                       
       51 -        c.id,                                                 
       52 -        c.claim_no,                                           
       53 -        c.config_hash,                                        
       54 -        c.policy_id,                                          
       55 -        c.member_id,                                          
       56 -        c.claim_type,                                         
       57 -        c.claimed_amount,                                     
       58 -        c.state,                                              
       59 -        c.state_entered_at,                                   
       60 -        c.version,                                            
       61 -        JSON.stringify(c.data),                               
       62 -        JSON.stringify(c.counters),                           
       63 -        JSON.stringify(c.participants),                       
       64 -        c.created_at,                                         
       65 -        c.updated_at,                                         
       66 -      ],                                                      
       67 -    );                                                        
       49 +    await this.repo.createQueryBuilder().insert().values({ ...
          +c }).updateEntity(false).execute();                           
       50    }
       51  
       52    async update(c: ClaimSnapshot, expectedVersion: number): Pro
           mise<boolean> {
       71 -    const result = await this.db.query(                       
       72 -      `UPDATE claims                                          
       73 -          SET state = $2, state_entered_at = $3, version = $4,
          - data = $5, counters = $6,                                    
       74 -              participants = $7, updated_at = $8              
       75 -        WHERE id = $1 AND version = $9`,                      
       76 -      [                                                       
       77 -        c.id,                                                 
       78 -        c.state,                                              
       79 -        c.state_entered_at,                                   
       80 -        c.version,                                            
       81 -        JSON.stringify(c.data),                               
       82 -        JSON.stringify(c.counters),                           
       83 -        JSON.stringify(c.participants),                       
       84 -        c.updated_at,                                         
       85 -        expectedVersion,                                      
       86 -      ],                                                      
       87 -    );                                                        
       88 -    return result.rowCount === 1;                             
       53 +    const result = await this.repo                            
       54 +      .createQueryBuilder()                                   
       55 +      .update()                                               
       56 +      .set({                                                  
       57 +        state: c.state,                                       
       58 +        state_entered_at: c.state_entered_at,                 
       59 +        version: c.version,                                   
       60 +        data: c.data,                                         
       61 +        counters: c.counters,                                 
       62 +        participants: c.participants,                         
       63 +        updated_at: c.updated_at,                             
       64 +      })                                                      
       65 +      .where({ id: c.id, version: expectedVersion })          
       66 +      .updateEntity(false)                                    
       67 +      .execute();                                             
       68 +    return result.affected === 1;                             
       69    }
       70  
       71    async nextClaimNo(year: number): Promise<string> {
       92 -    const { rows } = await this.db.query<{ n: number }>("SELEC
          -T nextval('claim_no_seq')::int AS n");                        
       93 -    return `CLM-${year}-${String(rows[0]?.n).padStart(6, '0')}
          -`;                                                            
       72 +    // Sequences have no ORM API.                             
       73 +    const row = await this.manager                            
       74 +      .createQueryBuilder()                                   
       75 +      .select("nextval('claim_no_seq')::int", 'n')            
       76 +      .fromDummy()                                            
       77 +      .getRawOne<{ n: number }>();                            
       78 +    return `CLM-${year}-${String(row?.n).padStart(6, '0')}`;  
       79    }
       80  
       81    async list(filter: ClaimFilter = {}): Promise<ClaimSnapshot[
           ]> {
       97 -    const where: string[] = [];                               
       98 -    const params: unknown[] = [];                             
       99 -    if (filter.states?.length) {                              
      100 -      params.push(filter.states);                             
      101 -      where.push(`state = ANY($${params.length})`);           
      102 -    }                                                         
      103 -    if (filter.assessorId) {                                  
      104 -      params.push(filter.assessorId);                         
      105 -      where.push(`assessor_id = $${params.length}`);          
      106 -    }                                                         
      107 -    if (filter.memberId) {                                    
      108 -      params.push(filter.memberId);                           
      109 -      where.push(`member_id = $${params.length}`);            
      110 -    }                                                         
      111 -    params.push(filter.limit ?? 200);                         
      112 -    const { rows } = await this.db.query(                     
      113 -      `SELECT ${COLUMNS} FROM claims ${where.length ? `WHERE $
          -{where.join(' AND ')}` : ''}                                  
      114 -       ORDER BY created_at DESC, claim_no DESC LIMIT $${params
          -.length}`,                                                    
      115 -      params,                                                 
      116 -    );                                                        
       82 +    const rows = await this.repo.find({                       
       83 +      where: {                                                
       84 +        ...(filter.states?.length ? { state: In(filter.states)
          + } : {}),                                                     
       85 +        ...(filter.assessorId ? { assessor_id: filter.assessor
          +Id } : {}),                                                   
       86 +        ...(filter.memberId ? { member_id: filter.memberId } :
          + {}),                                                         
       87 +      },                                                      
       88 +      order: { created_at: 'DESC', claim_no: 'DESC' },        
       89 +      take: filter.limit ?? 200,                              
       90 +    });                                                       
       91      return rows.map(rowToClaim);
       92    }
       93  }

● Write(src\repositories\postgres\audit-repository.ts)
  ⎿  Added 36 lines, removed 70 lines
       1 +import type { EntityManager } from 'typeorm';                  
       2  import type { AuditEntry, DeniedAttempt } from '../../domain/ty
          pes';
       2 -import type { Db } from '../../infra/db/pool';                 
       3  import type {
       4    AuditRepository,
       5    ChainHead,
       6    DeniedAttemptRepository,
       7    DeniedRecord,
       8  } from '../audit-repository';
       9 +import { AuditEntity, DeniedEntity } from './entities';        
      10  import { iso } from './rows';
      11  
      11 -const COLUMNS =                                                
      12 -  'entry_id, claim_id, claim_seq, transition_id, from_state, to
         -_state, actor_user_id, actor_role, ' +                         
      13 -  'reason, notes, input, changes, decision_context, effects, co
         -nfig_hash, claim_version, ' +                                  
      14 -  'snapshot_hash, prev_hash, hash, occurred_at';               
      15 -                                                               
      12  export function rowToEntry(row: Record<string, unknown>): Audit
          Entry {
      13    return {
      14      entry_id: row.entry_id as string,
     ...
       35  }
       36  
       37  export class PgAuditRepository implements AuditRepository {
       42 -  constructor(private readonly db: Db) {}                     
       38 +  constructor(private readonly manager: EntityManager) {}     
       39  
       40 +  private get repo() {                                        
       41 +    return this.manager.getRepository(AuditEntity);           
       42 +  }                                                           
       43 +                                                              
       44    async insert(e: AuditEntry): Promise<void> {
       45 -    await this.db.query(                                      
       46 -      `INSERT INTO audit_log (${COLUMNS})                     
       47 -       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $
          -12, $13, $14, $15, $16, $17, $18, $19, $20)`,                 
       48 -      [                                                       
       49 -        e.entry_id,                                           
       50 -        e.claim_id,                                           
       51 -        e.claim_seq,                                          
       52 -        e.transition_id,                                      
       53 -        e.from_state,                                         
       54 -        e.to_state,                                           
       55 -        e.actor_user_id,                                      
       56 -        e.actor_role,                                         
       57 -        e.reason,                                             
       58 -        e.notes,                                              
       59 -        JSON.stringify(e.input),                              
       60 -        JSON.stringify(e.changes),                            
       61 -        JSON.stringify(e.decision_context),                   
       62 -        JSON.stringify(e.effects),                            
       63 -        e.config_hash,                                        
       64 -        e.claim_version,                                      
       65 -        e.snapshot_hash,                                      
       66 -        e.prev_hash,                                          
       67 -        e.hash,                                               
       68 -        e.occurred_at,                                        
       69 -      ],                                                      
       70 -    );                                                        
       45 +    await this.repo.createQueryBuilder().insert().values({ ...
          +e }).updateEntity(false).execute();                           
       46    }
       47  
       48    async list(claimId: string): Promise<AuditEntry[]> {
       74 -    const { rows } = await this.db.query(                     
       75 -      `SELECT ${COLUMNS} FROM audit_log WHERE claim_id = $1 OR
          -DER BY claim_seq`,                                            
       76 -      [claimId],                                              
       77 -    );                                                        
       49 +    const rows = await this.repo.find({ where: { claim_id: cla
          +imId }, order: { claim_seq: 'ASC' } });                       
       50      return rows.map(rowToEntry);
       51    }
       52  
       53    async find(entryId: string): Promise<AuditEntry | null> {
       82 -    const { rows } = await this.db.query(`SELECT ${COLUMNS} FR
          -OM audit_log WHERE entry_id = $1`, [                          
       83 -      entryId,                                                
       84 -    ]);                                                       
       85 -    return rows[0] ? rowToEntry(rows[0]) : null;              
       54 +    const row = await this.repo.findOneBy({ entry_id: entryId 
          +});                                                           
       55 +    return row ? rowToEntry(row) : null;                      
       56    }
       57  
       58    async head(claimId: string): Promise<ChainHead | null> {
       89 -    const { rows } = await this.db.query<ChainHead>(          
       90 -      'SELECT claim_seq, hash FROM audit_log WHERE claim_id = 
          -$1 ORDER BY claim_seq DESC LIMIT 1',                          
       91 -      [claimId],                                              
       92 -    );                                                        
       93 -    return rows[0] ?? null;                                   
       59 +    const row = await this.repo.findOne({                     
       60 +      select: { claim_seq: true, hash: true },                
       61 +      where: { claim_id: claimId },                           
       62 +      order: { claim_seq: 'DESC' },                           
       63 +    });                                                       
       64 +    return row ? { claim_seq: row.claim_seq, hash: row.hash } 
          +: null;                                                       
       65    }
       66  }
       67  
       68  export class PgDeniedAttemptRepository implements DeniedAttemp
           tRepository {
       98 -  constructor(private readonly db: Db) {}                     
       69 +  constructor(private readonly manager: EntityManager) {}     
       70  
       71 +  private get repo() {                                        
       72 +    return this.manager.getRepository(DeniedEntity);          
       73 +  }                                                           
       74 +                                                              
       75    async record(d: DeniedRecord): Promise<boolean> {
       76      const bucket = new Date(d.occurred_at);
       77      bucket.setUTCSeconds(0, 0);
      103 -    const result = await this.db.query(                       
      104 -      `INSERT INTO denied_attempts                            
      105 -         (claim_id, actor_user_id, actor_role, transition_id, 
          -error_code, message, details, occurred_at, bucket_start)      
      106 -       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)            
      107 -       ON CONFLICT ON CONSTRAINT denied_attempts_dedupe DO NOT
          -HING`,                                                        
      108 -      [                                                       
      109 -        d.claim_id,                                           
      110 -        d.actor_user_id,                                      
      111 -        d.actor_role,                                         
      112 -        d.transition_id,                                      
      113 -        d.error_code,                                         
      114 -        d.message,                                            
      115 -        JSON.stringify(d.details),                            
      116 -        d.occurred_at,                                        
      117 -        bucket.toISOString(),                                 
      118 -      ],                                                      
      119 -    );                                                        
      120 -    return result.rowCount === 1;                             
       78 +    // The only unique constraint besides the key is denied_at
          +tempts_dedupe.                                                
       79 +    const result = await this.repo                            
       80 +      .createQueryBuilder()                                   
       81 +      .insert()                                               
       82 +      .values({ ...d, bucket_start: bucket.toISOString() })   
       83 +      .orIgnore()                                             
       84 +      .returning('id')                                        
       85 +      .updateEntity(false)                                    
       86 +      .execute();                                             
       87 +    return (result.raw as unknown[]).length === 1;            
       88    }
       89  
       90    async list(claimId?: string): Promise<DeniedAttempt[]> {
      124 -    const { rows } = await this.db.query(                     
      125 -      `SELECT id, claim_id, actor_user_id, actor_role, transit
          -ion_id, error_code, message, details, occurred_at             
      126 -         FROM denied_attempts ${claimId ? 'WHERE claim_id = $1
          -' : ''} ORDER BY id`,                                         
      127 -      claimId ? [claimId] : [],                               
      128 -    );                                                        
       91 +    const rows = await this.repo.find({                       
       92 +      where: claimId ? { claim_id: claimId } : {},            
       93 +      order: { id: 'ASC' },                                   
       94 +    });                                                       
       95      return rows.map((r) => ({
       96        id: r.id,
       97        claim_id: r.claim_id,

● Tiếp theo là outbox repository: lease dùng subquery FOR UPDATE SKIP LOCKED
  dựng bằng QueryBuilder.

● Bash(python - <<'EOF'
      p='src/repositories/postgres/outbox-repository.ts'…)
  ⎿  1:import type pg from 'pg';
     2:import type { EntityManager } from 'typeorm';
     3:import type { OutboxMessage, OutboxStatus } from '../../domain/types
     … +6 lines (ctrl+o to expand)
  ⎿  Updated src\repositories\postgres\outbox-repository.ts (+122 -83)
      1  import type pg from 'pg';
      2 +import type { EntityManager } from 'typeorm';                   
      3  import type { OutboxMessage, OutboxStatus } from '../../domain/t
         ypes';
      3 -import type { Db } from '../../infra/db/pool';                  
      4  import type {
      5    OutboxFilter,
      6    OutboxInsert,
     ...
       8    OutboxRepository,
       9    OutboxSubscription,
      10  } from '../outbox-repository';
      11 +import { OutboxEntity } from './entities';                     
      12  import { iso, isoOrNull } from './rows';
      13  
      14  /** NOTIFY channel; the payload is the schema name so workers i
          gnore other schemas' traffic. */
     ...
      40  }
      41  
      42  export class PgOutboxRepository implements OutboxRepository {
      42 -  constructor(private readonly db: Db) {}                      
      43 +  constructor(private readonly manager: EntityManager) {}      
      44 +                                                               
      45 +  private get repo() {                                         
      46 +    return this.manager.getRepository(OutboxEntity);           
      47 +  }                                                            
      48  
      49    async enqueue(messages: OutboxInsert[]): Promise<number[]> {
      50      const ids: number[] = [];
      51      for (const m of messages) {
      47 -      const { rows } = await this.db.query<{ id: number }>(    
      48 -        `INSERT INTO outbox (claim_id, audit_entry_id, effect_t
         -ype, payload, idempotency_key, next_attempt_at, created_at)    
      49 -         VALUES ($1, $2, $3, $4, $5, $6, $6)                   
      50 -         ON CONFLICT (idempotency_key) DO NOTHING              
      51 -         RETURNING id`,                                        
      52 -        [                                                      
      53 -          m.claim_id,                                          
      54 -          m.audit_entry_id,                                    
      55 -          m.effect_type,                                       
      56 -          JSON.stringify(m.payload),                           
      57 -          m.idempotency_key,                                   
      58 -          m.created_at,                                        
      59 -        ],                                                     
     … 222 more lines (ctrl+o to expand)

● Giờ là các repository còn lại: reference, definition, idempotency, mock
  gateway, cộng với unit of work và admin.

● Write(src\repositories\postgres\reference-repository.ts)
  ⎿  Added 31 lines, removed 33 lines
       1 +import type { EntityManager } from 'typeorm';                  
       2  import type { Policy, User } from '../../domain/types';
       2 -import type { Db } from '../../infra/db/pool';                 
       3  import type { PolicyRepository, UserRepository } from '../refer
          ence-repository';
       4 +import { PolicyEntity, UserEntity } from './entities';         
       5  
       6 +const toUser = (r: User): User => ({                           
       7 +  id: r.id,                                                    
       8 +  display_name: r.display_name,                                
       9 +  roles: r.roles,                                              
      10 +  member_id: r.member_id ?? null,                              
      11 +  service_account: r.service_account,                          
      12 +});                                                            
      13 +                                                               
      14 +const toPolicy = (r: Policy): Policy => ({                     
      15 +  id: r.id,                                                    
      16 +  member_id: r.member_id,                                      
      17 +  product: r.product,                                          
      18 +  coverage_limit: r.coverage_limit,                            
      19 +  currency: r.currency,                                        
      20 +  effective_from: r.effective_from,                            
      21 +  effective_to: r.effective_to,                                
      22 +});                                                            
      23 +                                                               
      24  export class PgUserRepository implements UserRepository {
       6 -  constructor(private readonly db: Db) {}                      
      25 +  constructor(private readonly manager: EntityManager) {}      
      26  
      27    async list(): Promise<User[]> {
       9 -    const { rows } = await this.db.query(                      
      10 -      'SELECT id, display_name, roles, member_id, service_accou
         -nt FROM users ORDER BY id',                                    
      11 -    );                                                         
      12 -    return rows.map((r) => ({                                  
      13 -      id: r.id,                                                
      14 -      display_name: r.display_name,                            
      15 -      roles: r.roles,                                          
      16 -      member_id: r.member_id ?? null,                          
      17 -      service_account: r.service_account,                      
      18 -    }));                                                       
      28 +    const rows = await this.manager.getRepository(UserEntity).f
         +ind({ order: { id: 'ASC' } });                                 
      29 +    return rows.map(toUser);                                   
      30    }
      31  }
      32  
      33  export class PgPolicyRepository implements PolicyRepository {
      23 -  constructor(private readonly db: Db) {}                      
      34 +  constructor(private readonly manager: EntityManager) {}      
      35  
      36 +  private get repo() {                                         
      37 +    return this.manager.getRepository(PolicyEntity);           
      38 +  }                                                            
      39 +                                                               
      40    async find(id: string | undefined): Promise<Policy | null> {
      41      if (!id) return null;
      27 -    const { rows } = await this.db.query(                      
      28 -      `SELECT id, member_id, product, coverage_limit, currency,
         - effective_from, effective_to                                  
      29 -         FROM policies WHERE id = $1`,                         
      30 -      [id],                                                    
      31 -    );                                                         
      32 -    const r = rows[0];                                         
      33 -    return r                                                   
      34 -      ? {                                                      
      35 -          id: r.id,                                            
      36 -          member_id: r.member_id,                              
      37 -          product: r.product,                                  
      38 -          coverage_limit: r.coverage_limit,                    
      39 -          currency: r.currency,                                
      40 -          effective_from: r.effective_from,                    
      41 -          effective_to: r.effective_to,                        
      42 -        }                                                      
      43 -      : null;                                                  
      42 +    const row = await this.repo.findOneBy({ id });             
      43 +    return row ? toPolicy(row) : null;                         
      44    }
      45  
      46    async list(): Promise<Policy[]> {
      47 -    const { rows } = await this.db.query('SELECT id FROM polici
         -es ORDER BY id');                                              
      48 -    const policies = await Promise.all(rows.map((r) => this.fin
         -d(r.id as string)));                                           
      49 -    return policies.filter((p): p is Policy => p !== null);    
      47 +    return (await this.repo.find({ order: { id: 'ASC' } })).map
         +(toPolicy);                                                    
      48    }
      49  }

● Write(src\repositories\postgres\definition-repository.ts)
  ⎿  Added 46 lines, removed 32 lines
       1 +import type { EntityManager } from 'typeorm';                  
       2  import type { DefinitionSummary, StoredDefinition } from '../..
          /domain/types';
       3  import type { CompiledWorkflow } from '../../engine/load';
       3 -import type { Db } from '../../infra/db/pool';                 
       4  import type { DefinitionRepository } from '../definition-reposi
          tory';
       5 +import { type DefinitionRow, DefinitionEntity } from './entitie
         +s';                                                            
       6  import { iso } from './rows';
       7  
       8 +const toDefinition = (r: DefinitionRow): StoredDefinition => ({
       9 +  config_hash: r.config_hash,                                  
      10 +  workflow_id: r.workflow_id,                                  
      11 +  version: r.version,                                          
      12 +  content: r.content,                                          
      13 +  registered_at: iso(r.registered_at),                         
      14 +});                                                            
      15 +                                                               
      16  export class PgDefinitionRepository implements DefinitionReposi
          tory {
       8 -  constructor(private readonly db: Db) {}                      
      17 +  constructor(private readonly manager: EntityManager) {}      
      18  
      19 +  private get repo() {                                         
      20 +    return this.manager.getRepository(DefinitionEntity);       
      21 +  }                                                            
      22 +                                                               
      23    async find(hash: string): Promise<StoredDefinition | null> {
      11 -    const { rows } = await this.db.query(                      
      12 -      'SELECT config_hash, workflow_id, version, content, regis
         -tered_at FROM workflow_definitions WHERE config_hash = $1',    
      13 -      [hash],                                                  
      14 -    );                                                         
      15 -    return rows[0] ? { ...rows[0], registered_at: iso(rows[0].r
         -egistered_at) } : null;                                        
      24 +    const row = await this.repo.findOneBy({ config_hash: hash }
         +);                                                             
      25 +    return row ? toDefinition(row) : null;                     
      26    }
      27  
      28    async findByVersion(workflowId: string, version: number): Pro
          mise<StoredDefinition | null> {
      19 -    const { rows } = await this.db.query(                      
      20 -      `SELECT config_hash, workflow_id, version, content, regis
         -tered_at                                                       
      21 -         FROM workflow_definitions WHERE workflow_id = $1 AND v
         -ersion = $2`,                                                  
      22 -      [workflowId, version],                                   
      23 -    );                                                         
      24 -    return rows[0] ? { ...rows[0], registered_at: iso(rows[0].r
         -egistered_at) } : null;                                        
      29 +    const row = await this.repo.findOneBy({ workflow_id: workfl
         +owId, version });                                              
      30 +    return row ? toDefinition(row) : null;                     
      31    }
      32  
      33    async insert(wf: CompiledWorkflow, now: Date): Promise<boolea
          n> {
      28 -    try {                                                      
      29 -      const r = await this.db.query(                           
      30 -        `INSERT INTO workflow_definitions (config_hash, workflo
         -w_id, version, content, registered_at)                         
      31 -         VALUES ($1, $2, $3, $4, $5)                           
      32 -         ON CONFLICT (config_hash) DO NOTHING`,                
      33 -        [wf.hash, wf.id, wf.version, JSON.stringify(wf.file), n
         -ow.toISOString()],                                             
      34 -      );                                                       
      35 -      return r.rowCount === 1;                                 
      36 -    } catch (error) {                                          
      37 -      // Another process registered this workflow version first
         - (with whatever hash it has).                                  
      38 -      if ((error as { constraint?: string }).constraint === 'wo
         -rkflow_definitions_version_unique')                            
      39 -        return false;                                          
      40 -      throw error;                                             
      41 -    }                                                          
      34 +    // ON CONFLICT DO NOTHING without a target also covers work
         +flow_definitions_version_unique:                               
      35 +    // when another process registered this version first, noth
         +ing is inserted.                                               
      36 +    const result = await this.repo                             
      37 +      .createQueryBuilder()                                    
      38 +      .insert()                                                
      39 +      .values({                                                
      40 +        config_hash: wf.hash,                                  
      41 +        workflow_id: wf.id,                                    
      42 +        version: wf.version,                                   
      43 +        content: wf.file,                                      
      44 +        registered_at: now.toISOString(),                      
      45 +      })                                                       
      46 +      .orIgnore()                                              
      47 +      .returning('config_hash')                                
      48 +      .updateEntity(false)                                     
      49 +      .execute();                                              
      50 +    return (result.raw as unknown[]).length === 1;             
      51    }
      52  
      53    async list(): Promise<DefinitionSummary[]> {
      45 -    const { rows } = await this.db.query(                      
      46 -      `SELECT config_hash, workflow_id, version, registered_at 
         -FROM workflow_definitions                                      
      47 -        ORDER BY workflow_id, version`,                        
      48 -    );                                                         
      49 -    return rows.map((r) => ({ ...r, registered_at: iso(r.regist
         -ered_at) }));                                                  
      54 +    const rows = await this.repo.find({                        
      55 +      select: { config_hash: true, workflow_id: true, version: 
         +true, registered_at: true },                                   
      56 +      order: { workflow_id: 'ASC', version: 'ASC' },           
      57 +    });                                                        
      58 +    return rows.map((r) => ({                                  
      59 +      config_hash: r.config_hash,                              
      60 +      workflow_id: r.workflow_id,                              
      61 +      version: r.version,                                      
      62 +      registered_at: iso(r.registered_at),                     
      63 +    }));                                                       
      64    }
      65  }

● Write(src\repositories\postgres\idempotency-repository.ts)
  ⎿  Added 26 lines, removed 20 lines
       1 -import type { Db } from '../../infra/db/pool';                 
       1 +import type { EntityManager } from 'typeorm';                  
       2  import type { IdempotencyRecord, IdempotencyRepository } from '
          ../idempotency-repository';
       3 +import { IdempotencyEntity } from './entities';                
       4  import { iso } from './rows';
       5  
       6  export class PgIdempotencyRepository implements IdempotencyRepo
          sitory {
       6 -  constructor(private readonly db: Db) {}                      
       7 +  constructor(private readonly manager: EntityManager) {}      
       8  
       9 +  private get repo() {                                         
      10 +    return this.manager.getRepository(IdempotencyEntity);      
      11 +  }                                                            
      12 +                                                               
      13    async lock(key: string): Promise<void> {
       9 -    await this.db.query('SELECT pg_advisory_xact_lock(hashtexte
         -xtended($1, 0))', [key]);                                      
      14 +    // Advisory locks have no ORM API.                         
      15 +    await this.manager                                         
      16 +      .createQueryBuilder()                                    
      17 +      .select('pg_advisory_xact_lock(hashtextextended(:key, 0))
         +')                                                             
      18 +      .fromDummy()                                             
      19 +      .setParameters({ key })                                  
      20 +      .getRawOne();                                            
      21    }
      22  
      23    async find(key: string): Promise<IdempotencyRecord | null> {
      13 -    const { rows } = await this.db.query(                      
      14 -      'SELECT key, actor_user_id, request_hash, claim_id, respo
         -nse, created_at FROM idempotency_keys WHERE key = $1',         
      15 -      [key],                                                   
      16 -    );                                                         
      17 -    return rows[0] ? { ...rows[0], created_at: iso(rows[0].crea
         -ted_at) } : null;                                              
      24 +    const row = await this.repo.findOneBy({ key });            
      25 +    return row                                                 
      26 +      ? {                                                      
      27 +          key: row.key,                                        
      28 +          actor_user_id: row.actor_user_id,                    
      29 +          request_hash: row.request_hash,                      
      30 +          claim_id: row.claim_id,                              
      31 +          response: row.response,                              
      32 +          created_at: iso(row.created_at),                     
      33 +        }                                                      
      34 +      : null;                                                  
      35    }
      36  
      37    async save(r: IdempotencyRecord): Promise<void> {
      21 -    await this.db.query(                                       
      22 -      `INSERT INTO idempotency_keys (key, actor_user_id, reques
         -t_hash, claim_id, response, created_at)                        
      23 -       VALUES ($1, $2, $3, $4, $5, $6)`,                       
      24 -      [                                                        
      25 -        r.key,                                                 
      26 -        r.actor_user_id,                                       
      27 -        r.request_hash,                                        
      28 -        r.claim_id,                                            
      29 -        JSON.stringify(r.response),                            
      30 -        r.created_at,                                          
      31 -      ],                                                       
      32 -    );                                                         
      38 +    await this.repo.createQueryBuilder().insert().values({ ...r
         + }).updateEntity(false).execute();                             
      39    }
      40  }

● Write(src\repositories\postgres\mock-gateway-repository.ts)
  ⎿  Added 70 lines, removed 51 lines
       1 +import type { EntityManager } from 'typeorm';                  
       2  import type { MockNotification, MockPayment } from '../../domai
          n/types';
       2 -import type { Db } from '../../infra/db/pool';                 
       3  import type { MockGatewayRepository } from '../mock-gateway-rep
          ository';
       4 +import {                                                       
       5 +  FaultEntity,                                                 
       6 +  NotificationEntity,                                          
       7 +  type NotificationRow,                                        
       8 +  PaymentEntity,                                               
       9 +  type PaymentRow,                                             
      10 +} from './entities';                                           
      11  import { iso } from './rows';
      12  
      13 +const toPayment = (r: PaymentRow): MockPayment => ({           
      14 +  idempotency_key: r.idempotency_key,                          
      15 +  claim_id: r.claim_id,                                        
      16 +  amount: r.amount,                                            
      17 +  reference: r.reference,                                      
      18 +  gateway_ref: r.gateway_ref,                                  
      19 +  created_at: iso(r.created_at),                               
      20 +});                                                            
      21 +                                                               
      22 +const toNotification = (r: NotificationRow): MockNotification =
         +> ({                                                           
      23 +  idempotency_key: r.idempotency_key,                          
      24 +  claim_id: r.claim_id,                                        
      25 +  template: r.template,                                        
      26 +  channel: r.channel,                                          
      27 +  recipient: r.recipient,                                      
      28 +  subject: r.subject,                                          
      29 +  body: r.body,                                                
      30 +  sent_at: iso(r.sent_at),                                     
      31 +});                                                            
      32 +                                                               
      33  export class PgMockGatewayRepository implements MockGatewayRepo
          sitory {
       7 -  constructor(private readonly db: Db) {}                      
      34 +  constructor(private readonly manager: EntityManager) {}      
      35  
      36    async consumeFault(): Promise<boolean> {
      10 -    const r = await this.db.query(                             
      11 -      `UPDATE mock_gateway_faults SET remaining_failures = rema
         -ining_failures - 1                                             
      12 -        WHERE id = 1 AND remaining_failures > 0`,              
      13 -    );                                                         
      14 -    return r.rowCount === 1;                                   
      37 +    const r = await this.manager                               
      38 +      .getRepository(FaultEntity)                              
      39 +      .createQueryBuilder()                                    
      40 +      .update()                                                
      41 +      .set({ remaining_failures: () => 'remaining_failures - 1'
         + })                                                            
      42 +      .where('id = 1 AND remaining_failures > 0')              
      43 +      .updateEntity(false)                                     
      44 +      .execute();                                              
      45 +    return r.affected === 1;                                   
      46    }
      47  
      48    async setFaults(count: number): Promise<void> {
      18 -    await this.db.query('UPDATE mock_gateway_faults SET remaini
         -ng_failures = $1 WHERE id = 1', [                              
      19 -      count,                                                   
      20 -    ]);                                                        
      49 +    await this.manager.getRepository(FaultEntity).update({ id: 
         +1 }, { remaining_failures: count });                           
      50    }
      51  
      52    async recordPayment(p: MockPayment): Promise<MockPayment & { 
          created: boolean }> {
      24 -    const inserted = await this.db.query(                      
      25 -      `INSERT INTO mock_gateway_payments (idempotency_key, clai
         -m_id, amount, reference, gateway_ref, created_at)              
      26 -       VALUES ($1, $2, $3, $4, $5, $6)                         
      27 -       ON CONFLICT (idempotency_key) DO NOTHING`,              
      28 -      [p.idempotency_key, p.claim_id, p.amount, p.reference, p.
         -gateway_ref, p.created_at],                                    
      29 -    );                                                         
      30 -    const { rows } = await this.db.query(                      
      31 -      `SELECT idempotency_key, claim_id, amount, reference, gat
         -eway_ref, created_at                                           
      32 -         FROM mock_gateway_payments WHERE idempotency_key = $1`
         -,                                                              
      33 -      [p.idempotency_key],                                     
      34 -    );                                                         
      35 -    const row = rows[0];                                       
      36 -    return { ...row, created_at: iso(row.created_at), created: 
         -inserted.rowCount === 1 };                                     
      53 +    const payments = this.manager.getRepository(PaymentEntity);
      54 +    const inserted = await payments                            
      55 +      .createQueryBuilder()                                    
      56 +      .insert()                                                
      57 +      .values({ ...p })                                        
      58 +      .orIgnore()                                              
      59 +      .returning('idempotency_key')                            
      60 +      .updateEntity(false)                                     
      61 +      .execute();                                              
      62 +    const row = await payments.findOneByOrFail({ idempotency_ke
         +y: p.idempotency_key });                                       
      63 +    return { ...toPayment(row), created: (inserted.raw as unkno
         +wn[]).length === 1 };                                          
      64    }
      65  
      66    async listPayments(claimId?: string): Promise<MockPayment[]> 
          {
      40 -    const { rows } = await this.db.query(                      
      41 -      `SELECT idempotency_key, claim_id, amount, reference, gat
         -eway_ref, created_at                                           
      42 -         FROM mock_gateway_payments ${claimId ? 'WHERE claim_id
         - = $1' : ''} ORDER BY id`,                                     
      43 -      claimId ? [claimId] : [],                                
      44 -    );                                                         
      45 -    return rows.map((r) => ({ ...r, created_at: iso(r.created_a
         -t) }));                                                        
      67 +    const rows = await this.manager.getRepository(PaymentEntity
         +).find({                                                       
      68 +      where: claimId ? { claim_id: claimId } : {},             
      69 +      order: { id: 'ASC' },                                    
      70 +    });                                                        
      71 +    return rows.map(toPayment);                                
      72    }
      73  
      74    async recordNotification(n: MockNotification): Promise<boolea
          n> {
      49 -    const r = await this.db.query(                             
      50 -      `INSERT INTO mock_notifications (idempotency_key, claim_i
         -d, template, channel, recipient, subject, body, sent_at)       
      51 -       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)                 
      52 -       ON CONFLICT (idempotency_key) DO NOTHING`,              
      53 -      [                                                        
      54 -        n.idempotency_key,                                     
      55 -        n.claim_id,                                            
      56 -        n.template,                                            
      57 -        n.channel,                                             
      58 -        JSON.stringify(n.recipient),                           
      59 -        n.subject,                                             
      60 -        n.body,                                                
      61 -        n.sent_at,                                             
      62 -      ],                                                       
      63 -    );                                                         
      64 -    return r.rowCount === 1;                                   
      75 +    const result = await this.manager                          
      76 +      .getRepository(NotificationEntity)                       
      77 +      .createQueryBuilder()                                    
      78 +      .insert()                                                
      79 +      .values({ ...n })                                        
      80 +      .orIgnore()                                              
      81 +      .returning('idempotency_key')                            
      82 +      .updateEntity(false)                                     
      83 +      .execute();                                              
      84 +    return (result.raw as unknown[]).length === 1;             
      85    }
      86  
      87    async listNotifications(claimId?: string): Promise<MockNotifi
          cation[]> {
      68 -    const { rows } = await this.db.query(                      
      69 -      `SELECT idempotency_key, claim_id, template, channel, rec
         -ipient, subject, body, sent_at                                 
      70 -         FROM mock_notifications ${claimId ? 'WHERE claim_id = 
         -$1' : ''} ORDER BY id`,                                        
      71 -      claimId ? [claimId] : [],                                
      72 -    );                                                         
      73 -    return rows.map((r) => ({ ...r, sent_at: iso(r.sent_at) }))
         -;                                                              
      88 +    const rows = await this.manager.getRepository(NotificationE
         +ntity).find({                                                  
      89 +      where: claimId ? { claim_id: claimId } : {},             
      90 +      order: { id: 'ASC' },                                    
      91 +    });                                                        
      92 +    return rows.map(toNotification);                           
      93    }
      94  }
● Write(src\repositories\postgres\unit-of-work.ts)
  ⎿  Added 15 lines, removed 16 lines
      1 -import type pg from 'pg';                                       
      2 -import { type Db, inTransaction } from '../../infra/db/pool';   
      1 +import type { DataSource, EntityManager } from 'typeorm';       
      2  import type { Repositories, UnitOfWork } from '../unit-of-work';
      3  import { PgAuditRepository, PgDeniedAttemptRepository } from './
         audit-repository';
      4  import { PgClaimRepository } from './claim-repository';
     ...
       8  import { PgOutboxRepository } from './outbox-repository';
       9  import { PgPolicyRepository, PgUserRepository } from './referen
          ce-repository';
      10  
      12 -/** Every repository on one connection (a pool, or the client o
         -f a transaction). */                                           
      13 -export function createPgRepositories(db: Db): Repositories {   
      11 +/** Every repository on one entity manager (the data source's, 
         +or a transaction's). */                                        
      12 +export function createPgRepositories(manager: EntityManager): R
         +epositories {                                                  
      13    return {
      15 -    claims: new PgClaimRepository(db),                         
      16 -    audit: new PgAuditRepository(db),                          
      17 -    denied: new PgDeniedAttemptRepository(db),                 
      18 -    outbox: new PgOutboxRepository(db),                        
      19 -    users: new PgUserRepository(db),                           
      20 -    policies: new PgPolicyRepository(db),                      
      21 -    definitions: new PgDefinitionRepository(db),               
      22 -    idempotency: new PgIdempotencyRepository(db),              
      23 -    mockGateway: new PgMockGatewayRepository(db),              
      14 +    claims: new PgClaimRepository(manager),                    
      15 +    audit: new PgAuditRepository(manager),                     
      16 +    denied: new PgDeniedAttemptRepository(manager),            
      17 +    outbox: new PgOutboxRepository(manager),                   
      18 +    users: new PgUserRepository(manager),                      
      19 +    policies: new PgPolicyRepository(manager),                 
      20 +    definitions: new PgDefinitionRepository(manager),          
      21 +    idempotency: new PgIdempotencyRepository(manager),         
      22 +    mockGateway: new PgMockGatewayRepository(manager),         
      23    };
      24  }
      25  
      26  export class PgUnitOfWork implements UnitOfWork {
      27    readonly repos: Repositories;
      28  
      30 -  constructor(private readonly pool: pg.Pool) {                
      31 -    this.repos = createPgRepositories(pool);                   
      29 +  constructor(private readonly dataSource: DataSource) {       
      30 +    this.repos = createPgRepositories(dataSource.manager);     
      31    }
      32  
      33    transaction<T>(fn: (tx: Repositories) => Promise<T>): Promise
          <T> {
      35 -    return inTransaction(this.pool, (client) => fn(createPgRepo
         -sitories(client)));                                            
      34 +    return this.dataSource.transaction((manager) => fn(createPg
         +Repositories(manager)));                                       
      35    }
      36  }

● Write(src\repositories\postgres\admin.ts)
  ⎿  Added 34 lines, removed 35 lines
       1  // Owner-only maintenance: schema lifecycle and reference data.
           The runtime role has no privilege
       2 -// for any of this, so these functions take the owner's pool an
         -d are not part of `Repositories`.                              
       3 -// The owner pool has a single connection: never run these quer
         -ies in parallel.                                               
       4 -import type pg from 'pg';                                      
       2 +// for any of this, so these functions take a data source conne
         +cted as the schema owner and are                               
       3 +// not part of `Repositories`.                                 
       4 +import type { DataSource } from 'typeorm';                     
       5  import type { Policy, User } from '../../domain/types';
       6  import { SCHEMA_RE } from '../../infra/db/pool';
       7 +import { PolicyEntity, UserEntity } from './entities';         
       8  
       9  function checkSchema(schema: string) {
      10    if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema 
          name '${schema}'`);
      11  }
      12  
      12 -export async function createSchema(owner: pg.Pool, schema: stri
         -ng): Promise<void> {                                           
      13 +export async function createSchema(owner: DataSource, schema: s
         +tring): Promise<void> {                                        
      14    checkSchema(schema);
      14 -  await owner.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);  
      15 +  const runner = owner.createQueryRunner();                    
      16 +  try {                                                        
      17 +    await runner.createSchema(schema, true);                   
      18 +  } finally {                                                  
      19 +    await runner.release();                                    
      20 +  }                                                            
      21  }
      22  
      23  /** Drops the schema with all its data; audit tables are append
          -only, so this is the only reset. */
      18 -export async function dropSchema(owner: pg.Pool, schema: string
         -): Promise<void> {                                             
      24 +export async function dropSchema(owner: DataSource, schema: str
         +ing): Promise<void> {                                          
      25    checkSchema(schema);
      20 -  await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      26 +  const runner = owner.createQueryRunner();                    
      27 +  try {                                                        
      28 +    await runner.dropSchema(schema, true, true);               
      29 +  } finally {                                                  
      30 +    await runner.release();                                    
      31 +  }                                                            
      32  }
      33  
      34  /** Inserts or updates users and policies. */
      35  export async function upsertReference(
      25 -  owner: pg.Pool,                                              
      36 +  owner: DataSource,                                           
      37    seed: { users: User[]; policies: Policy[] },
      38  ): Promise<void> {
      28 -  for (const u of seed.users) {                                
      29 -    await owner.query(                                         
      30 -      `INSERT INTO users (id, display_name, roles, member_id, s
         -ervice_account)                                                
      31 -       VALUES ($1, $2, $3, $4, $5)                             
      32 -       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.d
         -isplay_name, roles = EXCLUDED.roles,                           
      33 -         member_id = EXCLUDED.member_id, service_account = EXCL
         -UDED.service_account`,                                         
      34 -      [u.id, u.display_name, u.roles, u.member_id, u.service_ac
         -count],                                                        
      35 -    );                                                         
      36 -  }                                                            
      37 -  for (const p of seed.policies) {                             
      38 -    await owner.query(                                         
      39 -      `INSERT INTO policies (id, member_id, product, coverage_l
         -imit, currency, effective_from, effective_to)                  
      40 -       VALUES ($1, $2, $3, $4, $5, $6, $7)                     
      41 -       ON CONFLICT (id) DO UPDATE SET member_id = EXCLUDED.memb
         -er_id, product = EXCLUDED.product,                             
      42 -         coverage_limit = EXCLUDED.coverage_limit, currency = E
         -XCLUDED.currency,                                              
      43 -         effective_from = EXCLUDED.effective_from, effective_to
         - = EXCLUDED.effective_to`,                                     
      44 -      [                                                        
      45 -        p.id,                                                  
      46 -        p.member_id,                                           
      47 -        p.product,                                             
      48 -        p.coverage_limit,                                      
      49 -        p.currency,                                            
      50 -        p.effective_from,                                      
      51 -        p.effective_to,                                        
      52 -      ],                                                       
      53 -    );                                                         
      54 -  }                                                            
      39 +  // One row at a time, like the seed file reads: the owner poo
         +l has a single connection.                                     
      40 +  for (const u of seed.users) await owner.manager.upsert(UserEn
         +tity, { ...u }, ['id']);                                       
      41 +  for (const p of seed.policies) await owner.manager.upsert(Pol
         +icyEntity, { ...p }, ['id']);                                  
      42  }
      43 +                                                               
      44 +/** Applies pending migrations, each in its own transaction; re
         +turns what ran and what did not. */                            
      45 +export async function runMigrations(                           
      46 +  owner: DataSource,                                           
      47 +): Promise<{ applied: string[]; skipped: string[] }> {         
      48 +  const ran = await owner.runMigrations({ transaction: 'each' }
         +);                                                             
      49 +  const applied = ran.map((m) => m.name);                      
      50 +  const skipped = owner.migrations                             
      51 +    .map((m) => m.name ?? m.constructor.name)                  
      52 +    .filter((name) => !applied.includes(name));                
      53 +  return { applied, skipped };                                 
      54 +}                                                              

● Repository xong rồi. Giờ mình kiểm tra cách TypeORM sinh DDL cho các cột
  identity, generated, default và check, để đặt tên constraint khớp với tên mà
  Postgres tự sinh.

  Searched for 1 pattern, ran 1 shell command (ctrl+o to expand)

● Đã hiểu cách TypeORM sinh DDL, giờ tôi sẽ viết migration Init: dùng Table API
  cho bảng, constraint và index với tên trùng tên Postgres tự sinh, còn
  function, trigger và GRANT thì chép nguyên văn.

● Write(src\infra\db\migrations\1761350400000-Init.ts)
  ⎿  Wrote 621 lines to src\infra\db\migrations\1761350400000-Init.ts
       1 // Claims workflow schema (PostgreSQL 17+). Runs inside the sche
       2 // as claims_owner. The application connects as claims_app, whic
         h can read and insert audit
       3 // records but never update or delete them.
       5 // Tables, keys, checks and indexes use TypeORM's schema API, wi
         th the names PostgreSQL gave them
         ence and grants have no such API
       7 // and are SQL.
       8 import {
      10   type QueryRunner,
     … +709 lines (ctrl+o to expand)

● Migration xong. Giờ tạo migrations/index.ts, xoá runner cũ cùng file SQL, rồi
  cập nhật bootstrap.ts.

● Bash(cd /d/work/papaya && cat > src/infra/db/migrations/index.ts <<'EOF'
      import { Init1761350400000 } from './1761350400000-Init';…)
  ⎿  src/infra/db:
     migrations
     pool.ts
     … +4 lines (ctrl+o to expand)
  ⎿  Deleted src\infra\db\migrate.ts (+0 -71)
       1 -import { readdirSync, readFileSync } from 'node:fs';           
       2 -import { dirname, join } from 'node:path';                     
       3 -import { fileURLToPath } from 'node:url';                      
       4 -import type pg from 'pg';                                      
       5 -import { sha256Hex } from '../../engine/hash';                 
       6 -                                                               
       7 -const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.u
         -rl)), 'migrations');                                           
       8 -                                                               
       9 -export interface MigrationResult {                             
      10 -  applied: string[];                                           
      11 -  skipped: string[];                                           
      12 -}                                                              
      13 -                                                               
      14 -function migrationFiles(): Array<{ version: string; sql: string
         -; checksum: string }> {                                        
      15 -  return readdirSync(MIGRATIONS_DIR)                           
      16 -    .filter((f) => /^\d{3}_.+\.sql$/.test(f))                  
      17 -    .sort()                                                    
      18 -    .map((file) => {                                           
      19 -      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf
         -8').replace(/\r\n/g, '\n');                                    
      20 -      return { version: file.replace(/\.sql$/, ''), sql, checks
         -um: sha256Hex(sql) };                                          
      21 -    });                                                        
      22 -}                                                              
      23 -                                                               
      24 -/**                                                            
      25 - * Applies pending migrations in order, each in its own transac
         -tion, in the pool's schema.                                    
      26 - * An applied migration whose file content changed is an error:
         - migrations are append-only.                                   
      27 - */                                                            
      28 -export async function migrate(pool: pg.Pool): Promise<Migration
         -Result> {                                                      
      29 -  const client = await pool.connect();                         
      30 -  try {                                                        
      31 -    await client.query(`                                       
      32 -      CREATE TABLE IF NOT EXISTS schema_migrations (           
      33 -        version    text PRIMARY KEY,                           
      34 -        checksum   text NOT NULL CHECK (checksum ~ '^[0-9a-f]{6
         -4}$'),                                                         
      35 -        applied_at timestamptz NOT NULL DEFAULT now()          
      36 -      )`);                                                     
      37 -    const { rows } = await client.query<{ version: string; chec
         -ksum: string }>(                                               
      38 -      'SELECT version, checksum FROM schema_migrations',       
      39 -    );                                                         
      40 -    const applied = new Map(rows.map((r) => [r.version, r.check
         -sum]));                                                        
     … 31 more lines (ctrl+o to expand)
  ⎿  Deleted src\infra\db\migrations\001_init.sql (+0 -303)
        1 --- Claims workflow schema (PostgreSQL 17+).                   
        2 --- Runs inside the schema selected by search_path, as claims_o
          -wner. The application connects as                             
        3 --- claims_app, which can read and insert audit records but nev
          -er update or delete them.                                     
        4 -                                                              
        5 --- ── Helpers ────────────────────────────────────────────────
          -──────────────────────────────────                            
        6 -                                                              
        7 --- Raised for UPDATE / DELETE / TRUNCATE on append-only tables
          -.                                                             
        8 -CREATE FUNCTION forbid_mutation() RETURNS trigger             
        9 -LANGUAGE plpgsql AS $$                                        
       10 -BEGIN                                                         
       11 -  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TAB
          -LE_NAME, TG_OP                                                
       12 -    USING ERRCODE = 'insufficient_privilege';                 
       13 -END;                                                          
       14 -$$;                                                           
       15 -                                                              
       16 --- ── Reference data ─────────────────────────────────────────
          -──────────────────────────────────                            
       17 -                                                              
       18 --- Immutable copies of every workflow definition a claim has b
          -een pinned to.                                                
       19 -CREATE TABLE workflow_definitions (                           
       20 -  config_hash   text PRIMARY KEY CHECK (config_hash ~ '^[0-9a-
          -f]{64}$'),                                                    
       21 -  workflow_id   text NOT NULL CHECK (workflow_id ~ '^[a-z][a-z
          -0-9_]*$'),                                                    
       22 -  version       integer NOT NULL CHECK (version >= 1),        
       23 -  content       jsonb NOT NULL CHECK (jsonb_typeof(content) = 
          -'object'),                                                    
       24 -  registered_at timestamptz NOT NULL,                         
       25 -  CONSTRAINT workflow_definitions_version_unique UNIQUE (workf
          -low_id, version)                                              
       26 -);                                                            
       27 -                                                              
       28 -CREATE TABLE users (                                          
       29 -  id              text PRIMARY KEY,                           
       30 -  display_name    text NOT NULL,                              
       31 -  roles           text[] NOT NULL CHECK (cardinality(roles) > 
          -0),                                                           
       32 -  member_id       text,                                       
       33 -  service_account boolean NOT NULL DEFAULT false              
       34 -);                                                            
       35 -                                                              
       36 -CREATE TABLE policies (                                       
       37 -  id             text PRIMARY KEY,                            
       38 -  member_id      text NOT NULL,                               
       39 -  product        text NOT NULL,                               
       40 -  coverage_limit bigint NOT NULL CHECK (coverage_limit > 0 AND
          - coverage_limit < 9007199254740992),                          
     … 263 more lines (ctrl+o to expand)
  ⎿  Created src\infra\db\migrations\index.ts (+7 -0)
      1 +import { Init1761350400000 } from './1761350400000-Init';       
      2 +                                                                
      3 +/**                                                             
      4 + * Every migration, oldest first. Migrations are append-only: ne
        +ver edit one that has been                                      
      5 + * applied; add a new file (npm run db:migration:create) and lis
        +t it here and in checksums.json.                                
      6 + */                                                             
      7 +export const MIGRATIONS = [Init1761350400000];                  

  Read 1 file (ctrl+o to expand)

● Bash(python - <<'EOF'
      p='src/bootstrap.ts'…)
  ⎿  src/repositories/postgres/audit-repository.ts(45,58): error TS2345: Ar
     gument of type '{ entry_id: string; claim_id: string; claim_seq: numbe
     r; transition_id: string; from_state: string | null; to_state: string;
     … +90 lines (ctrl+o to expand)
  ⎿  Updated src\bootstrap.ts (+18 -15)
       1  // Composition root: the only module that wires PostgreSQL impl
          ementations into the services.
       2  import { randomUUID } from 'node:crypto';
       3 -import type pg from 'pg';                                      
       3 +import type { DataSource } from 'typeorm';                     
       4  import { type CompiledWorkflow, loadWorkflowFile } from './engi
          ne/load';
       5 -import { migrate } from './infra/db/migrate';                  
       6 -import { createPool } from './infra/db/pool';                  
       5  import { env } from './infra/env';
       6  import { loadSeed } from './infra/seed-file';
       7  import {
       8    createSchema,
       9    dropSchema as dropSchemaIn,
      10 +  runMigrations,                                               
      11    upsertReference,
      12  } from './repositories/postgres/admin';
      13 +import { createDataSource } from './repositories/postgres/data-
         +source';                                                       
      14  import { PgOutboxNotifications } from './repositories/postgres/
          outbox-repository';
      15  import { PgUnitOfWork } from './repositories/postgres/unit-of-w
          ork';
      16  import { ClaimQueryService } from './services/claim-query-servi
          ce';
     ...
      27  export type WorkerSettings = Omit<WorkerOptions, 'outbox' | 'no
          tifications' | 'gateway' | 'clock'>;
      28  
      29  export interface AppContext {
      30 -  /** Runtime-role pool, for tests and demos that check databas
         -e privileges directly. */                                      
      31 -  pool: pg.Pool;                                               
      30 +  /** Runtime-role data source; for tests. Controllers only get
         + `services`. */                                                
      31 +  dataSource: DataSource;                                      
      32    schema: string;
      33    clock: Clock;
      34    workflow: CompiledWorkflow;
     ...
      57    const clock = options.clock ?? systemClock;
      58    // One generator for writes and dry runs, so reproducible ids
           stay reproducible.
      59    const newId = options.newId ?? randomUUID;
      60 -  const pool = createPool(options.databaseUrl ?? env.databaseUr
         -l(), schema);                                                  
      61 -  const store = new PgUnitOfWork(pool);                        
      60 +  const dataSource = createDataSource(options.databaseUrl ?? en
         +v.databaseUrl(), schema);                                      
      61 +  await dataSource.initialize();                               
      62 +  const store = new PgUnitOfWork(dataSource);                  
      63    const auditKey = env.auditKey();
      64    const workflows = new WorkflowService(workflow, store.repos.d
          efinitions, clock);
      65    const services: Services = {
     … 52 more lines (ctrl+o to expand)
  ⎿  Updated src\repositories\postgres\admin.ts (+1 -1)
      36    owner: DataSource,
      37    seed: { users: User[]; policies: Policy[] },
      38  ): Promise<void> {
      39 -  // One row at a time, like the seed file reads: the owner poo
         -l has a single connection.                                     
      39 +  // One row at a time, in file order.                         
      40    for (const u of seed.users) await owner.manager.upsert(UserEn
          tity, { ...u }, ['id']);
      41    for (const p of seed.policies) await owner.manager.upsert(Pol
          icyEntity, { ...p }, ['id']);
      42  }
  ⎿  Updated src\repositories\postgres\outbox-repository.ts (+8 -4)
      1  import type pg from 'pg';
      2 -import type { EntityManager } from 'typeorm';                   
      2 +import type { DataSource, EntityManager } from 'typeorm';       
      3  import type { OutboxMessage, OutboxStatus } from '../../domain/t
         ypes';
      4  import type {
      5    OutboxFilter,
     ...
      209    }
      210  }
      211  
      212 -/** LISTEN on a connection of its own; only notifications for 
          -`schema` wake the listener. */                                
      212 +/**                                                           
      213 + * LISTEN on a connection of its own from the data source's po
          +ol; only notifications for                                    
      214 + * `schema` wake the listener. TypeORM has no LISTEN API, so t
          +his uses the pg client directly.                              
      215 + */                                                           
      216  export class PgOutboxNotifications implements OutboxNotificati
           ons {
      217    constructor(
      215 -    private readonly pool: pg.Pool,                           
      218 +    private readonly dataSource: DataSource,                  
      219      private readonly schema: string,
      220    ) {}
      221  
     ...
      223      onNotify: () => void;
      224      onError: (error: Error) => void;
      225    }): Promise<OutboxSubscription> {
      223 -    const listener = await this.pool.connect();               
      226 +    const pool = (this.dataSource.driver as unknown as { maste
          +r: pg.Pool }).master;                                         
      227 +    const listener = await pool.connect();                    
      228      const onNotification = (n: pg.Notification) => {
      229        if (n.channel === OUTBOX_CHANNEL && n.payload === this.s
           chema) handlers.onNotify();
      230      };

● Mình phát hiện hai lỗi type: "deep partial" của TypeORM không nhận JSON kiểu
  unknown, và UpdateQueryBuilder ở bản 1.x không còn subQuery(). Mình sẽ kiểm
  tra export trước khi sửa.

  Ran 1 shell command (ctrl+o to expand)

● Cách sửa gọn nhất là khai báo cột jsonb trong Row type là object thay vì
  Record<string, unknown> để tránh phải ép kiểu, còn subquery sẽ dựng bằng một
  select builder riêng.

● Bash(cd /d/work/papaya && python - <<'EOF'
      p='src/repositories/postgres/entities.ts'…)
  ⎿  src/repositories/postgres/audit-repository.ts(95,5): error TS2322: Typ
     e '{ id: number; claim_id: string | null; actor_user_id: string; actor
     _role: string | null; transition_id: string; error_code: string; messa
     … +23 lines (ctrl+o to expand)
  ⎿  Updated src\repositories\postgres\entities.ts (+29 -10)
      15  } from '../../domain/types';
      16  import type { IdempotencyRecord } from '../idempotency-reposito
          ry';
      17  
      18 -/** A row as the driver returns it: timestamptz columns come ba
         -ck as Date objects. */                                         
      19 -type Row<T, Timestamps extends keyof T> = Omit<T, Timestamps> &
         - {                                                             
      20 -  [K in Timestamps]: Date | string;                            
      21 -};                                                             
      18 +/** A jsonb value: any JSON object or array (TypeORM's write ty
         +pes cannot take `unknown`). */                                 
      19 +type Json = object;                                            
      20 +                                                               
      21 +/**                                                            
      22 + * A row as TypeORM reads and writes it: timestamptz columns co
         +me back as Date objects (and                                   
      23 + * accept ISO strings), jsonb columns hold any JSON.           
      24 + */                                                            
      25 +type Row<T, Timestamps extends keyof T, JsonColumns extends key
         +of T = never> = Omit<                                          
      26 +  T,                                                           
      27 +  Timestamps | JsonColumns                                     
      28 +> & { [K in Timestamps]: Date | string } & { [K in JsonColumns]
         +: Json };                                                      
      29  
      30  export type DefinitionRow = Row<StoredDefinition, 'registered_a
          t'>;
      24 -export type ClaimRow = Row<ClaimSnapshot, 'state_entered_at' | 
         -'created_at' | 'updated_at'> & {                               
      31 +export type ClaimRow = Row<                                    
      32 +  ClaimSnapshot,                                               
      33 +  'state_entered_at' | 'created_at' | 'updated_at',            
      34 +  'data' | 'counters' | 'participants'                         
      35 +> & {                                                          
      36    /** Generated from data.assessor_id, for work-queue filters. 
          */
      37    assessor_id: string | null;
      38  };
      28 -export type AuditRow = Row<AuditEntry, 'occurred_at'> & { id: n
         -umber; state_changed: boolean };                               
      29 -export type DeniedRow = Row<DeniedAttempt, 'occurred_at'> & { b
         -ucket_start: Date | string };                                  
      39 +export type AuditRow = Row<                                    
      40 +  AuditEntry,                                                  
      41 +  'occurred_at',                                               
      42 +  'input' | 'changes' | 'decision_context' | 'effects'         
      43 +> & { id: number; state_changed: boolean };                    
      44 +export type DeniedRow = Row<DeniedAttempt, 'occurred_at', 'deta
         +ils'> & {                                                      
      45 +  bucket_start: Date | string;                                 
      46 +};                                                             
      47  export type OutboxRow = Omit<
     … 20 more lines (ctrl+o to expand)
  ⎿  Updated src\repositories\postgres\outbox-repository.ts (+12 -16)
      79      leaseMs: number,
      80      limit: number,
      81    ): Promise<OutboxMessage[]> {
      82 +    const due = this.repo                                      
      83 +      .createQueryBuilder('o')                                 
      84 +      .select('o.id')                                          
      85 +      .where('o.attempts < o.max_attempts')                    
      86 +      .andWhere(                                               
      87 +        "((o.status IN ('PENDING', 'FAILED') AND o.next_attempt
         +_at <= :now) OR (o.status = 'PROCESSING' AND o.locked_until < :
         +now))",                                                        
      88 +      )                                                        
      89 +      .orderBy('o.id')                                         
      90 +      .limit(limit)                                            
      91 +      .setLock('pessimistic_write')                            
      92 +      .setOnLocked('skip_locked');                             
      93      const result = await this.repo
      94        .createQueryBuilder()
      95        .update()
     ...
       99          locked_until: new Date(now.getTime() + leaseMs).toISOS
           tring(),
      100          attempts: () => 'attempts + 1',
      101        })
       91 -      .where((qb) => {                                        
       92 -        const due = qb                                        
       93 -          .subQuery()                                         
       94 -          .select('o.id')                                     
       95 -          .from(OutboxEntity, 'o')                            
       96 -          .where('o.attempts < o.max_attempts')               
       97 -          .andWhere(                                          
       98 -            "((o.status IN ('PENDING', 'FAILED') AND o.next_at
          -tempt_at <= :now) OR (o.status = 'PROCESSING' AND o.locked_unt
          -il < :now))",                                                 
       99 -          )                                                   
      100 -          .orderBy('o.id')                                    
      101 -          .limit(limit)                                       
      102 -          .setLock('pessimistic_write')                       
      103 -          .setOnLocked('skip_locked')                         
      104 -          .getQuery();                                        
      105 -        return `id IN ${due}`;                                
      106 -      })                                                      
      102 +      .where(`id IN (${due.getQuery()})`)                     
      103        .setParameters({ now: now.toISOString() })
      104        .returning(COLUMNS)
      105        .updateEntity(false)

● Bash(sed -i 's/      details: r\.details,/      details: r.details as
      Record<string, unknown>,/' src/repositories/postgres/audit-repository.ts
      && sed -i 's/…)
  ⎿  Updated src\repositories\postgres\audit-repository.ts (+1 -1)
      100        transition_id: r.transition_id,
      101        error_code: r.error_code,
      102        message: r.message,
      103 -      details: r.details,                                     
      103 +      details: r.details as Record<string, unknown>,          
      104        occurred_at: iso(r.occurred_at),
      105      }));
      106    }
  ⎿  Updated src\repositories\postgres\idempotency-repository.ts (+1 -1)
      28            actor_user_id: row.actor_user_id,
      29            request_hash: row.request_hash,
      30            claim_id: row.claim_id,
      31 -          response: row.response,                              
      31 +          response: row.response as Record<string, unknown>,   
      32            created_at: iso(row.created_at),
      33          }
      34        : null;
  ⎿  Updated src\repositories\postgres\mock-gateway-repository.ts (+1 -1)
      24    claim_id: r.claim_id,
      25    template: r.template,
      26    channel: r.channel,
      27 -  recipient: r.recipient,                                      
      27 +  recipient: r.recipient as Record<string, unknown>,           
      28    subject: r.subject,
      29    body: r.body,
      30    sent_at: iso(r.sent_at),

● Repository đã qua typecheck; còn lại các chỗ test và demo đang dùng app.pool.
  Sửa chúng:

● Bash(python - <<'EOF'
      def edit(p, pairs):…)
  ⎿  async function main() {
       const keep = process.argv.includes('--keep');
       const schema = `tamper_demo_${new Date().toISOString().replace(/\D/g
     … +25 lines (ctrl+o to expand)
  ⎿  Updated tests\helpers\pg-schema.ts (+5 -0)
      37    clock: ManualClock;
      38    /** Connected as claims_app, like the CLI and API. */
      39    app: AppContext;
      40 +  /** Plain pg pool as claims_app, for checks of the runtime ro
         +le's privileges. */                                            
      41 +  appPool: pg.Pool;                                            
      42    /** Connected as claims_owner, for privileged checks and tamp
          ering. */
      43    owner: pg.Pool;
      44    /** Another app (e.g. a newer workflow version) on the same s
          chema; closed with the rest. */
     ...
      59      return app;
      60    };
      61    const app = await openApp(workflow ?? loadWorkflowFile(BASE_W
          ORKFLOW));
      62 +  const appPool = createPool(appUrl(), schema, 2);             
      63    const owner = createPool(ownerUrl(), schema, 2);
      64    return {
      65      schema,
      66      clock,
      67      app,
      68 +    appPool,                                                   
      69      owner,
      70      openApp,
      71      async close() {
      72        for (const a of apps) await a.close();
      73 +      await appPool.end();                                     
      74        // Audit tables reject TRUNCATE and DELETE, so a clean sl
          ate means dropping the schema.
      75        await owner.query(`DROP SCHEMA ${schema} CASCADE`);
      76        await owner.end();
  ⎿  Updated tests\integration\integrity.test.ts (+2 -2)
      50    });
      51  
      52    it('the runtime role has no UPDATE or DELETE privilege on the
           audit trail and claims', async () => {
      53 -    const app = db.app.pool;                                   
      53 +    const app = db.appPool;                                    
      54      await expect(app.query(`UPDATE audit_log SET reason = 'edit
          ed'`)).rejects.toMatchObject({
      55        code: '42501',
      56      });
     ...
      65    });
      66  
      67    it('a claim cannot change without its audit entry: the deferr
          ed check fails the commit', async () => {
      68 -    const client = await db.app.pool.connect();                
      68 +    const client = await db.appPool.connect();                 
      69      try {
      70        await client.query('BEGIN');
      71        await client.query(
  ⎿  Updated tests\integration\outbox.test.ts (+2 -2)
      64    it('a message whose worker died is taken again after the leas
          e expires', async () => {
      65      const claimNo = await d.submit();
      66      const claim = await d.services.queries.requireClaim(claimNo
          );
      67 -    const { outbox } = createPgRepositories(db.app.pool);      
      67 +    const { outbox } = createPgRepositories(db.app.dataSource.m
         +anager);                                                       
      68      const [leased] = await outbox.lease('crashed-worker', db.cl
          ock.now(), 30_000, 1);
      69      expect(leased?.claim_id).toBe(claim.id);
      70  
     ...
      123        (m) => m.effect_type === 'trigger_payment',
      124      );
      125      const ctx = {
      126 -      gateway: createPgRepositories(db.app.pool).mockGateway, 
      126 +      gateway: createPgRepositories(db.app.dataSource.manager)
          +.mockGateway,                                                 
      127        now: db.clock.now(),
      128        log: () => undefined,
      129      };

● Bash(python - <<'EOF'
      p='src/scenarios/tamper-demo.ts'…)
  ⎿  tsc exit 0
  ⎿  Updated src\scenarios\tamper-demo.ts (+5 -2)
      64    const clock = new ManualClock();
      65    const app = await createApp({ schema, clock });
      66    const owner = createPool(env.ownerUrl(), schema, 2);
      67 +  // Plain connections as the runtime role, to show what it may
         + not do behind the engine.                                     
      68 +  const runtime = createPool(env.databaseUrl(), schema, 2);    
      69    try {
      70      const s = new ScenarioRun({
      71        base: app,
     ...
       98          [claim.id],
       99        ),
      100      );
       99 -    await attempt('app role: DELETE FROM audit_log', () => app
          -.pool.query('DELETE FROM audit_log'));                        
      101 +    await attempt('app role: DELETE FROM audit_log', () => run
          +time.query('DELETE FROM audit_log'));                         
      102      await attempt('app role: UPDATE claims SET state', () =>
      101 -      app.pool.query(`UPDATE claims SET state = 'CLOSED', vers
          -ion = version + 1 WHERE id = $1`, [                           
      103 +      runtime.query(`UPDATE claims SET state = 'CLOSED', versi
          +on = version + 1 WHERE id = $1`, [                            
      104          claim.id,
      105        ]),
      106      );
     ...
      132        ),
      133      );
      134    } finally {
      135 +    await runtime.end();                                      
      136      await owner.end();
      137      await app.close();
      138      if (keep) say(pc.dim(`kept schema ${schema}`));

● Typecheck đã qua. Giờ thêm script db:migration:create. Mình thử chạy nó, xuất
  ra scratchpad để không tạo file trong repo.

  Ran 1 shell command (ctrl+o to expand)

● Script tạo migration chạy được. Có một lỗi của mình: timestamp 1761350400000
  là năm 2025, trong khi dự án làm ngày 2026-10-25. Đổi sang timestamp đúng
  ngày:

  Ran 1 shell command (ctrl+o to expand)

● Bash(mv src/infra/db/migrations/1761350400000-Init.ts
      src/infra/db/migrations/1792886400000-Init.ts && grep -rl "1761350400000"
      src tests | xargs sed -i 's/176135040…)
  ⎿  src/infra/db/migrations/1792886400000-Init.ts:88:export class Init1792
     886400000 implements MigrationInterface {
     src/infra/db/migrations/1792886400000-Init.ts:89:  name = 'Init1792886
     … +9 lines (ctrl+o to expand)
  ⎿  Updated package.json (+1 -0)
      14      "db:setup": "tsx scripts/db-setup.ts",
      15      "db:migrate": "tsx src/controllers/cli/index.ts db migrate"
          ,
      16      "db:seed": "tsx src/controllers/cli/index.ts db seed",
      17 +    "db:migration:create": "typeorm migration:create",         
      18      "demo:tamper": "tsx src/scenarios/tamper-demo.ts",
      19      "config:validate": "tsx src/controllers/cli/index.ts config
           validate",
      20      "config:schema": "tsx scripts/gen-json-schema.ts",
  ⎿  Updated src\infra\db\migrations\index.ts (+2 -2)
      1 -import { Init1761350400000 } from './1761350400000-Init';       
      1 +import { Init1792886400000 } from './1792886400000-Init';       
      2  
      3  /**
      4   * Every migration, oldest first. Migrations are append-only: ne
         ver edit one that has been
      5   * applied; add a new file (npm run db:migration:create) and lis
         t it here and in checksums.json.
      6   */
      7 -export const MIGRATIONS = [Init1761350400000];                  
      7 +export const MIGRATIONS = [Init1792886400000];                  
  ⎿  … 2 more files changed

● Giờ thêm luật typeorm vào test kiến trúc, viết test checksum cho migration, và
  test đối chiếu entity với schema thật.

● Update(tests\unit\architecture.test.ts)
  ⎿  Added 9 lines
      82      );
      83    });
      84  
      85 +  it('only the PostgreSQL repositories, migrations and the comp
         +osition root use TypeORM', () => {                             
      86 +    expect(                                                    
      87 +      violations(                                              
      88 +        /^(?!repositories\/postgres\/|infra\/db\/|bootstrap\.ts
         +$)/,                                                           
      89 +        (i) => i.specifier === 'typeorm' || i.specifier.startsW
         +ith('typeorm/'),                                               
      90 +      ),                                                       
      91 +    ).toEqual([]);                                             
      92 +  });                                                          
      93 +                                                               
      94    it('the engine only depends on itself and the domain types', 
          () => {
      95      expect(violations(/^engine\//, targets(/^(?!engine\/|domain
          \/)/))).toEqual([]);
      96    });

● Write(tests\unit\migrations.test.ts)
  ⎿  Wrote 37 lines to tests\unit\migrations.test.ts
       1 import { createHash } from 'node:crypto';
       2 import { readdirSync, readFileSync } from 'node:fs';
       3 import { fileURLToPath } from 'node:url';
       5 import { MIGRATIONS } from '../../src/infra/db/migrations/index'
         ;
       6
       7 const DIR = fileURLToPath(new URL('../../src/infra/db/migrations
       8 const FILE_RE = /^(\d{13})-(\w+)\.ts$/;
       9
      10 const files = readdirSync(DIR).filter((f) => FILE_RE.test(f));
     … +35 lines (ctrl+o to expand)

● Write(tests\integration\entities.test.ts)
  ⎿  Wrote 53 lines to tests\integration\entities.test.ts
       1 import { afterAll, beforeAll, describe, expect, it } from 'vites
         t';
         rs/pg-schema';
       3
       4 /** information_schema udt_name of each column type the entities
       5 const UDT: Record<string, string> = {
       6   text: 'text',
       7   integer: 'int4',
       9   smallint: 'int2',
      10   boolean: 'bool',
     … +50 lines (ctrl+o to expand)
● Bash(python - <<'EOF'
      p='tests/unit/migrations.test.ts'…)
  ⎿  Traceback (most recent call last):
       File "<stdin>", line 6, in <module>
     AssertionError: pattern
     … +6 lines (ctrl+o to expand)
  ⎿  Created src\infra\db\migrations\checksums.json (+3 -0)
      1 +{                                                               
      2 +  "1792886400000-Init.ts": "d50e42b763699c963d53b47c8277704840d1
        +4af067936fabbaed5b886b9974c6"                                   
      3 +}                                                               
  ⎿  Updated src\repositories\postgres\audit-repository.ts (+10 -2)
      42    }
      43  
      44    async insert(e: AuditEntry): Promise<void> {
      45 -    await this.repo.createQueryBuilder().insert().values({ ...e
         - }).updateEntity(false).execute();                             
      45 +    await this.repo                                            
      46 +      .createQueryBuilder()                                    
      47 +      .insert()                                                
      48 +      .values({ ...e })                                        
      49 +      .updateEntity(false)                                     
      50 +      .execute();                                              
      51    }
      52  
      53    async list(claimId: string): Promise<AuditEntry[]> {
      49 -    const rows = await this.repo.find({ where: { claim_id: clai
         -mId }, order: { claim_seq: 'ASC' } });                         
      54 +    const rows = await this.repo.find({                        
      55 +      where: { claim_id: claimId },                            
      56 +      order: { claim_seq: 'ASC' },                             
      57 +    });                                                        
      58      return rows.map(rowToEntry);
      59    }
      60  
  ⎿  Updated src\repositories\postgres\claim-repository.ts (+6 -1)
      46    }
      47  
      48    async insert(c: ClaimSnapshot): Promise<void> {
      49 -    await this.repo.createQueryBuilder().insert().values({ ...c
         - }).updateEntity(false).execute();                             
      49 +    await this.repo                                            
      50 +      .createQueryBuilder()                                    
      51 +      .insert()                                                
      52 +      .values({ ...c })                                        
      53 +      .updateEntity(false)                                     
      54 +      .execute();                                              
      55    }
      56  
      57    async update(c: ClaimSnapshot, expectedVersion: number): Prom
          ise<boolean> {
  ⎿  Updated src\repositories\postgres\definition-repository.ts (+1 -1)
      2  import type { DefinitionSummary, StoredDefinition } from '../../
         domain/types';
      3  import type { CompiledWorkflow } from '../../engine/load';
      4  import type { DefinitionRepository } from '../definition-reposit
         ory';
      5 -import { type DefinitionRow, DefinitionEntity } from './entities
        -';                                                              
      5 +import { DefinitionEntity, type DefinitionRow } from './entities
        +';                                                              
      6  import { iso } from './rows';
      7  
      8  const toDefinition = (r: DefinitionRow): StoredDefinition => ({
  ⎿  Updated src\repositories\postgres\idempotency-repository.ts (+6 -1)
      35    }
      36  
      37    async save(r: IdempotencyRecord): Promise<void> {
      38 -    await this.repo.createQueryBuilder().insert().values({ ...r
         - }).updateEntity(false).execute();                             
      38 +    await this.repo                                            
      39 +      .createQueryBuilder()                                    
      40 +      .insert()                                                
      41 +      .values({ ...r })                                        
      42 +      .updateEntity(false)                                     
      43 +      .execute();                                              
      44    }
      45  }

  Read 1 file (ctrl+o to expand)

● Update(tests\unit\migrations.test.ts)
  ⎿  Added 1 line, removed 1 line
       9  
      10  const files = readdirSync(DIR).filter((f) => FILE_RE.test(f));
      11  const checksums: Record<string, string> = JSON.parse(
      12 -  readFileSync(new URL('checksums.json', `file:///${DIR.replace
         -All('\\', '/')}`), 'utf8'),                                    
      12 +  readFileSync(`${DIR}checksums.json`, 'utf8'),                
      13  );
      14  const sha256 = (file: string) =>
      15    createHash('sha256')

● Bash(npx biome check --write tests/unit/migrations.test.ts 2>&1 | tail -1; npm
      run typecheck 2>&1 | tail -3; echo "tc=${PIPESTATUS[0]}"; npm run lint
      2>&1 | tail -3;…)
  ⎿  Checked 1 file in 6ms. Fixed 1 file.
     > claims-workflow-orchestrator@0.1.0 typecheck
     > tsc -p tsconfig.json && tsc -p web/tsconfig.json
     … +7 lines (ctrl+o to expand)
  ⎿  Updated tests\unit\migrations.test.ts (+1 -3)
       8  const FILE_RE = /^(\d{13})-(\w+)\.ts$/;
       9  
      10  const files = readdirSync(DIR).filter((f) => FILE_RE.test(f));
      11 -const checksums: Record<string, string> = JSON.parse(          
      12 -  readFileSync(`${DIR}checksums.json`, 'utf8'),                
      13 -);                                                             
      11 +const checksums: Record<string, string> = JSON.parse(readFileSy
         +nc(`${DIR}checksums.json`, 'utf8'));                           
      12  const sha256 = (file: string) =>
      13    createHash('sha256')
      14      .update(readFileSync(`${DIR}${file}`, 'utf8').replace(/\r\n
          /g, '\n'))

● Typecheck, lint và 69 unit test đều pass, bao gồm test checksum migration và
  luật typeorm mới. Vì chưa có DB thật, tôi sẽ viết thêm smoke test offline:
  dựng metadata TypeORM, giả connection bằng client chỉ ghi SQL, rồi gọi các
  method repository để kiểm tra SQL sinh ra có đúng không.

  Made 1 scratchpad edit +135, searched for 1 pattern, read 1 file, ran 3 shell commands (ctrl+o to expand)

● Smoke test offline chạy ổn, lỗi duy nhất là do dữ liệu giả trong script (regex
  sai payments), không phải do code. Giờ mình sẽ đọc SQL do TypeORM sinh ra để
  so sánh với SQL cũ.

  Ran 1 shell command (ctrl+o to expand)

● SQL sinh ra đúng mong đợi: lease có FOR UPDATE SKIP LOCKED, insert dùng ON
  CONFLICT DO NOTHING RETURNING, các biểu thức CASE/coalesce/attempts+1 được giữ
  nguyên và object truyền vào không bị thay đổi. Tiếp theo tôi sẽ kiểm tra các
  câu bị cắt dòng (lock, filter/limit) và phần DDL của migration.

  Ran 2 shell commands (ctrl+o to expand)

● Migration DDL khớp với 001_init.sql về tên constraint, cột identity, partial
  index, trigger và GRANT, còn bảng không ghi schema vẫn resolve qua search_path
  như dự đoán. Giờ tôi sẽ kiểm tra câu CREATE TABLE đầy đủ của claims/outbox để
  xác nhận phần FK chính xác.

  Ran 1 shell command (ctrl+o to expand)

● DDL khớp với 001_init.sql, kể cả tên constraint và FK. Giờ cập nhật docs, bắt
  đầu với CLAUDE.md.

  Read 1 file (ctrl+o to expand)

● Update(CLAUDE.md)
  ⎿  Added 1 line
      15  - `npm run cli -- <command>` — CLI (`config validate`, `show`, 
          `run`, `audit`, `verify`, …)
      16  - `npm run scenarios -- --write` — runs the demo scenarios and 
          writes `docs/results/`
      17  - `npm run db:setup` (once), `npm run db:migrate`, `npm run db:
          seed`
      18 +- `npm run db:migration:create -- src/infra/db/migrations/<Name
         +>` — scaffolds a TypeORM migration                             
      19  
      20  ## Architecture rules
      21  

● Update(CLAUDE.md)
  ⎿  Added 8 lines, removed 2 lines
      30    - **Services** (`src/services`): all logic. Data access only 
          through repository interfaces;
      31      transactions through `UnitOfWork.transaction`. Never import
           `pg`, `infra/db` or
      32      `repositories/postgres`.
      33 -  - **Repositories**: interfaces in `src/repositories/*.ts`, Po
         -stgreSQL implementations in                                    
      34 -    `src/repositories/postgres/`, the only place with SQL besid
         -es migrations.                                                 
      33 +  - **Repositories**: interfaces in `src/repositories/*.ts`; im
         +plementations in                                               
      34 +    `src/repositories/postgres/` use TypeORM (`EntitySchema` in
         + `entities.ts`, no decorators:                                 
      35 +    tsx/esbuild emit no decorator metadata). Use repositories a
         +nd query builders, not                                         
      36 +    `manager.query`. The only SQL fragments are what TypeORM ha
         +s no API for, each commented:                                  
      37 +    `nextval`, advisory locks, `pg_notify`, LISTEN, and express
         +ions such as `attempts + 1` in                                 
      38 +    `.set()`. Inserts and updates pass `.updateEntity(false)` s
         +o TypeORM never writes generated                               
      39 +    values back into domain objects (that would change hashes a
         +nd API output).                                                
      40 +  - `typeorm` may only be imported in `repositories/postgres`, 
         +`infra/db` and `bootstrap.ts`.                                 
      41  - `src/engine` is pure: no I/O, no `Date.now()`, no randomness.
           Time and ids are injected.
      42  - Never add workflow-specific behaviour (state names, transitio
          n ids, roles) to TypeScript.
      43    If a new behaviour is needed, add a generic condition/effect 
          primitive and use it from config.

● Update(CLAUDE.md)
  ⎿  Added 7 lines, removed 2 lines
      53    use camelCase.
      54  - Money is an integer number of VND. Timestamps are ISO-8601 UT
          C strings with millisecond
      55    precision, generated by the injected clock (never `now()` in 
          SQL for hashed values).
      56 -- Migrations in `src/infra/db/migrations` are append-only: neve
         -r edit an applied file                                         
      57 -  (the runner verifies checksums). Add a new numbered file inst
         -ead.                                                           
      56 +- Migrations are TypeORM migration classes in `src/infra/db/mig
         +rations`, written by hand with the                             
      57 +  `QueryRunner` schema API (`Table`, `TableCheck`, …; name ever
         +y constraint) and SQL only for what                            
      58 +  it lacks (functions, triggers, grants). They are append-only:
         + never edit an applied file, add a                             
      59 +  new one, register it in `migrations/index.ts` and its sha256 
         +in `migrations/checksums.json`                                 
      60 +  (`tests/unit/migrations.test.ts` fails otherwise). Scaffolded
         + files must switch to                                          
      61 +  `import type`. Never use `typeorm migration:generate`: entiti
         +es declare only columns, so it                                 
      62 +  would propose dropping checks, indexes and triggers.         
      63  - Audit tables are append-only (DB triggers). Tests that need a
           clean slate drop their schema.
      64  
      65  ## Environment

  Ran 1 shell command (ctrl+o to expand)

● Bash(python - <<'EOF'
      def edit(p, pairs):…)
  ⎿  151:src/repositories/  repository interfaces and UnitOfWork; postgres/
      holds the SQL implementations
     152:src/infra/         database pool, migrations, environment, seed fi
     le
  ⎿  Updated README.md (+2 -1)
      135  - **Transactional outbox**: at-least-once delivery with idempo
           tent handlers, `SKIP LOCKED` leases,
      136    exponential backoff, `DEAD` messages, and `LISTEN/NOTIFY`. T
           he CLI never waits for side effects.
      137  
      138 -Stack: TypeScript (strict, ESM) on Node.js, PostgreSQL with `p
          -g` and hand-written SQL, Zod,                                 
      138 +Stack: TypeScript (strict, ESM) on Node.js, PostgreSQL through
          + TypeORM (`EntitySchema`                                      
      139 +repositories and TypeORM migrations), Zod,                    
      140  `yaml`, RFC 8785 canonical JSON, `fast-json-patch`, commander 
           and @clack/prompts for the CLI,
      141  Fastify for the API, React with TanStack Query, Tailwind and M
           ermaid for the web UI, Vitest and
      142  Biome.
  ⎿  Updated docs\design.md (+5 -2)
      158  
      159  ## Database guarantees
      160  
      161 -The schema ([`001_init.sql`](../src/infra/db/migrations/001_in
          -it.sql)) enforces what the                                    
      161 +The schema ([`Init` migration](../src/infra/db/migrations/1792
          +886400000-Init.ts)) enforces what the                         
      162  application promises, so a bug or a manual query cannot silent
           ly break it:
      163  
      164  - **Append-only tables.** `audit_log`, `denied_attempts` and `
           workflow_definitions` reject
     ...
      172  - Types and CHECKs everywhere: money as `bigint` below 2^53 (e
           xact in JavaScript), JSONB columns
      173    must be objects or arrays, hash formats, claim number format
           , outbox status and lease
      174    consistency. A generated `assessor_id` column and partial in
           dexes serve the work queues.
      175 -- Migrations are append-only; the runner stores checksums and 
          -refuses an edited migration.                                  
      175 +- Migrations are TypeORM migration classes, written by hand (t
          +ables, keys, checks and indexes                               
      176 +  through TypeORM's schema API with explicit names; functions,
          + triggers and grants in SQL). They                            
      177 +  are append-only: `tests/unit/migrations.test.ts` pins the ch
          +ecksum of every migration file, so                            
      178 +  an edited migration fails CI.                               
      179  
      180  ## Tamper evidence
      181  

● Bash(sed -i 's#^src/repositories/  repository interfaces and UnitOfWork;
      postgres/ holds the SQL implementations#src/repositories/  repository
      interfaces and UnitOfW…)
  ⎿  src/services/      claim commands and queries, workflow versions, oper
     ations, outbox worker and handlers, verify
     src/repositories/  repository interfaces and UnitOfWork; postgres/ hol
     … +10 lines (ctrl+o to expand)
  ⎿  Updated README.md (+2 -2)
      148  src/engine/        schema, loader, validator, conditions, effe
           cts, templates, evaluation, Mermaid
      149  src/controllers/   cli/ (commands, rendering, interactive mode
           ), http/ (Fastify routes, RFC 9457 problem details)
      150  src/services/      claim commands and queries, workflow versio
           ns, operations, outbox worker and handlers, verify
      151 -src/repositories/  repository interfaces and UnitOfWork; postg
          -res/ holds the SQL implementations                            
      152 -src/infra/         database pool, migrations, environment, see
          -d file                                                        
      151 +src/repositories/  repository interfaces and UnitOfWork; postg
          +res/ holds the TypeORM entities and implementations           
      152 +src/infra/         TypeORM migrations, plain pg pool for scrip
          +ts and tests, environment, seed file                          
      153  src/bootstrap.ts   composition root: wires the PostgreSQL repo
           sitories into the services
      154  src/scenarios/     scenario runner and report writer, tamper d
           emo
      155  web/               React UI

● Bash(sed -n 33,37p docs/design.md && python - <<'EOF'
      p='docs/design.md'…)
  ⎿    side effects.
     - **Repositories** (`src/repositories`): the interfaces services use f
     or every query, plus a
     … +11 lines (ctrl+o to expand)
  ⎿  Updated docs\design.md (+4 -3)
      14    scenarios[Scenario runner<br/>src/scenarios] --> services
      15    services[Services<br/>ClaimService, ClaimQueryService,<br/>Wo
          rkflowService, OperationsService,<br/>outbox worker] --> engine
          [Engine<br/>pure functions]
      16    services --> repos[Repository interfaces<br/>src/repositories
          ]
      17 -  pg[PostgreSQL repositories<br/>src/repositories/postgres] -. 
         -implements .-> repos                                           
      17 +  pg[TypeORM repositories<br/>src/repositories/postgres] -. imp
         +lements .-> repos                                              
      18    boot[Composition root<br/>src/bootstrap.ts] -. wires .-> pg
      19    config[(config/workflow.yaml)] --> engine
      20  ```
     ...
      32    exposes reference data, the outbox and the mocks; the outbox 
          worker and its handlers deliver
      33    side effects.
      34  - **Repositories** (`src/repositories`): the interfaces service
          s use for every query, plus a
      35 -  `UnitOfWork` for transactions. The PostgreSQL implementations
         - (`src/repositories/postgres`) hold                            
      36 -  all the SQL apart from the migrations in `src/infra/db`.     
      35 +  `UnitOfWork` for transactions. The PostgreSQL implementations
         + (`src/repositories/postgres`) use                             
      36 +  TypeORM: `EntitySchema` mappings, repositories and query buil
         +ders, with SQL fragments only where                            
      37 +  TypeORM has no API (sequences, advisory locks, NOTIFY/LISTEN)
         +.                                                              
      38  
      39  Dependencies point one way (controllers → services → repository
           interfaces), and only
      40  `src/bootstrap.ts` knows the PostgreSQL implementations, so the
           engine's unit tests run without a

● Docs xong. Chạy lại toàn bộ kiểm tra tĩnh, bước so CLI không cần DB, và tìm
  chỗ còn sót tham chiếu cũ.

  Ran 2 shell commands (ctrl+o to expand)

● Đã chuyển xong sang TypeORM 1.1.2 (khai báo bảng bằng EntitySchema, không dùng
  decorator) và migration của TypeORM, đang nằm trên nhánh
  refactor/layered-architecture, chưa commit. Phần cần DB thì vẫn chưa kiểm tra
  được: .env vẫn chỉ có password mẫu, nên cả bốn URL đều bị 28P01.

  Đã làm:
  - Repository: 9 repository trong src/repositories/postgres/ giờ dùng
    repository và QueryBuilder của TypeORM. Bảng được khai báo trong entities.ts
    (src/repositories/postgres/entities.ts). Interface, service và controller
    không đổi.
  - Raw SQL còn lại: chỉ những chỗ TypeORM không có API, chỗ nào cũng có
    comment:
    - nextval, advisory lock, pg_notify, LISTEN;
    - vài biểu thức trong .set(): attempts + 1, CASE …, coalesce.
  - Migration: 1792886400000-Init.ts
    (src/infra/db/migrations/1792886400000-Init.ts) thay cho 001_init.sql.
    - Bảng, constraint và index dùng Table API, đặt tên trùng tên cũ; function,
      trigger và GRANT vẫn là SQL.
    - Schema do runner cũ tạo (có schema_migrations) sẽ được nhận luôn, không
      phải reset.
    - Runner checksum cũ bị bỏ, thay bằng migrations.test.ts
      (tests/unit/migrations.test.ts) so với checksums.json.
  - Test mới: luật kiến trúc cho typeorm; entities.test.ts
    (tests/integration/entities.test.ts) đối chiếu cột của entity với schema
    thật (test này cần DB).
  - Script mới: npm run db:migration:create. Đã cập nhật CLAUDE.md,
    docs/design.md và README.

  Đã kiểm tra:
  - typecheck, lint, 69/69 unit test, build:web đều qua.
  - Output các lệnh CLI không cần DB vẫn giống hệt code gốc.
  - Smoke test offline: dựng metadata TypeORM với một connection giả chỉ ghi lại
    SQL, rồi gọi mọi method repository và migration. SQL sinh ra đúng ý:
    - FOR UPDATE khi lock claim, FOR UPDATE SKIP LOCKED khi lease outbox, ON
      CONFLICT DO NOTHING RETURNING;
    - DDL có đúng tên constraint, cột identity/GENERATED và partial index;
    - insert không thêm field lạ vào object truyền vào. Điểm này quan trọng:
      TypeORM mặc định gán id trả về ngược vào object, sẽ làm đổi output API;
      mình đã tắt bằng updateEntity(false).

  Thay đổi có chủ đích:
  - Output của db migrate giờ ghi tên migration là Init1792886400000 thay vì
    001_init.
  - Schema có thêm bảng migrations và typeorm_metadata; TypeORM cần bảng sau cho
    cột GENERATED.

  Còn treo, cần DB: integration test, so pg_dump -s giữa schema cũ và mới, so
  kết quả scenario từng byte với baseline, thử nhận schema cũ trên dev DB, và
  demo:tamper. Bạn điền password thật vào .env rồi báo mình, mình sẽ chạy hết
  các bước này.