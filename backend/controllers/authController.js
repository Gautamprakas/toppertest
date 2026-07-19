const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const db     = require('../config/db');

const JWT_SECRET  = process.env.JWT_SECRET || 'toppertest_secret_2024';
const JWT_EXPIRES = '7d';

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const phone = (req.body.phone || '').trim();
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required' });
    if (phone && !/^[6-9]\d{9}$/.test(phone))
      return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) return res.status(409).json({ error: 'Email already registered' });
    if (phone) {
      const [phoneTaken] = await db.query('SELECT id FROM users WHERE phone = ?', [phone]);
      if (phoneTaken.length) return res.status(409).json({ error: 'Mobile number already registered' });
    }

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
    // Accepts email OR 10-digit mobile in one field ("identifier"; the old
    // "email" body field still works for backward compatibility)
    const identifier = String(req.body.identifier || req.body.email || '').trim();
    const { password } = req.body;
    if (!identifier || !password) return res.status(400).json({ error: 'Email/mobile and password required' });

    const isPhone = /^\d{10}$/.test(identifier);
    const [rows] = isPhone
      ? await db.query('SELECT * FROM users WHERE phone = ? AND is_active = 1', [identifier])
      : await db.query('SELECT * FROM users WHERE email = ? AND is_active = 1', [identifier.toLowerCase()]);
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
