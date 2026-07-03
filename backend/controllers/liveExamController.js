const db = require('../config/db');

// ── Helpers ──────────────────────────────────────────────────────────────────
function nowIST() {
  // Return current IST time as JS Date
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function getStatus(le) {
  const now        = nowIST();
  const start      = new Date(le.scheduled_at);
  const joinEnd    = new Date(start.getTime() + le.join_window_mins * 60000);
  const examEnd    = new Date(start.getTime() + (le.join_window_mins + le.duration_minutes) * 60000 + 300000); // +5 min buffer

  if (le.results_released) return 'results_released';
  if (now < start)    return 'scheduled';
  if (now <= joinEnd) return 'active';      // can join
  if (now <= examEnd) return 'ongoing';     // joined users still typing, no new joins
  return 'ended';                           // over, results not yet released
}

// ── GET /live-exams  (list all, students see upcoming+active) ─────────────────
exports.getLiveExams = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT le.*,
        e.exam_name, e.word_limit, e.enable_highlighting,
        p.title AS passage_title, p.language, p.word_count,
        u.name AS created_by_name,
        (SELECT COUNT(*) FROM live_exam_attempts a WHERE a.live_exam_id = le.id) AS attempt_count
      FROM live_exams le
      JOIN exams    e ON le.exam_id    = e.id
      JOIN passages p ON le.passage_id = p.id
      JOIN users    u ON le.created_by = u.id
      ORDER BY le.scheduled_at DESC
    `);

    const result = rows.map(le => ({ ...le, computed_status: getStatus(le) }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch live exams' });
  }
};

// ── GET /live-exams/:id ───────────────────────────────────────────────────────
exports.getLiveExam = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT le.*,
        e.exam_name, e.word_limit, e.enable_highlighting,
        p.title AS passage_title, p.language, p.word_count,
        p.passage_text,
        (SELECT COUNT(*) FROM live_exam_attempts a WHERE a.live_exam_id = le.id) AS attempt_count
      FROM live_exams le
      JOIN exams    e ON le.exam_id    = e.id
      JOIN passages p ON le.passage_id = p.id
      WHERE le.id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Live exam not found' });
    res.json({ ...rows[0], computed_status: getStatus(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch live exam' });
  }
};

// ── POST /live-exams  (admin create) ─────────────────────────────────────────
exports.createLiveExam = async (req, res) => {
  try {
    const { title, exam_id, passage_id, scheduled_at, join_window_mins, duration_minutes, description } = req.body;
    if (!title)        return res.status(400).json({ error: 'Title required' });
    if (!exam_id)      return res.status(400).json({ error: 'exam_id required' });
    if (!passage_id)   return res.status(400).json({ error: 'passage_id required' });
    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });

    const [result] = await db.query(
      `INSERT INTO live_exams
         (title, exam_id, passage_id, scheduled_at, join_window_mins, duration_minutes, description, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        title, exam_id, passage_id, scheduled_at,
        parseInt(join_window_mins) || 10,
        parseInt(duration_minutes) || 15,
        description || '', req.user.id
      ]
    );
    res.status(201).json({ id: result.insertId, message: 'Live exam scheduled!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create live exam: ' + err.message });
  }
};

// ── DELETE /live-exams/:id ────────────────────────────────────────────────────
exports.deleteLiveExam = async (req, res) => {
  try {
    await db.query('DELETE FROM live_exams WHERE id = ?', [req.params.id]);
    res.json({ message: 'Live exam deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete live exam' });
  }
};

