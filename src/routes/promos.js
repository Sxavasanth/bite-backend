const router = require('express').Router();
const pool = require('../db/pool');
const auth = require('../middleware/auth');

// POST /api/promos/validate  — check a promo code before checkout
router.post('/validate', auth, async (req, res) => {
  const { code, subtotal } = req.body;
  if (!code) return res.status(400).json({ error: 'Code is required' });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM promo_codes
       WHERE code = $1 AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (max_uses IS NULL OR used_count < max_uses)`,
      [code.toUpperCase()]
    );
    const promo = rows[0];
    if (!promo) return res.status(404).json({ error: 'Invalid or expired code' });

    const sub = parseFloat(subtotal) || 0;
    if (sub < parseFloat(promo.min_order)) {
      return res.status(400).json({
        error: `Minimum order $${promo.min_order} required for this code`
      });
    }

    const discount = promo.discount_type === 'percent'
      ? sub * (promo.discount_value / 100)
      : parseFloat(promo.discount_value);

    res.json({
      valid: true,
      code: promo.code,
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
      discount_amount: Math.min(discount, sub).toFixed(2),
    });
  } catch (err) {
    res.status(500).json({ error: 'Validation failed' });
  }
});

module.exports = router;
