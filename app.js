(function () {
  'use strict';

  const CONFIG = {
    botUsername: 'AvarNetwork_bot',
    adsgramBlockId: 'YOUR_ADSGRAM_BLOCK_ID', // Сюда вставишь ID из Adsgram
    devMode: false, 
    petEmoji: '🐉',
    startCoins: 200,
    maxHealthBase: 100,
    hungerDropPerHour: 10,
    happinessDropPerHour: 5,
    deathAfterHours: 24,
    feedCost: 50,
    feedHungerRestore: 30,
    feedXp: 20,
    playCost: 30,
    playHappinessRestore: 25,
    playXp: 15,
    tapCoinsBase: 1,
    tapCoinsPerLevel: 0.5,
    incomePerSecondBase: 1,
    incomePerSecondPerLevel: 1,
    boostMultiplier: 2,
    boostDurationMs: 2 * 60 * 60 * 1000,
    offlineCapHours: 4,
    withdrawCoins: 10000000,
    withdrawStars: 10,
    saveThrottleMs: 2000,
  };

  const SAVE_VERSION = 1;
  const SAVE_PREFIX = 'sb_v1_';
  const WITHDRAWALS_KEY = 'sb_withdrawals_global';

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const tgUser = tg && tg.initDataUnsafe ? tg.initDataUnsafe.user : null;
  const userId = tgUser && tgUser.id ? String(tgUser.id) : null;

  if (!userId) {
    document.getElementById('authError').classList.add('show');
    document.getElementById('app').style.display = 'none';
    return;
  }

  document.getElementById('app').style.display = 'flex';
  try { tg.ready(); tg.expand(); tg.setHeaderColor('#08020f'); tg.setBackgroundColor('#08020f'); } catch (e) {}

  const SAVE_KEY = SAVE_PREFIX + userId;
  const state = {
    version: SAVE_VERSION,
    coins: CONFIG.startCoins,
    totalEarned: 0,
    petXP: 0,
    petLevel: 1,
    hunger: CONFIG.maxHealthBase,
    happiness: CONFIG.maxHealthBase,
    maxHealth: CONFIG.maxHealthBase,
    isDead: false,
    hungerZeroSince: 0,
    boostUntil: 0,
    lastDailyBonus: 0,
    totalFeeds: 0,
    totalPlays: 0,
    totalTaps: 0,
    completed_offer: false,
    createdAt: Date.now(),
    lastUpdate: 0,
  };

  function formatNum(n) {
    n = Math.floor(n);
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
  }

  function formatTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function haptic(type) {
    if (tg && tg.HapticFeedback) { try { tg.HapticFeedback.impactOccurred(type || 'light'); return; } catch (e) {} }
    if (navigator.vibrate) { try { navigator.vibrate(type === 'heavy' ? 25 : type === 'medium' ? 15 : 10); } catch (e) {} }
  }

  function showToast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove('show'), ms || 2200);
  }

  let lastSaveAt = 0;
  function save(force) {
    const now = Date.now();
    if (!force && now - lastSaveAt < CONFIG.saveThrottleMs) return;
    lastSaveAt = now;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function load() {
    let data = null;
    try { const raw = localStorage.getItem(SAVE_KEY); if (raw) data = JSON.parse(raw); } catch (e) {}
    if (data && data.version === SAVE_VERSION) {
      Object.assign(state, data);
      if (state.lastUpdate > 0) updateGame(Date.now());
    } else {
      state.lastUpdate = Date.now();
    }
  }

  function getAllWithdrawals() {
    try { const raw = localStorage.getItem(WITHDRAWALS_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
  }
  function saveWithdrawals(list) {
    try { localStorage.setItem(WITHDRAWALS_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function generateWithdrawalId() {
    const existing = getAllWithdrawals().map(w => w.id);
    let id; let attempts = 0;
    do { id = 10 + Math.floor(Math.random() * 491); attempts++; } while (existing.includes(id) && attempts < 1000);
    return id;
  }

  function calcLevel(xp) { return 1 + Math.floor(Math.sqrt(xp / 50)); }
  function getTapValue() { return Math.ceil(CONFIG.tapCoinsBase + CONFIG.tapCoinsPerLevel * state.petLevel); }
  function getIncomeRate() {
    if (state.isDead || state.hunger <= 0 || state.happiness <= 0) return 0;
    const base = CONFIG.incomePerSecondBase + CONFIG.incomePerSecondPerLevel * (state.petLevel - 1);
    const boost = Date.now() < state.boostUntil ? CONFIG.boostMultiplier : 1;
    return base * boost;
  }
  function xpForLevel(level) { return 50 * Math.pow(level - 1, 2); }

  function applyDecayAndIncome(elapsedSec, previousTimestamp) {
    const hungerRate = CONFIG.hungerDropPerHour / 3600;
    const happinessRate = CONFIG.happinessDropPerHour / 3600;
    const wasHunger = state.hunger; const wasHappiness = state.happiness;
    const wasHealthy = wasHunger > 0 && wasHappiness > 0;

    const timeToHungerZero = hungerRate > 0 ? wasHunger / hungerRate : Infinity;
    const timeToHappinessZero = happinessRate > 0 ? wasHappiness / happinessRate : Infinity;
    const healthyDuration = Math.min(elapsedSec, timeToHungerZero, timeToHappinessZero);

    if (wasHealthy && healthyDuration > 0) {
      const cappedDuration = Math.min(healthyDuration, CONFIG.offlineCapHours * 3600);
      const gain = getIncomeRate() * cappedDuration;
      state.coins += gain; state.totalEarned += gain;
    }

    state.hunger = Math.max(0, wasHunger - hungerRate * elapsedSec);
    state.happiness = Math.max(0, wasHappiness - happinessRate * elapsedSec);

    if (state.hunger <= 0) {
      if (wasHunger > 0) state.hungerZeroSince = previousTimestamp + timeToHungerZero * 1000;
      if (state.hungerZeroSince && Date.now() - state.hungerZeroSince >= CONFIG.deathAfterHours * 3600 * 1000) state.isDead = true;
    } else {
      state.hungerZeroSince = 0;
    }
  }

  function updateGame(now) {
    if (!state.lastUpdate) state.lastUpdate = now;
    const dtSec = (now - state.lastUpdate) / 1000;
    if (dtSec <= 0) { state.lastUpdate = now; return; }
    const wasDead = state.isDead;
    if (!state.isDead) applyDecayAndIncome(dtSec, state.lastUpdate);
    if (!wasDead && state.isDead) { showToast('💀 Питомец умер! Смотри рекламу', 4000); haptic('heavy'); }
    state.lastUpdate = now;
  }

  const el = {
    balance: document.getElementById('balanceVal'), petLevel: document.getElementById('petLevel'),
    petAvatar: document.getElementById('petAvatar'), petStatus: document.getElementById('petStatus'),
    hungerFill: document.getElementById('hungerFill'), hungerText: document.getElementById('hungerText'),
    happinessFill: document.getElementById('happinessFill'), happinessText: document.getElementById('happinessText'),
    xpFill: document.getElementById('xpFill'), xpText: document.getElementById('xpText'),
    feedBtn: document.getElementById('feedBtn'), playBtn: document.getElementById('playBtn'), adBtn: document.getElementById('adBtn'),
    adBtnLbl: document.getElementById('adBtnLbl'), feedCost: document.getElementById('feedCost'), playCost: document.getElementById('playCost'),
    boostBanner: document.getElementById('boostBanner'), boostTimer: document.getElementById('boostTimer'),
    wCoins: document.getElementById('wCoins'), reqCoins: document.getElementById('reqCoins'),
    reqOffer: document.getElementById('reqOffer'), offerStatus: document.getElementById('offerStatus'),
    withdrawBtn: document.getElementById('withdrawBtn'),
  };

  function updateHUD() {
    el.balance.textContent = formatNum(state.coins);
    el.petLevel.textContent = state.petLevel;

    el.hungerFill.style.width = Math.max(0, Math.min(100, (state.hunger / state.maxHealth) * 100)) + '%';
    el.happinessFill.style.width = Math.max(0, Math.min(100, (state.happiness / state.maxHealth) * 100)) + '%';
    el.hungerText.textContent = Math.floor(state.hunger) + ' / ' + state.maxHealth;
    el.happinessText.textContent = Math.floor(state.happiness) + ' / ' + state.maxHealth;

    const curLvlXp = xpForLevel(state.petLevel); const nextLvlXp = xpForLevel(state.petLevel + 1);
    const xpPct = (state.petXP - curLvlXp) / (nextLvlXp - curLvlXp) * 100;
    el.xpFill.style.width = Math.max(0, Math.min(100, xpPct)) + '%';
    el.xpText.textContent = state.petXP + ' XP';

    el.petAvatar.classList.remove('state-sad', 'state-dead');
    if (state.isDead) {
      el.petAvatar.textContent = '💀'; el.petAvatar.classList.add('state-dead'); el.petStatus.textContent = '💀 Мёртв';
    } else if (state.hunger <= 0 || state.happiness <= 0) {
      el.petAvatar.textContent = '😢'; el.petAvatar.classList.add('state-sad');
      el.petStatus.textContent = state.hunger <= 0 ? '😢 Голоден' : '😢 Скучает';
    } else {
      el.petAvatar.textContent = CONFIG.petEmoji;
      el.petStatus.textContent = '✨ Сыт и счастлив · +' + getIncomeRate().toFixed(1) + '/сек';
    }

    el.feedBtn.disabled = state.isDead || state.coins < CONFIG.feedCost;
    el.playBtn.disabled = state.isDead || state.coins < CONFIG.playCost;
    el.adBtnLbl.textContent = state.isDead ? 'Воскресить' : 'Реклама';

    const boostLeft = state.boostUntil - Date.now();
    if (boostLeft > 0) { el.boostBanner.style.display = 'block'; el.boostTimer.textContent = formatTime(boostLeft); }
    else { el.boostBanner.style.display = 'none'; }

    const coinsOk = state.coins >= CONFIG.withdrawCoins;
    const offerOk = state.completed_offer === true;
    if (el.wCoins) el.wCoins.textContent = formatNum(Math.min(state.coins, CONFIG.withdrawCoins));
    if (el.reqCoins) el.reqCoins.querySelector('.check').textContent = coinsOk ? '✅' : '❌';
    if (el.reqOffer) el.reqOffer.querySelector('.check').textContent = offerOk ? '✅' : '❌';
    if (el.offerStatus) el.offerStatus.textContent = offerOk ? 'Выполнено' : 'Нет';
    if (el.withdrawBtn) el.withdrawBtn.disabled = !(coinsOk && offerOk);
  }

  const particleLayer = document.createElement('div'); particleLayer.className = 'particle-layer'; document.body.appendChild(particleLayer);
  function spawnParticles(x, y, type) {
    const sets = { coin: ['💰', '💎', '⭐'], heart: ['❤️', '💖'], ball: ['🎾', '⚽'], star: ['✨', '⭐'] };
    const set = sets[type] || sets.star;
    for (let i = 0; i < 5; i++) {
      const p = document.createElement('div'); p.className = 'particle'; p.textContent = set[Math.floor(Math.random() * set.length)];
      p.style.left = x + 'px'; p.style.top = y + 'px';
      p.style.setProperty('--dx', (Math.cos(Math.random() * Math.PI * 2) * 80) + 'px');
      p.style.setProperty('--dy', (Math.sin(Math.random() * Math.PI * 2) * 80) + 'px');
      p.style.setProperty('--rot', ((Math.random() - 0.5) * 120) + 'deg');
      particleLayer.appendChild(p); setTimeout(() => p.remove(), 800);
    }
  }

  el.petAvatar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state.isDead) return showToast('💀 Сначала воскреси питомца');
    const gain = getTapValue(); state.coins += gain; state.totalEarned += gain; state.totalTaps += 1;
    haptic('light'); spawnParticles(e.clientX, e.clientY, 'coin');
    el.petAvatar.classList.add('pressed'); setTimeout(() => el.petAvatar.classList.remove('pressed'), 100);
    updateHUD(); save(false);
  }, { passive: false });

  el.feedBtn.addEventListener('click', () => {
    if (state.isDead) return;
    if (state.coins < CONFIG.feedCost) return showToast('Мало монет');
    state.coins -= CONFIG.feedCost; state.hunger = Math.min(state.maxHealth, state.hunger + CONFIG.feedHungerRestore);
    state.petXP += CONFIG.feedXp; state.petLevel = calcLevel(state.petXP); state.totalFeeds += 1;
    haptic('medium'); spawnParticles(window.innerWidth/2, window.innerHeight/2, 'heart');
    showToast('🍖 Ням-ням!'); updateHUD(); save(true);
  });

  el.playBtn.addEventListener('click', () => {
    if (state.isDead) return;
    if (state.coins < CONFIG.playCost) return showToast('Мало монет');
    state.coins -= CONFIG.playCost; state.happiness = Math.min(state.maxHealth, state.happiness + CONFIG.playHappinessRestore);
    state.petXP += CONFIG.playXp; state.petLevel = calcLevel(state.petXP); state.totalPlays += 1;
    haptic('medium'); spawnParticles(window.innerWidth/2, window.innerHeight/2, 'ball');
    showToast('🎾 Ура!'); updateHUD(); save(true);
  });

  let adController = null;
  if (window.Adsgram && CONFIG.adsgramBlockId !== 'YOUR_ADSGRAM_BLOCK_ID') {
    try { adController = window.Adsgram.init({ blockId: CONFIG.adsgramBlockId }); } catch (e) {}
  }

  el.adBtn.addEventListener('click', () => {
    const cb = () => {
      const wasDead = state.isDead;
      state.hunger = state.maxHealth; state.happiness = state.maxHealth; state.hungerZeroSince = 0;
      state.isDead = false; state.boostUntil = Date.now() + CONFIG.boostDurationMs;
      haptic('heavy'); spawnParticles(window.innerWidth/2, window.innerHeight/2, 'star');
      showToast(wasDead ? '✨ Воскрешён!' : '🔥 Бонус получен!');
      updateHUD(); save(true);
    };
    if (adController) {
      adController.show().then((r) => { if (r && r.done) cb(); else showToast('Реклама не досмотрена'); }).catch(() => showToast('Реклама недоступна'));
    } else {
      showToast('📺 Реклама (симуляция)...'); setTimeout(cb, 1200);
    }
  });

  el.withdrawBtn.addEventListener('click', () => {
    if (state.coins < CONFIG.withdrawCoins || !state.completed_offer) return;
    const record = { id: generateWithdrawalId(), userId, amount: CONFIG.withdrawCoins, status: 'pending', createdAt: Date.now() };
    state.coins -= CONFIG.withdrawCoins; state.completed_offer = false;
    const all = getAllWithdrawals(); all.push(record); saveWithdrawals(all);
    save(true); showToast('✅ Заявка #' + record.id + ' создана. Ожидайте выплату.', 4000); haptic('heavy'); updateHUD();
  });

  document.getElementById('petMeta').addEventListener('click', () => {
    document.getElementById('pTotalEarned').textContent = formatNum(state.totalEarned);
    document.getElementById('pDaysAlive').textContent = Math.max(1, Math.floor((Date.now() - state.createdAt) / (24 * 3600 * 1000)) + 1);
    document.getElementById('pTaps').textContent = formatNum(state.totalTaps);
    document.getElementById('pFeeds').textContent = formatNum(state.totalFeeds);
    document.getElementById('profileModal').classList.add('open');
  });
  document.getElementById('closeProfile').addEventListener('click', () => document.getElementById('profileModal').classList.remove('open'));

  // DEV Buttons для тебя
  document.getElementById('devGrantCoinsBtn').addEventListener('click', () => {
    state.coins += CONFIG.withdrawCoins; state.totalEarned += CONFIG.withdrawCoins;
    showToast('🧪 +10M монет'); updateHUD(); save(true);
  });
  document.getElementById('devCompleteOfferBtn').addEventListener('click', () => {
    state.completed_offer = !state.completed_offer; showToast('🧪 completed_offer = ' + state.completed_offer); updateHUD(); save(true);
  });

  setInterval(() => { updateGame(Date.now()); updateHUD(); save(false); }, 1000);
  window.addEventListener('pagehide', () => save(true));

  load(); updateGame(Date.now()); updateHUD();
})();
