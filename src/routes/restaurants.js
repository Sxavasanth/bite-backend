const router = require('express').Router();
const pool = require('../db/pool');

// GET /api/restaurants  — list all, with optional ?category= and ?q=
router.get('/', async (req, res) => {
  const { category, q } = req.query;
  try {
    let query = `
      SELECT id, name, emoji, category, tags, rating, review_count,
             delivery_fee, delivery_min, description, is_open
      FROM restaurants
      WHERE is_open = true
    `;
    const params = [];
    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      query += ` AND (LOWER(name) LIKE $${params.length} OR LOWER(description) LIKE $${params.length})`;
    }
    query += ' ORDER BY rating DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch restaurants' });
  }
});

// GET /api/restaurants/:id  — single restaurant with full menu
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: restRows } = await pool.query(
      `SELECT id, name, emoji, category, tags, rating, review_count,
              delivery_fee, delivery_min, min_order, description, is_open
       FROM restaurants WHERE id = $1`,
      [id]
    );
    if (!restRows[0]) return res.status(404).json({ error: 'Restaurant not found' });
    const restaurant = restRows[0];

    // Fetch menu grouped by category
    const { rows: catRows } = await pool.query(
      `SELECT mc.id, mc.name, mc.sort_order FROM menu_categories mc
       WHERE mc.restaurant_id = $1 ORDER BY mc.sort_order`,
      [id]
    );
    const { rows: itemRows } = await pool.query(
      `SELECT id, category_id, name, description, price, emoji, sort_order, is_available
       FROM menu_items WHERE restaurant_id = $1 AND is_available = true
       ORDER BY sort_order`,
      [id]
    );

    restaurant.menu = catRows.map(cat => ({
      ...cat,
      items: itemRows.filter(i => i.category_id === cat.id),
    }));

    res.json(restaurant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch restaurant' });
  }
});

// GET /api/restaurants/:id/reviews
router.get('/:id/reviews', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS user_name
       FROM reviews r JOIN users u ON u.id = r.user_id
       WHERE r.restaurant_id = $1
       ORDER BY r.created_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

module.exports = router;
