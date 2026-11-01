(function () {
  'use strict';

  // ============================================================
  //  КОНФИГ
  // ============================================================
  const CONFIG = {
    botUsername: 'AvarNetwork_bot',          // Уже вставлено
    adsgramBlockId: 'YOUR_ADSGRAM_BLOCK_ID',    // Пока оставь так, позже вставим ID

    offerwallEnabled: false,
    offerwallBaseUrl: '',                       

    devMode: true, // Пока true, чтобы работала тестовая реклама

    // Геймплей
    startEnergy: 1000,
    maxEnergyBase: 1000,
    energyRegenPerSec: 1,
    tapPowerBase: 1,
    tapCostBase: 100,
    tapCostGrowth: 1.8,
    autoCostBase: 500,
    autoCostGrowth: 1.7,
    friendBonusCoins: 5000,
    friendEnergyBonus: 1,
    boostDurationMs: 2 * 60 * 60 * 1000,

    // Вывод
    withdrawCoins: 10000000,
    withdrawAdsRequired: 50,

    levelDivisor: 1000,
    saveThrottleMs: 3000,
    offlineCapHours: 4,
  };

  const SAVE_VERSION = 1;
  const SAVE_PREFIX = 'avar_v1_';
  const REFERRAL_KEY_PREFIX = 'avar_referred_by_';

  // ============================================================
  //  TELEGRAM
  // ============================================================
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const tgUser = tg && tg.initDataUnsafe ? tg.initDataUnsafe.user : null;
  const userId = tgUser && tgUser.id ? String(tgUser.id) : null;

  if (!userId) {
    document.getElementById('authError').classList.add('show');
    document.getElementById('app').style.display = 'none';
    return;
  }

  document.getElementById('app').style.display = 'flex';

  try { tg.ready(); } catch (e) {}
  try { tg.expand(); } catch (e) {}
  try { tg.setHeaderColor('#0b1020'); } catch (e) {}
  try { tg.setBackgroundColor('#0b1020'); } catch (e) {}
  try { tg.enableClosingConfirmation(); } catch (e) {}

  // ============================================================
  //  STATE
  // ============================================================
  const SAVE_KEY = SAVE_PREFIX + userId;

  const state = {
    version: SAVE_VERSION,
    coins: 0,
    totalEarned: 0,
    totalTaps: 0,
    energy: CONFIG.startEnergy,
    maxEnergy: CONFIG.maxEnergyBase,
    tapLevel: 0,
    autoLevel: 0,
    friends: 0,
    boostUntil: 0,
    adsWatched: 0,
    lastSave: Date.now(),
  };

  // ============================================================
  //  УТИЛИТЫ
  // ============================================================
  function formatNum(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    return Math.floor(n).toString();
  }

  function haptic(type) {
    if (tg && tg.HapticFeedback) {
      try { tg.HapticFeedback.impactOccurred(type || 'light'); return; } catch (e) {}
    }
    if (navigator.vibrate) {
      try { navigator.vibrate(type === 'heavy' ? 20 : 10); } catch (e) {}
    }
  }

  function showToast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove('show'), ms || 2200);
  }

  // ============================================================
  //  SAVE / LOAD
  // ============================================================
  let lastSaveAt = 0;

  function save(force) {
    const now = Date.now();
    if (!force && now - lastSaveAt < CONFIG.saveThrottleMs) return;
    lastSaveAt = now;
    state.lastSave = now;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function load() {
    let data = null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) {}

    if (!data || data.version !== SAVE_VERSION) return;
    Object.assign(state, data);

    const elapsedSec = Math.max(0, (Date.now() - (data.lastSave || Date.now())) / 1000);
    state.energy = Math.min(
      state.maxEnergy,
      state.energy + Math.floor(elapsedSec * CONFIG.energyRegenPerSec)
    );

    const cappedSec = Math.min(elapsedSec, CONFIG.offlineCapHours * 3600);
    const autoGain = Math.floor(cappedSec * state.autoLevel);
    if (autoGain > 0) {
      state.coins += autoGain;
      state.totalEarned += autoGain;
    }
  }

  // ============================================================
  //  ГЕЙМПЛЕЙ-ХЕЛПЕРЫ
  // ============================================================
  function getLevel() {
    return 1 + Math.floor(Math.sqrt(Math.max(0, state.totalEarned) / CONFIG.levelDivisor));
  }
  function getTapPower() { return CONFIG.tapPowerBase + state.tapLevel; }
  function getBoostMultiplier() { return Date.now() < state.boostUntil ? 2 : 1; }
  function tapCost() {
    return Math.floor(CONFIG.tapCostBase * Math.pow(CONFIG.tapCostGrowth, state.tapLevel));
  }
  function autoCost() {
    return Math.floor(CONFIG.autoCostBase * Math.pow(CONFIG.autoCostGrowth, state.autoLevel));
  }

  // ============================================================
  //  HUD
  // ============================================================
  const el = {
    balance: document.getElementById('balanceVal'),
    level: document.getElementById('levelVal'),
    energyVal: document.getElementById('energyVal'),
    energyMax: document.getElementById('energyMax'),
    energyFill: document.getElementById('energyFill'),
    tapLvl: document.getElementById('tapLvl'),
    autoLvl: document.getElementById('autoLvl'),
    buyTapBtn: document.getElementById('buyTapBtn'),
    buyAutoBtn: document.getElementById('buyAutoBtn'),
    friendsCount: document.getElementById('friendsCount'),
    boostX2Desc: document.getElementById('boostX2Desc'),
    boostX2Btn: document.getElementById('boostX2Btn'),
    wCoins: document.getElementById('wCoins'),
    wAds: document.getElementById('wAds'),
    reqCoins: document.getElementById('reqCoins'),
    reqAds: document.getElementById('reqAds'),
    withdrawBtn: document.getElementById('withdrawBtn'),
    withdrawAdsCount: document.getElementById('withdrawAdsCount'),
  };

  function updateHUD() {
    el.balance.textContent = formatNum(state.coins);
    el.level.textContent = getLevel();

    const pct = state.maxEnergy > 0 ? (state.energy / state.maxEnergy) * 100 : 0;
    el.energyFill.style.width = pct + '%';
    el.energyFill.style.background = pct < 20
      ? 'linear-gradient(90deg, #ff4d6d, #ff8800)'
      : 'linear-gradient(90deg, #27e1ff, #3dff9e)';
    el.energyVal.textContent = Math.floor(state.energy);
    el.energyMax.textContent = state.maxEnergy;

    el.tapLvl.textContent = state.tapLevel;
    el.autoLvl.textContent = state.autoLevel;
    el.buyTapBtn.textContent = formatNum(tapCost()) + ' 💰';
    el.buyAutoBtn.textContent = formatNum(autoCost()) + ' 💰';
    el.buyTapBtn.disabled = state.coins < tapCost();
    el.buyAutoBtn.disabled = state.coins < autoCost();

    el.friendsCount.textContent = state.friends;
    el.withdrawAdsCount.textContent = state.adsWatched;

    const left = state.boostUntil - Date.now();
    if (left > 0) {
      el.boostX2Desc.textContent = '🔥 Активен: ' + Math.ceil(left / 60000) + ' мин';
      el.boostX2Btn.textContent = 'Активен';
      el.boostX2Btn.disabled = true;
    } else {
      el.boostX2Desc.textContent = 'На 2 часа';
      el.boostX2Btn.textContent = '📺 Смотреть';
      el.boostX2Btn.disabled = false;
    }

    const coinsOk = state.coins >= CONFIG.withdrawCoins;
    const adsOk = state.adsWatched >= CONFIG.withdrawAdsRequired;
    el.wCoins.textContent = formatNum(Math.min(state.coins, CONFIG.withdrawCoins));
    el.wAds.textContent = Math.min(state.adsWatched, CONFIG.withdrawAdsRequired);
    el.reqCoins.querySelector('.check').textContent = coinsOk ? '✅' : '❌';
    el.reqAds.querySelector('.check').textContent = adsOk ? '✅' : '❌';
    el.withdrawBtn.disabled = !(coinsOk && adsOk);
  }

  // ============================================================
  //  PARTICLE LAYER
  // ============================================================
  const particleLayer = document.createElement('div');
  particleLayer.className = 'particle-layer';
  document.body.appendChild(particleLayer);

  let activeParticles = 0;
  const MAX_PARTICLES = 36;
  const EMOJIS = ['💰', '💎', '⭐', '💵'];

  function spawnParticles(x, y) {
    if (activeParticles >= MAX_PARTICLES) return;
    for (let i = 0; i < 5 && activeParticles < MAX_PARTICLES; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.textContent = EMOJIS[(Math.random() * EMOJIS.length) | 0];
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      const angle = Math.random() * Math.PI * 2;
      const dist = 55 + Math.random() * 65;
      p.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(1) + 'px');
      p.style.setProperty('--dy', (Math.sin(angle) * dist).toFixed(1) + 'px');
      p.style.setProperty('--rot', ((Math.random() - 0.5) * 120).toFixed(0) + 'deg');
      particleLayer.appendChild(p);
      activeParticles++;
      setTimeout(() => {
        if (p.parentNode) p.parentNode.removeChild(p);
        activeParticles--;
      }, 750);
    }
  }

  // ============================================================
  //  TAP
  // ============================================================
  const mineBtn = document.getElementById('mineBtn');
  let lastNoEnergyToast = 0;

  function onTap(e) {
    const x = e.clientX != null ? e.clientX : window.innerWidth / 2;
    const y = e.clientY != null ? e.clientY : window.innerHeight / 2;

    if (state.energy < 1) {
      const now = Date.now();
      if (now - lastNoEnergyToast > 2000) {
        lastNoEnergyToast = now;
        showToast('⚡ Нет энергии! Подожди или посмотри рекламу');
        haptic('rigid');
      }
      return;
    }

    const gain = Math.round(getTapPower() * getBoostMultiplier());
    state.energy -= 1;
    state.coins += gain;
    state.totalEarned += gain;
    state.totalTaps += 1;

    haptic('light');
    spawnParticles(x, y);
    updateHUD();
    save(false);
  }

  mineBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    mineBtn.classList.add('pressed');
    onTap(e);
  }, { passive: false });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(evt => {
    mineBtn.addEventListener(evt, () => mineBtn.classList.remove('pressed'));
  });

  // ============================================================
  //  БУСТЫ
  // ============================================================
  document.getElementById('buyTapBtn').addEventListener('click', () => {
    const cost = tapCost();
    if (state.coins < cost) return showToast('Недостаточно монет');
    state.coins -= cost;
    state.tapLevel += 1;
    haptic('medium');
    showToast('💪 Сила тапа: ' + getTapPower());
    updateHUD();
    save(true);
  });

  document.getElementById('buyAutoBtn').addEventListener('click', () => {
    const cost = autoCost();
    if (state.coins < cost) return showToast('Недостаточно монет');
    state.coins -= cost;
    state.autoLevel += 1;
    haptic('medium');
    showToast('🤖 Автокликер: +' + state.autoLevel + '/сек');
    updateHUD();
    save(true);
  });

  // ============================================================
  //  ADSGRAM + ОБЁРТКА С УЧЁТОМ ВЫВОДА
  // ============================================================
  let adController = null;

  function initAdsgram() {
    if (window.Adsgram && CONFIG.adsgramBlockId !== 'YOUR_ADSGRAM_BLOCK_ID') {
      try {
        adController = window.Adsgram.init({ blockId: CONFIG.adsgramBlockId });
      } catch (e) {
        console.warn('Adsgram init failed', e);
      }
    }
  }
  initAdsgram();

  function showAdReward(callback, opts) {
    opts = opts || {};
    const onSuccess = () => {
      if (opts.countsForWithdraw) {
        state.adsWatched += 1;
        save(true);
      }
      callback();
    };

    if (adController) {
      adController.show()
        .then((result) => {
          if (result && result.done) onSuccess();
          else showToast('❌ Реклама не досмотрена');
        })
        .catch((err) => {
          console.warn('Adsgram error', err);
          showToast('❌ Реклама недоступна');
        });
      return;
    }

    showToast('📺 Реклама (симуляция)...');
    setTimeout(onSuccess, 1200);
  }

  document.getElementById('restoreEnergyBtn').addEventListener('click', () => {
    showAdReward(() => {
      state.energy = state.maxEnergy;
      haptic('medium');
      showToast('⚡ Энергия восстановлена!');
      updateHUD();
      save(true);
    }, { countsForWithdraw: true });
  });

  document.getElementById('boostX2Btn').addEventListener('click', () => {
    showAdReward(() => {
      state.boostUntil = Math.max(state.boostUntil, Date.now()) + CONFIG.boostDurationMs;
      haptic('medium');
      showToast('🔥 Доход x2 на 2 часа!');
      updateHUD();
      save(true);
    }, { countsForWithdraw: false });
  });

  const watchAdForWithdrawBtn = document.getElementById('watchAdForWithdrawBtn');
  if (watchAdForWithdrawBtn) {
    watchAdForWithdrawBtn.addEventListener('click', () => {
      showAdReward(() => {
        haptic('medium');
        showToast('📺 +1 к выводу (' + state.adsWatched + '/' + CONFIG.withdrawAdsRequired + ')');
        updateHUD();
      }, { countsForWithdraw: true });
    });
  }

  // ============================================================
  //  ОФФЕРВОЛЛ
  // ============================================================
  document.getElementById('earnMoreBtn').addEventListener('click', () => {
    if (!CONFIG.offerwallEnabled || !CONFIG.offerwallBaseUrl) {
      showToast('🎁 Офферволл появится после подключения сервера');
      return;
    }
    const subid = encodeURIComponent(userId);
    const url = CONFIG.offerwallBaseUrl + '?subid=' + subid;
    haptic('medium');
    if (tg && tg.openLink) tg.openLink(url);
    else window.open(url, '_blank');
    showToast('🌐 Открываю задания...');
  });

  // ============================================================
  //  РЕФЕРАЛЫ
  // ============================================================
  document.getElementById('inviteBtn').addEventListener('click', async () => {
    const link = 'https://t.me/' + CONFIG.botUsername + '?startapp=' + userId;
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copied = true;
      } catch (err) {}
    }
    haptic('medium');
    showToast(copied ? '🔗 Ссылка скопирована!' : '🔗 Открываю...');
    if (tg && tg.openTelegramLink) {
      const text = encodeURIComponent('Играй в $AVAR Clicker со мной! 🐹💰');
      tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + text);
    }
  });

  function handleStartParam() {
    const startParam = tg && tg.initDataUnsafe ? tg.initDataUnsafe.start_param : null;
    if (!startParam) return;
    if (String(startParam) === userId) return;

    const REF_KEY = REFERRAL_KEY_PREFIX + userId;
    if (localStorage.getItem(REF_KEY)) return;

    localStorage.setItem(REF_KEY, String(startParam));

    if (CONFIG.devMode) {
      showToast('👋 Ты пришёл по приглашению от ' + startParam);
    }
  }

  // ============================================================
  //  ВЫВОД
  // ============================================================
  el.withdrawBtn.addEventListener('click', () => {
    if (el.withdrawBtn.disabled) return;
    haptic('medium');
    showToast('✅ Заявка на вывод создана! Ожидайте выплату.');
  });

  // ============================================================
  //  ПРОФИЛЬ
  // ============================================================
  const modal = document.getElementById('profileModal');

  function openProfile() {
    const name = tgUser
      ? ((tgUser.first_name || '') + (tgUser.last_name ? ' ' + tgUser.last_name : '')).trim() || 'Игрок'
      : 'Игрок';
    document.getElementById('profileName').textContent = name;
    document.getElementById('profileAvatar').textContent =
      tgUser && tgUser.first_name ? tgUser.first_name[0].toUpperCase() : '🐹';
    document.getElementById('mTotalEarned').textContent = formatNum(state.totalEarned);
    document.getElementById('mTaps').textContent = formatNum(state.totalTaps);
    document.getElementById('mFriends').textContent = state.friends;
    document.getElementById('mLevel').textContent = getLevel();
    modal.classList.add('open');
  }

  document.getElementById('userBlock').addEventListener('click', openProfile);
  document.getElementById('closeProfile').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

  document.getElementById('saveBtn').addEventListener('click', () => {
    save(true);
    showToast('💾 Прогресс сохранён');
    haptic('medium');
  });
  document.getElementById('modalSaveBtn').addEventListener('click', () => {
    save(true);
    showToast('💾 Прогресс сохранён');
    haptic('medium');
  });

  const devFriendBtn = document.getElementById('devFriendBtn');
  if (CONFIG.devMode && devFriendBtn) {
    devFriendBtn.style.display = 'block';
    devFriendBtn.addEventListener('click', () => {
      state.friends += 1;
      state.maxEnergy += CONFIG.friendEnergyBonus;
      state.coins += CONFIG.friendBonusCoins;
      state.totalEarned += CONFIG.friendBonusCoins;
      haptic('medium');
      showToast('🧪 DEV: +1 друг (+5000 💰, +1 ⚡)');
      updateHUD();
      save(true);
    });
  }

  // ============================================================
  //  POSTBACK SYNC
  // ============================================================
  function syncBalanceFromServer() {
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      syncBalanceFromServer();
      save(true);
    } else {
      save(true);
    }
  });

  // ============================================================
  //  ИГРОВОЙ ЦИКЛ
  // ============================================================
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;

    if (state.energy < state.maxEnergy) {
      state.energy = Math.min(
        state.maxEnergy,
        state.energy + Math.floor(dt * CONFIG.energyRegenPerSec)
      );
    }

    if (state.autoLevel > 0) {
      const gain = Math.floor(state.autoLevel * dt * getBoostMultiplier());
      if (gain > 0) {
        state.coins += gain;
        state.totalEarned += gain;
      }
    }
    updateHUD();
    save(false);
  }, 1000);

  window.addEventListener('pagehide', () => save(true));

  // ============================================================
  //  TABS
  // ============================================================
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const screen = document.getElementById('screen-' + btn.dataset.tab);
      if (screen) screen.classList.add('active');
      haptic('light');
    });
  });

  // ============================================================
  //  INIT
  // ============================================================
  load();
  updateHUD();
  handleStartParam();

  console.log('[AVAR] Запущено. Telegram ID:', userId);
})();
