const request = require('supertest');
const app = require('../app');
const db = require('../config/db');

const stamp = Date.now();
const email = `ci-daily-${stamp}@toppertest.com`;
const password = 'TestPass@123';

let token, userId, examId, passageId, challengeId;

beforeAll(async () => {
  const reg = await request(app).post('/api/register').send({ name: 'CI Daily Tester', email, password });
  token = reg.body.token;
  userId = reg.body.user.id;

  const [[exam]] = await db.query('SELECT id, exam_name FROM exams WHERE is_active = 1 LIMIT 1');
  examId = exam.id;
  const [p] = await db.query(
    `INSERT INTO passages (exam_id, passage_text, language, difficulty, passage_date, word_count, title)
     VALUES (?, 'daily challenge test passage words here', 'english', 'M', CURDATE(), 6, 'CI Daily Challenge Passage')`,
    [examId]
  );
  passageId = p.insertId;

  // Replace any existing challenge for today with ours (UNIQUE on challenge_date)
  await db.query('DELETE FROM daily_challenges WHERE challenge_date = CURDATE()');
  const [c] = await db.query(
    'INSERT INTO daily_challenges (passage_id, challenge_date) VALUES (?, CURDATE())',
    [passageId]
  );
  challengeId = c.insertId;
});

afterAll(async () => {
  await db.query('DELETE FROM daily_challenges WHERE id = ?', [challengeId]);
  await db.query('DELETE FROM typing_results WHERE user_id = ?', [userId]);
  await db.query('DELETE FROM passages WHERE id = ?', [passageId]);
  await db.query('DELETE FROM users WHERE email = ?', [email]);
  await db.end();
});

describe('Daily challenge', () => {
  test('anonymous request returns challenge meta without passage text', async () => {
    const res = await request(app).get('/api/daily-challenge');
    expect(res.status).toBe(200);
    expect(res.body.challenge.passage_id).toBe(passageId);
    expect(res.body.challenge.exam_id).toBe(examId);
    expect(res.body.my_result).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('daily challenge test passage');
  });

  test('logged-in user with a result today sees my_result and appears on the board', async () => {
    await db.query(
      `INSERT INTO typing_results (user_id, exam_id, passage_id, total_words, correct_words, wrong_words, wpm, accuracy, errors, time_taken)
       VALUES (?, ?, ?, 6, 6, 0, 42.5, 100, 0, 60)`,
      [userId, examId, passageId]
    );
    const res = await request(app).get('/api/daily-challenge').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Number(res.body.my_result.wpm)).toBe(42.5);
    expect(res.body.leaderboard.some(r => Number(r.wpm) === 42.5)).toBe(true);
  });
});

describe('Analytics extensions', () => {
  // Route renamed to /performance-stats — many ad-blockers blanket-block
  // any URL containing "analytics" as a tracker pattern. /analytics kept
  // as a compatibility alias and checked here too.
  test('performance-stats returns streak, personal best, week compare and weak words fields', async () => {
    const res = await request(app).get('/api/performance-stats').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.streak).toBeGreaterThanOrEqual(1); // result inserted today
    expect(Number(res.body.personal_best.wpm)).toBe(42.5);
    expect(res.body).toHaveProperty('week_compare');
    expect(Array.isArray(res.body.weak_words)).toBe(true);
  });

  test('/analytics alias still works', async () => {
    const res = await request(app).get('/api/analytics').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
  });
});
