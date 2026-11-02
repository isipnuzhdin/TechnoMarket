
import React, {
  createContext,
  useContext,
  useEffect,
  useState
} from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams
} from 'react-router-dom';
import './style.css';

const API = 'http://10.203.68.77:4000/api';

const ThemeContext = createContext(null);
const AuthContext = createContext(null);
const CartContext = createContext(null);

const money = value =>
  Number(value || 0).toLocaleString('ru-RU', {
    maximumFractionDigits: 2
  }) + ' ₽';

// ОБЩАЯ ТЕМА САЙТА
function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('techmarket-theme') === 'dark'
      ? 'dark'
      : 'light'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('techmarket-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(old => old === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// АВТОРИЗАЦИЯ И ЗАПРОСЫ К СЕРВЕРУ
function AuthProvider({ children }) {
  const [token, setToken] = useState(
    () => sessionStorage.getItem('token') || ''
  );
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!token);

  async function api(path, method = 'GET', body) {
    const response = await fetch(API + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token
          ? { Authorization: 'Bearer ' + token }
          : {})
      },
      ...(body !== undefined
        ? { body: JSON.stringify(body) }
        : {})
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Ошибка сервера');
    }

    return data;
  }

  useEffect(() => {
    let active = true;

    async function checkUser() {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const response = await fetch(API + '/me', {
          headers: {
            Authorization: 'Bearer ' + token
          }
        });

        if (!response.ok) {
          throw new Error('Сессия истекла');
        }

        const data = await response.json();

        if (active) setUser(data);
      } catch {
        if (active) {
          sessionStorage.removeItem('token');
          setToken('');
          setUser(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    checkUser();

    return () => {
      active = false;
    };
  }, [token]);

  function login(newToken, newUser) {
    sessionStorage.setItem('token', newToken);
    setUser(newUser);
    setToken(newToken);
  }

  function logout() {
    sessionStorage.removeItem('token');
    setToken('');
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        setUser,
        loading,
        api,
        login,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ОБЩАЯ КОРЗИНА ЧЕРЕЗ CONTEXT API
function CartProvider({ children }) {
  const { token, user, api } = useContext(AuthContext);
  const [cart, setCart] = useState([]);
  const [busy, setBusy] = useState(false);

  async function refreshCart() {
    if (!token) {
      setCart([]);
      return;
    }

    const data = await api('/cart');
    setCart(data);
  }

  useEffect(() => {
    if (!token) {
      setCart([]);
      return;
    }

    let active = true;

    api('/cart')
      .then(data => {
        if (active) setCart(data);
      })
      .catch(error => console.error(error));

    return () => {
      active = false;
    };
  }, [token]);

  async function changeCart(path, method, body) {
    setBusy(true);

    try {
      await api(path, method, body);
      await refreshCart();
    } finally {
      setBusy(false);
    }
  }

  const addItem = name =>
    changeCart('/cart', 'POST', {
      product: name,
      quantity: 1
    });

  const decreaseItem = name =>
    changeCart(
      '/cart/' + encodeURIComponent(name) + '/decrease',
      'PATCH'
    );

  const removeItem = name =>
    changeCart(
      '/cart/' + encodeURIComponent(name),
      'DELETE'
    );

  const count = cart.reduce(
    (sum, item) => sum + Number(item.quantity),
    0
  );

  const total = cart.reduce(
    (sum, item) => sum + Number(item.subtotal),
    0
  );

  return (
    <CartContext.Provider value={{
      cart,
      count,
      total,
      busy,
      user,
      addItem,
      decreaseItem,
      removeItem,
      refreshCart
    }}>
      {children}
    </CartContext.Provider>
  );
}

// СООБЩЕНИЯ ОБ ОШИБКАХ
function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function run(action) {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    message,
    setError,
    setMessage,
    run
  };
}

function Notices({ task }) {
  return (
    <>
      {task.busy && (
        <div className="notice">Загрузка...</div>
      )}

      {task.error && (
        <div className="notice error">
          {task.error}
        </div>
      )}

      {task.message && (
        <div className="notice success">
          {task.message}
        </div>
      )}
    </>
  );
}

// ШАПКА САЙТА
function Header() {
  const { user, logout } = useContext(AuthContext);
  const { count } = useContext(CartContext);
  const { theme, toggleTheme } = useContext(ThemeContext);
  const navigate = useNavigate();

  return (
    <header>
      <div className="brand">
        ⚡ ТехноМаркет
        <small>Компьютерная техника</small>
      </div>

      <nav>
        <NavLink to="/catalog">
          Каталог
        </NavLink>

       {user?.role !== 'admin' && (
  <NavLink to="/cart">
    Корзина ({count})
  </NavLink>
)}

        {user ? (
          <>
            <NavLink to="/dashboard">
              Личный кабинет
            </NavLink>

            {user.role === 'admin' && (
              <NavLink to="/admin">
                Админ-панель
              </NavLink>
            )}

            <button
              onClick={() => {
                logout();
                navigate('/catalog');
              }}
            >
              Выход
            </button>
          </>
        ) : (
          <>
            <NavLink to="/login">
              Вход
            </NavLink>

            <NavLink to="/register">
              Регистрация
            </NavLink>
          </>
        )}

        <button onClick={toggleTheme}>
          {theme === 'dark'
            ? '☀️ Светлая тема'
            : '🌙 Тёмная тема'}
        </button>
      </nav>
    </header>
  );
}

// КАРТОЧКА ТОВАРА С PROPS И USESTATE
function ProductCard({
  product,
  onAdd,
  onReviews,
  busy
}) {
  const [added, setAdded] = useState(0);
  const { user } = useContext(AuthContext);
const isAdmin = user?.role === 'admin';

  const icons = {
    'Ноутбуки': '💻',
    'Мониторы': '🖥️',
    'Клавиатуры': '⌨️',
    'Мыши': '🖱️',
    'Наушники': '🎧',
    'Комплектующие': '💾'
  };

  async function handleAdd() {
    const success = await onAdd(product.name);

    if (success) {
      setAdded(n => n + 1);
    }
  }

  return (
    <article className="product">
      <div className="product-icon">
        {icons[product.category] || '🖥️'}
      </div>

      <div className="tag">
        {product.category}
      </div>

      <h3>{product.name}</h3>

      <p>{product.description}</p>

      {Number(product.discount_percent) > 0 && (
        <span className="discount-badge">
          −{product.discount_percent}%
        </span>
      )}

      {Number(product.discount_percent) > 0 && (
        <div className="old-price">
          {money(product.original_price)}
        </div>
      )}

      <div className="price">
        {money(product.price)}
      </div>

      <p className="muted">
        В наличии: {product.stock}
      </p>

      {added > 0 && (
        <p className="muted">
          Добавлено за это посещение: {added}
        </p>
      )}

      <div className="actions">
        {!isAdmin && (
  <button
    disabled={!product.stock || busy}
    onClick={handleAdd}
  >
    В корзину
  </button>
)}

        <button
          className="secondary"
          onClick={() => onReviews(product.name)}
        >
          Отзывы
        </button>
      </div>
    </article>
  );
}

// КАТАЛОГ
function Catalog() {
  const { user, api } = useContext(AuthContext);
  const { addItem, busy } = useContext(CartContext);
  const navigate = useNavigate();
  const task = useTask();

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] =
    useState([]);

  useEffect(() => {
    task.run(async () => {
      const [p, c] = await Promise.all([
        api('/products'),
        api('/categories')
      ]);

      setProducts(p);
      setCategories(c);
    });
  }, []);

  function toggleCategory(name) {
    setSelectedCategories(old =>
      old.includes(name)
        ? old.filter(c => c !== name)
        : [...old, name]
    );
  }

 async function add(name) {
  if (!user) {
    navigate('/login');
    return false;
  }

  if (user.role === 'admin') {
    task.setError(
      'Администратор не может добавлять товары в корзину'
    );
    return false;
  }

    try {
      await addItem(name);
      navigate('/cart');
      return true;
    } catch (e) {
      task.setError(e.message);
      return false;
    }
  }

  const filtered = products.filter(p =>
    selectedCategories.length === 0 ||
    selectedCategories.includes(p.category)
  );

  return (
    <>
      <Notices task={task} />

      <section className="hero">
        <h1>
          Техника для работы, учёбы и игр
        </h1>

        <p>
          Выбирай устройства и оформляй
          доставку онлайн.
        </p>
      </section>

      <div className="section-head">
        <h2>Каталог товаров</h2>

        <span className="muted">
          Найдено: {filtered.length}
        </span>
      </div>

      <div className="catalog-layout">
        <aside className="catalog-sidebar">
          <h3>Категории</h3>

          {categories.map(c => (
            <label
              className="category-check"
              key={c.name}
            >
              <input
                type="checkbox"
                checked={
                  selectedCategories.includes(c.name)
                }
                onChange={() =>
                  toggleCategory(c.name)
                }
              />

              <span>{c.name}</span>
            </label>
          ))}

          {selectedCategories.length > 0 && (
            <button
              className="secondary"
              onClick={() =>
                setSelectedCategories([])
              }
            >
              Сбросить фильтры
            </button>
          )}
        </aside>

        <div>
          <div className="grid">
            {filtered.map(p => (
              <ProductCard
                key={p.name}
                product={p}
                busy={busy}
                onAdd={add}
                onReviews={name =>
                  navigate(
                    '/reviews/' +
                    encodeURIComponent(name)
                  )
                }
              />
            ))}
          </div>

          {!filtered.length && (
            <p>
              В выбранных категориях товаров нет.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/* ==========================================
   КОРЗИНА И ПЕРСОНАЛЬНЫЕ КУПОНЫ
========================================== */

function Cart() {
  const { user, api } = useContext(AuthContext);

  const {
    cart,
    total,
    busy,
    addItem,
    decreaseItem,
    removeItem,
    refreshCart
  } = useContext(CartContext);

  const task = useTask();

  const [address, setAddress] = useState('');
  const [date, setDate] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState(null);
  const [coupons, setCoupons] = useState([]);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [couponError, setCouponError] = useState('');

  useEffect(() => {
    if (!user) {
      setCoupons([]);
      return;
    }

    setAddress(user.default_address || '');

    api('/coupons')
      .then(setCoupons)
      .catch(console.error);
  }, [user?.email]);

  const couponPercent = Number(
    coupon?.discount_percent || 0
  );

  const couponSaving =
    Math.round(total * couponPercent) / 100;

  const finalTotal =
    Math.round((total - couponSaving) * 100) / 100;

  function localToday() {
    const now = new Date();

    now.setMinutes(
      now.getMinutes() - now.getTimezoneOffset()
    );

    return now.toISOString().slice(0, 10);
  }

  async function checkCoupon() {
    setCoupon(null);
    setCouponError('');

    const code = couponCode.trim();

    if (!code) {
      setCouponError('Введите код купона');
      return;
    }

    setCheckingCoupon(true);

    try {
      const result = await api(
        '/coupons/check',
        'POST',
        { code }
      );

      setCoupon(result);
      setCouponCode(result.code);
    } catch (error) {
      setCouponError(error.message);
    } finally {
      setCheckingCoupon(false);
    }
  }

  function clearCoupon() {
    setCoupon(null);
    setCouponCode('');
    setCouponError('');
  }

  function changeQuantity(action) {
    task.run(action);
  }

  function createOrder(event) {
    event.preventDefault();

    task.run(async () => {
      if (!cart.length) {
        throw new Error('Корзина пустая');
      }

      if (!address.trim()) {
        throw new Error('Введите адрес доставки');
      }

      if (!date) {
        throw new Error('Выберите дату доставки');
      }

      const result = await api(
        '/orders',
        'POST',
        {
          delivery_address: address.trim(),
          delivery_date: date,
          coupon_code: coupon?.code || ''
        }
      );

      await refreshCart();

      setDate('');
      clearCoupon();

      try {
        const updated = await api('/coupons');
        setCoupons(updated);
      } catch (error) {
        console.error(error);
      }

      task.setMessage(
        'Заказ №' +
        result.order_number +
        ' успешно оформлен! Сумма: ' +
        money(result.total)
      );
    });
  }

  return (
    <section className="panel">
      <h2>Корзина</h2>

      <Notices task={task} />

      {!user ? (
        <p>
          Для работы с корзиной необходимо
          войти в аккаунт.
        </p>
      ) : cart.length === 0 ? (
        <p>Ваша корзина пока пустая.</p>
      ) : (
        <>
          <div className="cart-items">
            {cart.map(item => (
              <div
                className="cart-row"
                key={item.name}
              >
                <div>
                  <h3>{item.name}</h3>

                  {Number(
                    item.discount_percent
                  ) > 0 && (
                    <>
                      <span className="discount-badge">
                        −{item.discount_percent}%
                      </span>

                      <p className="old-price">
                        {money(item.original_price)}
                      </p>
                    </>
                  )}

                  <p>
                    Цена за штуку:{' '}
                    <b>{money(item.price)}</b>
                  </p>
                </div>

                <div className="cart-quantity">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || task.busy}
                    onClick={() =>
                      changeQuantity(() =>
                        decreaseItem(item.name)
                      )
                    }
                  >
                    −
                  </button>

                  <strong>
                    {item.quantity}
                  </strong>

                  <button
                    type="button"
                    disabled={
                      busy ||
                      task.busy ||
                      Number(item.quantity) >=
                        Number(item.stock)
                    }
                    onClick={() =>
                      changeQuantity(() =>
                        addItem(item.name)
                      )
                    }
                  >
                    +
                  </button>
                </div>

                <div>
                  <b>{money(item.subtotal)}</b>
                </div>

                <button
                  type="button"
                  className="danger"
                  disabled={busy || task.busy}
                  onClick={() =>
                    changeQuantity(() =>
                      removeItem(item.name)
                    )
                  }
                >
                  Удалить
                </button>
              </div>
            ))}
          </div>

          <div className="coupon-box">
            <h3>🎟️ Персональный купон</h3>

            <p className="muted">
              Введи код купона, который
              выдал администратор.
            </p>

            <div className="coupon-input-row">
              <input
                type="text"
                placeholder="Например, TECH10"
                value={couponCode}
                disabled={!!coupon}
                onChange={event => {
                  setCouponCode(
                    event.target.value.toUpperCase()
                  );
                  setCouponError('');
                }}
              />

              {coupon ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={clearCoupon}
                >
                  Убрать
                </button>
              ) : (
                <button
                  type="button"
                  disabled={checkingCoupon || busy}
                  onClick={checkCoupon}
                >
                  {checkingCoupon
                    ? 'Проверка...'
                    : 'Применить'}
                </button>
              )}
            </div>

            {couponError && (
              <p className="coupon-error">
                {couponError}
              </p>
            )}

            {coupon && (
              <p className="coupon-success">
                ✓ Купон {coupon.code} применён.
                Дополнительная скидка{' '}
                {couponPercent}%.
              </p>
            )}

            {coupons.some(c =>
              !c.is_used &&
              (!c.expires_at ||
                new Date(c.expires_at) > new Date())
            ) && (
              <div className="available-coupons">
                <h4>Доступные купоны</h4>

                {coupons
                  .filter(c =>
                    !c.is_used &&
                    (!c.expires_at ||
                      new Date(c.expires_at) >
                        new Date())
                  )
                  .map(c => (
                    <button
                      type="button"
                      className="secondary"
                      key={c.code}
                      onClick={() => {
                        setCoupon(null);
                        setCouponCode(c.code);
                        setCouponError('');
                      }}
                    >
                      {c.code}
                      {' '}
                      (−{c.discount_percent}%)
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div className="order-summary">
            <div className="summary-row">
              <span>
                Стоимость товаров:
              </span>

              <b>{money(total)}</b>
            </div>

            {coupon && (
              <div className="summary-row">
                <span>
                  Скидка по купону:
                </span>

                <b className="coupon-success">
                  −{money(couponSaving)}
                </b>
              </div>
            )}

            <div className="summary-row summary-total">
              <strong>Итого:</strong>

              <strong>
                {money(finalTotal)}
              </strong>
            </div>
          </div>

          <form onSubmit={createOrder}>
            <h3>Оформление заказа</h3>

            <label>
              Адрес доставки

              <input
                required
                minLength={8}
                maxLength={500}
                placeholder="Город, улица, дом, квартира"
                value={address}
                onChange={event =>
                  setAddress(event.target.value)
                }
              />
            </label>

            <label>
              Дата доставки

              <input
                type="date"
                required
                min={localToday()}
                value={date}
                onChange={event =>
                  setDate(event.target.value)
                }
              />
            </label>

            <button
              type="submit"
              disabled={task.busy || busy}
            >
              Оформить заказ —{' '}
              {money(finalTotal)}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

/* ==========================================
   РЕГИСТРАЦИЯ И АВТОРИЗАЦИЯ
========================================== */

function AuthPage({ register = false }) {
  const { api, login } = useContext(AuthContext);
  const navigate = useNavigate();
  const task = useTask();

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    confirm: ''
  });

  function update(name, value) {
    setForm(old => ({
      ...old,
      [name]: value
    }));
  }

  function submit(event) {
    event.preventDefault();

    task.run(async () => {
      if (register) {
        if (form.password !== form.confirm) {
          throw new Error('Пароли не совпадают');
        }

        await api(
          '/register',
          'POST',
          {
            full_name: form.full_name,
            email: form.email,
            phone: form.phone,
            password: form.password
          }
        );

        navigate('/login');
      } else {
        const result = await api(
          '/login',
          'POST',
          {
            email: form.email,
            password: form.password
          }
        );

        login(result.token, result.user);

        navigate('/dashboard');
      }
    });
  }

  return (
    <section className="panel narrow">
      <h2>
        {register
          ? 'Регистрация'
          : 'Вход в аккаунт'}
      </h2>

      <Notices task={task} />

      <form onSubmit={submit}>
        {register && (
          <label>
            ФИО

            <input
              required
              minLength={2}
              maxLength={120}
              value={form.full_name}
              onChange={event =>
                update(
                  'full_name',
                  event.target.value
                )
              }
            />
          </label>
        )}

        <label>
          Электронная почта

          <input
            required
            type="email"
            value={form.email}
            onChange={event =>
              update(
                'email',
                event.target.value
              )
            }
          />
        </label>

        {register && (
          <label>
            Телефон

            <input
              required
              type="tel"
              minLength={7}
              value={form.phone}
              onChange={event =>
                update(
                  'phone',
                  event.target.value
                )
              }
            />
          </label>
        )}

        <label>
          Пароль

          <input
            required
            type="password"
            minLength={register ? 8 : 1}
            value={form.password}
            onChange={event =>
              update(
                'password',
                event.target.value
              )
            }
          />
        </label>

        {register && (
          <label>
            Повторите пароль

            <input
              required
              type="password"
              minLength={8}
              value={form.confirm}
              onChange={event =>
                update(
                  'confirm',
                  event.target.value
                )
              }
            />
          </label>
        )}

        <button
          type="submit"
          disabled={task.busy}
        >
          {register
            ? 'Зарегистрироваться'
            : 'Войти'}
        </button>
      </form>

      {!register && (
        <button
          type="button"
          className="link"
          onClick={() =>
            navigate('/forgot')
          }
        >
          Забыли пароль?
        </button>
      )}
    </section>
  );
}

/* ==========================================
   ВОССТАНОВЛЕНИЕ ПАРОЛЯ
========================================== */

function ForgotPassword() {
  const { api } = useContext(AuthContext);
  const task = useTask();

  const [email, setEmail] = useState('');

  function submit(event) {
    event.preventDefault();

    task.run(async () => {
      const result = await api(
        '/password-reset/request',
        'POST',
        { email }
      );

      task.setMessage(
        result.message ||
        'Запрос на восстановление отправлен'
      );
    });
  }

  return (
    <section className="panel narrow">
      <h2>Восстановление пароля</h2>

      <Notices task={task} />

      <p className="muted">
        В учебной версии ссылка для
        восстановления может выводиться
        в терминале сервера.
      </p>

      <form onSubmit={submit}>
        <label>
          Электронная почта

          <input
            required
            type="email"
            value={email}
            onChange={event =>
              setEmail(event.target.value)
            }
          />
        </label>

        <button
          type="submit"
          disabled={task.busy}
        >
          Восстановить пароль
        </button>
      </form>
    </section>
  );
}

function ResetPassword() {
  const { api } = useContext(AuthContext);
  const navigate = useNavigate();
  const task = useTask();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const params = new URLSearchParams(
    window.location.search
  );

  const resetToken =
    params.get('token') ||
    params.get('reset') ||
    '';

  function submit(event) {
    event.preventDefault();

    task.run(async () => {
      if (!resetToken) {
        throw new Error(
          'Отсутствует токен восстановления'
        );
      }

      if (password !== confirm) {
        throw new Error('Пароли не совпадают');
      }

      await api(
        '/password-reset/confirm',
        'POST',
        {
          token: resetToken,
          password
        }
      );

      navigate('/login');
    });
  }

  return (
    <section className="panel narrow">
      <h2>Установка нового пароля</h2>

      <Notices task={task} />

      <form onSubmit={submit}>
        <label>
          Новый пароль

          <input
            required
            type="password"
            minLength={8}
            value={password}
            onChange={event =>
              setPassword(event.target.value)
            }
          />
        </label>

        <label>
          Повторите пароль

          <input
            required
            type="password"
            minLength={8}
            value={confirm}
            onChange={event =>
              setConfirm(event.target.value)
            }
          />
        </label>

        <button
          type="submit"
          disabled={task.busy || !resetToken}
        >
          Сохранить новый пароль
        </button>
      </form>
    </section>
  );
}

/* ==========================================
   ОТЗЫВЫ О ТОВАРАХ
========================================== */

function Reviews() {
  const { product } = useParams();
  const { user, api } = useContext(AuthContext);
  const navigate = useNavigate();
  const task = useTask();

  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  async function loadReviews() {
    const data = await api(
      '/reviews/' + encodeURIComponent(product)
    );

    setReviews(data);
  }

  useEffect(() => {
    task.run(loadReviews);
  }, [product]);

  function submit(event) {
    event.preventDefault();

    task.run(async () => {
      await api('/reviews', 'POST', {
        product,
        rating: Number(rating),
        comment
      });

      await loadReviews();
      setComment('');
      task.setMessage('Отзыв успешно добавлен');
    });
  }

  return (
    <section className="panel">
      <button
        className="secondary"
        onClick={() => navigate('/catalog')}
      >
        ← Вернуться в каталог
      </button>

      <h2>Отзывы: {product}</h2>

      <Notices task={task} />

      {reviews.length === 0 ? (
        <p>Отзывов пока нет.</p>
      ) : (
        reviews.map((review, index) => (
          <div className="review" key={index}>
            <strong>
              {review.full_name || 'Покупатель'}
            </strong>

            <p>
              {'⭐'.repeat(Number(review.rating))}
            </p>

            <p>{review.comment}</p>
          </div>
        ))
      )}

      {user ? (
        <form onSubmit={submit}>
          <h3>Оставить отзыв</h3>

          <label>
            Оценка
            <select
              value={rating}
              onChange={event =>
                setRating(Number(event.target.value))
              }
            >
              {[5, 4, 3, 2, 1].map(number => (
                <option
                  key={number}
                  value={number}
                >
                  {number}
                </option>
              ))}
            </select>
          </label>

          <label>
            Комментарий
            <textarea
              required
              minLength={3}
              maxLength={1000}
              value={comment}
              onChange={event =>
                setComment(event.target.value)
              }
            />
          </label>

          <button
            type="submit"
            disabled={task.busy}
          >
            Отправить отзыв
          </button>
        </form>
      ) : (
        <p>
          Чтобы оставить отзыв, необходимо{' '}
          <button
            className="link"
            onClick={() => navigate('/login')}
          >
            войти в аккаунт
          </button>
        </p>
      )}
    </section>
  );
}

/* ==========================================
   ЛИЧНЫЙ КАБИНЕТ
========================================== */

function Dashboard() {
  const { user, setUser, api } =
    useContext(AuthContext);

  const task = useTask();

  const [orders, setOrders] = useState([]);
  const [coupons, setCoupons] = useState([]);

  const [profile, setProfile] = useState({});

  const [passwords, setPasswords] = useState({
    old_password: '',
    new_password: ''
  });

  useEffect(() => {
    if (!user) return;

    task.run(async () => {
      const [orderData, couponData] =
        await Promise.all([
          api('/orders'),
          api('/coupons')
        ]);

      setOrders(orderData);
      setCoupons(couponData);
    });
  }, [user?.email]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  function updateProfile(event) {
    event.preventDefault();

    task.run(async () => {
      const result = await api(
        '/me',
        'PATCH',
        {
          full_name:
            profile.full_name ??
            user.full_name,

          email:
            profile.email ??
            user.email,

          phone:
            profile.phone ??
            user.phone,

          default_address:
            profile.default_address ??
            user.default_address ??
            ''
        }
      );

      const updatedUser = await api('/me');
      setUser(updatedUser);

      task.setMessage(
        result.message ||
        'Данные успешно сохранены'
      );
    });
  }

  function updatePassword(event) {
    event.preventDefault();

    task.run(async () => {
      const result = await api(
        '/me/password',
        'PATCH',
        passwords
      );

      setPasswords({
        old_password: '',
        new_password: ''
      });

      task.setMessage(
        result.message ||
        'Пароль успешно изменён'
      );
    });
  }

  function couponStatus(coupon) {
    if (coupon.is_used) {
      return 'Использован';
    }

    if (
      coupon.expires_at &&
      new Date(coupon.expires_at) <= new Date()
    ) {
      return 'Срок действия истёк';
    }

    return 'Доступен';
  }

  return (
    <section className="panel">
      <h2>Личный кабинет</h2>

      <p>
        Здравствуйте,{' '}
        <strong>{user.full_name}</strong>!
      </p>

      <Notices task={task} />

      <h3>🎟️ Мои персональные купоны</h3>

      {coupons.length === 0 ? (
        <p className="muted">
          У вас пока нет персональных купонов.
        </p>
      ) : (
        <div className="coupons-grid">
          {coupons.map(coupon => (
            <div
              className="coupon-card"
              key={coupon.code}
            >
              <strong className="coupon-code">
                {coupon.code}
              </strong>

              <div className="coupon-percent">
                −{coupon.discount_percent}%
              </div>

              <p>
                Статус:{' '}
                <strong>
                  {couponStatus(coupon)}
                </strong>
              </p>

              {coupon.expires_at && (
                <p className="muted">
                  Срок действия:{' '}
                  {new Date(
                    coupon.expires_at
                  ).toLocaleDateString('ru-RU')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <h3>История заказов</h3>

      {orders.length === 0 ? (
        <p>Вы пока не оформляли заказы.</p>
      ) : (
        orders.map((order, index) => (
          <div
            className="review"
            key={order.order_number || index}
          >
            <h4>
              Заказ №{order.order_number}
            </h4>

            <p>
              Сумма:{' '}
              <strong>
                {money(order.total)}
              </strong>
            </p>

            <p>
              Товары: {order.items}
            </p>

            <p>
              Адрес доставки:{' '}
              {order.delivery_address}
            </p>

            <p>
              Дата доставки:{' '}
              {order.delivery_date}
            </p>

            <p>
              Статус: {order.status}
            </p>
          </div>
        ))
      )}

      <h3>Мои данные</h3>

      <form onSubmit={updateProfile}>
        {[
          ['full_name', 'ФИО'],
          ['email', 'Электронная почта'],
          ['phone', 'Телефон'],
          [
            'default_address',
            'Адрес доставки по умолчанию'
          ]
        ].map(([key, label]) => (
          <label key={key}>
            {label}

            <input
              type={
                key === 'email'
                  ? 'email'
                  : 'text'
              }
              required={
                key !== 'default_address'
              }
              value={
                profile[key] ??
                user[key] ??
                ''
              }
              onChange={event =>
                setProfile(old => ({
                  ...old,
                  [key]: event.target.value
                }))
              }
            />
          </label>
        ))}

        <button
          type="submit"
          disabled={task.busy}
        >
          Сохранить данные
        </button>
      </form>

      <h3>Изменение пароля</h3>

      <form onSubmit={updatePassword}>
        <label>
          Текущий пароль

          <input
            required
            type="password"
            value={passwords.old_password}
            onChange={event =>
              setPasswords(old => ({
                ...old,
                old_password: event.target.value
              }))
            }
          />
        </label>

        <label>
          Новый пароль

          <input
            required
            type="password"
            minLength={8}
            value={passwords.new_password}
            onChange={event =>
              setPasswords(old => ({
                ...old,
                new_password: event.target.value
              }))
            }
          />
        </label>

        <button
          type="submit"
          disabled={task.busy}
        >
          Изменить пароль
        </button>
      </form>
    </section>
  );
}

/* ==========================================
   АДМИН-ПАНЕЛЬ
========================================== */

function Admin() {
  const { user, api } = useContext(AuthContext);
  const task = useTask();

  const [section, setSection] = useState('products');
  const [rows, setRows] = useState([]);

  const emptyProduct = {
    name: '',
    description: '',
    category: '',
    price: '',
    stock: '',
    duration_minutes: 0,
    discount_percent: 0
  };

  const [productForm, setProductForm] =
    useState(emptyProduct);

  const [originalName, setOriginalName] =
    useState('');

  const [categoryName, setCategoryName] =
    useState('');

  const [couponForm, setCouponForm] = useState({
    email: '',
    code: '',
    discount_percent: 10,
    expires_at: ''
  });

  const [selectedRow, setSelectedRow] =
    useState(null);

  const sectionNames = {
    products: 'Товары',
    categories: 'Категории',
    orders: 'Заказы',
    reviews: 'Отзывы',
    users: 'Пользователи',
    coupons: 'Купоны'
  };

  async function load(name = section) {
    const result = await api(
      '/admin/' + name
    );

    setRows(result);
  }

  useEffect(() => {
    if (user?.role === 'admin') {
      task.run(() => load(section));
    }
  }, [user?.role, section]);

  if (!user || user.role !== 'admin') {
    return (
      <Navigate
        to="/catalog"
        replace
      />
    );
  }

  function updateProduct(name, value) {
    setProductForm(old => ({
      ...old,
      [name]: value
    }));
  }

  function editProduct(product) {
    setOriginalName(product.name);

    setProductForm({
      name: product.name || '',
      description:
        product.description || '',
      category: product.category || '',
      price: product.price ?? '',
      stock: product.stock ?? '',
      duration_minutes:
        product.duration_minutes ?? 0,
      discount_percent:
        product.discount_percent ?? 0
    });

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }

  function saveProduct(event) {
    event.preventDefault();

    task.run(async () => {
      const body = {
        name: productForm.name.trim(),
        description:
          productForm.description.trim(),
        category: productForm.category,
        price: Number(productForm.price),
        stock: Number(productForm.stock),
        duration_minutes:
          Number(productForm.duration_minutes),
        discount_percent:
          Number(productForm.discount_percent)
      };

      if (
        !body.name ||
        !body.category ||
        !body.description
      ) {
        throw new Error(
          'Заполните все поля товара'
        );
      }

      if (
        body.price < 0 ||
        body.stock < 0 ||
        body.discount_percent < 0 ||
        body.discount_percent > 90
      ) {
        throw new Error(
          'Проверьте цену, остаток и скидку'
        );
      }

      if (originalName) {
        await api(
          '/admin/products/' +
          encodeURIComponent(originalName),
          'PATCH',
          body
        );
      } else {
        await api(
          '/admin/products',
          'POST',
          body
        );
      }

      await load('products');

      setProductForm(emptyProduct);
      setOriginalName('');

      task.setMessage(
        'Товар успешно сохранён'
      );
    });
  }

  function deleteProduct(name) {
    if (
      !window.confirm(
        'Вы действительно хотите удалить товар?'
      )
    ) {
      return;
    }

    task.run(async () => {
      await api(
        '/admin/products/' +
        encodeURIComponent(name),
        'DELETE'
      );

      await load('products');

      task.setMessage(
        'Товар удалён'
      );
    });
  }

  function addCategory(event) {
    event.preventDefault();

    task.run(async () => {
      await api(
        '/admin/categories',
        'POST',
        {
          name: categoryName.trim()
        }
      );

      await load('categories');

      setCategoryName('');

      task.setMessage(
        'Категория добавлена'
      );
    });
  }

  function deleteCategory(name) {
    if (
      !window.confirm(
        'Удалить категорию?'
      )
    ) {
      return;
    }

    task.run(async () => {
      await api(
        '/admin/categories/' +
        encodeURIComponent(name),
        'DELETE'
      );

      await load('categories');

      task.setMessage(
        'Категория удалена'
      );
    });
  }

  function issueCoupon(event) {
    event.preventDefault();

    task.run(async () => {
      const discount = Number(
        couponForm.discount_percent
      );

      if (discount < 1 || discount > 90) {
        throw new Error(
          'Скидка купона должна быть от 1 до 90%'
        );
      }

      await api(
        '/admin/coupons',
        'POST',
        {
          email:
            couponForm.email.trim(),
          code:
            couponForm.code.trim().toUpperCase(),
          discount_percent: discount,
          expires_at:
            couponForm.expires_at || null
        }
      );

      await load('coupons');

      setCouponForm({
        email: '',
        code: '',
        discount_percent: 10,
        expires_at: ''
      });

      task.setMessage(
        'Персональный купон выдан пользователю'
      );
    });
  }

  function deleteOther(resource, row) {
    const key =
      resource === 'users'
        ? row.email
        : row.id;

    if (
      !window.confirm(
        'Удалить выбранную запись?'
      )
    ) {
      return;
    }

    task.run(async () => {
      await api(
        '/admin/' +
        resource +
        '/' +
        encodeURIComponent(key),
        'DELETE'
      );

      await load(resource);

      task.setMessage(
        'Запись удалена'
      );
    });
  }

  return (
    <section className="panel admin-panel">
      <h2>Панель администратора</h2>

      <Notices task={task} />

      <label>
        Выберите раздел

        <select
          value={section}
          onChange={event => {
            setSection(event.target.value);
            setSelectedRow(null);
          }}
        >
          {Object.entries(sectionNames).map(
            ([key, name]) => (
              <option
                key={key}
                value={key}
              >
                {name}
              </option>
            )
          )}
        </select>
      </label>

      {section === 'products' && (
        <>
          <h3>
            {originalName
              ? 'Редактирование товара'
              : 'Добавление товара'}
          </h3>

          <form onSubmit={saveProduct}>
            <label>
              Название товара

              <input
                required
                value={productForm.name}
                onChange={event =>
                  updateProduct(
                    'name',
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Описание

              <textarea
                required
                value={productForm.description}
                onChange={event =>
                  updateProduct(
                    'description',
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Категория

              <input
                required
                placeholder="Например, Ноутбуки"
                value={productForm.category}
                onChange={event =>
                  updateProduct(
                    'category',
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Цена без скидки, ₽

              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={productForm.price}
                onChange={event =>
                  updateProduct(
                    'price',
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Количество на складе

              <input
                required
                type="number"
                min="0"
                step="1"
                value={productForm.stock}
                onChange={event =>
                  updateProduct(
                    'stock',
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Длительность, минут

              <input
                type="number"
                min="0"
                step="1"
                value={
                  productForm.duration_minutes
                }
                onChange={event =>
                  updateProduct(
                    'duration_minutes',
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Скидка на товар, %

              <input
                type="number"
                min="0"
                max="90"
                step="1"
                value={
                  productForm.discount_percent
                }
                onChange={event =>
                  updateProduct(
                    'discount_percent',
                    event.target.value
                  )
                }
              />
            </label>

            <div className="actions">
              <button
                type="submit"
                disabled={task.busy}
              >
                {originalName
                  ? 'Сохранить изменения'
                  : 'Добавить товар'}
              </button>

              {originalName && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setOriginalName('');
                    setProductForm(emptyProduct);
                  }}
                >
                  Отмена
                </button>
              )}
            </div>
          </form>
        </>
      )}

      {section === 'categories' && (
        <>
          <h3>Добавление категории</h3>

          <form onSubmit={addCategory}>
            <label>
              Название категории

              <input
                required
                value={categoryName}
                onChange={event =>
                  setCategoryName(
                    event.target.value
                  )
                }
              />
            </label>

            <button
              type="submit"
              disabled={task.busy}
            >
              Добавить категорию
            </button>
          </form>
        </>
      )}

      {section === 'coupons' && (
        <>
          <h3>
            🎟️ Выдать персональный купон
          </h3>

          <p className="muted">
            Купон выдаётся конкретному
            зарегистрированному пользователю.
          </p>

          <form onSubmit={issueCoupon}>
            <label>
              Email пользователя

              <input
                required
                type="email"
                placeholder="user@example.com"
                value={couponForm.email}
                onChange={event =>
                  setCouponForm(old => ({
                    ...old,
                    email: event.target.value
                  }))
                }
              />
            </label>

            <label>
              Код купона

              <input
                required
                placeholder="Например, TECH10"
                value={couponForm.code}
                onChange={event =>
                  setCouponForm(old => ({
                    ...old,
                    code:
                      event.target.value.toUpperCase()
                  }))
                }
              />
            </label>

            <label>
              Скидка по купону, %

              <input
                required
                type="number"
                min="1"
                max="90"
                step="1"
                value={
                  couponForm.discount_percent
                }
                onChange={event =>
                  setCouponForm(old => ({
                    ...old,
                    discount_percent:
                      event.target.value
                  }))
                }
              />
            </label>

            <label>
              Дата окончания действия
              (необязательно)

              <input
                type="date"
                value={couponForm.expires_at}
                onChange={event =>
                  setCouponForm(old => ({
                    ...old,
                    expires_at: event.target.value
                  }))
                }
              />
            </label>

            <button
              type="submit"
              disabled={task.busy}
            >
              Выдать купон
            </button>
          </form>
        </>
      )}

      <h3>
        Список: {sectionNames[section]}
      </h3>

      {rows.length === 0 ? (
        <p>Записей пока нет.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {Object.keys(rows[0]).map(
                  key => (
                    <th key={key}>
                      {key}
                    </th>
                  )
                )}

                {section !== 'coupons' && (
                  <th>Действия</th>
                )}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {Object.values(row).map(
                    (value, i) => (
                      <td key={i}>
                        {value === null
                          ? '—'
                          : typeof value ===
                            'object'
                          ? JSON.stringify(value)
                          : String(value)}
                      </td>
                    )
                  )}

                  {section !== 'coupons' && (
                    <td>
                      {section === 'products' && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            editProduct(row)
                          }
                        >
                          Изменить
                        </button>
                      )}

                      {section === 'categories' && (
                        <button
                          type="button"
                          className="danger"
                          onClick={() =>
                            deleteCategory(row.name)
                          }
                        >
                          Удалить
                        </button>
                      )}

                      {section === 'products' && (
                        <button
                          type="button"
                          className="danger"
                          onClick={() =>
                            deleteProduct(row.name)
                          }
                        >
                          Удалить
                        </button>
                      )}

                      {[
                        'users',
                        'reviews',
                        'orders'
                      ].includes(section) && (
                        <button
                          type="button"
                          className="danger"
                          onClick={() =>
                            deleteOther(
                              section,
                              row
                            )
                          }
                        >
                          Удалить
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ==========================================
   ЗАЩИТА СТРАНИЦ
========================================== */

function Protected({ children }) {
  const { user, loading } =
    useContext(AuthContext);

  if (loading) {
    return (
      <p>Загрузка аккаунта...</p>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  return children;
}

/* ==========================================
   МАРШРУТЫ САЙТА
========================================== */

function App() {
  return (
    <>
      <Header />

      <main>
        <Routes>
          <Route
            path="/"
            element={
              <Navigate
                to="/catalog"
                replace
              />
            }
          />

          <Route
            path="/catalog"
            element={<Catalog />}
          />

          <Route
            path="/cart"
            element={<Cart />}
          />

          <Route
            path="/login"
            element={
              <AuthPage
                key="login"
              />
            }
          />

          <Route
            path="/register"
            element={
              <AuthPage
                key="register"
                register
              />
            }
          />

          <Route
            path="/forgot"
            element={<ForgotPassword />}
          />

          <Route
            path="/reset"
            element={<ResetPassword />}
          />

          <Route
            path="/reviews/:product"
            element={<Reviews />}
          />

          <Route
            path="/dashboard"
            element={
              <Protected>
                <Dashboard />
              </Protected>
            }
          />

          <Route
            path="/admin"
            element={
              <Protected>
                <Admin />
              </Protected>
            }
          />

          <Route
            path="*"
            element={
              <Navigate
                to="/catalog"
                replace
              />
            }
          />
        </Routes>
      </main>

      <footer>
        © 2026 ТехноМаркет
        {' · '}
        Учебная информационная система
      </footer>
    </>
  );
}

/* ==========================================
   ЗАПУСК REACT
========================================== */

createRoot(
  document.getElementById('root')
).render(
  <BrowserRouter>
    <ThemeProvider>
      <AuthProvider>
        <CartProvider>
          <App />
        </CartProvider>
      </AuthProvider>
    </ThemeProvider>
  </BrowserRouter>
);
