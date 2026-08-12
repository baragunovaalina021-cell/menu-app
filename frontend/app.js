(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  // API base: same origin as this static page
  const API_BASE = '/api';

  // --- Auth headers -------------------------------------------------
  // In real Telegram, tg.initData carries a signed payload the backend verifies.
  // Outside Telegram (e.g. testing in a plain browser) we fall back to a
  // locally-generated debug identity so the app is still usable for QA.
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
      // HTTP header values must be Latin-1; encode Cyrillic names before sending.
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
  let familyAccessActive = true;

  function fmtQty(item) {
    if (item.qty == null) return '';
    const q = Number(item.qty);
    const qStr = Number.isInteger(q) ? q : q.toFixed(1);
    return `${qStr} ${item.unit || ''}`.trim();
  }

  // --- Trial badge ----------------------------------------------------
  function renderTrialBadge(family) {
    const badge = document.getElementById('trialBadge');
    if (family.isPremium) {
      badge.textContent = 'Подписка активна';
      badge.className = 'badge premium';
    } else if (family.trialActive) {
      const daysLeft = Math.max(0, Math.ceil((family.trialEndsAt - Date.now()) / (24 * 60 * 60 * 1000)));
      badge.textContent = `Пробный период: ${daysLeft} дн.`;
      badge.className = 'badge';
    } else {
      badge.textContent = 'Подписка истекла';
      badge.className = 'badge expired';
    }
    familyAccessActive = family.accessActive;
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
      const mealLabel = day.recipe ? day.recipe.name : (day.customText || null);
      card.innerHTML = `
        <div>
          <div class="day-name">${day.dayName}</div>
          <div class="meal-name ${mealLabel ? '' : 'empty'}">${mealLabel || 'Не выбрано'}</div>
        </div>
        <div class="chevron">›</div>
      `;
      card.addEventListener('click', () => openRecipePicker(day.day));
      container.appendChild(card);
    });
  }

  function openRecipePicker(day) {
    currentPickerDay = day;
    document.getElementById('customMealInput').value = '';
    const list = document.getElementById('recipeList');
    list.innerHTML = '';
    recipes.forEach((r) => {
      const el = document.createElement('div');
      el.className = 'recipe-item';
      el.innerHTML = `<div class="r-name">${r.name}</div><div class="r-ing">${r.ingredients.map((i) => i.name).join(', ')}</div>`;
      el.addEventListener('click', () => selectRecipe(r.id));
      list.appendChild(el);
    });
    document.getElementById('recipePicker').classList.remove('hidden');
  }

  async function selectRecipe(recipeId) {
    await saveMeal({ recipeId, customText: null });
  }

  async function saveMeal({ recipeId, customText }) {
    try {
      await api(`/menu/${currentPickerDay}`, { method: 'PUT', body: { recipeId, customText } });
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
    saveMeal({ recipeId: null, customText: text });
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
  async function loadShoppingList() {
    const items = await api('/shopping');
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
      `;
      row.querySelector('.checkbox').addEventListener('click', async () => {
        try {
          await api(`/shopping/${item.id}`, { method: 'PATCH', body: { checked: !item.checked } });
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
