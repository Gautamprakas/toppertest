const db     = require('../config/db');
const crypto = require('crypto');
const cache  = require('../utils/cache');

const SERIES_CACHE_PREFIX = 'series:';
const SERIES_CACHE_TTL = 60000;
const VALID_TRACKS  = ['UPP_ASI_SI', 'UPP_CO'];
const VALID_OPTIONS = ['A', 'B', 'C', 'D'];
const SUBMIT_GRACE_SECONDS = 120;

// Student-facing question columns — MUST never include correct_option or
// explanations. Any change here needs a matching check in mockTests.test.js.
const STUDENT_QUESTION_COLS =
  `id, question_order, section, question_en, question_hi,
   option_a_en, option_b_en, option_c_en, option_d_en,
   option_a_hi, option_b_hi, option_c_hi, option_d_hi`;

/* ═══════════════════════ STUDENT ENDPOINTS ═══════════════════════ */

// GET /api/test-series?track=UPP_ASI_SI   (public, cached)
exports.getSeriesList = async (req, res) => {
  try {
    const track = VALID_TRACKS.includes(req.query.track) ? req.query.track : null;
    const cacheKey = `${SERIES_CACHE_PREFIX}list:${track || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    let sql = `SELECT s.id, s.track_code, s.title, s.description, s.sort_order,
                      (SELECT COUNT(*) FROM mock_tests t WHERE t.series_id = s.id AND t.is_active = 1) AS test_count
               FROM test_series s WHERE s.is_active = 1`;
    const params = [];
    if (track) { sql += ' AND s.track_code = ?'; params.push(track); }
    sql += ' ORDER BY s.sort_order ASC, s.id ASC';

    const [rows] = await db.query(sql, params);
    cache.set(cacheKey, rows, SERIES_CACHE_TTL);
    res.json(rows);
  } catch (err) {
    console.error('getSeriesList error:', err);
    res.status(500).json({ error: 'Failed to fetch test series' });
  }
};

// GET /api/test-series/:id   (optionalAuth — attempt status added when logged in)
exports.getSeriesDetail = async (req, res) => {
  try {
    const [seriesRows] = await db.query(
      'SELECT id, track_code, title, description FROM test_series WHERE id = ? AND is_active = 1',
      [req.params.id]
    );
    if (!seriesRows.length) return res.status(404).json({ error: 'Test series not found' });

    const [tests] = await db.query(
      `SELECT t.id, t.title, t.test_number, t.duration_minutes, t.marks_correct, t.negative_marks,
              (SELECT COUNT(*) FROM mock_questions q WHERE q.mock_test_id = t.id) AS question_count
       FROM mock_tests t WHERE t.series_id = ? AND t.is_active = 1
       ORDER BY t.test_number ASC, t.id ASC`,
      [req.params.id]
    );

    let attemptsByTest = {};
    if (req.user) {
      const [attempts] = await db.query(
        `SELECT mock_test_id, MAX(score) AS best_score, COUNT(*) AS attempt_count,
                SUBSTRING_INDEX(GROUP_CONCAT(id ORDER BY submitted_at DESC), ',', 1) AS last_attempt_id
         FROM mock_attempts
         WHERE user_id = ? AND status = 'submitted' AND mock_test_id IN (SELECT id FROM mock_tests WHERE series_id = ?)
         GROUP BY mock_test_id`,
        [req.user.id, req.params.id]
      );
      attempts.forEach(a => { attemptsByTest[a.mock_test_id] = a; });
    }

    res.json({
      ...seriesRows[0],
      tests: tests.map(t => {
        const a = attemptsByTest[t.id];
        return {
          ...t,
          total_marks: Number((t.question_count * t.marks_correct).toFixed(2)),
          attempt_status: a ? 'completed' : 'not_attempted',
          best_score: a ? Number(a.best_score) : null,
          attempt_count: a ? a.attempt_count : 0,
          last_attempt_id: a ? Number(a.last_attempt_id) : null,
        };
      }),
    });
  } catch (err) {
    console.error('getSeriesDetail error:', err);
    res.status(500).json({ error: 'Failed to fetch series detail' });
  }
};

// GET /api/test-series/:id/scorecard   (auth)
exports.getSeriesScorecard = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.id AS mock_test_id, t.title, t.test_number,
              (SELECT COUNT(*) FROM mock_questions q WHERE q.mock_test_id = t.id) * t.marks_correct AS total_marks,
              MAX(a.score) AS best_score,
              COUNT(a.id) AS attempts
       FROM mock_tests t
       LEFT JOIN mock_attempts a ON a.mock_test_id = t.id AND a.user_id = ? AND a.status = 'submitted'
       WHERE t.series_id = ? AND t.is_active = 1
       GROUP BY t.id
       ORDER BY t.test_number ASC`,
      [req.user.id, req.params.id]
    );
    res.json(rows.map(r => ({
      ...r,
      total_marks: Number(r.total_marks) || 0,
      best_score: r.best_score !== null ? Number(r.best_score) : null,
    })));
  } catch (err) {
    console.error('getSeriesScorecard error:', err);
    res.status(500).json({ error: 'Failed to fetch scorecard' });
  }
};

