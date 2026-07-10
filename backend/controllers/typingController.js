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

  // Personal bests (which exam/day the best WPM came from)
  const [[bestWpm]] = await db.query(
    `SELECT r.wpm, r.accuracy, e.exam_name, DATE(r.created_at) AS date
     FROM typing_results r JOIN exams e ON r.exam_id = e.id
     WHERE r.user_id = ? ORDER BY r.wpm DESC LIMIT 1`,
    [user_id]
  );

  // Practice streak: consecutive days with >=1 test, ending today or yesterday
  const [days] = await db.query(
    `SELECT DISTINCT DATE(created_at) AS d FROM typing_results
     WHERE user_id = ? ORDER BY d DESC LIMIT 60`,
    [user_id]
  );
  let streak = 0;
  if (days.length) {
    const msDay = 86400000;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let expect = today.getTime();
    const first = new Date(days[0].d).setHours(0, 0, 0, 0);
    if (first === expect - msDay) expect -= msDay; // streak alive but no test yet today
    for (const row of days) {
      const d = new Date(row.d).setHours(0, 0, 0, 0);
      if (d !== expect) break;
      streak++;
      expect -= msDay;
    }
  }

  // This week vs previous week average WPM
  const [[weeks]] = await db.query(
    `SELECT
       ROUND(AVG(CASE WHEN created_at >= NOW() - INTERVAL 7 DAY THEN wpm END), 2)  AS this_week,
       ROUND(AVG(CASE WHEN created_at <  NOW() - INTERVAL 7 DAY
                       AND created_at >= NOW() - INTERVAL 14 DAY THEN wpm END), 2) AS prev_week
     FROM typing_results WHERE user_id = ?`,
    [user_id]
  );

  // Most frequently mistyped words across the last 10 tests (word-position
  // compare, same scheme evaluateTyping scores with; capped for cheapness)
  const [recent] = await db.query(
    `SELECT r.typed_text, p.passage_text
     FROM typing_results r JOIN passages p ON r.passage_id = p.id
     WHERE r.user_id = ? AND r.typed_text IS NOT NULL
     ORDER BY r.created_at DESC LIMIT 10`,
    [user_id]
  );
  const missCounts = {};
  for (const row of recent) {
    const orig  = String(row.passage_text || '').trim().split(/\s+/).slice(0, 600);
    const typed = String(row.typed_text  || '').trim().split(/\s+/).slice(0, 600);
    typed.forEach((w, i) => {
      if (i < orig.length && w !== orig[i]) {
        missCounts[orig[i]] = (missCounts[orig[i]] || 0) + 1;
      }
    });
  }
  const weak_words = Object.entries(missCounts)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  res.json({
    summary: summary[0],
    trend,
    personal_best: bestWpm || null,
    streak,
    week_compare: weeks,
    weak_words,
  });
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

/* ─── Daily Challenge ──────────────────────────────────────────────────────── */
// One featured passage per day (row seeded by the daily scraper). Public for
// browsing; adds the caller's own attempt status when a valid token is sent.
exports.getDailyChallenge = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT dc.id AS challenge_id, dc.challenge_date,
              p.id AS passage_id, p.title, p.language, p.word_count, p.difficulty,
              e.id AS exam_id, e.exam_name, e.duration_minutes
       FROM daily_challenges dc
       JOIN passages p ON dc.passage_id = p.id AND p.is_active = 1
       JOIN exams e    ON p.exam_id = e.id
       WHERE dc.challenge_date = CURDATE() AND dc.is_active = 1
       LIMIT 1`
    );
    if (!rows.length) return res.json({ challenge: null });
    const challenge = rows[0];

    // Today's top performers on this passage (never includes passage text)
    const [leaders] = await db.query(
      `SELECT u.name, r.wpm, r.accuracy
       FROM typing_results r JOIN users u ON r.user_id = u.id
       WHERE r.passage_id = ? AND DATE(r.created_at) = CURDATE()
       ORDER BY r.wpm DESC, r.accuracy DESC
       LIMIT 10`,
      [challenge.passage_id]
    );

    let my_result = null;
    if (req.user) {
      const [mine] = await db.query(
        `SELECT wpm, accuracy FROM typing_results
         WHERE user_id = ? AND passage_id = ? AND DATE(created_at) = CURDATE()
         ORDER BY wpm DESC LIMIT 1`,
        [req.user.id, challenge.passage_id]
      );
      if (mine.length) my_result = mine[0];
    }

    res.json({ challenge, leaderboard: leaders, my_result });
  } catch (err) {
    console.error('getDailyChallenge error:', err);
    res.status(500).json({ error: 'Failed to fetch daily challenge' });
  }
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
