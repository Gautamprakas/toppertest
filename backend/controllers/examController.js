const db = require('../config/db');
const cache = require('../utils/cache');

const EXAMS_CACHE_KEY = 'exams:list';
const EXAMS_CACHE_TTL = 60000;

exports.getExams = async (req, res) => {
  try {
    const cached = cache.get(EXAMS_CACHE_KEY);
    if (cached) return res.json(cached);

    const [rows] = await db.query(
      `SELECT id, exam_name, exam_code, language, duration_minutes, word_limit,
              description, sort_order,
              IFNULL(enable_highlighting, 1) AS enable_highlighting
       FROM exams WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`
    );
    cache.set(EXAMS_CACHE_KEY, rows, EXAMS_CACHE_TTL);
    res.json(rows);
  } catch (err) {
    console.error('getExams error:', err);
    res.status(500).json({ error: 'Failed to fetch exams' });
  }
};

exports.getExam = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT *, IFNULL(enable_highlighting, 1) AS enable_highlighting
       FROM exams WHERE id = ? AND is_active = 1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Exam not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch exam' });
  }
};

exports.createExam = async (req, res) => {
  try {
    const {
      exam_name, exam_code, language, duration_minutes,
      word_limit, description, sort_order, enable_highlighting
    } = req.body;

    if (!exam_name?.trim()) return res.status(400).json({ error: 'exam_name is required' });
    if (!exam_code?.trim()) return res.status(400).json({ error: 'exam_code is required' });

    const code = exam_code.trim().toUpperCase();

    const [existing] = await db.query('SELECT id FROM exams WHERE exam_code = ?', [code]);
    if (existing.length) return res.status(409).json({ error: `Exam code "${code}" already exists.` });

    const [result] = await db.query(
      `INSERT INTO exams
         (exam_name, exam_code, language, duration_minutes, word_limit,
          description, sort_order, enable_highlighting)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        exam_name.trim(), code,
        language || 'both',
        parseInt(duration_minutes) || 15,
        parseInt(word_limit) || 250,
        description || '',
        parseInt(sort_order) || 10,
        enable_highlighting !== undefined ? (enable_highlighting ? 1 : 0) : 1
      ]
    );
    cache.clear(EXAMS_CACHE_KEY);
    res.status(201).json({ id: result.insertId, message: 'Exam created successfully' });
  } catch (err) {
    console.error('createExam error:', err);
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Exam code already exists.' });
    res.status(500).json({ error: 'Failed to create exam: ' + err.message });
  }
};

exports.updateExam = async (req, res) => {
  try {
    const {
      exam_name, language, duration_minutes, word_limit,
      description, is_active, sort_order, enable_highlighting
    } = req.body;

    await db.query(
      `UPDATE exams
       SET exam_name=?, language=?, duration_minutes=?, word_limit=?,
           description=?, is_active=?, sort_order=?, enable_highlighting=?
       WHERE id=?`,
      [
        exam_name, language, duration_minutes, word_limit,
        description, is_active ?? 1, sort_order || 0,
        enable_highlighting !== undefined ? (enable_highlighting ? 1 : 0) : 1,
        req.params.id
      ]
    );
    cache.clear(EXAMS_CACHE_KEY);
    res.json({ message: 'Exam updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update exam: ' + err.message });
  }
};

// Quick toggle endpoint — just flips enable_highlighting
exports.toggleHighlighting = async (req, res) => {
  try {
    await db.query(
      `UPDATE exams
       SET enable_highlighting = CASE WHEN enable_highlighting = 1 THEN 0 ELSE 1 END
       WHERE id = ?`,
      [req.params.id]
    );
    const [rows] = await db.query(
      'SELECT id, enable_highlighting FROM exams WHERE id = ?',
      [req.params.id]
    );
    cache.clear(EXAMS_CACHE_KEY);
    res.json({ id: rows[0].id, enable_highlighting: rows[0].enable_highlighting });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle highlighting' });
  }
};

exports.deleteExam = async (req, res) => {
  try {
    await db.query('UPDATE exams SET is_active = 0 WHERE id = ?', [req.params.id]);
    cache.clear(EXAMS_CACHE_KEY);
    res.json({ message: 'Exam deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate exam' });
  }
};