// POST /api/mock-tests/:id/start   (auth)
exports.startMockTest = async (req, res) => {
  try {
    const user_id = req.user.id;
    const [tests] = await db.query(
      `SELECT t.*, s.title AS series_title, s.track_code
       FROM mock_tests t JOIN test_series s ON t.series_id = s.id
       WHERE t.id = ? AND t.is_active = 1 AND s.is_active = 1`,
      [req.params.id]
    );
    if (!tests.length) return res.status(404).json({ error: 'Mock test not found' });
    const test = tests[0];

    const [questions] = await db.query(
      `SELECT ${STUDENT_QUESTION_COLS} FROM mock_questions
       WHERE mock_test_id = ? ORDER BY question_order ASC, id ASC`,
      [test.id]
    );
    if (!questions.length) return res.status(400).json({ error: 'This test has no questions yet' });

    await db.query(
      'UPDATE mock_attempts SET status = "abandoned" WHERE user_id = ? AND status = "active"',
      [user_id]
    );

    const attemptToken = crypto.randomBytes(32).toString('hex');
    const totalMarks = Number((questions.length * test.marks_correct).toFixed(2));
    const [attempt] = await db.query(
      'INSERT INTO mock_attempts (mock_test_id, user_id, attempt_token, total_marks) VALUES (?,?,?,?)',
      [test.id, user_id, attemptToken, totalMarks]
    );

    res.json({
      attempt_id:    attempt.insertId,
      attempt_token: attemptToken,
      test: {
        id: test.id,
        title: test.title,
        series_title: test.series_title,
        track_code: test.track_code,
        duration_minutes: test.duration_minutes,
        marks_correct: Number(test.marks_correct),
        negative_marks: Number(test.negative_marks),
        question_count: questions.length,
        total_marks: totalMarks,
      },
      questions,
    });
  } catch (err) {
    console.error('startMockTest error:', err);
    res.status(500).json({ error: 'Failed to start mock test' });
  }
};

// Builds the full scorecard + solutions payload for a submitted attempt.
async function buildResultPayload(attempt) {
  const [tests] = await db.query(
    `SELECT t.*, s.title AS series_title, s.id AS series_id
     FROM mock_tests t JOIN test_series s ON t.series_id = s.id WHERE t.id = ?`,
    [attempt.mock_test_id]
  );
  const test = tests[0];
  const [questions] = await db.query(
    `SELECT * FROM mock_questions WHERE mock_test_id = ? ORDER BY question_order ASC, id ASC`,
    [attempt.mock_test_id]
  );
  const answers = JSON.parse(attempt.answers_json || '{}');

  return {
    attempt_id:   attempt.id,
    test: {
      id: test.id, title: test.title, series_id: test.series_id, series_title: test.series_title,
      duration_minutes: test.duration_minutes,
      marks_correct: Number(test.marks_correct), negative_marks: Number(test.negative_marks),
    },
    score:         Number(attempt.score),
    total_marks:   Number(attempt.total_marks),
    correct_count: attempt.correct_count,
    wrong_count:   attempt.wrong_count,
    skipped_count: attempt.skipped_count,
    time_taken:    attempt.time_taken,
    submitted_at:  attempt.submitted_at,
    sections:      JSON.parse(attempt.sections_json || '{}'),
    questions: questions.map(q => ({
      id: q.id, question_order: q.question_order, section: q.section,
      question_en: q.question_en, question_hi: q.question_hi,
      option_a_en: q.option_a_en, option_b_en: q.option_b_en, option_c_en: q.option_c_en, option_d_en: q.option_d_en,
      option_a_hi: q.option_a_hi, option_b_hi: q.option_b_hi, option_c_hi: q.option_c_hi, option_d_hi: q.option_d_hi,
      correct_option: q.correct_option,
      explanation_en: q.explanation_en, explanation_hi: q.explanation_hi,
      user_answer: answers[q.id] || null,
    })),
  };
}

