const db = require('../config/db');

exports.getUsers = async (req, res) => {
  const [rows] = await db.query(
    'SELECT id, name, email, phone, role, is_active, created_at FROM users ORDER BY created_at DESC'
  );
  res.json(rows);
};

exports.getUserStats = async (req, res) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, COUNT(r.id) AS total_tests,
            ROUND(AVG(r.wpm),2) AS avg_wpm, MAX(r.wpm) AS best_wpm
     FROM users u LEFT JOIN typing_results r ON u.id = r.user_id
     WHERE u.role = 'student'
     GROUP BY u.id ORDER BY total_tests DESC`
  );
  res.json(rows);
};

exports.toggleUser = async (req, res) => {
  await db.query('UPDATE users SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
  res.json({ message: 'User status toggled' });
};

exports.getAllResults = async (req, res) => {
  const limit  = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const [rows] = await db.query(
    `SELECT r.*, u.name AS student_name, e.exam_name, p.difficulty
     FROM typing_results r
     JOIN users u ON r.user_id = u.id
     JOIN exams e ON r.exam_id = e.id
     JOIN passages p ON r.passage_id = p.id
     ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  res.json(rows);
};

exports.getSiteStats = async (_req, res) => {
  const [[users]]   = await db.query('SELECT COUNT(*) AS c FROM users WHERE role="student"');
  const [[exams]]   = await db.query('SELECT COUNT(*) AS c FROM exams WHERE is_active=1');
  const [[passages]]= await db.query('SELECT COUNT(*) AS c FROM passages WHERE is_active=1');
  const [[tests]]   = await db.query('SELECT COUNT(*) AS c FROM typing_results');
  const [[avgWpm]]  = await db.query('SELECT ROUND(AVG(wpm),2) AS avg FROM typing_results');
  res.json({
    total_users:    users.c,
    total_exams:    exams.c,
    total_passages: passages.c,
    total_tests:    tests.c,
    site_avg_wpm:   avgWpm.avg,
  });
};
