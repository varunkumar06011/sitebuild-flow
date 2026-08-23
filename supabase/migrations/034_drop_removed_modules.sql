-- Drop tables for removed modules: Safety, Punch List, Offline Sync,
-- Anomaly Detection, Data Export, Medical Equipment, Medical Gas,
-- Cleanroom Validation, AERB Compliance, NABH Checklist, Backup, Digital Twin

-- Safety
DROP TABLE IF EXISTS safety_incidents CASCADE;

-- Punch List
DROP TABLE IF EXISTS punch_items CASCADE;

-- Offline Sync
DROP TABLE IF EXISTS offline_sync_queue CASCADE;

-- Anomaly Detection
DROP TABLE IF EXISTS anomaly_detections CASCADE;

-- Medical Equipment
DROP TABLE IF EXISTS medical_equipment CASCADE;

-- Medical Gas
DROP TABLE IF EXISTS medical_gas_pipeline CASCADE;

-- Cleanroom Validation
DROP TABLE IF EXISTS cleanroom_validation CASCADE;

-- AERB Compliance
DROP TABLE IF EXISTS aerb_compliance CASCADE;

-- NABH Checklist
DROP TABLE IF EXISTS nabh_checklist CASCADE;

-- Backup
DROP TABLE IF EXISTS backup_verification_log CASCADE;

-- Digital Twin
DROP TABLE IF EXISTS digital_twin_models CASCADE;
