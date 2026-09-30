require('dotenv').config();
const pool = require('../src/db/pool');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Seeding database…');

    // Clear existing seed data
    await client.query(`
      TRUNCATE order_items, orders, reviews, menu_items, menu_categories, restaurants, promo_codes CASCADE
    `);

    // ── Restaurants ──────────────────────────────────────────────
    const restaurants = [
      { name: 'Woodfire Pizza Co.', emoji: '🍕', category: 'Pizza',
        tags: ['Pizza','Italian','Pasta'], rating: 4.8, review_count: 312,
        delivery_fee: 0.00, delivery_min: 22, description: 'Neapolitan-style wood-fired pizzas made with imported San Marzano tomatoes.' },
      { name: "Stack'd Burgers", emoji: '🍔', category: 'Burgers',
        tags: ['Burgers','American','Fries'], rating: 4.6, review_count: 198,
        delivery_fee: 1.99, delivery_min: 18, description: 'Smash burgers done right — crispy edges, juicy centres.' },
      { name: 'Sakura Sushi', emoji: '🍣', category: 'Sushi',
        tags: ['Sushi','Japanese','Ramen'], rating: 4.9, review_count: 445,
        delivery_fee: 2.49, delivery_min: 35, description: 'Omakase-inspired rolls and authentic Japanese mains.' },
      { name: 'Spice Route', emoji: '🍛', category: 'Indian',
        tags: ['Indian','Curry','Naan'], rating: 4.7, review_count: 261,
        delivery_fee: 0.00, delivery_min: 30, description: 'North and South Indian classics, made with whole spices.' },
      { name: 'Taco Loco', emoji: '🌮', category: 'Mexican',
        tags: ['Mexican','Burritos','Quesadillas'], rating: 4.5, review_count: 183,
        delivery_fee: 1.49, delivery_min: 20, description: 'Street-style tacos and burritos, straight from the plancha.' },
      { name: 'Greens & Grains', emoji: '🥗', category: 'Salads',
        tags: ['Salads','Bowls','Healthy'], rating: 4.6, review_count: 140,
        delivery_fee: 0.00, delivery_min: 15, description: 'Seasonal salads and grain bowls that actually fill you up.' },
    ];

    const restRows = [];
    for (const r of restaurants) {
      const { rows } = await client.query(`
        INSERT INTO restaurants (name, emoji, category, tags, rating, review_count, delivery_fee, delivery_min, description)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
      `, [r.name, r.emoji, r.category, r.tags, r.rating, r.review_count, r.delivery_fee, r.delivery_min, r.description]);
      restRows.push({ ...r, id: rows[0].id });
    }

    // ── Menu items per restaurant ─────────────────────────────────
    const menus = {
      'Woodfire Pizza Co.': [
        { cat: '🔥 Popular', items: [
          { name: 'Margherita', desc: 'San Marzano tomato, fresh mozzarella, basil', price: 14.99, emoji: '🍕' },
          { name: 'Pepperoni Classic', desc: 'Double pepperoni, smoked mozzarella', price: 16.99, emoji: '🍕' },
          { name: 'Truffle Mushroom', desc: 'Wild mushrooms, truffle oil, fontina', price: 18.99, emoji: '🍕' },
        ]},
        { cat: '🥗 Sides', items: [
          { name: 'Caesar salad', desc: 'Romaine, croutons, parmesan dressing', price: 8.99, emoji: '🥗' },
          { name: 'Garlic bread', desc: 'Woodfire toasted, herb butter', price: 5.99, emoji: '🥖' },
        ]},
        { cat: '🍰 Desserts', items: [
          { name: 'Tiramisu', desc: 'House-made, espresso soaked', price: 7.99, emoji: '🍰' },
        ]},
      ],
      "Stack'd Burgers": [
        { cat: '🔥 Popular', items: [
          { name: 'Double Smash Burger', desc: 'Two smashed patties, American cheese, pickles, sauce', price: 13.99, emoji: '🍔' },
          { name: 'BBQ Bacon Stack', desc: 'Beef patty, crispy bacon, cheddar, BBQ sauce', price: 15.99, emoji: '🍔' },
          { name: 'Spicy Crispy Chicken', desc: 'Buttermilk fried chicken, jalapeño mayo, slaw', price: 13.49, emoji: '🍗' },
        ]},
        { cat: '🍟 Sides', items: [
          { name: 'Loaded fries', desc: 'Crispy fries, cheese sauce, jalapeños, bacon', price: 7.49, emoji: '🍟' },
          { name: 'Onion rings', desc: 'Battered, golden fried', price: 5.99, emoji: '🧅' },
        ]},
      ],
      'Sakura Sushi': [
        { cat: '🍱 Rolls', items: [
          { name: 'Spicy Tuna Roll', desc: 'Fresh tuna, cucumber, spicy mayo, sesame', price: 14.99, emoji: '🍣' },
          { name: 'Dragon Roll', desc: 'Shrimp tempura, avocado, eel sauce', price: 16.99, emoji: '🍣' },
          { name: 'California Roll', desc: 'Crab, avocado, cucumber', price: 12.99, emoji: '🍣' },
        ]},
        { cat: '🍜 Mains', items: [
          { name: 'Tonkotsu Ramen', desc: 'Rich pork broth, chashu, soft egg, nori', price: 15.99, emoji: '🍜' },
          { name: 'Chicken Teriyaki', desc: 'Grilled chicken, steamed rice, miso soup', price: 13.99, emoji: '🍱' },
        ]},
      ],
      'Spice Route': [
        { cat: '🍛 Mains', items: [
          { name: 'Butter Chicken', desc: 'Creamy tomato gravy, tender chicken, basmati', price: 15.99, emoji: '🍛' },
          { name: 'Lamb Biryani', desc: 'Slow-cooked lamb, fragrant basmati, raita', price: 17.99, emoji: '🍛' },
          { name: 'Paneer Tikka Masala', desc: 'Grilled paneer, rich masala sauce, butter naan', price: 14.99, emoji: '🍛' },
        ]},
        { cat: '🫓 Breads & Sides', items: [
          { name: 'Garlic Naan', desc: 'Fresh from tandoor, garlic butter', price: 3.99, emoji: '🫓' },
          { name: 'Mango Lassi', desc: 'Fresh mango, yogurt, cardamom', price: 4.99, emoji: '🥭' },
        ]},
      ],
      'Taco Loco': [
        { cat: '🌮 Tacos', items: [
          { name: 'Al Pastor Tacos (3)', desc: 'Marinated pork, pineapple, cilantro, onion', price: 11.99, emoji: '🌮' },
          { name: 'Carne Asada Tacos (3)', desc: 'Grilled steak, guac, pico de gallo', price: 13.99, emoji: '🌮' },
        ]},
        { cat: '🌯 Wraps & More', items: [
          { name: 'Chicken Burrito', desc: 'Grilled chicken, rice, beans, cheese, salsa', price: 12.99, emoji: '🌯' },
          { name: 'Cheese Quesadilla', desc: 'Three cheese blend, jalapeños, sour cream', price: 9.99, emoji: '🧀' },
          { name: 'Chips & Guacamole', desc: 'Fresh-made guac, tortilla chips', price: 6.99, emoji: '🥑' },
        ]},
      ],
      'Greens & Grains': [
        { cat: '🥗 Salads', items: [
          { name: 'The Harvest Bowl', desc: 'Kale, roasted sweet potato, feta, lemon vinaigrette', price: 13.99, emoji: '🥗' },
          { name: 'Greek Salad', desc: 'Tomato, cucumber, olives, feta, red onion', price: 11.99, emoji: '🥗' },
        ]},
        { cat: '🍚 Grain Bowls', items: [
          { name: 'Quinoa Power Bowl', desc: 'Quinoa, chickpeas, roasted veggies, tahini', price: 14.99, emoji: '🥙' },
          { name: 'Brown Rice & Salmon', desc: 'Seared salmon, edamame, sesame-ginger dressing', price: 16.99, emoji: '🐟' },
        ]},
      ],
    };

    for (const rest of restRows) {
      const sections = menus[rest.name] || [];
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        const { rows: catRows } = await client.query(
          `INSERT INTO menu_categories (restaurant_id, name, sort_order) VALUES ($1,$2,$3) RETURNING id`,
          [rest.id, s.cat, i]
        );
        const catId = catRows[0].id;
        for (let j = 0; j < s.items.length; j++) {
          const item = s.items[j];
          await client.query(
            `INSERT INTO menu_items (restaurant_id, category_id, name, description, price, emoji, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [rest.id, catId, item.name, item.desc, item.price, item.emoji, j]
          );
        }
      }
    }

    // ── Promo codes ───────────────────────────────────────────────
    await client.query(`
      INSERT INTO promo_codes (code, discount_type, discount_value, min_order, max_uses, is_active)
      VALUES
        ('BITE50',   'percent', 50, 0,     1000, true),
        ('FREESHIP', 'fixed',   2.99, 15,  500,  true),
        ('SAVE5',    'fixed',   5.00, 25,  200,  true)
    `);

    await client.query('COMMIT');
    console.log('✅ Database seeded successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
