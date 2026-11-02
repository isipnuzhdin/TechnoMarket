
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');

const app = express();

app.use(cors({
  origin(origin, callback) {
    const allowed = [
      'http://172.18.0.1:5173',
'http://10.203.68.77:5173',
      process.env.CLIENT_URL,
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:5175'
    ].filter(Boolean);

    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS: адрес сайта не разрешён'));
    }
  }
}));

app.use(express.json({ limit: '32kb' }));

// ПОДКЛЮЧЕНИЕ К POSTGRESQL
const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'tech_store'
});

const query = (sql, params = []) => db.query(sql, params);

const wrap = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

const str = (value, max = 255) =>
  typeof value === 'string'
    ? value.trim().slice(0, max)
    : '';

const email = value => str(value, 190).toLowerCase();

const validEmail = value =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const validPhone = value =>
  /^\+?[\d\s()-]{7,25}$/.test(value);

const validPassword = value =>
  typeof value === 'string' &&
  value.length >= 8 &&
  value.length <= 72;

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(value + 'T00:00:00Z');

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function createToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

// АВТОРИЗАЦИЯ
const auth = wrap(async (req, res, next) => {
  const token = (req.headers.authorization || '')
    .replace(/^Bearer /, '');

  let payload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    fail('Войдите в аккаунт', 401);
  }

  const result = await query(
    `SELECT id, full_name, email, phone,
            address AS default_address, role
     FROM users
     WHERE id = $1`,
    [payload.sub]
  );

  if (!result.rows.length) {
    fail('Пользователь не найден', 401);
  }

  req.user = result.rows[0];
  next();
});

// ПРОВЕРКА ПРАВ АДМИНИСТРАТОРА
const admin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return next(
      Object.assign(new Error('Нет доступа'), {
        status: 403
      })
    );
  }

  next();
};

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

// РЕГИСТРАЦИЯ
app.post('/api/register', limiter, wrap(async (req, res) => {
  const name = str(req.body.full_name, 120);
  const mail = email(req.body.email);
  const phone = str(req.body.phone, 25);
  const password = req.body.password;

  if (
    name.length < 2 ||
    !validEmail(mail) ||
    !validPhone(phone) ||
    !validPassword(password)
  ) {
    fail('Проверьте ФИО, email, телефон и пароль (8–72 символа)');
  }

  const hash = await bcrypt.hash(password, 12);

  await query(
    `INSERT INTO users
     (full_name, email, phone, password_hash)
     VALUES ($1, $2, $3, $4)`,
    [name, mail, phone, hash]
  );

  res.json({ message: 'Регистрация успешна' });
}));

// ВХОД
app.post('/api/login', limiter, wrap(async (req, res) => {
  const result = await query(
    'SELECT * FROM users WHERE email = $1',
    [email(req.body.email)]
  );

  const user = result.rows[0];

  if (
    !user ||
    typeof req.body.password !== 'string' ||
    !(await bcrypt.compare(
      req.body.password,
      user.password_hash
    ))
  ) {
    fail('Неверный email или пароль', 401);
  }

  res.json({
    token: createToken(user),
    user: {
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      default_address: user.address,
      role: user.role
    }
  });
}));

// ВОССТАНОВЛЕНИЕ ПАРОЛЯ
app.post('/api/password-reset/request', limiter,
  wrap(async (req, res) => {
    const result = await query(
      'SELECT id FROM users WHERE email = $1',
      [email(req.body.email)]
    );

    const user = result.rows[0];

    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');

      const hash = crypto.createHash('sha256')
        .update(resetToken)
        .digest('hex');

      await query(
        `UPDATE users
         SET reset_token_hash = $1,
             reset_expires = NOW() + INTERVAL '15 minutes'
         WHERE id = $2`,
        [hash, user.id]
      );

      if (process.env.NODE_ENV !== 'production') {
        console.log(
          'LOCAL RESET LINK:',
          `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset?token=${resetToken}`
        );
      }
    }

    res.json({
      message: 'Если email зарегистрирован, ссылка для восстановления находится в консоли сервера.'
    });
  })
);

