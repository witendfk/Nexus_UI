-- OrderOps 初始 schema（docs/SPEC.md §5）。时间一律存 ISO 8601 文本；金额为整数最小货币单位。

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  promised_at TEXT,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE logistics_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL
);
CREATE INDEX idx_logistics_events_order ON logistics_events(order_id);

CREATE TABLE anomaly_cases (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  type TEXT NOT NULL,
  -- 一次停滞区间一个 key：重复扫描命中同 key 即跳过建案（幂等靠唯一约束兜底）。
  occurrence_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  detected_at TEXT NOT NULL,
  last_event_id TEXT,
  UNIQUE (order_id, occurrence_key)
);
CREATE INDEX idx_anomaly_cases_status ON anomaly_cases(status, severity);

-- tickets.case_id 唯一 = 领域幂等（caseId + operationType）的数据库兜底。
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES anomaly_cases(id),
  order_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE action_attempts (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES anomaly_cases(id),
  operation TEXT NOT NULL,
  -- 客户端请求重放识别；NULL 表示无请求键（SQLite 唯一索引不约束 NULL）。
  request_key TEXT,
  status TEXT NOT NULL,
  result_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_action_attempts_request_key
  ON action_attempts(request_key) WHERE request_key IS NOT NULL;
CREATE INDEX idx_action_attempts_case ON action_attempts(case_id, operation);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES anomaly_cases(id),
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_events_case ON audit_events(case_id);

CREATE TABLE surface_bindings (
  surface_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES anomaly_cases(id),
  case_version INTEGER NOT NULL,
  catalog_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_surface_bindings_case ON surface_bindings(case_id);
