# PayPilot

> Trợ lý AI cho đội vận hành thanh toán: tự gom giao dịch lỗi/nghi ngờ vào một chỗ → phân tích nguyên nhân (kèm bằng chứng và mức độ tin cậy) → đề xuất cách xử lý → nhân viên duyệt ngay trên màn hình.

Bản chạy thật (demo) tại **https://paypilot.trongquy267.workers.dev** — cần tài khoản đăng nhập.

Đây là project cho khóa **Agentic Vibe Coding**. Tài liệu này kiêm bản mô tả yêu cầu (PRD) 1 trang để định hướng khi viết code.

## Vấn đề & cho ai

Khi một giao dịch thanh toán lỗi hoặc nghi ngờ, đội vận hành thường phải chờ đội kỹ thuật hoặc đội dữ liệu tra cứu giúp, xử lý chậm và khó truy nguyên. **PayPilot** dành cho **nhân viên vận hành thanh toán**: giúp họ tự xử lý sự cố nhanh và đáng tin cậy, không cần biết truy vấn cơ sở dữ liệu.

## Tính năng

- Engine chấm điểm ưu tiên minh bạch cho hàng đợi triage, kết hợp số tiền, tuổi/SLA, rủi ro và độ tự tin, kèm breakdown từng thành phần.
- Lọc, tìm kiếm, sắp xếp và phân trang inbox.
- Shell nhiều trang với sidebar điều hướng.
- Dashboard KPI và biểu đồ dùng dữ liệu từ `/api/stats`.
- Lịch sử quyết định và xuất CSV.
- Form thêm giao dịch thủ công, chỉ hỗ trợ VND.
- AI triage: nút "Xử lý bằng AI" chạy agent trên Workers AI (model Kimi), hiển thị trực tiếp quá trình agent gọi công cụ và suy luận, tạo đề xuất xử lý kèm bằng chứng + độ tin cậy để duyệt/từ chối ngay.
- Đăng nhập username/password + phân quyền 3 vai trò (admin/operator/viewer); admin có màn hình "Quản lý user" (chi tiết ở mục Authentication & roles bên dưới).

> **Lưu ý:** PayPilot hiện chỉ hỗ trợ giao dịch bằng VND.

## Phạm vi bản tối thiểu (MVP) — giữ nhỏ, làm xong được trong khóa

**Trạng thái: đã hoàn thành và đang chạy thật.**

Một luồng hoàn chỉnh, **một loại lỗi → một hành động → một lượt duyệt**:

1. Nạp sẵn vài giao dịch lỗi/nghi ngờ làm dữ liệu mẫu (xem `seed.sql`).
2. AI **phân loại và xếp ưu tiên** (cái nào nghiêm trọng, xử trước).
3. AI tìm **nguyên nhân gốc** và hiển thị **bằng chứng** (giao dịch nào, trường dữ liệu nào, mức độ tin cậy).
4. AI soạn sẵn **một đề xuất xử lý** (thử lại / chuyển cấp trên / hoàn tiền).
5. Nhân viên **duyệt hoặc từ chối** ngay trên màn hình, xem được quá trình AI suy luận.
6. **Ghi lại kết quả** (ai duyệt, lý do, thời điểm).

Có đăng nhập username/password với 3 vai trò — xem mục Authentication & roles (RBAC). Bộ kiểm thử chất lượng AI ≥ 10 tình huống, đo độ chính xác khi phân loại và khi gọi công cụ. Triển khai chạy thật trên `*.workers.dev`.

## Luồng chính

```
seed (giao dịch lỗi) → AI phân loại + xếp ưu tiên → bằng chứng + độ tin cậy
   → AI đề xuất hành động → nhân viên duyệt/từ chối → ghi log (resolutions)
```

## Mô hình dữ liệu

Hai bảng (chi tiết trong [`schema.sql`](schema.sql), dữ liệu mẫu trong [`seed.sql`](seed.sql)):

- **`transactions`** — nguồn giao dịch cho hộp xử lý lỗi: số tiền (số nguyên, đơn vị đồng), phương thức (`QR`/`CARD`/`SOFTPOS`), trạng thái (`SUCCESS`/`FAILED`/`FLAGGED`/`PENDING`), mã lỗi + lý do, mã tham chiếu cổng (`gateway_ref`) để AI dựng bằng chứng.
- **`resolutions`** — AI chẩn đoán + đề xuất hành động (`RETRY`/`ESCALATE`/`REFUND`) + mức tin cậy + bằng chứng (JSON); người duyệt + quyết định (`APPROVED`/`REJECTED`/`PENDING`) + lý do + thời điểm.

> `REFUND` chỉ dùng cho giao dịch đã ghi nhận tiền/`FLAGGED`, không dùng cho `FAILED`.

## Công nghệ

- **Cloudflare** Workers (serve app + API), Durable Object `TriageAgent` (agent + trí nhớ hội thoại), D1 (giao dịch + user), Workers AI (model Kimi/Moonshot cho agent triage).
- React 19 + Vite + Tailwind CSS v4 + shadcn/ui.
- Vitest (unit) + bộ eval chạy miniflare (xem mục Đánh giá AI).

_PRD ban đầu dự kiến dùng thêm AI Gateway, Queues, TanStack Start và có phương án thay thế Next.js + Supabase; bản MVP thực tế không dùng các phần này (AI Gateway đã thử nhưng gỡ ra vì làm hỏng tín hiệu kết thúc stream của chat)._

