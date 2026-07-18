-- UPP ASI/SI rules: Hindi passage is ~400 words (25 WPM x 15 min), typed in
-- Mangal/Inscript. Our Hindi exams were set to 250; raise to 410 so daily
-- scrapes fetch exam-length passages. English stays at 510 (~500-word rule).
UPDATE exams SET word_limit = 410
WHERE exam_code IN ('UPP_ASI_SI_HINDI', 'UPP_CO_HINDI');
