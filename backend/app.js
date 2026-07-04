const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const app  = express();

/* ── Security ──────────────────────────────────────────────────────────────── */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiter for auth
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many requests' } });
app.use('/api/login',    authLimiter);
app.use('/api/register', authLimiter);

// General limiter
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 200 }));

/* ── Routes ─────────────────────────────────────────────────────────────────── */
app.use('/api', require('./routes/index'));

/* ── Serve Frontend (production) ────────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/pages/index.html')));

module.exports = app;