app.post('/api/password-reset/confirm', limiter,
  wrap(async (req, res) => {
    const password = req.body.password;
    const resetToken = str(req.body.token, 128);

    if (!validPassword(password) || !resetToken) {
      fail('Проверьте новый пароль и ссылку');
    }

    const hash = crypto.createHash('sha256')
      .update(resetToken)
      .digest('hex');

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      `UPDATE users
       SET password_hash = $1,
           reset_token_hash = NULL,
           reset_expires = NULL
       WHERE reset_token_hash = $2
         AND reset_expires > NOW()`,
      [passwordHash, hash]
    );

    if (!result.rowCount) {
      fail('Ссылка недействительна или истекла');
    }

    res.json({ message: 'Пароль изменён' });
  })
);

// ЛИЧНЫЙ КАБИНЕТ
app.get('/api/me', auth, (req, res) => {
  res.json(req.user);
});

app.patch('/api/me', auth, wrap(async (req, res) => {
  const name = str(req.body.full_name, 120);
  const mail = email(req.body.email);
  const phone = str(req.body.phone, 25);
  const address = str(req.body.default_address, 500);

  if (
    name.length < 2 ||
    !validEmail(mail) ||
    !validPhone(phone)
  ) {
    fail('Проверьте личные данные');
  }

  await query(
    `UPDATE users
     SET full_name = $1,
         email = $2,
         phone = $3,
         address = $4
     WHERE id = $5`,
    [name, mail, phone, address, req.user.id]
  );

  res.json({ message: 'Данные сохранены' });
}));

// ИЗМЕНЕНИЕ ПАРОЛЯ
app.patch('/api/me/password', auth,
  wrap(async (req, res) => {
    const result = await query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    const oldPassword = req.body.old_password || '';

    if (!(await bcrypt.compare(
      oldPassword,
      result.rows[0].password_hash
    ))) {
      fail('Неверный текущий пароль');
    }

    if (!validPassword(req.body.new_password)) {
      fail('Новый пароль должен содержать 8–72 символа');
    }

    const hash = await bcrypt.hash(
      req.body.new_password,
      12
    );

    await query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hash, req.user.id]
    );

    res.json({ message: 'Пароль изменён' });
  })
);

// КАТЕГОРИИ
app.get('/api/categories', wrap(async (req, res) => {
  const result = await query(
    'SELECT name FROM categories ORDER BY name'
  );

  res.json(result.rows);
}));

// ТОВАРЫ СО СКИДКАМИ
app.get('/api/products', wrap(async (req, res) => {
  const result = await query(
    `SELECT
       p.name,
       p.description,
       p.duration AS duration_minutes,
       p.price AS original_price,
       p.discount_percent,
       ROUND(
         p.price * (100 - p.discount_percent) / 100.0,
         2
       ) AS price,
       p.stock,
       c.name AS category
     FROM products p
     JOIN categories c ON c.id = p.category_id
     ORDER BY p.name`
  );

  res.json(result.rows);
}));

// ПРОСМОТР ОТЗЫВОВ
app.get('/api/reviews/:product', wrap(async (req, res) => {
  const result = await query(
    `SELECT u.full_name,
            r.rating,
            r.comment,
            r.created_at
     FROM reviews r
     JOIN users u ON u.id = r.user_id
     JOIN products p ON p.id = r.product_id
     WHERE p.name = $1
     ORDER BY r.created_at DESC`,
    [req.params.product]
  );

  res.json(result.rows);
}));

