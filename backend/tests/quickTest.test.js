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