// POST /api/mock-tests/:id/submit   (auth)
exports.submitMockTest = async (req, res) => {
  try {
    const { attempt_id, attempt_token, answers, time_taken } = req.body;
    const user_id = req.user.id;

    const [attempts] = await db.query(
      `SELECT * FROM mock_attempts
       WHERE id = ? AND attempt_token = ? AND user_id = ? AND mock_test_id = ? AND status = 'active'`,
      [attempt_id, attempt_token, user_id, req.params.id]
    );
    if (!attempts.length) return res.status(400).json({ error: 'Invalid or expired attempt' });
    const attempt = attempts[0];

    const [tests] = await db.query('SELECT * FROM mock_tests WHERE id = ?', [attempt.mock_test_id]);
    const test = tests[0];

    // Server-side deadline: reject submissions past duration + grace
    const [[{ elapsed }]] = await db.query(
      'SELECT TIMESTAMPDIFF(SECOND, started_at, NOW()) AS elapsed FROM mock_attempts WHERE id = ?',
      [attempt.id]
    );
    const maxSeconds = test.duration_minutes * 60 + SUBMIT_GRACE_SECONDS;
    if (elapsed > maxSeconds) {
      await db.query('UPDATE mock_attempts SET status = "abandoned" WHERE id = ? AND status = "active"', [attempt.id]);
      return res.status(400).json({ error: 'Time limit exceeded — attempt expired' });
    }

    const [questions] = await db.query(
      'SELECT id, section, correct_option, question_order FROM mock_questions WHERE mock_test_id = ?',
      [attempt.mock_test_id]
    );

    // Whitelist answers: only this test's question IDs, only A-D values
    const validIds = new Set(questions.map(q => q.id));
    const clean = {};
    if (answers && typeof answers === 'object') {
      for (const [qid, opt] of Object.entries(answers)) {
        const id = parseInt(qid);
        if (validIds.has(id) && VALID_OPTIONS.includes(opt)) clean[id] = opt;
      }
    }

    const marksCorrect  = Number(test.marks_correct);
    const negativeMarks = Number(test.negative_marks);
    let correct = 0, wrong = 0;
    const sections = {};
    for (const q of questions) {
      const sec = q.section || 'General';
      if (!sections[sec]) sections[sec] = { total: 0, correct: 0, wrong: 0, skipped: 0, marks: 0 };
      sections[sec].total++;
      const ans = clean[q.id];
      if (!ans) { sections[sec].skipped++; continue; }
      if (ans === q.correct_option) {
        correct++; sections[sec].correct++; sections[sec].marks += marksCorrect;
      } else {
        wrong++; sections[sec].wrong++; sections[sec].marks -= negativeMarks;
      }
    }
    for (const sec of Object.values(sections)) sec.marks = Number(sec.marks.toFixed(2));

    const skipped   = questions.length - correct - wrong;
    const score     = Number((correct * marksCorrect - wrong * negativeMarks).toFixed(2));
    const timeTaken = Math.min(parseInt(time_taken) || 0, test.duration_minutes * 60);

    // One-shot submit: the status='active' condition makes re-submission a no-op
    const [upd] = await db.query(
      `UPDATE mock_attempts
       SET status='submitted', submitted_at=NOW(), time_taken=?, score=?,
           correct_count=?, wrong_count=?, skipped_count=?, answers_json=?, sections_json=?
       WHERE id = ? AND status = 'active'`,
      [timeTaken, score, correct, wrong, skipped, JSON.stringify(clean), JSON.stringify(sections), attempt.id]
    );
    if (upd.affectedRows !== 1) return res.status(400).json({ error: 'Attempt already submitted' });

    const [updated] = await db.query('SELECT * FROM mock_attempts WHERE id = ?', [attempt.id]);
    res.json(await buildResultPayload(updated[0]));
  } catch (err) {
    console.error('submitMockTest error:', err);
    res.status(500).json({ error: 'Failed to submit mock test' });
  }
};

// GET /api/mock-attempts/:id/review   (auth, owner-only, submitted-only)
exports.reviewAttempt = async (req, res) => {
  try {
    const [attempts] = await db.query(
      `SELECT * FROM mock_attempts WHERE id = ? AND user_id = ? AND status = 'submitted'`,
      [req.params.id, req.user.id]
    );
    if (!attempts.length) return res.status(404).json({ error: 'Attempt not found' });
    res.json(await buildResultPayload(attempts[0]));
  } catch (err) {
    console.error('reviewAttempt error:', err);
    res.status(500).json({ error: 'Failed to fetch attempt review' });
  }
};

/* ═══════════════════════ ADMIN ENDPOINTS ═══════════════════════ */

