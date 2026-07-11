-- PayPilot — Dữ liệu mẫu cho hộp xử lý giao dịch lỗi
--
-- Áp dụng SAU schema.sql. Bối cảnh thanh toán Việt Nam:
--   amount_minor = số đồng (số nguyên), currency = 'VND'
--   created_at   = epoch giây (cuối tháng 6/2026)
--   id giao dịch để dạng đọc được cho demo; hệ thống thật dùng UUID.
--
-- Phủ đủ trạng thái để AI có cái phân loại/xếp ưu tiên:
--   FAILED  x5 (nhiều mã lỗi khác nhau)
--   FLAGGED x3 (nghi ngờ: số tiền lớn bất thường, nghi trùng, giao dịch dồn dập)
--   PENDING x2 (kẹt chưa kết thúc)
--   SUCCESS x3 (để tương phản khi lọc inbox)
-- Users được bootstrap qua scripts/make-admin.mjs và quản lý trong ứng dụng.

INSERT INTO transactions
  (id, merchant_id, gateway_ref, amount_minor, currency, method, status, failure_code, failure_reason, created_at)
VALUES
  -- FAILED
  ('txn_0001', 'mc_coffee_hcm',   'GW-20260627-0001',     85000, 'VND', 'QR',      'FAILED',  'TIMEOUT',            'Cổng thanh toán quá thời gian chờ phản hồi',                 1782530100),
  ('txn_0002', 'mc_grocery_hn',   'GW-20260627-0002',    450000, 'VND', 'CARD',    'FAILED',  'INSUFFICIENT_FUNDS', 'Thẻ không đủ số dư',                                          1782531200),
  ('txn_0003', 'mc_coffee_hcm',   'GW-20260627-0003',     32000, 'VND', 'QR',      'FAILED',  'INVALID_QR',         'Mã QR hết hạn hoặc sai định dạng',                            1782532000),
  ('txn_0004', 'mc_fashion_dn',   'GW-20260627-0004',   1290000, 'VND', 'SOFTPOS', 'FAILED',  'GATEWAY_ERROR',      'Cổng trả về lỗi 5xx khi xác nhận',                            1782533500),
  ('txn_0005', 'mc_pharmacy_hcm', 'GW-20260627-0005',    219000, 'VND', 'SOFTPOS', 'FAILED',  'TIMEOUT',            'Hết thời gian chờ ở bước trừ tiền',                            1782534800),

  -- FLAGGED (nghi ngờ, cần soát)
  ('txn_0006', 'mc_electronics_hn','GW-20260627-0006',  52000000, 'VND', 'CARD',    'FLAGGED', 'FRAUD_SUSPECT',      'Số tiền lớn bất thường so với lịch sử cửa hàng',              1782535600),
  ('txn_0007', 'mc_grocery_hn',   'GW-20260627-0007',    450000, 'VND', 'QR',      'FLAGGED', 'DUPLICATE',          'Nghi trùng: cùng số tiền/cửa hàng trong vài giây',            1782531260),
  ('txn_0008', 'mc_coffee_hcm',   'GW-20260627-0008',     99000, 'VND', 'SOFTPOS', 'FLAGGED', 'VELOCITY',           'Nhiều giao dịch dồn dập từ một thiết bị',                      1782536400),

  -- PENDING (kẹt chưa kết thúc)
  ('txn_0009', 'mc_fashion_dn',   'GW-20260627-0009',    175000, 'VND', 'QR',      'PENDING', NULL,                 NULL,                                                          1782537000),
  ('txn_0010', 'mc_pharmacy_hcm', 'GW-20260627-0010',    640000, 'VND', 'CARD',    'PENDING', NULL,                 NULL,                                                          1782537600),

  -- SUCCESS (tương phản)
  ('txn_0011', 'mc_coffee_hcm',   'GW-20260627-0011',     85000, 'VND', 'QR',      'SUCCESS', NULL,                 NULL,                                                          1782529900),
  ('txn_0012', 'mc_grocery_hn',   'GW-20260627-0012',    120000, 'VND', 'SOFTPOS', 'SUCCESS', NULL,                 NULL,                                                          1782530500),
  ('txn_0013', 'mc_electronics_hn','GW-20260627-0013',   2300000, 'VND', 'CARD',    'SUCCESS', NULL,                 NULL,                                                          1782530800);

-- Hai dòng resolutions mẫu để minh hoạ vòng đời xử lý
INSERT INTO resolutions
  (id, transaction_id, ai_diagnosis, proposed_action, confidence, evidence, operator_id, operator_decision, operator_note, created_at, decided_at)
VALUES
  -- (A) AI vừa đề xuất, đang CHỜ nhân viên duyệt — giao dịch lỗi do quá thời gian chờ → thử lại
  ('res_0001', 'txn_0001',
   'Giao dịch lỗi do cổng quá thời gian chờ (TIMEOUT), không phải lỗi thẻ hay số dư. An toàn để thử lại.',
   'RETRY', 0.82,
   '{"transaction_id":"txn_0001","fields":["status","failure_code","gateway_ref"],"note":"failure_code=TIMEOUT; chưa ghi nhận trừ tiền ở GW-20260627-0001"}',
   NULL, 'PENDING', NULL,
   1782530200, NULL),

  -- (B) Nhân viên đã DUYỆT — giao dịch nghi trùng → hoàn tiền (REFUND chỉ áp dụng cho FLAGGED)
  ('res_0002', 'txn_0007',
   'Nghi giao dịch trùng: cùng cửa hàng và số tiền 450.000đ cách giao dịch txn_0002 vài giây. Đề xuất hoàn tiền cho lần trùng.',
   'REFUND', 0.88,
   '{"transaction_id":"txn_0007","fields":["merchant_id","amount_minor","created_at"],"note":"trùng amount_minor=450000 với txn_0002 trong ~60s"}',
   'op_minh', 'APPROVED', 'Đã đối chiếu log cổng, đúng là trùng — duyệt hoàn tiền.',
   1782531300, 1782538200);
