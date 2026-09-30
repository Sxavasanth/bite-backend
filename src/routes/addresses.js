const router = require('express').Router();
const pool = require('../db/pool');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/addresses
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
    [req.user.id]
  );
  res.json(rows);
});

// POST /api/addresses
router.post('/', async (req, res) => {
  const { label, line1, line2, city, state, zip, is_default } = req.body;
  if (!line1 || !city || !state || !zip) {
    return res.status(400).json({ error: 'line1, city, state, zip are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_default) {
      await client.query(
        'UPDATE addresses SET is_default = false WHERE user_id = $1', [req.user.id]
      );
    }
    const { rows } = await client.query(
      `INSERT INTO addresses (user_id, label, line1, line2, city, state, zip, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, label || 'Home', line1, line2 || null, city, state, zip, is_default || false]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to save address' });
  } finally {
    client.release();
  }
});

// DELETE /api/addresses/:id
router.delete('/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM addresses WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Address not found' });
  res.json({ success: true });
});

module.exports = router;
