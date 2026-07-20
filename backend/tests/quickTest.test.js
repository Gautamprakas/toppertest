const request = require('supertest');
const app = require('../app');
const db = require('../config/db');

afterAll(async () => {
  await db.end();
});

describe('Guest quick test', () => {
  test('anonymous request returns an english passage with text', async () => {
    const res = await request(app).get('/api/quick-test?language=english');
    expect(res.status).toBe(200);
    expect(res.body.language).toBe('english');
    expect(typeof res.body.passage_text).toBe('string');
    expect(res.body.passage_text.length).toBeGreaterThan(50);
  });

  test('hindi passages are served when requested', async () => {
    const res = await request(app).get('/api/quick-test?language=hindi');
    expect(res.status).toBe(200);
    expect(res.body.language).toBe('hindi');
  });

  test('invalid language falls back to english', async () => {
    const res = await request(app).get('/api/quick-test?language=klingon');
    expect(res.status).toBe(200);
    expect(res.body.language).toBe('english');
  });
});

describe('Guest quick test — date & passage picker', () => {
  test('GET /passages/dates works without exam_id (aggregated across exams)', async () => {
    const res = await request(app).get('/api/passages/dates?language=english');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('picking a specific passage_id returns exactly that passage', async () => {
    const list = await request(app).get('/api/passages?language=english');
    const target = list.body[0];
    const res = await request(app).get(`/api/quick-test?language=english&passage_id=${target.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(target.id);
    expect(res.body.title).toBe(target.title);
  });

  test('an unknown passage_id returns 404', async () => {
    const res = await request(app).get('/api/quick-test?language=english&passage_id=999999999');
    expect(res.status).toBe(404);
  });

  test('picking a valid date returns a passage from that date', async () => {
    const dates = await request(app).get('/api/passages/dates?language=english');
    const date = dates.body[0];
    const res = await request(app).get(`/api/quick-test?language=english&date=${date}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.passage_text).toBe('string');
  });
});
