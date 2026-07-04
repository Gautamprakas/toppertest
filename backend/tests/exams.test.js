const request = require('supertest');
const app = require('../app');
const db = require('../config/db');

describe('Public exams endpoint', () => {
  afterAll(async () => {
    await db.end();
  });

  test('GET /api/exams returns an array', async () => {
    const res = await request(app).get('/api/exams');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