exports.adminCreateSeries = async (req, res) => {
  try {
    const { track_code, title, description, sort_order } = req.body;
    if (!VALID_TRACKS.includes(track_code)) return res.status(400).json({ error: `track_code must be one of: ${VALID_TRACKS.join(', ')}` });
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const [result] = await db.query(
      'INSERT INTO test_series (track_code, title, description, sort_order) VALUES (?,?,?,?)',
      [track_code, title.trim(), description || '', parseInt(sort_order) || 0]
    );
    cache.clear(SERIES_CACHE_PREFIX);
    res.status(201).json({ id: result.insertId, message: 'Series created' });
  } catch (err) {
    console.error('adminCreateSeries error:', err);
    res.status(500).json({ error: 'Failed to create series' });
  }
};

exports.adminUpdateSeries = async (req, res) => {
  try {
    const { title, description, sort_order, is_active } = req.body;
    await db.query(
      'UPDATE test_series SET title=?, description=?, sort_order=?, is_active=? WHERE id=?',
      [title, description || '', parseInt(sort_order) || 0, is_active ?? 1, req.params.id]
    );
    cache.clear(SERIES_CACHE_PREFIX);
    res.json({ message: 'Series updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update series' });
  }
};

exports.adminDeleteSeries = async (req, res) => {
  try {
    await db.query('UPDATE test_series SET is_active = 0 WHERE id = ?', [req.params.id]);
    cache.clear(SERIES_CACHE_PREFIX);
    res.json({ message: 'Series deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate series' });
  }
};

exports.adminCreateTest = async (req, res) => {
  try {
    const { series_id, title, test_number, duration_minutes, marks_correct, negative_marks } = req.body;
    if (!series_id) return res.status(400).json({ error: 'series_id is required' });
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const [series] = await db.query('SELECT id FROM test_series WHERE id = ?', [series_id]);
    if (!series.length) return res.status(404).json({ error: 'Series not found' });
    const [result] = await db.query(
      `INSERT INTO mock_tests (series_id, title, test_number, duration_minutes, marks_correct, negative_marks)
       VALUES (?,?,?,?,?,?)`,
      [series_id, title.trim(), parseInt(test_number) || 1, parseInt(duration_minutes) || 120,
       parseFloat(marks_correct) || 1, parseFloat(negative_marks) || 0]
    );
    cache.clear(SERIES_CACHE_PREFIX);
    res.status(201).json({ id: result.insertId, message: 'Mock test created' });
  } catch (err) {
    console.error('adminCreateTest error:', err);
    res.status(500).json({ error: 'Failed to create mock test' });
  }
};

exports.adminUpdateTest = async (req, res) => {
  try {
    const { title, test_number, duration_minutes, marks_correct, negative_marks, is_active } = req.body;
    await db.query(
      `UPDATE mock_tests SET title=?, test_number=?, duration_minutes=?, marks_correct=?, negative_marks=?, is_active=?
       WHERE id=?`,
      [title, parseInt(test_number) || 1, parseInt(duration_minutes) || 120,
       parseFloat(marks_correct) || 1, parseFloat(negative_marks) || 0, is_active ?? 1, req.params.id]
    );
    cache.clear(SERIES_CACHE_PREFIX);
    res.json({ message: 'Mock test updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update mock test' });
  }
};

exports.adminDeleteTest = async (req, res) => {
  try {
    await db.query('UPDATE mock_tests SET is_active = 0 WHERE id = ?', [req.params.id]);
    cache.clear(SERIES_CACHE_PREFIX);
    res.json({ message: 'Mock test deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate mock test' });
  }
};

// Full rows INCLUDING answers — adminAuth only, never expose via student routes
exports.adminGetQuestions = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM mock_questions WHERE mock_test_id = ? ORDER BY question_order ASC, id ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
};

function validateQuestion(q) {
  const hasText = (en, hi) => (en && String(en).trim()) || (hi && String(hi).trim());
  if (!hasText(q.question_en, q.question_hi)) return 'question text required in at least one language';
  for (const opt of ['a', 'b', 'c', 'd']) {
    if (!hasText(q[`option_${opt}_en`], q[`option_${opt}_hi`])) return `option ${opt.toUpperCase()} required in at least one language`;
  }
  if (!VALID_OPTIONS.includes(q.correct_option)) return 'correct_option must be A, B, C or D';
  return null;
}

const QUESTION_COLS = ['section', 'question_en', 'question_hi',
  'option_a_en', 'option_b_en', 'option_c_en', 'option_d_en',
  'option_a_hi', 'option_b_hi', 'option_c_hi', 'option_d_hi',
  'correct_option', 'explanation_en', 'explanation_hi'];