// ДОБАВЛЕНИЕ ОТЗЫВА
app.post('/api/reviews', auth, wrap(async (req, res) => {
  const product = str(req.body.product, 150);
  const rating = Number(req.body.rating);
  const comment = str(req.body.comment, 1000);

  if (
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5 ||
    comment.length < 3
  ) {
    fail('Оценка от 1 до 5 и комментарий от 3 символов');
  }

  const result = await query(
    `INSERT INTO reviews
     (user_id, product_id, rating, comment)
     SELECT $1, p.id, $2, $3
     FROM products p
     WHERE p.name = $4
     ON CONFLICT (user_id, product_id)
     DO UPDATE SET
       rating = EXCLUDED.rating,
       comment = EXCLUDED.comment,
       created_at = NOW()
     RETURNING id`,
    [req.user.id, rating, comment, product]
  );

  if (!result.rowCount) {
    fail('Товар не найден', 404);
  }

  res.json({ message: 'Отзыв сохранён' });
}));

// КОРЗИНА: ПРОСМОТР СО СКИДКАМИ
app.get('/api/cart', auth, wrap(async (req, res) => {
  const result = await query(
    `SELECT
       p.name,
       p.price AS original_price,
       p.discount_percent,
       ROUND(
         p.price * (100 - p.discount_percent) / 100.0,
         2
       ) AS price,
       p.stock,
       c.quantity,
       ROUND(
         p.price * (100 - p.discount_percent) /
         100.0 * c.quantity,
         2
       ) AS subtotal
     FROM cart_items c
     JOIN products p ON p.id = c.product_id
     WHERE c.user_id = $1
     ORDER BY p.name`,
    [req.user.id]
  );

  res.json(result.rows);
}));

