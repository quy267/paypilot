# PayPilot

> Trợ lý AI cho đội vận hành thanh toán: tự gom giao dịch lỗi/nghi ngờ vào một chỗ → phân tích nguyên nhân (kèm bằng chứng và mức độ tin cậy) → đề xuất cách xử lý → nhân viên duyệt ngay trên màn hình.

Đây là project cho khóa **Agentic Vibe Coding**. Tài liệu này kiêm bản mô tả yêu cầu (PRD) 1 trang để định hướng khi viết code.

## Vấn đề & cho ai

Khi một giao dịch thanh toán lỗi hoặc nghi ngờ, đội vận hành thường phải chờ đội kỹ thuật hoặc đội dữ liệu tra cứu giúp, xử lý chậm và khó truy nguyên. **PayPilot** dành cho **nhân viên vận hành thanh toán**: giúp họ tự xử lý sự cố nhanh và đáng tin cậy, không cần biết truy vấn cơ sở dữ liệu.

## Phạm vi bản tối thiểu (MVP) — giữ nhỏ, làm xong được trong khóa

Một luồng hoàn chỉnh, **một loại lỗi → một hành động → một lượt duyệt**:

1. Nạp sẵn vài giao dịch lỗi/nghi ngờ làm dữ liệu mẫu (xem `seed.sql`).
2. AI **phân loại và xếp ưu tiên** (cái nào nghiêm trọng, xử trước).
3. AI tìm **nguyên nhân gốc** và hiển thị **bằng chứng** (giao dịch nào, trường dữ liệu nào, mức độ tin cậy).
4. AI soạn sẵn **một đề xuất xử lý** (thử lại / chuyển cấp trên / hoàn tiền).
5. Nhân viên **duyệt hoặc từ chối** ngay trên màn hình, xem được quá trình AI suy luận.
6. **Ghi lại kết quả** (ai duyệt, lý do, thời điểm).

Có đăng nhập (1 tài khoản). Bộ kiểm thử chất lượng AI ≥ 10 tình huống, đo độ chính xác khi phân loại và khi gọi công cụ. Triển khai chạy thật trên `*.workers.dev`.

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

## Công nghệ dự kiến

- **Ưu tiên Cloudflare:** Workers (chạy code), Durable Objects (lưu trí nhớ hội thoại), D1 (cơ sở dữ liệu giao dịch), AI Gateway (giám sát + lưu đệm lời gọi AI), Queues (xử lý việc nặng), và TanStack Start cho giao diện cập nhật trực tiếp.
- **Phương án thay thế** nếu khóa yêu cầu công nghệ phổ thông hơn: Next.js + Supabase (Postgres) + Vercel AI SDK — giữ nguyên phần xử lý AI, công cụ và kiểm thử. *(Chờ mentor chốt.)*

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

Token: Cloudflare dashboard → My Profile → API Tokens → Create Token → quyền **Workers AI: Read** (phạm vi Account).

Mỗi tình huống đo: có gọi `proposeResolution` không, đúng giao dịch không, hành động (`RETRY`/`ESCALATE`/`REFUND`) có nằm trong tập kỳ vọng không, có chain tool (`getTransaction` → `proposeResolution`) không, và luật `REFUND` chỉ cho `FLAGGED` có được tôn trọng không. In ra % chính xác. *(Model thật nên % có thể dao động nhẹ giữa các lần chạy.)*

## Trạng thái

Đang đăng ký khóa **Agentic Vibe Coding**. Repo này hiện chứa schema + dữ liệu mẫu + bản mô tả yêu cầu; phần code MVP sẽ được xây trong khóa (sau khi mentor chốt công nghệ).
