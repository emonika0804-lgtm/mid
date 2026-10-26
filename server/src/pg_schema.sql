-- ============================================================
-- PIL Cargo Claim & Survey Management Platform
-- PostgreSQL Database Schema
-- ============================================================

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agency',
  is_verified INTEGER NOT NULL DEFAULT 1,
  otp_code TEXT,
  reset_token TEXT
);

-- 2. CLAIMS
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  claim_number TEXT UNIQUE NOT NULL,
  cms_number TEXT,
  bl_number TEXT NOT NULL,
  shipper TEXT,
  consignee TEXT,
  notify_party TEXT,
  place_of_receipt TEXT,
  port_of_loading TEXT,
  port_of_discharge TEXT,
  place_of_delivery TEXT,
  vessel_code TEXT,
  vessel_name TEXT,
  vessel_voyage TEXT,
  commodity TEXT,
  container_number TEXT,
  container_size TEXT,
  seal_number TEXT,
  weight NUMERIC(15, 4),
  quantity NUMERIC(15, 4),
  package_type TEXT,
  discharge_date TEXT,
  port_of_landing_date TEXT,
  port_of_discharge_date TEXT,
  country TEXT,
  claim_amount NUMERIC(15, 4),
  claimant TEXT,
  claimant_type TEXT,
  status TEXT NOT NULL DEFAULT 'new_claim',
  awaiting_input_reason TEXT DEFAULT '',
  closed_reason TEXT DEFAULT '',
  court_case_status TEXT,
  court_case_file_reference TEXT,
  court_case_location TEXT,
  court_case_indicator TEXT,
  court_case_jurisdiction TEXT,
  court_case_chance_of_winning TEXT,
  court_case_file_attachment TEXT,
  court_case_attachment_comment TEXT,
  user_email TEXT,
  vendor_email TEXT,
  claims_handler TEXT,
  time_bar_date TEXT,
  last_action_date TEXT,
  acknowledged_date TEXT,
  sla_status TEXT DEFAULT 'green',
  survey_status TEXT DEFAULT 'none',
  survey_case_number TEXT,
  incident_description TEXT,
  date_of_incident TEXT,
  place_of_incident TEXT,
  cargo_type TEXT DEFAULT 'dry',
  nature_of_damage_category TEXT,
  nature_of_damage_type TEXT,
  nature_of_damage_dry TEXT,
  nature_of_damage_reefer TEXT,
  selected_containers TEXT DEFAULT '[]',
  containers_with_sizes TEXT DEFAULT '[]',
  policy_deductible_type TEXT,
  policy_pi_club TEXT,
  policy_number TEXT,
  policy_deductible_usd NUMERIC(15, 4),
  affiliated_claim_number TEXT,
  reference_number TEXT,
  expense_tally_records TEXT DEFAULT '[]',
  recovery_tally_records TEXT DEFAULT '[]',
  email_thread TEXT DEFAULT '[]',
  mail_thread_attachments TEXT DEFAULT '[]',
  claim_amount_history TEXT DEFAULT '[]',
  originating_survey_id TEXT,
  originating_survey_number TEXT,
  response_received_history TEXT DEFAULT '[]',
  comments TEXT DEFAULT '[]',
  attachments TEXT DEFAULT '[]',
  created_by_id TEXT,
  created_by_name TEXT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL
);

-- 3. SURVEYS
CREATE TABLE IF NOT EXISTS surveys (
  id TEXT PRIMARY KEY,
  survey_number TEXT UNIQUE NOT NULL,
  survey_created_date TEXT NOT NULL,
  survey_requested_by TEXT NOT NULL,
  survey_status TEXT NOT NULL DEFAULT 'new_survey',
  survey_reference_number TEXT NOT NULL,
  cms_reference_number TEXT,
  date_of_survey TEXT NOT NULL,
  request_coordinator TEXT,
  survey_cost NUMERIC(15, 4) NOT NULL,
  bl_number TEXT NOT NULL,
  shipper TEXT,
  consignee TEXT,
  notify_party TEXT,
  place_of_receipt TEXT,
  port_of_loading TEXT,
  port_of_discharge TEXT,
  place_of_delivery TEXT,
  vessel_code TEXT,
  vessel_name TEXT,
  vessel_voyage TEXT,
  commodity TEXT,
  container_number TEXT,
  container_size TEXT,
  seal_number TEXT,
  weight NUMERIC(15, 4),
  quantity NUMERIC(15, 4),
  package_type TEXT,
  discharge_date TEXT,
  port_of_landing_date TEXT,
  port_of_discharge_date TEXT,
  country TEXT,
  incident_description TEXT,
  date_of_incident TEXT,
  place_of_incident TEXT,
  cargo_type TEXT DEFAULT 'dry',
  nature_of_damage_category TEXT,
  nature_of_damage_type TEXT,
  nature_of_damage_dry TEXT,
  nature_of_damage_reefer TEXT,
  selected_containers TEXT DEFAULT '[]',
  containers_with_sizes TEXT DEFAULT '[]',
  claim_id TEXT,
  originating_claim_id TEXT,
  originating_claim_number TEXT,
  converted_to_claim_id TEXT,
  converted_to_claim_number TEXT,
  mail_thread_attachments TEXT DEFAULT '[]',
  comments TEXT DEFAULT '[]',
  attachments TEXT DEFAULT '[]',
  expense_tally_records TEXT DEFAULT '[]',
  recovery_tally_records TEXT DEFAULT '[]',
  created_by_id TEXT,
  created_by_name TEXT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL
);