// КОРЗИНА: ДОБАВЛЕНИЕ
app.post('/api/cart', auth, wrap(async (req, res) => {
  const name = str(req.body.product, 150);
  const qty = Number(req.body.quantity ?? 1);

  if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
    fail('Количество должно быть от 1 до 99');
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const productResult = await client.query(
      `SELECT id, stock
       FROM products
       WHERE name = $1
       FOR UPDATE`,
      [name]
    );

    const product = productResult.rows[0];

    if (!product) {
      fail('Товар не найден', 404);
    }

    const oldResult = await client.query(
      `SELECT quantity
       FROM cart_items
       WHERE user_id = $1 AND product_id = $2`,
      [req.user.id, product.id]
    );

    const currentQty = oldResult.rows[0]?.quantity || 0;

    if (
      currentQty + qty > product.stock ||
      currentQty + qty > 99
    ) {
      fail('Недостаточно товара или превышен лимит');
    }

    await client.query(
      `INSERT INTO cart_items
       (user_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET
         quantity = cart_items.quantity + EXCLUDED.quantity`,
      [req.user.id, product.id, qty]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Товар добавлен',
      quantity: currentQty + qty
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

// КОРЗИНА: КНОПКА МИНУС
app.patch('/api/cart/:product/decrease', auth,
  wrap(async (req, res) => {
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `SELECT c.id, c.quantity
         FROM cart_items c
         JOIN products p ON p.id = c.product_id
         WHERE c.user_id = $1
           AND p.name = $2
         FOR UPDATE OF c`,
        [req.user.id, req.params.product]
      );

      if (!result.rows.length) {
        fail('Товар не найден в корзине', 404);
      }

      const item = result.rows[0];

      if (item.quantity > 1) {
        await client.query(
          `UPDATE cart_items
           SET quantity = quantity - 1
           WHERE id = $1`,
          [item.id]
        );
      } else {
        await client.query(
          'DELETE FROM cart_items WHERE id = $1',
          [item.id]
        );
      }

      await client.query('COMMIT');

      res.json({
        message: 'Количество изменено',
        quantity: item.quantity - 1
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })
);

// КОРЗИНА: УДАЛЕНИЕ ТОВАРА
app.delete('/api/cart/:product', auth,
  wrap(async (req, res) => {
    await query(
      `DELETE FROM cart_items
       WHERE user_id = $1
         AND product_id IN (
           SELECT id FROM products WHERE name = $2
         )`,
      [req.user.id, req.params.product]
    );

    res.json({ message: 'Товар удалён' });
  })
);

// КУПОНЫ: ПРОСМОТР
app.get('/api/coupons', auth, wrap(async (req, res) => {
  const result = await query(
    `SELECT
       code,
       discount_percent,
       is_used,
       expires_at
     FROM user_coupons
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC`,
    [req.user.id]
  );

  res.json(result.rows);
}));

// КУПОНЫ: ПРОВЕРКА
app.post('/api/coupons/check', auth,
  wrap(async (req, res) => {
    const code = str(req.body.code, 50).toUpperCase();

    if (!code) {
      fail('Введите код купона');
    }

    const result = await query(
      `SELECT discount_percent
       FROM user_coupons
       WHERE user_id = $1
         AND UPPER(code) = $2
         AND is_used = FALSE
         AND (
           expires_at IS NULL
           OR expires_at > NOW()
         )`,
      [req.user.id, code]
    );

    if (!result.rows.length) {
      fail('Купон не найден или уже использован');
    }

    res.json({
      code,
      discount_percent: result.rows[0].discount_percent
    });
  })
);

// ОФОРМЛЕНИЕ ЗАКАЗА
app.post('/api/orders', auth, wrap(async (req, res) => {
  const address = str(req.body.delivery_address, 500);
  const date = str(req.body.delivery_date, 10);
  const couponCode = str(
    req.body.coupon_code,
    50
  ).toUpperCase();

  if (address.length < 8 || !validDate(date)) {
    fail('Проверьте адрес и дату доставки');
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const todayResult = await client.query(
      "SELECT TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') AS today"
    );

    if (date < todayResult.rows[0].today) {
      fail('Дата доставки не может быть в прошлом');
    }

    const cartResult = await client.query(
      `SELECT product_id, quantity
       FROM cart_items
       WHERE user_id = $1
       FOR UPDATE`,
      [req.user.id]
    );

    if (!cartResult.rows.length) {
      fail('Корзина пуста');
    }

    const productIds = cartResult.rows.map(
      item => item.product_id
    );

    const productResult = await client.query(
      `SELECT id, name, price, discount_percent, stock
       FROM products
       WHERE id = ANY($1::integer[])
       ORDER BY id
       FOR UPDATE`,
      [productIds]
    );

    const products = new Map(
      productResult.rows.map(p => [p.id, p])
    );

    const items = cartResult.rows.map(item => ({
      ...item,
      ...products.get(item.product_id)
    }));

    if (items.some(item =>
      !item.id || item.quantity > item.stock
    )) {
      fail('Недостаточно товара на складе');
    }

    // СЧИТАЕМ ЦЕНУ ТОВАРОВ СО СКИДКАМИ
    const pricedItems = items.map(item => ({
      ...item,
      finalPrice: Math.round(
        Number(item.price) *
        (100 - Number(item.discount_percent))
      ) / 100
    }));

    const itemsTotal = pricedItems.reduce(
      (sum, item) =>
        sum + item.finalPrice * item.quantity,
      0
    );

    // ПРОВЕРЯЕМ ПЕРСОНАЛЬНЫЙ КУПОН
    let coupon = null;

    if (couponCode) {
      const couponResult = await client.query(
        `SELECT id, discount_percent
         FROM user_coupons
         WHERE user_id = $1
           AND UPPER(code) = $2
           AND is_used = FALSE
           AND (
             expires_at IS NULL
             OR expires_at > NOW()
           )
         FOR UPDATE`,
        [req.user.id, couponCode]
      );

      coupon = couponResult.rows[0];

      if (!coupon) {
        fail('Купон недействителен или уже использован');
      }
    }

    const total = Math.round(
      itemsTotal *
      (100 - (coupon?.discount_percent || 0))
    ) / 100;

    const orderResult = await client.query(
      `INSERT INTO orders
       (user_id, delivery_address, delivery_date, total_amount)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [req.user.id, address, date, total]
    );

    const orderId = orderResult.rows[0].id;

    for (const item of pricedItems) {
      await client.query(
        `INSERT INTO order_items
         (order_id, product_id, product_name, quantity, price)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          orderId,
          item.id,
          item.name,
          item.quantity,
          item.finalPrice
        ]
      );

      await client.query(
        `UPDATE products
         SET stock = stock - $1
         WHERE id = $2`,
        [item.quantity, item.id]
      );
    }

    if (coupon) {
      await client.query(
        `UPDATE user_coupons
         SET is_used = TRUE
         WHERE id = $1`,
        [coupon.id]
      );
    }

    await client.query(
      'DELETE FROM cart_items WHERE user_id = $1',
      [req.user.id]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Заказ оформлен',
      order_number: orderId,
      total,
      coupon_discount_percent:
        coupon?.discount_percent || 0
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

// ИСТОРИЯ ЗАКАЗОВ
app.get('/api/orders', auth, wrap(async (req, res) => {
  const result = await query(
    `SELECT
       o.id AS order_number,
       o.delivery_address,
       TO_CHAR(o.delivery_date, 'YYYY-MM-DD') AS delivery_date,
       o.status,
       o.total_amount AS total,
       o.created_at,
       STRING_AGG(
         oi.product_name || ' ×' || oi.quantity::text,
         ', '
       ) AS items
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.user_id = $1
     GROUP BY o.id
     ORDER BY o.created_at DESC`,
    [req.user.id]
  );

  res.json(result.rows);
}));

// АДМИН: ПРОСМОТР КУПОНОВ
app.get('/api/admin/coupons', auth, admin,
  wrap(async (req, res) => {
    const result = await query(
      `SELECT
         u.email,
         uc.code,
         uc.discount_percent,
         uc.is_used,
         uc.expires_at
       FROM user_coupons uc
       JOIN users u ON u.id = uc.user_id
       ORDER BY uc.created_at DESC, uc.id DESC`
    );

    res.json(result.rows);
  })
);

// АДМИН: СОЗДАНИЕ КУПОНА
app.post('/api/admin/coupons', auth, admin,
  wrap(async (req, res) => {
    const mail = email(req.body.email);
    const code = str(req.body.code, 50).toUpperCase();
    const discount = Number(req.body.discount_percent);
    const expires = req.body.expires_at || null;

    if (
      !validEmail(mail) ||
      !/^[A-Z0-9_-]{3,50}$/.test(code) ||
      !Number.isInteger(discount) ||
      discount < 1 ||
      discount > 90
    ) {
      fail('Проверьте email, код и размер скидки');
    }

    if (
      expires !== null &&
      !validDate(expires)
    ) {
      fail('Некорректная дата окончания купона');
    }

    const result = await query(
      `INSERT INTO user_coupons
       (user_id, code, discount_percent, expires_at)
       SELECT u.id, $2, $3, $4::timestamp
       FROM users u
       WHERE u.email = $1
       RETURNING id`,
      [mail, code, discount, expires]
    );

    if (!result.rowCount) {
      fail('Пользователь не найден', 404);
    }

    res.json({
      message: 'Купон выдан пользователю'
    });
  })
);

// НАСТРОЙКИ АДМИН-ПАНЕЛИ
const allowed = {
  categories: {
    key: 'name',
    fields: ['name']
  },

  products: {
    key: 'name',
    fields: [
      'name',
      'description',
      'duration_minutes',
      'price',
      'stock',
      'discount_percent',
      'category'
    ]
  },

  reviews: {
    key: 'id',
    fields: ['rating', 'comment']
  },

  orders: {
    key: 'id',
    fields: [
      'status',
      'delivery_address',
      'delivery_date'
    ]
  },

  users: {
    key: 'email',
    fields: [
      'full_name',
      'email',
      'phone',
      'default_address'
    ]
  }
};

const adminQueries = {
  categories:
    'SELECT name FROM categories ORDER BY name',

  products:
    `SELECT
       p.name,
       p.description,
       p.duration AS duration_minutes,
       p.price,
       p.stock,
       p.discount_percent,
       c.name AS category
     FROM products p
     JOIN categories c ON c.id = p.category_id
     ORDER BY p.name`,

  reviews:
    `SELECT
       r.id,
       u.email AS author,
       p.name AS product,
       r.rating,
       r.comment
     FROM reviews r
     JOIN users u ON u.id = r.user_id
     JOIN products p ON p.id = r.product_id`,

  orders:
    `SELECT
       o.id,
       u.email AS customer,
       o.delivery_address,
       TO_CHAR(o.delivery_date, 'YYYY-MM-DD') AS delivery_date,
       o.status,
       o.total_amount AS total
     FROM orders o
     JOIN users u ON u.id = o.user_id`,

  users:
    `SELECT
       full_name,
       email,
       phone,
       address AS default_address,
       role
     FROM users`
};

// АДМИН: ПРОСМОТР
app.get('/api/admin/:resource', auth, admin,
  wrap(async (req, res) => {
    const resource = req.params.resource;

    if (!allowed[resource]) {
      fail('Ресурс не найден', 404);
    }

    const result = await query(adminQueries[resource]);
    res.json(result.rows);
  })
);

// АДМИН: ДОБАВЛЕНИЕ
app.post('/api/admin/:resource', auth, admin,
  wrap(async (req, res) => {
    const resource = req.params.resource;
    const body = req.body;

    if (!['categories', 'products'].includes(resource)) {
      fail('Создание недоступно');
    }

    if (resource === 'categories') {
      const name = str(body.name, 80);

      if (!name) {
        fail('Укажите категорию');
      }

      await query(
        'INSERT INTO categories(name) VALUES($1)',
        [name]
      );
    } else {
      const name = str(body.name, 150);
      const description = str(body.description, 5000);
      const category = str(body.category, 80);
      const price = Number(body.price);
      const stock = Number(body.stock);
      const duration = Number(body.duration_minutes || 0);
      const discount = Number(body.discount_percent ?? 0);

      if (
        !name ||
        !description ||
        !category ||
        body.price === '' ||
        body.price == null ||
        body.stock === '' ||
        body.stock == null ||
        !Number.isFinite(price) ||
        price < 0 ||
        !Number.isInteger(stock) ||
        stock < 0 ||
        !Number.isInteger(duration) ||
        duration < 0 ||
        !Number.isInteger(discount) ||
        discount < 0 ||
        discount > 90
      ) {
        fail('Проверьте поля товара');
      }

      const result = await query(
        `INSERT INTO products
         (
           category_id,
           name,
           description,
           duration,
           price,
           stock,
           discount_percent
         )
         SELECT
           id, $1, $2, $3, $4, $5, $7
         FROM categories
         WHERE name = $6
         RETURNING id`,
        [
          name,
          description,
          duration,
          price,
          stock,
          category,
          discount
        ]
      );

      if (!result.rowCount) {
        fail('Категория не найдена', 404);
      }
    }

    res.json({ message: 'Создано' });
  })
);

// АДМИН: ИЗМЕНЕНИЕ
app.patch('/api/admin/:resource/:key', auth, admin,
  wrap(async (req, res) => {
    const resource = req.params.resource;
    const config = allowed[resource];

    if (!config) {
      fail('Ресурс не найден', 404);
    }

    const body = req.body;

    const fields = config.fields.filter(field =>
      Object.prototype.hasOwnProperty.call(body, field)
    );

    if (!fields.length) {
      fail('Нет полей для изменения');
    }

    const changes = [];

    for (const field of fields) {
      let column = field;
      let value = body[field];

      if (field === 'category') {
        const result = await query(
          'SELECT id FROM categories WHERE name = $1',
          [str(value, 80)]
        );

        if (!result.rows.length) {
          fail('Категория не найдена', 404);
        }

        column = 'category_id';
        value = result.rows[0].id;
      } else if (field === 'duration_minutes') {
        column = 'duration';
      } else if (field === 'default_address') {
        column = 'address';
      }

      if (
        [
          'price',
          'stock',
          'duration_minutes',
          'discount_percent'
        ].includes(field)
      ) {
        if (
          value === '' ||
          value == null ||
          !Number.isFinite(Number(value)) ||
          Number(value) < 0
        ) {
          fail('Некорректное число');
        }

        value = Number(value);

        if (
          [
            'stock',
            'duration_minutes',
            'discount_percent'
          ].includes(field) &&
          !Number.isInteger(value)
        ) {
          fail('Требуется целое число');
        }

        if (
          field === 'discount_percent' &&
          value > 90
        ) {
          fail('Скидка должна быть от 0 до 90%');
        }
      }

      if (field === 'rating') {
        value = Number(value);

        if (
          !Number.isInteger(value) ||
          value < 1 ||
          value > 5
        ) {
          fail('Оценка должна быть от 1 до 5');
        }
      }

      if (field === 'email') {
        value = email(value);

        if (!validEmail(value)) {
          fail('Некорректный email');
        }
      }

      if (
        field === 'phone' &&
        !validPhone(value)
      ) {
        fail('Некорректный телефон');
      }

      if (
        field === 'status' &&
        ![
          'new',
          'processing',
          'shipped',
          'completed',
          'cancelled'
        ].includes(value)
      ) {
        fail('Некорректный статус');
      }

      if (field === 'delivery_date') {
        if (!validDate(value)) {
          fail('Некорректная дата');
        }

        const today = await query(
          "SELECT TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') AS today"
        );

        if (value < today.rows[0].today) {
          fail('Дата доставки не может быть в прошлом');
        }
      }

      if (typeof value === 'string') {
        value = value.trim();

        if (
          !value &&
          field !== 'default_address'
        ) {
          fail('Поле не может быть пустым');
        }
      }

      changes.push({ column, value });
    }

    const values = changes.map(item => item.value);
    values.push(req.params.key);

    const sql = `
      UPDATE ${resource}
      SET ${changes.map(
        (item, index) =>
          `${item.column} = $${index + 1}`
      ).join(', ')}
      WHERE ${config.key} = $${values.length}
    `;

    const result = await query(sql, values);

    if (!result.rowCount) {
      fail('Запись не найдена', 404);
    }

    res.json({ message: 'Обновлено' });
  })
);

// АДМИН: УДАЛЕНИЕ
app.delete('/api/admin/:resource/:key', auth, admin,
  wrap(async (req, res) => {
    const resource = req.params.resource;
    const config = allowed[resource];

    if (!config) {
      fail('Ресурс не найден', 404);
    }

    if (
      resource === 'users' &&
      req.params.key === req.user.email
    ) {
      fail('Нельзя удалить свой аккаунт');
    }

    const result = await query(
      `DELETE FROM ${resource}
       WHERE ${config.key} = $1`,
      [req.params.key]
    );

    if (!result.rowCount) {
      fail('Запись не найдена', 404);
    }

    res.json({ message: 'Удалено' });
  })
);

// ПРОВЕРКА СЕРВЕРА И POSTGRESQL
app.get('/api/health', wrap(async (req, res) => {
  await query('SELECT 1');

  res.json({
    status: 'ok',
    database: 'PostgreSQL',
    message: 'Сервер и база данных работают'
  });
}));

// ОБРАБОТКА ОШИБОК
app.use((error, req, res, next) => {
  if (error.code === '23505') {
    return res.status(409).json({
      error: 'Такая запись уже существует'
    });
  }

  if (error.code === '23503') {
    return res.status(409).json({
      error: 'Запись используется в других данных'
    });
  }

  if (
    error.code === '23514' ||
    error.code === '23502' ||
    error.code === '22P02' ||
    error.code === '22007'
  ) {
    return res.status(400).json({
      error: 'Некорректные данные'
    });
  }

  console.error(error);

  res.status(error.status || 500).json({
    error: error.status
      ? error.message
      : 'Ошибка сервера'
  });
});

// ЗАПУСК СЕРВЕРА
if (
  !process.env.JWT_SECRET ||
  process.env.JWT_SECRET === 'replace_with_long_random_secret'
) {
  throw new Error('Укажите JWT_SECRET в файле .env');
}

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`API http://localhost:${PORT}`);
});
