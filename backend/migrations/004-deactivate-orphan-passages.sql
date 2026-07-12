-- Passages belonging to deactivated exams were scraped by the old scraper
-- (before the text-quality whitelist) and can contain untypeable foreign
-- scripts and symbols. Deactivate them so no endpoint can ever serve them.
UPDATE passages p
JOIN exams e ON p.exam_id = e.id
SET p.is_active = 0
WHERE e.is_active = 0;