-- 4. LMS CACHE
CREATE TABLE IF NOT EXISTS lms_cache (
  bl_number TEXT PRIMARY KEY,
  lms_data TEXT NOT NULL,
  containers TEXT NOT NULL,
  cached_date TEXT NOT NULL
);

-- 5. AUDIT LOGS
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  entity_number TEXT,
  action TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  performed_by_name TEXT,
  details TEXT,
  field_changed TEXT,
  old_value TEXT,
  new_value TEXT,
  remarks TEXT,
  created_date TEXT NOT NULL
);

-- 6. EXPENSES
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  claim_number TEXT,
  bl_number TEXT,
  expense_type TEXT NOT NULL,
  amount NUMERIC(15, 4),
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending',
  settlement_amount NUMERIC(15, 4),
  settlement_date TEXT,
  responsible_user TEXT,
  description TEXT,
  created_date TEXT NOT NULL
);

-- 7. RECOVERIES
CREATE TABLE IF NOT EXISTS recoveries (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  claim_number TEXT,
  bl_number TEXT,
  recovery_status TEXT DEFAULT 'pending',
  recovery_amount NUMERIC(15, 4),
  recovered_amount NUMERIC(15, 4),
  outstanding_recovery NUMERIC(15, 4),
  recovery_source TEXT,
  liable_party TEXT,
  date TEXT,
  responsible_handler TEXT,
  remarks TEXT,
  created_date TEXT NOT NULL
);

-- 8. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT DEFAULT 'claim',
  message TEXT NOT NULL,
  claim_id TEXT,
  user_id TEXT,
  read INTEGER DEFAULT 0,
  created_date TEXT NOT NULL
);

-- 9. CURRENCY RATES
CREATE TABLE IF NOT EXISTS currency_rates (
  id TEXT PRIMARY KEY,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  rate_date TEXT NOT NULL,
  rates TEXT NOT NULL,
  source TEXT,
  fetch_timestamp TEXT,
  status TEXT NOT NULL,
  error_message TEXT
);

-- 10. FILE UPLOADS STAGING
CREATE TABLE IF NOT EXISTS file_uploads (
  filename TEXT PRIMARY KEY,
  original_filename TEXT,
  mime_type TEXT,
  file_size INTEGER,
  uploaded_by_id TEXT,
  uploaded_by_name TEXT,
  uploaded_at TEXT
);

-- 11. ATTACHMENT METADATA (For Secure Centralized Storage)
CREATE TABLE IF NOT EXISTS attachment_metadata (
  id TEXT PRIMARY KEY,
  claim_id TEXT,
  survey_id TEXT,
  bl_number TEXT,
  cms_reference_number TEXT,
  claim_number TEXT,
  survey_number TEXT,
  mandatory_attachment_type TEXT,
  original_filename TEXT NOT NULL,
  stored_filename TEXT,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  uploaded_by_id TEXT,
  uploaded_by_name TEXT,
  uploaded_at TEXT NOT NULL,
  comments TEXT,
  document_status TEXT DEFAULT 'uploaded',
  checksum TEXT,
  created_date TEXT NOT NULL
);

-- 12. ATTACHMENT CONTENTS (BYTEA Binary Content)
CREATE TABLE IF NOT EXISTS attachment_contents (
  attachment_id TEXT PRIMARY KEY REFERENCES attachment_metadata(id) ON DELETE CASCADE,
  file_data BYTEA NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_bl_number ON claims(bl_number);
CREATE INDEX IF NOT EXISTS idx_claims_claim_number ON claims(claim_number);
CREATE INDEX IF NOT EXISTS idx_claims_cms_number ON claims(cms_number);
CREATE INDEX IF NOT EXISTS idx_claims_created_by ON claims(created_by_id);
CREATE INDEX IF NOT EXISTS idx_claims_sla_status ON claims(sla_status);
CREATE INDEX IF NOT EXISTS idx_surveys_status ON surveys(survey_status);
CREATE INDEX IF NOT EXISTS idx_surveys_bl_number ON surveys(bl_number);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON audit_logs(entity_id);
