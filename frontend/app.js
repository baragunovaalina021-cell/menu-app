(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const API_BASE = '/api';

  const DAY_COLORS = ['#ff7a45', '#f2b134', '#33b26f', '#4aa3ff', '#a56bff', '#ff5f9e', '#ff5f6d'];

  // Very small keyword -> emoji map so dishes look friendly without any manual tagging.
  const EMOJI_RULES = [
    [/суп|борщ|щи/i, '🍲'],
    [/паст|спагетти|макарон/i, '🍝'],
    [/рыб|треск|лосос/i, '🐟'],
    [/куриц|курин|цыпл/i, '🍗'],
    [/говядин|фарш|тако|бургер/i, '🥩'],
    [/салат/i, '🥗'],
    [/омлет|яйц/i, '🍳'],
    [/рис|плов/i, '🍚'],
    [/сырник|творог/i, '🧀'],
    [/рагу|овощ/i, '🥘'],
    [/пирог|блин|сырник/i, '🥞'],
    [/суши|ролл/i, '🍣'],
    [/пицц/i, '🍕'],
  ];
  function emojiFor(name) {
    if (!name) return '🍽️';
    for (const [re, emoji] of EMOJI_RULES) {
      if (re.test(name)) return emoji;
    }
    return '🍽️';
  }

  function getAuthHeaders() {
    if (tg && tg.initData) {
      return { 'X-Telegram-Init-Data': tg.initData };
    }
    let debugId = localStorage.getItem('debug_user_id');
    if (!debugId) {
      debugId = 'debug-' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('debug_user_id', debugId);
    }
    const debugName = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.first_name) || 'Гость';
    return {
      'X-Debug-User-Id': debugId,
      'X-Debug-User-Name': encodeURIComponent(debugName),
    };
  }

  async function api(path, options = {}) {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.error || 'request_failed');
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  // --- Toast ----------------------------------------------------------
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }

  // --- Tabs -------------------------------------------------------------
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'));
      tabPanels.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'shopping') loadShoppingList();
      if (btn.dataset.tab === 'family') loadFamilyStatus();
    });
  });

  // --- State --------------------------------------------------------
  let recipes = [];
  let currentPickerDay = null;

  function fmtQty(item) {
    if (item.qty == null) return '';
    const q = Number(item.qty);
    const qStr = Number.isInteger(q) ? q : q.toFixed(1);
    return `${qStr} ${item.unit || ''}`.trim();
  }

  function pyaterochkaSearchUrl(name) {
    return `https://5ka.ru/search/?text=${encodeURIComponent(name)}`;
  }

  // Opens the Pyaterochka search page for this product. Inside Telegram, a
  // plain <a target="_blank"> stays trapped in Telegram's own in-app browser,
  // which never hands off to a native app. Telegram.WebApp.openLink() routes
  // through the phone's system browser instead — that's the only way a
  // universal/app link even has a chance to open the real Pyaterochka app.
  // Whether it actually does depends entirely on whether Pyaterochka has
  // registered their app for that link on this device — we can't force it,
  // there's no public API for that.
  function openInPyaterochka(name) {
    const url = pyaterochkaSearchUrl(name);
    if (tg && typeof tg.openLink === 'function') {
      tg.openLink(url, { try_instant_view: false });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  // --- Trial badge ----------------------------------------------------
  function renderTrialBadge(family) {
    const badge = document.getElementById('trialBadge');
    if (family.isPremium) {
      badge.textContent = 'Подписка активна';
      badge.className = 'badge premium';
    } else if (family.trialActive) {
      const daysLeft = Math.max(0, Math.ceil((family.trialEndsAt - Date.now()) / (24 * 60 * 60 * 1000)));
      badge.textContent = `Пробный: ${daysLeft} дн.`;
      badge.className = 'badge';
    } else {
      badge.textContent = 'Подписка истекла';
      badge.className = 'badge expired';
    }
  }

  function renderSubscriptionCard(family) {
    const el = document.getElementById('subscriptionCard');
    if (family.isPremium) {
      el.innerHTML = `<p><strong>У вас активная подписка.</strong> Спасибо, что пользуетесь приложением!</p>`;
      return;
    }
    const statusLine = family.trialActive
      ? `Бесплатный период действует ещё ${Math.max(0, Math.ceil((family.trialEndsAt - Date.now()) / (24 * 60 * 60 * 1000)))} дн.`
      : `Бесплатный период закончился.`;
    el.innerHTML = `
      <p><strong>Тариф</strong></p>
      <p class="hint">${statusLine} Бесплатно доступно ${family.freeMemberLimit} человек в семье. Подписка снимает лимит на участников и даёт доступ ко всем функциям без ограничений.</p>
      <button id="mockSubscribeBtn" class="primary-btn">Оформить подписку (демо)</button>
    `;
    document.getElementById('mockSubscribeBtn').addEventListener('click', async () => {
      await api('/family/mock-subscribe', { method: 'POST' });
      showToast('Подписка оформлена (демо-режим)');
      loadFamilyStatus();
    });
  }

  async function loadFamilyStatus() {
    const me = await api('/family/me');
    renderTrialBadge(me.family);
    document.getElementById('inviteCode').textContent = me.family.inviteCode;
    renderSubscriptionCard(me.family);
  }

  document.getElementById('joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('joinCode').value.trim();
    if (!code) return;
    try {
      await api('/family/join', { method: 'POST', body: { inviteCode: code } });
      showToast('Вы присоединились к семье!');
      document.getElementById('joinCode').value = '';
      loadFamilyStatus();
      loadMenu();
      loadShoppingList();
    } catch (err) {
      showToast(err.payload && err.payload.message ? err.payload.message : 'Не удалось присоединиться');
    }
  });

  // --- Menu tab ---------------------------------------------------------
  async function loadRecipes() {
    recipes = await api('/recipes');
  }

  async function loadMenu() {
    const week = await api('/menu');
    const container = document.getElementById('menuDays');
    container.innerHTML = '';
    week.forEach((day) => {
      const card = document.createElement('div');
      card.className = 'day-card';
      card.style.setProperty('--day-color', DAY_COLORS[day.day]);

      const chipsHtml = day.meals.length
        ? `<div class="meal-chips">${day.meals
            .map((m) => {
              const label = m.recipe ? m.recipe.name : m.customText;
              return `<div class="meal-chip">
                <span class="meal-emoji">${emojiFor(label)}</span>
                <span class="meal-text">${label}</span>
                <button class="remove-meal" data-entry-id="${m.id}">✕</button>
              </div>`;
            })
            .join('')}</div>`
        : `<div class="no-meals">Пока ничего не выбрано</div>`;

      card.innerHTML = `
        <div class="day-header">
          <span class="day-name">${day.dayName}</span>
        </div>
        ${chipsHtml}
        <button class="add-meal-btn" data-day="${day.day}">+ Добавить блюдо</button>
      `;

      card.querySelector('.add-meal-btn').addEventListener('click', () => openRecipePicker(day.day, day.dayName));
      card.querySelectorAll('.remove-meal').forEach((btn) => {
        btn.addEventListener('click', () => removeMeal(btn.dataset.entryId));
      });

      container.appendChild(card);
    });
  }

  async function removeMeal(entryId) {
    try {
      await api(`/menu/entry/${entryId}`, { method: 'DELETE' });
      loadMenu();
    } catch (err) {
      handleGateError(err);
    }
  }

  function openRecipePicker(day, dayName) {
    currentPickerDay = day;
    document.getElementById('pickerDayTitle').textContent = `Добавить блюдо · ${dayName}`;
    document.getElementById('customMealInput').value = '';
    const list = document.getElementById('recipeList');
    list.innerHTML = '';
    recipes.forEach((r) => {
      const el = document.createElement('div');
      el.className = 'recipe-item';
      el.innerHTML = `
        <span class="r-emoji">${emojiFor(r.name)}</span>
        <div>
          <div class="r-name">${r.name}</div>
          <div class="r-ing">${r.ingredients.map((i) => i.name).join(', ')}</div>
        </div>`;
      el.addEventListener('click', () => addMeal({ recipeId: r.id }));
      list.appendChild(el);
    });
    document.getElementById('recipePicker').classList.remove('hidden');
  }

  async function addMeal({ recipeId, customText }) {
    try {
      await api(`/menu/${currentPickerDay}`, { method: 'POST', body: { recipeId, customText } });
      document.getElementById('recipePicker').classList.add('hidden');
      loadMenu();
    } catch (err) {
      handleGateError(err);
    }
  }

  document.getElementById('closePicker').addEventListener('click', () => {
    document.getElementById('recipePicker').classList.add('hidden');
  });

  document.getElementById('saveCustomMeal').addEventListener('click', () => {
    const text = document.getElementById('customMealInput').value.trim();
    if (!text) return;
    addMeal({ customText: text });
  });

  document.getElementById('generateListBtn').addEventListener('click', async () => {
    try {
      const result = await api('/menu/generate-shopping-list', { method: 'POST' });
      showToast(`Список собран: ${result.itemsGenerated} позиций`);
      document.querySelector('[data-tab="shopping"]').click();
    } catch (err) {
      handleGateError(err);
    }
  });

  // --- Shopping list tab --------------------------------------------
  let lastShoppingItems = [];

  async function loadShoppingList() {
    const items = await api('/shopping');
    lastShoppingItems = items;
    const container = document.getElementById('shoppingList');
    container.innerHTML = '';
    if (items.length === 0) {
      container.innerHTML = '<p class="hint">Список пуст. Добавьте продукты вручную или соберите их из меню.</p>';
      return;
    }
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'shopping-item' + (item.checked ? ' checked' : '');
      row.innerHTML = `
        <div class="checkbox">${item.checked ? '✓' : ''}</div>
        <div style="flex:1">
          <div class="item-name">${item.name}</div>
          <div class="item-qty">${fmtQty(item)}${item.source === 'auto' ? ' · из меню' : ''}</div>
        </div>
        <button class="cart-link-btn" title="Найти в Пятёрочке">🛒</button>
        <button class="delete-item-btn" title="Удалить">✕</button>
      `;
      row.querySelector('.cart-link-btn').addEventListener('click', () => openInPyaterochka(item.name));
      row.querySelector('.checkbox').addEventListener('click', async () => {
        try {
          await api(`/shopping/${item.id}`, { method: 'PATCH', body: { checked: !item.checked } });
          loadShoppingList();
        } catch (err) {
          handleGateError(err);
        }
      });
      row.querySelector('.delete-item-btn').addEventListener('click', async () => {
        try {
          await api(`/shopping/${item.id}`, { method: 'DELETE' });
          loadShoppingList();
        } catch (err) {
          handleGateError(err);
        }
      });
      container.appendChild(row);
    });
  }

  document.getElementById('addItemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('newItemName');
    const name = input.value.trim();
    if (!name) return;
    try {
      await api('/shopping', { method: 'POST', body: { name } });
      input.value = '';
      loadShoppingList();
    } catch (err) {
      handleGateError(err);
    }
  });

  document.getElementById('clearCheckedBtn').addEventListener('click', async () => {
    try {
      await api('/shopping/clear-checked', { method: 'POST' });
      loadShoppingList();
    } catch (err) {
      handleGateError(err);
    }
  });

  document.getElementById('copyListBtn').addEventListener('click', async () => {
    if (!lastShoppingItems.length) {
      showToast('Список пуст');
      return;
    }
    const text = lastShoppingItems
      .filter((i) => !i.checked)
      .map((i) => `${i.name}${i.qty ? ` — ${fmtQty(i)}` : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast('Список скопирован — вставьте в поиск на 5ka.ru или в приложении');
    } catch {
      showToast('Не удалось скопировать. Скопируйте вручную из списка на экране.');
    }
  });

  function handleGateError(err) {
    if (err.status === 402) {
      showToast(err.payload.message || 'Нужна подписка для этого действия');
      document.querySelector('[data-tab="family"]').click();
    } else {
      showToast('Что-то пошло не так, попробуйте ещё раз');
    }
  }

  // --- Init -------------------------------------------------------------
  (async function init() {
    try {
      await loadFamilyStatus();
      await loadRecipes();
      await loadMenu();
    } catch (err) {
      console.error(err);
      showToast('Не удалось загрузить данные');
    }
  })();
})();
