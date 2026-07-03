const db     = require('../config/db');
const crypto = require('crypto');

/* ─── Typing Evaluation Logic ──────────────────────────────────────────────── */
function evaluateTyping(originalText, typedText, durationMinutes) {
  const originalWords = originalText.trim().split(/\s+/).filter(Boolean);
  const typedWords    = typedText.trim().split(/\s+/).filter(Boolean);

  let correct = 0;
  let wrong   = 0;
  const totalTyped = typedWords.length;

  typedWords.forEach((word, i) => {
    if (i < originalWords.length && word === originalWords[i]) correct++;
    else wrong++;
  });

  const minutesTaken = Math.max(durationMinutes, 0.1);
  const wpm          = parseFloat((totalTyped / minutesTaken).toFixed(2));
  const accuracy     = totalTyped > 0
    ? parseFloat(((correct / totalTyped) * 100).toFixed(2))
    : 0;

  return { totalTyped, correct, wrong, wpm, accuracy, errors: wrong };
}

/* ─── Start Test ───────────────────────────────────────────────────────────── */
exports.startTest = async (req, res) => {
  try {
    const { passage_id } = req.body;
    const user_id = req.user.id;

    const [passages] = await db.query(
      'SELECT p.*, e.duration_minutes, e.word_limit, IFNULL(e.enable_highlighting,1) AS enable_highlighting FROM passages p JOIN exams e ON p.exam_id = e.id WHERE p.id = ? AND p.is_active = 1',
      [passage_id]
    );
    if (!passages.length) return res.status(404).json({ error: 'Passage not found' });

    const passage = passages[0];

    // Abandon any previous active session
    await db.query(
      'UPDATE typing_sessions SET status = "abandoned" WHERE user_id = ? AND status = "active"',
      [user_id]
    );

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const [session] = await db.query(
      'INSERT INTO typing_sessions (user_id, exam_id, passage_id, session_token) VALUES (?,?,?,?)',
      [user_id, passage.exam_id, passage_id, sessionToken]
    );

    res.json({
      session_id:       session.insertId,
      session_token:    sessionToken,
      passage_id:       passage.id,
      passage_text:     passage.passage_text,
      duration_minutes: passage.duration_minutes,
      exam_id:          passage.exam_id,
      word_limit:       passage.word_limit || 0,
      enable_highlighting: passage.enable_highlighting,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to start test' });
  }
};

/* ─── Submit Test ──────────────────────────────────────────────────────────── */
exports.submitTest = async (req, res) => {
  try {
    const { session_id, session_token, typed_text, time_taken, keystrokes, backspaces } = req.body;
    const user_id = req.user.id;

    const [sessions] = await db.query(
      'SELECT * FROM typing_sessions WHERE id = ? AND session_token = ? AND user_id = ? AND status = "active"',
      [session_id, session_token, user_id]
    );
    if (!sessions.length) return res.status(400).json({ error: 'Invalid or expired session' });

    const session = sessions[0];
    const [passages] = await db.query(
      'SELECT p.*, e.duration_minutes FROM passages p JOIN exams e ON p.exam_id = e.id WHERE p.id = ?',
      [session.passage_id]
    );
    const passage = passages[0];

    const minutesTaken = time_taken ? time_taken / 60 : passage.duration_minutes;
    const result = evaluateTyping(passage.passage_text, typed_text || '', minutesTaken);

    await db.query(
      `INSERT INTO typing_results
       (user_id, exam_id, passage_id, session_id, typed_text, total_words, correct_words, wrong_words, wpm, accuracy, errors, time_taken, keystrokes, backspaces)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        user_id, session.exam_id, session.passage_id, session_id,
        typed_text, result.totalTyped, result.correct, result.wrong,
        result.wpm, result.accuracy, result.errors,
        time_taken || (passage.duration_minutes * 60),
        keystrokes || 0, backspaces || 0
      ]
    );

    await db.query('UPDATE typing_sessions SET status = "submitted" WHERE id = ?', [session_id]);

    res.json({
      message:       'Test submitted successfully',
      wpm:           result.wpm,
      accuracy:      result.accuracy,
      errors:        result.errors,
      total_words:   result.totalTyped,
      correct_words: result.correct,
      wrong_words:   result.wrong,
      time_taken,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit test' });
  }
};

/* ─── History ──────────────────────────────────────────────────────────────── */
exports.getHistory = async (req, res) => {
  const user_id = req.user.id;
  const limit   = parseInt(req.query.limit) || 20;
  const offset  = parseInt(req.query.offset) || 0;

  const [rows] = await db.query(
    `SELECT r.id, e.exam_name, p.language, p.difficulty, p.passage_date,
            r.wpm, r.accuracy, r.errors, r.total_words, r.correct_words,
            r.time_taken, r.created_at
     FROM typing_results r
     JOIN exams e ON r.exam_id = e.id
     JOIN passages p ON r.passage_id = p.id
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [user_id, limit, offset]
  );

  const [countRow] = await db.query(
    'SELECT COUNT(*) AS total FROM typing_results WHERE user_id = ?', [user_id]
  );

  res.json({ results: rows, total: countRow[0].total });
};

/* ─── Stats / Analytics ────────────────────────────────────────────────────── */
exports.getAnalytics = async (req, res) => {
  const user_id = req.user.id;

  const [summary] = await db.query(
    `SELECT COUNT(*) AS total_tests,
            ROUND(AVG(wpm),2) AS avg_wpm,
            MAX(wpm) AS best_wpm,
            ROUND(AVG(accuracy),2) AS avg_accuracy
     FROM typing_results WHERE user_id = ?`,
    [user_id]
  );

  const [trend] = await db.query(
    `SELECT DATE(created_at) AS date, ROUND(AVG(wpm),2) AS avg_wpm, ROUND(AVG(accuracy),2) AS avg_accuracy
     FROM typing_results WHERE user_id = ?
     GROUP BY DATE(created_at)
     ORDER BY date ASC
     LIMIT 30`,
    [user_id]
  );

  res.json({ summary: summary[0], trend });
};

/* ─── Leaderboard ──────────────────────────────────────────────────────────── */
exports.getLeaderboard = async (req, res) => {
  const { exam_id } = req.query;
  let sql = `SELECT u.name, e.exam_name, MAX(r.wpm) AS best_wpm,
             ROUND(AVG(r.accuracy),2) AS avg_accuracy, COUNT(r.id) AS total_tests
             FROM typing_results r JOIN users u ON r.user_id = u.id JOIN exams e ON r.exam_id = e.id`;
  const params = [];
  if (exam_id) { sql += ' WHERE r.exam_id = ?'; params.push(exam_id); }
  sql += ' GROUP BY r.user_id, r.exam_id ORDER BY best_wpm DESC LIMIT 50';
  const [rows] = await db.query(sql, params);
  res.json(rows);
};

/* ─── Dashboard Stats ──────────────────────────────────────────────────────── */
exports.getDashboardStats = async (_req, res) => {
  const [[passages]] = await db.query('SELECT COUNT(*) AS c FROM passages WHERE is_active=1');
  const [[exams]]    = await db.query('SELECT COUNT(*) AS c FROM exams WHERE is_active=1');
  const [[users]]    = await db.query('SELECT COUNT(*) AS c FROM users WHERE role="student"');
  const [[tests]]    = await db.query('SELECT COUNT(*) AS c FROM typing_results');
  res.json({
    total_passages: passages.c,
    exams_covered:  exams.c,
    students:       users.c,
    tests_taken:    tests.c,
  });
};