exports.adminCreateQuestion = async (req, res) => {
  try {
    const [tests] = await db.query('SELECT id FROM mock_tests WHERE id = ?', [req.params.id]);
    if (!tests.length) return res.status(404).json({ error: 'Mock test not found' });

    const err = validateQuestion(req.body);
    if (err) return res.status(400).json({ error: err });

    const [[{ maxOrder }]] = await db.query(
      'SELECT IFNULL(MAX(question_order), 0) AS maxOrder FROM mock_questions WHERE mock_test_id = ?',
      [req.params.id]
    );
    const values = QUESTION_COLS.map(c => req.body[c] ?? null);
    const [result] = await db.query(
      `INSERT INTO mock_questions (mock_test_id, question_order, ${QUESTION_COLS.join(', ')})
       VALUES (?, ?, ${QUESTION_COLS.map(() => '?').join(', ')})`,
      [req.params.id, maxOrder + 1, ...values]
    );
    res.status(201).json({ id: result.insertId, message: 'Question added' });
  } catch (err) {
    console.error('adminCreateQuestion error:', err);
    res.status(500).json({ error: 'Failed to add question' });
  }
};

exports.adminUpdateQuestion = async (req, res) => {
  try {
    const err = validateQuestion(req.body);
    if (err) return res.status(400).json({ error: err });
    const sets = QUESTION_COLS.map(c => `${c} = ?`).join(', ');
    const values = QUESTION_COLS.map(c => req.body[c] ?? null);
    await db.query(`UPDATE mock_questions SET ${sets} WHERE id = ?`, [...values, req.params.id]);
    res.json({ message: 'Question updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update question' });
  }
};

exports.adminDeleteQuestion = async (req, res) => {
  try {
    await db.query('DELETE FROM mock_questions WHERE id = ?', [req.params.id]);
    res.json({ message: 'Question deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete question' });
  }
};

// POST /api/admin/mock-tests/:id/questions/bulk
// Body: { questions: [{section, question_en/hi, options_en/hi arrays OR option_x_en/hi, correct, explanation_en/hi}] }
// Validates every row first, then inserts all in one multi-row INSERT.
exports.adminBulkImportQuestions = async (req, res) => {
  try {
    const [tests] = await db.query('SELECT id FROM mock_tests WHERE id = ?', [req.params.id]);
    if (!tests.length) return res.status(404).json({ error: 'Mock test not found' });

    const { questions } = req.body;
    if (!Array.isArray(questions) || !questions.length)
      return res.status(400).json({ error: 'questions must be a non-empty array' });
    if (questions.length > 500)
      return res.status(400).json({ error: 'Maximum 500 questions per import' });

    // Normalize: accept options_en/options_hi arrays or individual option_x columns
    const normalized = questions.map(q => {
      const n = {
        section: q.section || null,
        question_en: q.question_en || null,
        question_hi: q.question_hi || null,
        correct_option: (q.correct_option || q.correct || '').toUpperCase(),
        explanation_en: q.explanation_en || null,
        explanation_hi: q.explanation_hi || null,
      };
      ['a', 'b', 'c', 'd'].forEach((opt, i) => {
        n[`option_${opt}_en`] = q[`option_${opt}_en`] ?? (Array.isArray(q.options_en) ? q.options_en[i] : null) ?? null;
        n[`option_${opt}_hi`] = q[`option_${opt}_hi`] ?? (Array.isArray(q.options_hi) ? q.options_hi[i] : null) ?? null;
      });
      return n;
    });

    const failed = [];
    normalized.forEach((q, i) => {
      const err = validateQuestion(q);
      if (err) failed.push({ index: i, error: err });
    });
    if (failed.length) return res.status(400).json({ error: 'Validation failed', failed });

    const [[{ maxOrder }]] = await db.query(
      'SELECT IFNULL(MAX(question_order), 0) AS maxOrder FROM mock_questions WHERE mock_test_id = ?',
      [req.params.id]
    );
    const rows = normalized.map((q, i) => [
      req.params.id, maxOrder + i + 1, ...QUESTION_COLS.map(c => q[c] ?? null)
    ]);
    await db.query(
      `INSERT INTO mock_questions (mock_test_id, question_order, ${QUESTION_COLS.join(', ')}) VALUES ?`,
      [rows]
    );
    res.status(201).json({ imported: rows.length, message: `${rows.length} questions imported` });
  } catch (err) {
    console.error('adminBulkImportQuestions error:', err);
    res.status(500).json({ error: 'Failed to import questions' });
  }
};