## Tái sử dụng

Xây dựa trên bản chạy thử đã triển khai thật **Agentic Copilot** (<https://agentic-copilot.trongquy267.workers.dev>): công cụ truy vấn D1, bộ nhớ hội thoại trên Durable Object, và cổng giám sát AI Gateway trở thành **bộ công cụ cho agent điều tra giao dịch**.

## Cách chạy schema + dữ liệu mẫu

Trên Cloudflare D1:

```bash
wrangler d1 execute <ten-db> --file=./schema.sql
wrangler d1 execute <ten-db> --file=./seed.sql
```

Kiểm thử nhanh tại máy bằng SQLite:

```bash
sqlite3 /tmp/paypilot.db ".read schema.sql" ".read seed.sql" \
  "SELECT status, COUNT(*) FROM transactions GROUP BY status;"
```

## Chạy local

```bash
npm install
npx wrangler login   # dev dùng remote bindings nên cần đăng nhập Cloudflare
npm run dev          # http://localhost:5173
```

**Lưu ý:** dev dùng chung D1 với production (remote bindings) — dữ liệu tạo ở local sẽ xuất hiện trên bản chạy thật.

Kiểm tra chất lượng bằng `npm run check` (format + lint + type) và `npm test`.

## Triển khai

Push lên nhánh `main` → Cloudflare Workers Builds tự build và deploy (Build command `npx vite build`, Deploy command `npx wrangler deploy`). Deploy thủ công khi cần: `npm run deploy`.

Nếu thay đổi cần schema mới, migrate D1 (`schema.sql`) **trước** khi push code — như mục Authentication & roles đã hướng dẫn.

## Authentication & roles (RBAC)

PayPilot có ba vai trò:

- **admin**: toàn quyền, bao gồm quản lý user.
- **operator**: triage, duyệt/từ chối, thêm giao dịch và xuất dữ liệu.
- **viewer**: chỉ xem và xuất dữ liệu.

Trước khi triển khai code mới, bảng `users` trong `schema.sql` phải tồn tại trên D1. Luôn migrate D1 **trước** khi deploy code:

```bash
npx wrangler d1 execute paypilot-db --remote --file schema.sql
```

Để bootstrap admin đầu tiên, chạy lệnh sau và nhập mật khẩu khi được hỏi; có thể đặt biến môi trường `PAYPILOT_ADMIN_PASSWORD` thay cho prompt. Script sẽ ghi câu lệnh INSERT vào một file `.sql` tạm:

```bash
node scripts/make-admin.mjs <username>
```

Sau đó chạy lệnh `npx wrangler d1 execute paypilot-db --remote --file <đường-dẫn-file-tạm>` mà script in ra. Khi lệnh thành công, xóa file tạm bằng lệnh `rm <đường-dẫn-file-tạm>` được in kèm vì file chứa password hash. Khi đã đăng nhập bằng admin, tạo thêm tài khoản operator hoặc viewer trong màn hình **Quản lý user**.

Mật khẩu được băm bằng PBKDF2 với 100.000 vòng lặp. Phiên đăng nhập chứa role đã ký trong cookie tiền tố `__Host-`, có thuộc tính HttpOnly, Secure, SameSite=Strict và thời hạn 7 ngày; role và trạng thái disabled vẫn được kiểm tra lại từ DB ở mỗi request. Hệ thống chủ đích chưa có MFA, lockout hoặc password policy. Xoay `OWNER_KEY` sẽ vô hiệu hóa toàn bộ session hiện có.

Giới hạn đã biết: guard bảo vệ admin cuối cùng không atomic khi có thao tác đồng thời. Nếu mất admin cuối cùng, khôi phục bằng `scripts/make-admin.mjs`.

## Đánh giá AI

Bộ đánh giá đo độ chính xác của model khi triage ≥ 10 tình huống dựa trên dữ liệu mẫu. Nó chạy **ngoài** Durable Object/WebSocket: dựng một D1 trong bộ nhớ (miniflare) từ `schema.sql` + `seed.sql`, rồi gọi đúng system prompt + bộ công cụ mà agent thật dùng (định nghĩa dùng chung trong `src/agent/triage-core.ts`).

```bash
npm run eval
```

Cần 2 dòng trong `.dev.vars` (đã git-ignore, không commit):

```
CLOUDFLARE_ACCOUNT_ID=<account id — lấy bằng: wrangler whoami>
CLOUDFLARE_API_TOKEN=<token quyền Workers AI Read>
```


Mỗi tình huống đo: có gọi `proposeResolution` không, đúng giao dịch không, hành động (`RETRY`/`ESCALATE`/`REFUND`) có nằm trong tập kỳ vọng không, có chain tool (`getTransaction` → `proposeResolution`) không, và luật `REFUND` chỉ cho `FLAGGED` có được tôn trọng không. In ra % chính xác. _(Model thật nên % có thể dao động nhẹ giữa các lần chạy.)_

## Trạng thái

MVP + đăng nhập/RBAC đã hoàn thành và đang chạy thật tại https://paypilot.trongquy267.workers.dev; chất lượng AI được đo bằng bộ eval ≥ 10 tình huống (`npm run eval`); tài liệu này đồng thời là bản PRD gốc của project trong khóa Agentic Vibe Coding.
