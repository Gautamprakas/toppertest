const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../config/db');

const JWT_SECRET  = process.env.JWT_SECRET || 'toppertest_secret_2024';
const JWT_EXPIRES = '7d';

exports.register = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required' });

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) return res.status(409).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (name, email, password, phone) VALUES (?,?,?,?)',
      [name.trim(), email.toLowerCase(), hashed, phone || null]
    );

    const token = jwt.sign(
      { id: result.insertId, name, email, role: 'student' },
      JWT_SECRET, { expiresIn: JWT_EXPIRES }
    );

    res.status(201).json({ message: 'Registered successfully', token, user: { id: result.insertId, name, email, role: 'student' } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const [rows] = await db.query('SELECT * FROM users WHERE email = ? AND is_active = 1', [email.toLowerCase()]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET, { expiresIn: JWT_EXPIRES }
    );

    res.json({ message: 'Login successful', token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
};

exports.profile = async (req, res) => {
  const [rows] = await db.query(
    'SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?',
    [req.user.id]
  );
  res.json(rows[0] || {});
};
