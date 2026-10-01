const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const nodemailer = require('nodemailer');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

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
        `INSERT INTO users (name, email, password, phone) VALUES ($1,$2,$3,$4) RETURNING id, name, email, phone`,
        [name, email, hash, phone || null]
      );
      const user = rows[0];
      res.status(201).json({ token: sign(user), user });
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
        'SELECT id, name, email, phone, password FROM users WHERE email = $1',
        [email]
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
      `UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone), updated_at = NOW()
       WHERE id = $3 RETURNING id, name, email, phone`,
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
    // Always return 200 to prevent email enumeration
    res.json({ message: 'If that email is registered, a reset link is on its way.' });

    try {
      const { rows } = await pool.query(
        'SELECT id, name FROM users WHERE email = $1', [email]
      );
      if (!rows[0]) return; // silently stop — already sent 200

      const user = rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Invalidate any existing tokens for this user
      await pool.query(
        'UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false',
        [user.id]
      );

      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, token, expires]
      );

      const resetUrl = `${process.env.FRONTEND_URL}?token=${token}`;

      await mailer.sendMail({
        from: `"Bite 🍕" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Reset your Bite password',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
            <h1 style="font-size:28px;font-weight:800;color:#e8622a;margin-bottom:8px">bite.</h1>
            <h2 style="font-size:20px;font-weight:700;margin-bottom:12px">Reset your password</h2>
            <p style="color:#555;margin-bottom:24px">Hi ${user.name}, click the button below to set a new password. This link expires in 1 hour.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#e8622a;color:#fff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none">Reset password</a>
            <p style="color:#999;font-size:13px;margin-top:24px">If you didn't request this, you can safely ignore this email.</p>
            <p style="color:#ccc;font-size:12px;margin-top:8px">Or copy this link: ${resetUrl}</p>
          </div>
        `,
      });
    } catch (err) {
      console.error('Forgot password error:', err);
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
        `SELECT prt.id, prt.user_id, prt.expires_at, prt.used
         FROM password_reset_tokens prt
         WHERE prt.token = $1`,
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
