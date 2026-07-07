const request = require('supertest');
const app = require('../app');
const db = require('../config/db');

const stamp = Date.now();
const adminEmail   = `ci-mock-admin-${stamp}@toppertest.com`;
const studentEmail = `ci-mock-student-${stamp}@toppertest.com`;
const otherEmail   = `ci-mock-other-${stamp}@toppertest.com`;
const password = 'TestPass@123';

let adminToken, studentToken, otherToken;
let seriesId, testId, questionIds = [];
let attemptId, attemptToken;

// 4 questions across 2 sections; correct answers: A, B, C, D
const QUESTIONS = [
  { section: 'GK', question_en: 'Capital of India?', options_en: ['New Delhi', 'Mumbai', 'Kolkata', 'Chennai'], correct: 'A' },
  { section: 'GK', question_en: '2 + 2 = ?', options_en: ['3', '4', '5', '6'], correct: 'B', explanation_en: 'Basic addition' },
  { section: 'Reasoning', question_en: 'Next in 2,4,6,...?', options_en: ['7', '9', '8', '10'], correct: 'C' },
  { section: 'Reasoning', question_en: 'Odd one out?', options_en: ['Dog', 'Cat', 'Cow', 'Car'], correct: 'D' },
];

async function registerAndLogin(email) {
  const res = await request(app).post('/api/register').send({ name: 'CI Mock Tester', email, password });
  return res.body.token;
}

beforeAll(async () => {
  adminToken   = await registerAndLogin(adminEmail);
  studentToken = await registerAndLogin(studentEmail);
  otherToken   = await registerAndLogin(otherEmail);
  // Promote to admin directly (independent of seeded admin credentials),
  // then re-login so the JWT carries role=admin
  await db.query('UPDATE users SET role = "admin" WHERE email = ?', [adminEmail]);
  const relog = await request(app).post('/api/login').send({ email: adminEmail, password });
  adminToken = relog.body.token;
});

afterAll(async () => {
  if (seriesId) await db.query('DELETE FROM test_series WHERE id = ?', [seriesId]); // CASCADE clears tests/questions/attempts
  await db.query('DELETE FROM users WHERE email IN (?,?,?)', [adminEmail, studentEmail, otherEmail]);
  await db.end();
});

describe('Mock test series — admin setup', () => {
  test('student cannot create a series (403)', async () => {
    const res = await request(app).post('/api/admin/test-series')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ track_code: 'UPP_ASI_SI', title: 'Nope' });
    expect(res.status).toBe(403);
  });

  test('admin creates a series', async () => {
    const res = await request(app).post('/api/admin/test-series')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ track_code: 'UPP_ASI_SI', title: `CI Series ${stamp}`, description: 'test series' });
    expect(res.status).toBe(201);
    seriesId = res.body.id;
  });

  test('admin creates a mock test (2 marks correct, 0.5 negative)', async () => {
    const res = await request(app).post('/api/admin/mock-tests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ series_id: seriesId, title: 'CI Mock Test 1', test_number: 1, duration_minutes: 30, marks_correct: 2, negative_marks: 0.5 });
    expect(res.status).toBe(201);
    testId = res.body.id;
  });

  test('bulk import validates and inserts questions', async () => {
    const res = await request(app).post(`/api/admin/mock-tests/${testId}/questions/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ questions: QUESTIONS });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(4);
  });

  test('bulk import rejects invalid rows with per-row errors', async () => {
    const res = await request(app).post(`/api/admin/mock-tests/${testId}/questions/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ questions: [{ question_en: 'No options', correct: 'A' }] });
    expect(res.status).toBe(400);
    expect(res.body.failed[0].index).toBe(0);
  });

  test('unauthenticated cannot list admin questions (401)', async () => {
    const res = await request(app).get(`/api/admin/mock-tests/${testId}/questions`);
    expect(res.status).toBe(401);
  });
});

describe('Mock test series — student flow', () => {
  test('series detail shows the test with question_count and no attempts yet', async () => {
    const res = await request(app).get(`/api/test-series/${seriesId}`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(200);
    const t = res.body.tests.find(t => t.id === testId);
    expect(t.question_count).toBe(4);
    expect(t.total_marks).toBe(8);
    expect(t.attempt_status).toBe('not_attempted');
  });

  test('start returns questions WITHOUT answers or explanations', async () => {
    const res = await request(app).post(`/api/mock-tests/${testId}/start`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBe(4);
    attemptId = res.body.attempt_id;
    attemptToken = res.body.attempt_token;
    questionIds = res.body.questions.map(q => q.id);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('correct_option');
    expect(raw).not.toContain('explanation');
  });

  test('submit scores correctly: 2 correct, 1 wrong, 1 skipped -> 3.5', async () => {
    // Q1 correct (A), Q2 correct (B), Q3 wrong (A, actual C), Q4 skipped
    const answers = {
      [questionIds[0]]: 'A',
      [questionIds[1]]: 'B',
      [questionIds[2]]: 'A',
    };
    const res = await request(app).post(`/api/mock-tests/${testId}/submit`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ attempt_id: attemptId, attempt_token: attemptToken, answers, time_taken: 300 });
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(3.5); // 2*2 - 1*0.5
    expect(res.body.correct_count).toBe(2);
    expect(res.body.wrong_count).toBe(1);
    expect(res.body.skipped_count).toBe(1);
    // Section breakdown
    expect(res.body.sections.GK.correct).toBe(2);
    expect(res.body.sections.Reasoning.wrong).toBe(1);
    expect(res.body.sections.Reasoning.skipped).toBe(1);
    // Solutions present after submit
    const q3 = res.body.questions.find(q => q.id === questionIds[2]);
    expect(q3.correct_option).toBe('C');
    expect(q3.user_answer).toBe('A');
  });

  test('re-submitting the same attempt fails (400)', async () => {
    const res = await request(app).post(`/api/mock-tests/${testId}/submit`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ attempt_id: attemptId, attempt_token: attemptToken, answers: {}, time_taken: 300 });
    expect(res.status).toBe(400);
  });

  test('review is owner-only (other user gets 404)', async () => {
    const own = await request(app).get(`/api/mock-attempts/${attemptId}/review`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect(own.status).toBe(200);
    expect(own.body.score).toBe(3.5);

    const other = await request(app).get(`/api/mock-attempts/${attemptId}/review`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(other.status).toBe(404);
  });

  test('series detail now shows completed with best score', async () => {
    const res = await request(app).get(`/api/test-series/${seriesId}`)
      .set('Authorization', `Bearer ${studentToken}`);
    const t = res.body.tests.find(t => t.id === testId);
    expect(t.attempt_status).toBe('completed');
    expect(t.best_score).toBe(3.5);
  });
});