// ── POST /live-exams/:id/join  (student joins) ────────────────────────────────
exports.joinLiveExam = async (req, res) => {
  try {
    const user_id = req.user.id;
    const [rows] = await db.query(
      `SELECT le.*, e.word_limit, e.enable_highlighting, p.passage_text, p.title AS passage_title
       FROM live_exams le
       JOIN exams    e ON le.exam_id    = e.id
       JOIN passages p ON le.passage_id = p.id
       WHERE le.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Live exam not found' });
    const le = rows[0];
    const status = getStatus(le);

    if (status === 'scheduled') {
      const start = new Date(le.scheduled_at);
      return res.status(403).json({
        error: 'exam_not_started',
        message: `Exam hasn't started yet. Opens at ${start.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
        scheduled_at: le.scheduled_at
      });
    }
    if (status === 'ongoing') {
      return res.status(403).json({ error: 'join_window_closed', message: 'Join window has closed. Exam is ongoing.' });
    }
    if (status === 'ended' || status === 'results_released') {
      return res.status(403).json({ error: 'exam_ended', message: 'This exam has ended.' });
    }

    // Check if already attempted
    const [existing] = await db.query(
      'SELECT id FROM live_exam_attempts WHERE live_exam_id=? AND user_id=?',
      [le.id, user_id]
    );
    if (existing.length && existing[0].submitted_at) {
      return res.status(409).json({ error: 'already_submitted', message: 'You have already submitted this live exam.' });
    }

    // Create typing session
    const crypto = require('crypto');
    const sessionToken = crypto.randomBytes(32).toString('hex');

    await db.query(
      'UPDATE typing_sessions SET status="abandoned" WHERE user_id=? AND status="active"',
      [user_id]
    );
    const [session] = await db.query(
      'INSERT INTO typing_sessions (user_id, exam_id, passage_id, session_token) VALUES (?,?,?,?)',
      [user_id, le.exam_id, le.passage_id, sessionToken]
    );

    // Record attempt
    if (!existing.length) {
      await db.query(
        'INSERT INTO live_exam_attempts (live_exam_id, user_id, session_id) VALUES (?,?,?)',
        [le.id, user_id, session.insertId]
      );
    } else {
      await db.query(
        'UPDATE live_exam_attempts SET session_id=?, joined_at=NOW() WHERE live_exam_id=? AND user_id=?',
        [session.insertId, le.id, user_id]
      );
    }

    // Calculate time remaining for this student
    // Timer = min(duration_minutes, time until exam hard-end)
    const now     = nowIST();
    const start   = new Date(le.scheduled_at);
    const hardEnd = new Date(start.getTime() + (le.join_window_mins + le.duration_minutes) * 60000);
    const secsLeft = Math.max(60, Math.floor((hardEnd - now) / 1000));
    const effectiveDuration = Math.min(le.duration_minutes, Math.ceil(secsLeft / 60));

    res.json({
      session_id:          session.insertId,
      session_token:       sessionToken,
      passage_id:          le.passage_id,
      exam_id:             le.exam_id,
      word_limit:          le.word_limit || 0,
      enable_highlighting: le.enable_highlighting,
      duration_minutes:    effectiveDuration,
      secs_remaining:      secsLeft,
      live_exam_id:        le.id,
      live_exam_title:     le.title,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join live exam: ' + err.message });
  }
};

// ── POST /live-exams/:id/release-results  (admin) ─────────────────────────────
exports.releaseResults = async (req, res) => {
  try {
    await db.query(
      'UPDATE live_exams SET results_released=1, status="results_released" WHERE id=?',
      [req.params.id]
    );
    res.json({ message: 'Results released!' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to release results' });
  }
};

// ── GET /live-exams/:id/results  (leaderboard for this live exam) ─────────────
exports.getLiveExamResults = async (req, res) => {
  try {
    const [le] = await db.query('SELECT * FROM live_exams WHERE id=?', [req.params.id]);
    if (!le.length) return res.status(404).json({ error: 'Not found' });

    // Only show results if released (or admin)
    const isAdmin = req.user?.role === 'admin';
    if (!le[0].results_released && !isAdmin) {
      return res.status(403).json({ error: 'results_not_released', message: 'Results have not been released yet.' });
    }

    const [rows] = await db.query(`
      SELECT
        a.user_id, a.joined_at, a.submitted_at,
        u.name AS student_name,
        r.wpm, r.accuracy, r.correct_words, r.wrong_words,
        r.errors, r.time_taken, r.total_words,
        RANK() OVER (ORDER BY r.wpm DESC, r.accuracy DESC) AS \`rank\`
      FROM live_exam_attempts a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN typing_results r ON r.session_id = a.session_id
      WHERE a.live_exam_id = ?
      ORDER BY r.wpm DESC, r.accuracy DESC
    `, [req.params.id]);

    res.json({ live_exam: le[0], results: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
};

// ── PATCH /live-exams/:id/mark-attempt-submitted (called after submit-test) ───
exports.markAttemptSubmitted = async (req, res) => {
  try {
    const { result_id } = req.body;
    await db.query(
      'UPDATE live_exam_attempts SET submitted_at=NOW(), result_id=? WHERE live_exam_id=? AND user_id=?',
      [result_id || null, req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark attempt' });
  }
};
