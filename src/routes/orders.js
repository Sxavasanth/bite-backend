const router = require('express').Router();
const pool = require('../db/pool');
const auth = require('../middleware/auth');

// All order routes require auth
router.use(auth);

// POST /api/orders — place a new order
router.post('/', async (req, res) => {
  const { restaurant_id, items, address_id, notes, promo_code } = req.body;

  if (!restaurant_id || !items || !items.length) {
    return res.status(400).json({ error: 'restaurant_id and items are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate restaurant
    const { rows: restRows } = await client.query(
      'SELECT id, delivery_fee, is_open FROM restaurants WHERE id = $1',
      [restaurant_id]
    );
    if (!restRows[0]) return res.status(404).json({ error: 'Restaurant not found' });
    if (!restRows[0].is_open) return res.status(400).json({ error: 'Restaurant is currently closed' });

    const deliveryFee = parseFloat(restRows[0].delivery_fee);

    // Validate and price each item
    const itemIds = items.map(i => i.menu_item_id);
    const { rows: dbItems } = await client.query(
      `SELECT id, price, name FROM menu_items
       WHERE id = ANY($1::uuid[]) AND restaurant_id = $2 AND is_available = true`,
      [itemIds, restaurant_id]
    );

    if (dbItems.length !== itemIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'One or more items are unavailable' });
    }

    const itemMap = Object.fromEntries(dbItems.map(i => [i.id, i]));
    let subtotal = 0;
    const orderItems = items.map(i => {
      const db = itemMap[i.menu_item_id];
      const qty = Math.max(1, parseInt(i.quantity) || 1);
      const sub = parseFloat(db.price) * qty;
      subtotal += sub;
      return { menu_item_id: i.menu_item_id, name: db.name, price: db.price, quantity: qty, subtotal: sub };
    });

    // Apply promo code
    let discount = 0;
    if (promo_code) {
      const { rows: promoRows } = await client.query(
        `SELECT * FROM promo_codes
         WHERE code = $1 AND is_active = true
           AND (expires_at IS NULL OR expires_at > NOW())
           AND (max_uses IS NULL OR used_count < max_uses)
           AND min_order <= $2`,
        [promo_code.toUpperCase(), subtotal]
      );
      if (promoRows[0]) {
        const p = promoRows[0];
        discount = p.discount_type === 'percent'
          ? subtotal * (p.discount_value / 100)
          : parseFloat(p.discount_value);
        discount = Math.min(discount, subtotal);
        await client.query(
          'UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1',
          [p.id]
        );
      }
    }

    const tax = (subtotal - discount) * 0.08;
    const total = subtotal - discount + deliveryFee + tax;

    // Insert order
    const { rows: orderRows } = await client.query(
      `INSERT INTO orders
         (user_id, restaurant_id, address_id, status, subtotal, delivery_fee, tax, total,
          promo_code, discount, notes, estimated_mins)
       VALUES ($1,$2,$3,'confirmed',$4,$5,$6,$7,$8,$9,$10,30)
       RETURNING *`,
      [req.user.id, restaurant_id, address_id || null,
       subtotal.toFixed(2), deliveryFee.toFixed(2),
       tax.toFixed(2), total.toFixed(2),
       promo_code || null, discount.toFixed(2), notes || null]
    );
    const order = orderRows[0];

    // Insert order items
    for (const oi of orderItems) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.id, oi.menu_item_id, oi.name, oi.price, oi.quantity, oi.subtotal]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...order, items: orderItems });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Order failed' });
  } finally {
    client.release();
  }
});

// GET /api/orders — current user's order history
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, r.name AS restaurant_name, r.emoji AS restaurant_emoji
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.user_id = $1
       ORDER BY o.placed_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/orders/:id — single order with items
router.get('/:id', async (req, res) => {
  try {
    const { rows: orderRows } = await pool.query(
      `SELECT o.*, r.name AS restaurant_name, r.emoji AS restaurant_emoji
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.id = $1 AND o.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!orderRows[0]) return res.status(404).json({ error: 'Order not found' });

    const { rows: items } = await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [req.params.id]
    );

    res.json({ ...orderRows[0], items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// PATCH /api/orders/:id/cancel — cancel a pending/confirmed order
router.patch('/:id/cancel', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE orders SET status = 'cancelled'
       WHERE id = $1 AND user_id = $2 AND status IN ('pending','confirmed')
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Order cannot be cancelled' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Cancellation failed' });
  }
});

module.exports = router;
