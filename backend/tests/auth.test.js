const request = require('supertest');
const app = require('../app');
const db = require('../config/db');

const email = `ci-test-${Date.now()}@toppertest.com`;
const password = 'TestPass@123';
const phone = '9' + String(Date.now()).slice(-9); // valid unique 10-digit mobile

describe('Auth flow', () => {
  let token;

  afterAll(async () => {
    await db.query('DELETE FROM users WHERE email = ?', [email]);
    await db.end();
  });

  test('POST /api/register creates a new user', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ name: 'CI Tester', email, password, phone });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(email);
  });

  test('POST /api/register rejects an invalid mobile number', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ name: 'CI Tester 2', email: `x${email}`, password, phone: '12345' });

    expect(res.status).toBe(400);
  });

  test('POST /api/register rejects a duplicate mobile number', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ name: 'CI Tester 2', email: `x${email}`, password, phone });

    expect(res.status).toBe(409);
  });

  test('POST /api/register rejects a duplicate email', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ name: 'CI Tester', email, password });

    expect(res.status).toBe(409);
  });

  test('POST /api/login rejects a wrong password', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email, password: 'WrongPass@123' });

    expect(res.status).toBe(401);
  });

  test('POST /api/login succeeds with correct credentials', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    token = res.body.token;
  });

  test('POST /api/login succeeds with mobile number as identifier', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ identifier: phone, password });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  test('GET /api/profile returns the logged-in user', async () => {
    const res = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
  });
});
