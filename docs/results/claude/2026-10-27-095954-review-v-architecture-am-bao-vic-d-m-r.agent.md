
> review về architecture đảm bảo việc dễ mở rộng, dễ tiếp cận, có thể code hiện
  tại sẽ là nền tảng để xây dựng 1 service trong kiến trúc microservice

● Mình sẽ đọc qua cấu trúc repo trước.

  Searched for 2 patterns, read 18 files, ran 1 shell command (ctrl+o to expand)

● Mình đã đọc xong engine, service, API, outbox và schema DB; đang kiểm tra thêm
  vài chỗ (hướng phụ thuộc giữa các lớp, CLI, test) rồi viết review.

  Searched for 7 patterns, read 2 files (ctrl+o to expand)

● Mình đã review kiến trúc theo ba tiêu chí bạn nêu: dễ mở rộng, dễ tiếp cận, và
  dùng làm nền cho một service trong hệ thống microservice. Kết luận: nền tảng
  rất tốt, nhưng chưa sẵn sàng làm microservice. Phần lõi gần như không phải
  sửa. Phần cần sửa là các "đường biên": hiện service tự giữ dữ liệu vốn thuộc
  service khác, giao tiếp với service khác qua mock, và tầng app gọi thẳng vào
  PostgreSQL.

  Điểm mạnh nên giữ nguyên

  - Engine thuần (engine.ts:657 (src/engine/engine.ts#L657)): evaluateTransition
    là hàm quyết định không có I/O, thời gian và id được truyền vào. Đây là
    phần quý nhất. Nó test được mà không cần DB, và có thể tách ra thành package
    dùng chung sau này.
  - Validator tĩnh chặn được vòng lặp vô hạn ngay khi đọc config, và kiểm tra
    kiểu cho mọi $path. Nhờ vậy mở rộng bằng config an toàn hơn nhiều so với
    viết code.
  - Mỗi transition chạy trong một transaction, kèm outbox, idempotency key và
    optimistic lock. Đây chính là các pattern cần có khi làm microservice, và đã
    được làm đúng.
  - Audit chuỗi HMAC, các bảng append-only có trigger, tách quyền
    claims_owner/claims_app. Phần tách quyền khớp sẵn với cách chạy migration
    bằng một Job riêng trên Kubernetes.
  - Pin phiên bản workflow theo hash: claim cũ tiếp tục chạy theo rule cũ. Nhờ
    vậy rolling deploy không làm hỏng claim đang chạy.
  - Tài liệu (design.md (docs/design.md), extending-the-workflow.md
    (docs/extending-the-workflow.md)) đã rất tốt cho người mới.

  Các vấn đề, theo mức ưu tiên

  P0: Bắt buộc sửa trước khi làm microservice

  1. Chưa có port: app gọi thẳng các hàm của infra.
  CLAUDE.md ghi "infra implements ports used by app", nhưng thực tế không có
  interface nào. claim-service.ts:13-38 (src/app/claim-service.ts#L13-L38)
  import trực tiếp các hàm repo dùng PostgreSQL và nhận pg.Pool. API cũng làm rò
  lớp này: routes.ts:175 (src/api/routes.ts#L175) truyền app.pool vào service,
  claim-service.ts:101 (src/app/claim-service.ts#L101) trả pool ra ngoài. Ngoài
  ra infra còn import ngược lên app (reference.ts:1
  (src/infra/repos/reference.ts#L1), worker.ts:3
  (src/infra/outbox/worker.ts#L3)).
  → Nên định nghĩa các port trong src/app/ports.ts:
  - UnitOfWork (transaction)
  - ClaimStore, AuditStore, OutboxStore
  - PolicyDirectory, UserDirectory

  Khi tách service, chỉ cần thay PolicyDirectory (đang đọc bảng local) bằng một
  HTTP client có cache, ClaimService không phải sửa. Nên chuyển Clock sang một
  module dùng chung để bỏ chiều import ngược.

  2. Service đang tự giữ dữ liệu vốn thuộc service khác.

  Dữ liệu: users, roles
  Hiện tại: Bảng local; danh tính lấy từ header X-User-Id (routes.ts:33
  (src/api/routes.ts#L33))
  Trong microservice: Identity Provider. Lấy actor và roles từ JWT;
  user_ref/has_role đi qua UserDirectory
  ────────────────────────────────────────
  Dữ liệu: policies
  Hiện tại: Bảng local, claims.policy_id REFERENCES policies (001_init.sql:55
  (src/infra/db/migrations/001_init.sql#L55))
  Trong microservice: Policy service. Bỏ FK, dùng bản sao đọc (read model) đồng
  bộ qua event, hoặc gọi đồng bộ qua một lớp chống nhiễm mô hình
  (anti-corruption layer)
  ────────────────────────────────────────
  Dữ liệu: mock_*
  Hiện tại: Nằm chung schema với bảng claims
  Trong microservice: Chuyển hẳn ra ngoài: Payment service và Notification
  service

  Lưu ý thêm: claim-service.ts:171 (src/app/claim-service.ts#L171) gọi loadUsers
  lấy toàn bộ bảng users ở mỗi request. Khi có Identity Provider thật, chỗ này
  phải đổi thành tra cứu theo id.

  3. Giao tiếp với service khác mới chỉ là mock, và chỉ đi một chiều.
  - Tập effect là danh sách đóng: notify | trigger_payment | log. Muốn thêm một
    loại effect phải sửa bốn chỗ: types.ts:106 (src/domain/types.ts#L106),
    engine.ts:42 (src/engine/engine.ts#L42), khối switch ở engine.ts:584-627
    (src/engine/engine.ts#L584-L627) và handlers.ts:71
    (src/infra/outbox/handlers.ts#L71).
    → Nên thêm một primitive chung emit_event { topic, payload }, có validator
    kiểm tra. Worker sẽ chuyển outbox sang message broker (Kafka, NATS hoặc
    RabbitMQ) thay vì gọi mock trực tiếp.
  - Nên phát một event claim.transitioned cho mỗi audit entry, để các service
    khác tự dựng read model. Envelope của event gồm:
    - event_id = entry_id
    - partition key = claim_id
    - claim_version để giữ thứ tự
    - config_hash
    - có thể theo chuẩn CloudEvents
  - Chưa có chiều vào. Kết quả thanh toán (gateway_ref) chỉ nằm trong
    outbox.result; muốn close_paid thì cần có người nhập
    payment.confirmation_ref.
    → Cần thêm bảng inbox để chống trùng event, cùng một phần config ánh xạ
    event vào transition (ví dụ on_event: payment.confirmed →
    record_payment_confirmation, chạy bằng tài khoản system). Cách này đúng quy
    tắc của CLAUDE.md: một primitive chung, không viết code riêng cho workflow.

  4. Xác thực (authentication). Việc này đã nằm trong mục Limitations của
  design.md, nhưng là điều kiện bắt buộc. Cần thêm một hook Fastify kiểm tra
  JWT. Ngoài ra, env.ts:36 (src/infra/env.ts#L36) đang dùng key dev khi thiếu
  AUDIT_HMAC_KEY, chỉ in cảnh báo. Ở môi trường production chỗ này phải dừng hẳn
  (fail fast), và key nên lấy từ KMS.

  P1: Độ tin cậy và vận hành

  5. Auto-advance chạy sau khi commit, trong một transaction riêng
     (claim-service.ts:244 (src/app/claim-service.ts#L244)). Nếu process chết
     đúng lúc giữa hai bước, claim sẽ đứng chờ cho tới lần scheduler chạy tiếp.
     → Nên ghi một message auto_advance vào outbox ngay trong transaction gốc,
     để tận dụng cơ chế retry sẵn có của outbox.
  6. Scheduler chưa chịu được nhiều replica. runSystem duyệt tuần tự tối đa 1000
     claim (claim-service.ts:341 (src/app/claim-service.ts#L341)). Nếu nhiều
     pod cùng chạy, mọi pod sẽ quét lại cùng một tập claim. Tương tự, verifyAll
     lấy tới 10_000 claim trong một lần.
     → Engine có thể tự tính next_check_at từ các điều kiện duration_elapsed
     (vẫn giữ được tính thuần) và lưu vào claim. Scheduler sau đó lease các
     claim đến hạn bằng SKIP LOCKED, giống cách outbox đang làm.
  7. Khả năng quan sát (observability) còn thiếu. Hiện có Fastify({ logger:
     false }), log bằng console.log, và chưa có correlation id, metrics hay
     tracing. /api/health không kiểm tra DB.
     → Cần:
     - log JSON bằng pino (Fastify có sẵn), không log body vì chứa PII
     - lưu traceparent vào dòng outbox để trace đi xuyên qua outbox
     - metrics: độ trễ outbox, số message DEAD, số lần bị từ chối theo mã lỗi
     - tách endpoint /livez và /readyz
  8. Chưa có bản build để deploy. tsconfig đang noEmit, server chạy bằng tsx, và
     chưa có Dockerfile.
     → Cần thêm một bước build (tsc hoặc tsup) và Dockerfile multi-stage. Có thể
     dùng ba entrypoint: api, worker, migrate-job. Hiện đã có --no-worker nên
     tách API và worker rất dễ.
  9. Hợp đồng API. Nên:
     - thêm tiền tố phiên bản /api/v1
     - sinh OpenAPI từ các schema zod
     - phân trang bằng cursor
     - If-Match ánh xạ sang expected_version

     Ngoài ra ?queue=1 đang bị N+1: mỗi claim lại gọi available(), và mỗi lần đó
     tải toàn bộ users và policy (routes.ts:158-162
     (src/api/routes.ts#L158-L162)).

  P2: Dễ mở rộng và dễ tiếp cận

  10. Thêm một condition primitive phải sửa bốn file: schema.ts, danh sách
      CONDITION_TYPES trong load.ts, conditions.ts và validate.ts. Nên gom thành
      một registry: mỗi primitive là một module gồm { schema, validate,
      evaluate, dependsOn }. Effect làm tương tự. Người mới chỉ cần đọc một file
      mẫu là thêm được primitive mới.
  11. ClaimService 452 dòng gom cả command, query lẫn verify. Nên tách thành
      ClaimCommands (act, autoAdvance), ClaimQueries và AuditVerifier.
  12. Mới chỉ có một workflow cho mỗi process (registry.current). Nếu muốn nhiều
      loại sản phẩm hoặc nhiều tenant, registry nên tra theo workflow_id, còn
      transition tạo claim thì chọn workflow. Các phần còn lại (pin theo hash)
      đã hỗ trợ sẵn.
  13. Engine vẫn còn vài giả định riêng cho claim:
      - các cột cố định policy_id/claim_type/claimed_amount (validate.ts:367
        (src/engine/validate.ts#L367))
      - documents_present đọc data.documents
      - recipient member
      - currency: 'VND'
      - cột sinh assessor_id

      Với một Claims service thì chấp nhận được. Chỉ nên làm engine tổng quát
      hơn khi có nhu cầu thật cho domain thứ hai. Tuy vậy, nên ghi rõ giới hạn
      này trong design.md để người sau không hiểu lầm engine là "generic".

  Lộ trình đề xuất

  1. Phase 1, refactor nội bộ, chưa đổi hành vi: port và adapter (mục 1), tách
     ClaimService (11), registry cho primitive (10). Bộ test hiện có đủ để làm
     lưới an toàn.
  2. Phase 2, đường biên service: JWT cùng UserDirectory và PolicyDirectory
     (2, 4), bỏ FK và đưa mock_* ra ngoài, emit_event cùng relay sang broker và
     inbox (3).
  3. Phase 3, vận hành: auto-advance qua outbox, scheduler có lease (5, 6),
     observability (7), Dockerfile và build (8), API v1 cùng OpenAPI (9).

  Bạn muốn mình bắt đầu từ đâu? Mình đề xuất Phase 1, mục 1 (ports), vì đây là
  thay đổi có đòn bẩy lớn nhất và rủi ro thấp nhất. Nếu cần, mình cũng có thể
  chuyển review này thành một trang để chia sẻ với team.

> nếu tôi muốn làm theo mô hình 3 lốp thì có lợi và hại gì

● Hiện tại code của bạn về cơ bản đã là 3 lớp. Vì vậy câu hỏi thực chất là: có
  nên giữ nguyên kiểu 3 lớp cổ điển không, hay áp dụng Dependency Inversion như
  mình đề xuất ở mục P0 #1 lần trước.

  Code hiện tại xếp vào 3 lớp như sau

  ┌──────────────┬──────────────────────────────────────┐
  │     Lớp      │           Thư mục hiện tại           │
  ├──────────────┼──────────────────────────────────────┤
  │ Presentation │ src/api, src/cli, web/               │
  ├──────────────┼──────────────────────────────────────┤
  │ Business     │ src/app (ClaimService) và src/engine │
  ├──────────────┼──────────────────────────────────────┤
  │ Data access  │ src/infra (repos, outbox, db)        │
  └──────────────┴──────────────────────────────────────┘

  Điểm đặc trưng của 3 lớp cổ điển là lớp Business gọi thẳng xuống lớp Data.
  Code đang làm đúng như vậy: claim-service.ts:13-38
  (src/app/claim-service.ts#L13-L38) import trực tiếp các repo PostgreSQL.

  Lợi ích

  - Dễ tiếp cận nhất. Hầu hết dev đã quen Controller → Service → Repository
    (giống NestJS, Spring). Người mới mở repo là biết ngay mỗi thứ nằm ở đâu.
  - Ít lớp trừu tượng. Không cần interface cho mọi repo. Ít file hơn, và "go to
    definition" dẫn thẳng tới câu SQL.
  - Hợp với đặc thù của service này. Các ràng buộc toàn vẹn nằm trong
    PostgreSQL: trigger, deferred constraint, SKIP LOCKED, advisory lock. Bạn sẽ
    không bao giờ đổi sang DB khác. Viết interface cho ClaimStore hay
    AuditStore chỉ để có thể thay DB là trừu tượng thừa.
  - Nhanh cho team nhỏ, và hợp với các phần thiên về CRUD như Operations, danh
    sách policy, user.

  Bất lợi trong bối cảnh service này

  1. Lớp Business phụ thuộc cứng vào lớp Data. Khi tách microservice, policy và
     user sẽ chuyển sang lấy từ service khác qua HTTP hoặc event. Với 3 lớp
     thuần, bạn phải sửa ClaimService để gọi HTTP client, hoặc nhét HTTP client
     vào "data layer". Cả hai cách đều làm lớp Data phình thành chỗ chứa mọi
     thứ.
  2. Không có chỗ tự nhiên cho các tích hợp. Mô hình 3 lớp coi tầng dưới cùng là
     DB. Trong khi đó microservice cần thêm: publish lên broker, inbox nhận
     event, Identity Provider, Payment service. Không có quy ước rõ ràng thì mỗi
     người sẽ đặt các thành phần này một chỗ.
  3. Dễ làm mất tính thuần của engine. Đây là rủi ro lớn nhất. Khi engine bị gộp
     chung vào lớp Business với Service, sớm muộn sẽ có người gọi repo,
     Date.now() hay HTTP ngay trong một rule "cho nhanh". Lúc đó mất cả ba thứ:
     - unit test không cần DB
     - khả năng replay và verify audit
     - decision context xác định (deterministic)
  4. Service dễ phình to. ClaimService đã 452 dòng, gom cả command, query lẫn
     verify. Mô hình 3 lớp không có cơ chế nào ngăn việc này.
  5. Transaction và kiểu pg lan lên trên. Service phải tự mở client rồi truyền
     cho từng repo. Hệ quả là API cũng bắt đầu đụng tới app.pool (routes.ts:175
     (src/api/routes.ts#L175)).
  6. Test Business khó hơn. Hoặc chạy với PostgreSQL thật, hoặc dùng vi.mock
     theo đường dẫn module, vốn dễ vỡ khi refactor.

  Khuyến nghị: 3 lớp thực dụng, đảo phụ thuộc chỉ ở đường biên

  Giữ 3 lớp làm cấu trúc chính để dễ tiếp cận, nhưng thêm hai luật:

  1. Engine là lõi bên trong lớp Business, và phải thuần. Áp luật này bằng lint
     rule: Biome noRestrictedImports cấm src/engine import infra, app, pg,
     node:*. Có luật bằng công cụ thì không phải trông vào việc người review
     nhớ.
  2. Chỉ dùng interface (port) cho những phụ thuộc sẽ trở thành service khác, cụ
     thể là PolicyDirectory, UserDirectory, EventPublisher/PaymentGateway. Các
     repo cho dữ liệu service tự sở hữu (claims, audit, outbox, idempotency) vẫn
     là hàm PostgreSQL cụ thể như hiện nay.

  Như vậy mình sửa lại đề xuất P0 #1 lần trước: không cần port cho mọi thứ, chỉ
  cần khoảng 3–4 interface ở đường biên. Bạn vẫn có sự đơn giản của 3 lớp, mà
  khi tách service chỉ cần đổi một adapter, không phải sửa ClaimService.

  Còn nếu ý bạn là 3 tầng vật lý (web, API server, DB), thì hệ thống cũng đã như
  vậy rồi. Muốn scale, chỉ cần tách worker và scheduler thành process riêng (đã
  có --no-worker).

  Bạn muốn mình áp dụng phương án này không? Mình sẽ bắt đầu bằng lint rule cho
  engine và ba port ở đường biên.