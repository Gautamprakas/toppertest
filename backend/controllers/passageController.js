const db = require('../config/db');
const cache = require('../utils/cache');

const PASSAGE_DATES_PREFIX = 'passage-dates:';
const PASSAGE_DATES_TTL = 60000;

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Ensure date is always returned as clean YYYY-MM-DD string
function cleanDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.substring(0, 10);
  return new Date(d).toISOString().substring(0, 10);
}

exports.getPassages = async (req, res) => {
  try {
    const { exam_id, language, date, difficulty } = req.query;

    let sql = `SELECT id, exam_id, title, language, difficulty,
                      DATE_FORMAT(passage_date, '%Y-%m-%d') AS passage_date,
                      word_count, shift
               FROM passages WHERE is_active = 1`;
    const params = [];

    if (exam_id)    { sql += ' AND exam_id = ?';               params.push(exam_id); }
    if (language)   { sql += ' AND language = ?';               params.push(language); }
    if (date)       { sql += ' AND DATE_FORMAT(passage_date, \'%Y-%m-%d\') = ?'; params.push(date); }
    if (difficulty) { sql += ' AND difficulty = ?';             params.push(difficulty); }

    sql += ' ORDER BY passage_date DESC, id ASC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch passages' });
  }
};

exports.getPassageDates = async (req, res) => {
  const { exam_id, language } = req.query;
  if (!language) return res.status(400).json({ error: 'language required' });
  try {
    // exam_id is optional: the guest Quick Test has no exam context and asks
    // for dates across every active exam of a language; select-exam.html
    // still passes exam_id to scope dates to one specific exam.
    const cacheKey = `${PASSAGE_DATES_PREFIX}${exam_id || 'all'}:${language}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    let sql = `SELECT DISTINCT DATE_FORMAT(passage_date, '%Y-%m-%d') AS passage_date
               FROM passages WHERE language = ? AND is_active = 1 AND passage_date IS NOT NULL`;
    const params = [language];
    if (exam_id) { sql += ' AND exam_id = ?'; params.push(exam_id); }
    sql += ' ORDER BY passage_date DESC';

    const [rows] = await db.query(sql, params);
    // Return plain array of date strings e.g. ["2024-01-15", "2024-01-16"]
    const dates = rows.map(r => r.passage_date);
    cache.set(cacheKey, dates, PASSAGE_DATES_TTL);
    res.json(dates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dates' });
  }
};

exports.getPassage = async (req, res) => {
  const [rows] = await db.query(
    `SELECT p.*, e.exam_name, e.duration_minutes, e.word_limit,
            DATE_FORMAT(p.passage_date, '%Y-%m-%d') AS passage_date
     FROM passages p JOIN exams e ON p.exam_id = e.id
     WHERE p.id = ? AND p.is_active = 1`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Passage not found' });
  res.json(rows[0]);
};

exports.createPassage = async (req, res) => {
  const { exam_id, passage_text, language, difficulty, passage_date, title, shift } = req.body;
  if (!exam_id || !passage_text) return res.status(400).json({ error: 'exam_id and passage_text required' });

  const word_count = countWords(passage_text);
  const [result] = await db.query(
    'INSERT INTO passages (exam_id, passage_text, language, difficulty, passage_date, word_count, title, shift) VALUES (?,?,?,?,?,?,?,?)',
    [exam_id, passage_text, language || 'hindi', difficulty || 'M', passage_date || null, word_count, title || '', shift || '']
  );
  cache.clear(PASSAGE_DATES_PREFIX);
  res.status(201).json({ id: result.insertId, word_count, message: 'Passage created' });
};

exports.updatePassage = async (req, res) => {
  const { passage_text, language, difficulty, passage_date, title, shift, is_active } = req.body;
  const word_count = passage_text ? countWords(passage_text) : undefined;
  await db.query(
    'UPDATE passages SET passage_text=?, language=?, difficulty=?, passage_date=?, word_count=?, title=?, shift=?, is_active=? WHERE id=?',
    [passage_text, language, difficulty, passage_date, word_count, title, shift, is_active ?? 1, req.params.id]
  );
  cache.clear(PASSAGE_DATES_PREFIX);
  res.json({ message: 'Passage updated', word_count });
};

exports.deletePassage = async (req, res) => {
  await db.query('UPDATE passages SET is_active = 0 WHERE id = ?', [req.params.id]);
  cache.clear(PASSAGE_DATES_PREFIX);
  res.json({ message: 'Passage deactivated' });
};
