const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

function sign(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register
router.post('/register',
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be 6+ characters'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { name, email, password, phone } = req.body;
    try {
      const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (exists.rows.length) return res.status(409).json({ error: 'Email already registered' });
      const hash = await bcrypt.hash(password, 12);
      const { rows } = await pool.query(
        'INSERT INTO users (name, email, password, phone) VALUES ($1,$2,$3,$4) RETURNING id, name, email, phone',
        [name, email, hash, phone || null]
      );
      res.status(201).json({ token: sign(rows[0]), user: rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// POST /api/auth/login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, password } = req.body;
    try {
      const { rows } = await pool.query(
        'SELECT id, name, email, phone, password FROM users WHERE email = $1', [email]
      );
      const user = rows[0];
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const { password: _, ...safe } = user;
      res.json({ token: sign(safe), user: safe });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, phone, avatar_url, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PATCH /api/auth/me
router.patch('/me', auth, async (req, res) => {
  const { name, phone } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone), updated_at = NOW() WHERE id = $3 RETURNING id, name, email, phone',
      [name || null, phone || null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password',
  body('email').isEmail().normalizeEmail(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email } = req.body;
    try {
      const { rows } = await pool.query(
        'SELECT id, name FROM users WHERE email = $1', [email]
      );
      if (!rows[0]) {
        return res.json({ message: 'If that email is registered, a reset link is on its way.', reset_url: null });
      }
      const user = rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000);
      await pool.query(
        'UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false',
        [user.id]
      );
      await pool.query(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, token, expires]
      );
      const resetUrl = (process.env.FRONTEND_URL || 'http://localhost:3000') + '?token=' + token;
      console.log('Password reset requested for:', email);
      // Note: SMTP is blocked on Railway free tier.
      // Returning reset_url directly for demo purposes.
      // In production, replace with an HTTP-based email service.
      res.json({
        message: 'Reset link generated successfully.',
        reset_url: resetUrl,
      });
    } catch (err) {
      console.error('Forgot password error:', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  }
);

// POST /api/auth/reset-password
router.post('/reset-password',
  body('token').notEmpty(),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid request' });
    const { token, password } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = $1',
        [token]
      );
      const record = rows[0];
      if (!record) return res.status(400).json({ error: 'Reset link is invalid.' });
      if (record.used) return res.status(400).json({ error: 'Reset link has already been used.' });
      if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
      const hash = await bcrypt.hash(password, 12);
      await client.query(
        'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
        [hash, record.user_id]
      );
      await client.query(
        'UPDATE password_reset_tokens SET used = true WHERE id = $1',
        [record.id]
      );
      await client.query('COMMIT');
      res.json({ message: 'Password updated successfully.' });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Reset password error:', err);
      res.status(500).json({ error: 'Password reset failed.' });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
