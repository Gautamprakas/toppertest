-- Hide per-word highlighting in all full typing tests (real exams give no
-- live feedback). The guest 1-minute Quick Test keeps its own client-side
-- highlighting and is not affected. Admins can re-enable per exam from the
-- admin panel toggle if ever needed.
UPDATE exams SET enable_highlighting = 0;
