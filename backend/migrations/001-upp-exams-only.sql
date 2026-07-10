-- Reduce the typing-exam catalog to the two UPP tracks (Hindi + English each).
-- Old exams are deactivated, not deleted: typing_results/leaderboard history
-- joins exams regardless of is_active, so past results keep their exam names.
-- Idempotent: blanket-deactivate then upsert-reactivate by unique exam_code.

UPDATE exams SET is_active = 0;

INSERT INTO exams (exam_name, exam_code, language, duration_minutes, word_limit, description, sort_order, is_active) VALUES
('UPP ASI / SI Hindi Typing',            'UPP_ASI_SI_HINDI',   'hindi',   15, 250, 'Uttar Pradesh Police ASI/SI Hindi Mangal typing test practice',  1, 1),
('UPP ASI / SI English Typing',          'UPP_ASI_SI_ENGLISH', 'english', 15, 510, 'Uttar Pradesh Police ASI/SI English typing test practice',       2, 1),
('UPP Computer Operator Hindi Typing',   'UPP_CO_HINDI',       'hindi',   15, 250, 'UP Police Computer Operator Hindi Mangal typing test practice',  3, 1),
('UPP Computer Operator English Typing', 'UPP_CO_ENGLISH',     'english', 15, 510, 'UP Police Computer Operator English typing test practice',       4, 1)
ON DUPLICATE KEY UPDATE
  is_active        = 1,
  language         = VALUES(language),
  duration_minutes = VALUES(duration_minutes),
  word_limit       = VALUES(word_limit),
  sort_order       = VALUES(sort_order),
  exam_name        = VALUES(exam_name),
  description      = VALUES(description);
