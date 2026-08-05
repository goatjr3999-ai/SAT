-- ============================================
--  SCHEMA CHO SAT WEBSITE (PostgreSQL)
-- ============================================

-- (TÙY CHỌN) Nếu muốn xóa sạch mọi thứ rồi tạo lại, bỏ comment các dòng dưới:
-- DROP TABLE IF EXISTS user_activity CASCADE;
-- DROP TABLE IF EXISTS test_history CASCADE;
-- DROP TABLE IF EXISTS test_progress CASCADE;
-- DROP TABLE IF EXISTS devices CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;
-- DROP TABLE IF EXISTS exam_plans CASCADE;
-- DROP TABLE IF EXISTS study_plan_tasks CASCADE;

-- =======================
-- BẢNG USERS
-- =======================
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  email VARCHAR(255),
  google_id VARCHAR(255)
);
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_pro INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_name VARCHAR(255);
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pro_expires_at TIMESTAMP;
-- =======================
-- BẢNG LỚP HỌC
-- =======================
CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id);

  CREATE TABLE IF NOT EXISTS user_classes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, class_id)
);

INSERT INTO user_classes (user_id, class_id)
SELECT id, class_id
FROM users
WHERE class_id IS NOT NULL
ON CONFLICT (user_id, class_id) DO NOTHING;

-- =======================
-- BẢNG GIAO BÀI THEO LỚP
-- =======================
CREATE TABLE IF NOT EXISTS class_assignments (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  test_file VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_class_assignment UNIQUE (class_id, test_file)
);
-- =======================
-- BẢNG DEVICES
-- (quản lý thiết bị, duyệt thiết bị)
-- =======================
CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token VARCHAR(255) NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at_vn VARCHAR(50),
  CONSTRAINT uq_devices_user_device UNIQUE (user_id, device_token)
);

-- =======================
-- BẢNG TEST_PROGRESS
-- (lưu trạng thái đang làm dở)
-- =======================
CREATE TABLE IF NOT EXISTS test_progress (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_file VARCHAR(255) NOT NULL,
  answers TEXT,
  review_list TEXT,
  current_index INTEGER DEFAULT 0,
  remaining_time INTEGER,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_test_progress_user_test UNIQUE (user_id, test_file)
);
ALTER TABLE test_progress
  ADD COLUMN IF NOT EXISTS highlights TEXT;
ALTER TABLE test_progress
  ADD COLUMN IF NOT EXISTS eliminated_choices TEXT;

-- =======================
-- BẢNG TEST_HISTORY
-- (lưu lịch sử mỗi lần nộp bài)
-- =======================
CREATE TABLE IF NOT EXISTS test_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_file VARCHAR(255) NOT NULL,
  score INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  taken_at VARCHAR(50),
  answers_json TEXT NOT NULL
);

-- =======================
-- BẢNG USER_ACTIVITY
-- (heatmap: mỗi ngày giải bao nhiêu câu)
-- =======================
CREATE TABLE IF NOT EXISTS user_activity (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  problems_solved INTEGER NOT NULL,
  CONSTRAINT uq_user_activity_user_date UNIQUE (user_id, date)
);

-- =======================
-- BẢNG KẾ HOẠCH LUYỆN TẬP (PRO)
-- =======================
CREATE TABLE IF NOT EXISTS exam_plans (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_exam_plans_user UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS study_plan_tasks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_date DATE NOT NULL,
  test_file VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_study_plan UNIQUE (user_id, task_date, test_file)
);

-- =======================
-- BẢNG THÔNG BÁO TRANG CHỦ
-- =======================
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =======================
-- BẢNG AI EXPLANATIONS (cache giải thích theo đề/câu hỏi)
-- =======================
CREATE TABLE IF NOT EXISTS ai_explanations (
  id SERIAL PRIMARY KEY,
  test_file VARCHAR(255) NOT NULL,
  question_id INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  model VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_ai_explanations UNIQUE (test_file, question_id)
);

-- =======================
-- BẢNG ĐỀ PRO ĐƯỢC MỞ CHO TẤT CẢ
-- =======================
CREATE TABLE IF NOT EXISTS pro_free_tests (
  id SERIAL PRIMARY KEY,
  test_file VARCHAR(255) UNIQUE NOT NULL,
  category VARCHAR(50) NOT NULL,
  access_level VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (access_level IN ('admin', 'pro', 'all')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE pro_free_tests
  ADD COLUMN IF NOT EXISTS access_level VARCHAR(20);

UPDATE pro_free_tests
SET access_level = 'all'
WHERE access_level IS NULL;

ALTER TABLE pro_free_tests
  ALTER COLUMN access_level SET DEFAULT 'all';

ALTER TABLE pro_free_tests
  ALTER COLUMN access_level SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pro_free_tests_access_level_check'
  ) THEN
    ALTER TABLE pro_free_tests
      ADD CONSTRAINT pro_free_tests_access_level_check
      CHECK (access_level IN ('admin', 'pro', 'all'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_study_plan_user_date
  ON study_plan_tasks (user_id, task_date);

  -- =======================
-- BẢNG DEADLINE ĐỀ THEO LỚP
-- =======================
CREATE TABLE IF NOT EXISTS class_test_deadlines (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  test_file VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  deadline DATE NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_class_test_deadline UNIQUE (class_id, test_file)
);

-- =======================
-- (TÙY CHỌN) TẠO 1 ADMIN MẶC ĐỊNH
-- username: admin / password: admin123
-- =======================
INSERT INTO users (username, password, is_admin)
VALUES ('admin', 'admin123', 1)
ON CONFLICT (username) DO NOTHING;

-- =======================
-- BẢNG PAYMENT_INTENTS
-- (lưu nội dung chuyển khoản để auto cấp Pro)
-- =======================
CREATE TABLE IF NOT EXISTS payment_intents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(32) UNIQUE NOT NULL,
  amount INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  transaction_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP
);

-- =======================
-- BẢNG LOG THANH TOÁN TỪ GOOGLE SHEET
-- (tránh xử lý trùng giao dịch)
-- =======================
CREATE TABLE IF NOT EXISTS sheet_payment_events (
  id SERIAL PRIMARY KEY,
  transaction_code VARCHAR(255) UNIQUE NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255),
  amount INTEGER,
  transaction_at TIMESTAMP,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =======================
-- BẢNG ERROR LOG CHO KHO CÂU SAI
-- (lưu ghi chú theo user + đề + câu)
-- =======================
CREATE TABLE IF NOT EXISTS wrong_answer_error_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_file VARCHAR(255) NOT NULL,
  question_id INTEGER NOT NULL,
  log_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_wrong_answer_error_logs UNIQUE (user_id, test_file, question_id)
);
-- =======================
-- BẢNG USER_SESSIONS
-- (lưu session để không bị mất khi restart server)
-- =======================
CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR(255) PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expire
  ON user_sessions (expire);
  