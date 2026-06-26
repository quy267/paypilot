-- PayPilot — Lược đồ cơ sở dữ liệu (D1 = SQLite)
--
-- Hai bảng đủ cho bản tối thiểu (MVP):
--   transactions — nguồn giao dịch lỗi/nghi ngờ để xử lý (hộp xử lý lỗi)
--   resolutions  — AI chẩn đoán + đề xuất, nhân viên duyệt, lịch sử xử lý
--
-- Lưu ý D1/SQLite: KHÔNG bật kiểm tra khóa ngoại (foreign key) mặc định —
-- ràng buộc quan hệ tự lo ở tầng code.
-- Tiền lưu theo đơn vị nhỏ nhất (đồng) bằng SỐ NGUYÊN, không dùng số thực để tránh sai số tiền.

-- Bảng giao dịch: nguồn dữ liệu cho hộp xử lý lỗi
CREATE TABLE transactions (
  id             TEXT PRIMARY KEY,           -- mã giao dịch (thực tế dùng UUID)
  merchant_id    TEXT NOT NULL,              -- mã cửa hàng/merchant
  gateway_ref    TEXT,                       -- mã tham chiếu bên cổng thanh toán (AI dùng để tra cứu + dựng bằng chứng)
  amount_minor   INTEGER NOT NULL,           -- tiền theo đơn vị nhỏ nhất (đồng), số nguyên
  currency       TEXT NOT NULL DEFAULT 'VND',
  method         TEXT NOT NULL CHECK (method IN ('QR','CARD','SOFTPOS')),
  status         TEXT NOT NULL CHECK (status IN ('SUCCESS','FAILED','FLAGGED','PENDING')),
  failure_code   TEXT,                       -- 'TIMEOUT' | 'INSUFFICIENT_FUNDS' | 'INVALID_QR'... (null nếu thành công)
  failure_reason TEXT,                       -- mô tả lỗi cho người đọc
  created_at     INTEGER NOT NULL            -- thời điểm (epoch giây)
);

-- Bảng xử lý: AI chẩn đoán + nhân viên duyệt (phần "ghi lại kết quả")
CREATE TABLE resolutions (
  id                TEXT PRIMARY KEY,
  transaction_id    TEXT NOT NULL REFERENCES transactions(id),
  ai_diagnosis      TEXT,                    -- AI giải thích nguyên nhân
  proposed_action   TEXT CHECK (proposed_action IN ('RETRY','ESCALATE','REFUND')),  -- REFUND chỉ cho giao dịch đã ghi nhận tiền/FLAGGED, KHÔNG dùng cho FAILED
  confidence        REAL CHECK (confidence BETWEEN 0 AND 1),  -- mức tin cậy (phục vụ minh bạch/niềm tin)
  evidence          TEXT,                    -- bằng chứng (JSON: trường nào, giá trị nào)
  operator_id       TEXT,                    -- ai là người duyệt
  operator_decision TEXT NOT NULL DEFAULT 'PENDING' CHECK (operator_decision IN ('APPROVED','REJECTED','PENDING')),
  operator_note     TEXT,                    -- vì sao duyệt/từ chối
  created_at        INTEGER NOT NULL,        -- thời điểm AI đề xuất
  decided_at        INTEGER                  -- thời điểm nhân viên quyết (null nếu chưa)
);

-- Chỉ mục (index): hộp xử lý luôn lọc theo trạng thái + sắp theo thời gian → tránh quét toàn bảng
CREATE INDEX idx_transactions_inbox      ON transactions(status, created_at);
CREATE INDEX idx_resolutions_transaction ON resolutions(transaction_id);
