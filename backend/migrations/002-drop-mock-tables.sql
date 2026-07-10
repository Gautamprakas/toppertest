-- The MCQ mock-test feature was removed before ever shipping; these tables
-- exist only on databases that loaded an interim schema.sql (local dev, or
-- prod if the interim manual SQL was ever run). Order matters for FKs.

DROP TABLE IF EXISTS mock_attempts;
DROP TABLE IF EXISTS mock_questions;
DROP TABLE IF EXISTS mock_tests;
DROP TABLE IF EXISTS test_series;
