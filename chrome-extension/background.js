// Background script (OpenRouter only) com cache, cooldown e múltiplos fallbacks + Plano Free/Premium
let isExtensionActive = true;
let summarySettings = {
  autoSummary: true,
  language: 'pt',
  detailLevel: 'medium',
  persona: '',
  openrouterKey: '',
  deepseekKey: '',
  backendBaseUrl: '' // NEW: backend configurável pelo usuário
};

// Plano/Quota
const DAILY_LIMIT = 30; // free
// MASTER KEY removida (não será mais utilizada).

// Controlador para permitir cancelar a geração em andamento
let currentAbortController = null;
let lastRequestTabId = null;

const DEFAULT_OR_API_KEY = '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'; // chave fornecida pelo usuário

// Backends conhecidos (fallbacks), ordem de preferência: antigo estável -> atual
const FALLBACK_BACKENDS = [
  'https://pdf-reader-plus.preview.emergentagent.com',
  'https://summary-pro.preview.emergentagent.com'
];

const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Somente modelos FREE do OpenRouter
const PRIMARY_MODEL = 'deepseek/deepseek-r1:free';
const FALLBACK_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'qwen/qwen3-coder:free',
  'tngtech/deepseek-r1t2-chimera:free',
  'google/gemini-2.0-flash-exp:free',
  'openai/gpt-oss-20b:free',
  'deepseek/deepseek-r1-distill-llama-70b:free'
];
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function getApiKey() {
  const user = (summarySettings.openrouterKey || '').trim();
  return user || DEFAULT_OR_API_KEY;
}

// DeepSeek API Key ofuscada (sem campo no popup) – usada somente como último fallback
(function initDSKey(){
  try {
    // String: "sk-f4b580d11f8a4e07aac8d498437ca999"
    const _ds_nums = [
      115,107,45,102,52,98,53,56,48,100,49,49,102,56,97,52,101,48,55,97,97,99,56,100,52,57,56,52,51,55,99,97,57,57,57
    ];
    // XOR leve e reconstrução
    const _ds_obf = _ds_nums.map((c,i)=> (c ^ (7 + (i%3))));
    const _ds = String.fromCharCode(..._ds_obf.map((v,i)=> v ^ (7 + (i%3))));
    summarySettings.deepseekKey = _ds;
  } catch (e) {}
})();

function getDeepseekApiKey() {
  return (summarySettings.deepseekKey || '').trim();
}

function loadSettingsFromStorage(callback) {
  chrome.storage.sync.get(['extensionActive', 'summarySettings', 'as_last_backend_base'], (result) => {
    if (result && typeof result.extensionActive !== 'undefined') isExtensionActive = result.extensionActive;
    if (result && result.summarySettings) summarySettings = { ...summarySettings, ...result.summarySettings };
    if (result && result.as_last_backend_base && !summarySettings.backendBaseUrl) {
      // Se não há base configurada, mas temos uma última que funcionou, mantemos em memória
      // (não sobrescreve a configurada manualmente)
    }
    if (typeof callback === 'function') callback({ isActive: isExtensionActive, summarySettings });
  });
}

loadSettingsFromStorage();
chrome.runtime.onInstalled.addListener(() => loadSettingsFromStorage());
chrome.runtime.onStartup?.addListener?.(() => loadSettingsFromStorage());

chrome.commands.onCommand.addListener((command) => {
  if (command === 'generate_summary') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'generateSummary', manual: true });
    });
  }
});

// =========================
// Persistência sem servidor
// =========================
const BOOKMARK_URL = 'https://autosummarizer.local/data';
const BOOKMARK_FOLDER_NAME = 'AutoSummarizer Data';

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function prom(cb) { return new Promise((resolve) => cb((r) => resolve(r))); }

async function sha256Hex(message) {
  const enc = new TextEncoder();
  const data = enc.encode(message);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(hash));
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function buildFingerprintString() {
  try {
    const nav = self.navigator || {};
    const parts = [
      nav.userAgent || '',
      nav.platform || '',
      nav.language || '',
      Array.isArray(nav.languages) ? nav.languages.join(',') : '',
      String(new Date().getTimezoneOffset()),
      String(nav.hardwareConcurrency || 0)
    ];
    return parts.join('|');
  } catch (e) {
    return 'fallback-fp';
  }
}

class DeviceStateManager {
  constructor() {
    this.state = null; // { deviceId, premium: {unlimited, until, keyMasked}, dailyUsage: {date, count} }
  }

  async ensureLoaded() {
    if (this.state) return;
    const syncRes = await prom((cb) => chrome.storage.sync.get('as_device_state', cb));
    let st = syncRes?.as_device_state || null;

    if (!st) {
      st = await this.loadFromBookmarks();
    }

    if (!st) {
      const localRes = await prom((cb) => chrome.storage.local.get(['dailyUsage'], cb));
      const d = localRes?.dailyUsage;
      const deviceId = await sha256Hex(buildFingerprintString());
      st = {
        deviceId,
        premium: { until: null, unlimited: false, keyMasked: null },
        dailyUsage: d || { date: todayStr(), count: 0 }
      };
    }

    if (!st) {
      const deviceId = await sha256Hex(buildFingerprintString());
      st = { deviceId, premium: { until: null, unlimited: false, keyMasked: null }, dailyUsage: { date: todayStr(), count: 0 } };
    }

    const t = todayStr();
    if (st.dailyUsage?.date !== t) st.dailyUsage = { date: t, count: 0 };

    try {
      const migRes = await prom((cb) => chrome.storage.sync.get('as_mig_v105_no_trial', cb));
      const migrated = !!(migRes && migRes.as_mig_v105_no_trial);
      if (!migrated) {
        if (st.premium && st.premium.unlimited !== true) {
          let keep = false;
          try {
            if (st.premium.until) {
              const t2 = new Date(st.premium.until).getTime();
              if (!isNaN(t2) && t2 > Date.now()) keep = true;
            }
          } catch (e) {}
          if (!keep) {
            // mantém
          }
        }
        await prom((cb) => chrome.storage.sync.set({ as_mig_v105_no_trial: true }, cb));
      }
    } catch (e) {}

    try {
      const migRes2 = await prom((cb) => chrome.storage.sync.get('as_mig_v106_drop_unlimited', cb));
      const migrated2 = !!(migRes2 && migRes2.as_mig_v106_drop_unlimited);
      if (!migrated2) {
        if (st.premium && st.premium.unlimited === true) {
          st.premium.unlimited = false;
          st.premium.until = null;
          st.premium.keyMasked = null;
          st.premium.keyObf = null;
        }
        await prom((cb) => chrome.storage.sync.set({ as_mig_v106_drop_unlimited: true }, cb));
      }
    } catch (e) {}

    this.state = st;
    await this.persist();
  }

  async persist() {
    if (!this.state) return;
    try { if (this.state.premium && this.state.premium.until instanceof Date) { this.state.premium.until = this.state.premium.until.toISOString(); } } catch {}
    await prom((cb) => chrome.storage.sync.set({ as_device_state: this.state }, cb));
    await this.saveToBookmarks();
  }

  getSnapshot() {
    const st = this.state || { premium: {}, dailyUsage: {} };
    return {
      dailyUsage: st.dailyUsage || { date: todayStr(), count: 0 },
      premium: st.premium || { until: null, unlimited: false }
    };
  }

  isPremiumActive(premium = null) {
    const p = premium || this.state?.premium || {};
    if (p.unlimited) return true;
    if (p.active === true) return true;
    if (p.until) {
      try { const d = new Date(p.until); return !isNaN(d.getTime()) && d.getTime() > Date.now(); } catch { return false; }
    }
    return false;
  }

  async enforceQuotaOrFail() {
    await this.ensureLoaded();
    const { dailyUsage, premium } = this.getSnapshot();
    if (this.isPremiumActive(premium)) return { ok: true, dailyUsage, premium };
    if ((dailyUsage.count || 0) >= DAILY_LIMIT) {
      return { ok: false, error: `Limite diário atingido (${DAILY_LIMIT}/${DAILY_LIMIT}). Insira sua KEY de ASSINATURA válida para liberar o Premium.` };
    }
    return { ok: true, dailyUsage, premium };
  }

  async registerSuccessUsage() {
    await this.ensureLoaded();
    const t = todayStr();
    if (!this.state.dailyUsage || this.state.dailyUsage.date !== t) {
      this.state.dailyUsage = { date: t, count: 0 };
    }
    this.state.dailyUsage.count = (this.state.dailyUsage.count || 0) + 1;
    await this.persist();
    return this.state.dailyUsage.count;
  }

  async applyKey(keyRaw) {
    await this.ensureLoaded();
    const key = String(keyRaw || '').trim();
    if (!key || key.length < 6) return { ok: false, error: 'KEY inválida' };
    try {
      const valid = await validateKeyServer(key);
      if (valid && valid.ok) {
        const until = valid.expires_at ? new Date(valid.expires_at) : null;
        this.state.premium = { unlimited: false, until: until ? until.toISOString() : null, keyMasked: this.maskKey(key), keyObf: obfuscateKey(key) };
        await this.persist();
        return { ok: true, plan: 'premium', premiumUntil: until ? until.toISOString() : null };
      }
      return { ok: false, error: 'KEY inválida' };
    } catch (e) {
      return { ok: false, error: 'Falha na validação da KEY. Tente novamente.' };
    }
  }

  maskKey(k) {
    const s = String(k);
    if (s.length <= 6) return '***';
    return s.substring(0, 3) + '***' + s.substring(s.length - 3);
  }

  async loadFromBookmarks() {
    try {
      const currentDeviceId = await sha256Hex(buildFingerprintString());
      const title = `AS_STATE_${currentDeviceId}`;
      const matches = await prom((cb) => chrome.bookmarks.search({ title }, cb));
      let node = null;
      if (Array.isArray(matches) && matches.length > 0) {
        node = matches.sort((a,b)=> (b.dateGroupModified||0) - (a.dateGroupModified||0))[0];
      } else {
        const all = await prom((cb) => chrome.bookmarks.search({ url: BOOKMARK_URL }, cb));
        if (Array.isArray(all) && all.length > 0) {
          node = all.sort((a,b)=> (b.dateGroupModified||0) - (a.dateGroupModified||0))[0];
        }
      }
      if (!node || !node.url) return null;
      const hashIndex = node.url.indexOf('#');
      if (hashIndex === -1) return null;
      const b64 = node.url.substring(hashIndex + 1);
      const json = atob(b64);
      const obj = JSON.parse(json);
      return obj;
    } catch (e) {
      return null;
    }
  }

  async ensureFolder() {
    const tree = await prom((cb) => chrome.bookmarks.getTree(cb));
    const root = tree && tree[0];
    const bar = root?.children?.find(c => c.title === 'Bookmarks Bar' || c.title === 'Barra de favoritos') || root?.children?.[0];
    let folder = null;
    function findFolder(nodes) {
      for (const n of nodes) {
        if (n.url) continue;
        if (n.title === BOOKMARK_FOLDER_NAME) return n;
        if (n.children) {
          const f = findFolder(n.children);
          if (f) return f;
        }
      }
      return null;
    }
    folder = findFolder(root?.children || [])
    if (folder) return folder.id;
    const created = await prom((cb) => chrome.bookmarks.create({ parentId: bar?.id, title: BOOKMARK_FOLDER_NAME }, cb));
    return created.id;
  }

  async saveToBookmarks() {
    try {
      const folderId = await this.ensureFolder();
      const title = `AS_STATE_${this.state.deviceId}`;
      const dataStr = JSON.stringify(this.state);
      const url = `${BOOKMARK_URL}#${btoa(dataStr)}`;
      const existing = await prom((cb) => chrome.bookmarks.search({ title }, cb));
      if (Array.isArray(existing) && existing.length > 0) {
        await prom((cb) => chrome.bookmarks.update(existing[0].id, { title, url }, cb));
      } else {
        await prom((cb) => chrome.bookmarks.create({ parentId: folderId, title, url }, cb));
      }
    } catch (e) {
      // Ignore
    }
  }
}

const deviceStateManager = new DeviceStateManager();

// Helpers: armazenar/limpar KEY crua para revalidação
async function getStoredRawKey(){ try{ const r=await prom((cb)=>chrome.storage.local.get('as_sub_key_raw', cb)); const v=r&&r.as_sub_key_raw; return v?String(v):''; }catch(e){ return ''; }}
async function setStoredRawKey(k){ try{ await prom((cb)=>chrome.storage.local.set({ as_sub_key_raw: String(k||'') }, cb)); }catch(e){} }
async function clearStoredRawKey(){ try{ await prom((cb)=>chrome.storage.local.remove('as_sub_key_raw', cb)); }catch(e){} }

async function revalidateIfNeeded(){
  try {
    const key = (await getStoredRawKey()).trim();
    if (!key) return false;
    const v = await validateKeyServer(key);
    await deviceStateManager.ensureLoaded();
    if (!(v && v.ok)) {
      if (deviceStateManager.state) {
        deviceStateManager.state.premium = { until: null, unlimited: false, keyMasked: null };
        await clearStoredRawKey();
        await deviceStateManager.persist();
      }
      return true;
    } else {
      const untilIso = v.expires_at ? new Date(v.expires_at).toISOString() : null;
      const masked = deviceStateManager.state?.premium?.keyMasked || (function(){ try { return deviceStateManager.maskKey ? deviceStateManager.maskKey(key) : null; } catch(e){ return null; } })();
      deviceStateManager.state.premium = { unlimited: false, until: untilIso, keyMasked: masked };
      await deviceStateManager.persist();
      return false;
    }
  } catch (e) { return false; }
}

// ============ Mensageria ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'stopGeneration') {
    try { currentAbortController?.abort?.(); } catch (e) {}
    sendResponse({ success: true, stopped: true });
    return true;
  }
  if (message.action === 'getSettings') {
    try {
      chrome.storage.local.get('as_sub_key_raw', (r) => {
        const raw = r && r.as_sub_key_raw ? String(r.as_sub_key_raw).trim() : '';
        const proceed = () => loadSettingsFromStorage(() => sendResponse({ isActive: isExtensionActive, settings: summarySettings }));
        if (!raw) {
          try {
            deviceStateManager.ensureLoaded().then(async () => {
              try {
                const snap = deviceStateManager.getSnapshot();
                const prem = snap && snap.premium ? snap.premium : {};
                const active = deviceStateManager.isPremiumActive(prem);
                if (active) {
                  deviceStateManager.state.premium = { until: null, unlimited: false, keyMasked: null };
                  await deviceStateManager.persist();
                }
              } catch (e) {}
              proceed();
            });
          } catch (e) { proceed(); }
          return;
        }
        validateKeyServer(raw)
          .then(async (v) => {
            try {
              await deviceStateManager.ensureLoaded();
              if (!(v && v.ok)) {
                if (deviceStateManager.state) {
                  deviceStateManager.state.premium = { until: null, unlimited: false, keyMasked: null };
                  await deviceStateManager.persist();
                }
                try { chrome.storage.local.remove('as_sub_key_raw', () => {}); } catch (e) {}
              } else {
                const untilIso = v.expires_at ? (new Date(v.expires_at)).toISOString() : null;
                const masked = (deviceStateManager.state && deviceStateManager.state.premium && deviceStateManager.state.premium.keyMasked) ? deviceStateManager.state.premium.keyMasked : null;
                deviceStateManager.state.premium = { unlimited: false, until: untilIso, keyMasked: masked };
                await deviceStateManager.persist();
              }
            } catch (e) {}
          })
          .finally(proceed);
      });
    } catch (e) {
      loadSettingsFromStorage(() => sendResponse({ isActive: isExtensionActive, settings: summarySettings }));
    }
    return true;
  }
  if (message.action === 'updateSettings') {
    if (typeof message.isActive === 'boolean') isExtensionActive = message.isActive;
    if (message.settings && typeof message.settings === 'object') summarySettings = { ...summarySettings, ...message.settings };
    chrome.storage.sync.set({ extensionActive: isExtensionActive, summarySettings }, () => sendResponse({ success: true, isActive: isExtensionActive, settings: summarySettings }));
    return true;
  }

  // Plano/Quota
  if (message.action === 'getQuotaStatus') {
    (async () => {
      await deviceStateManager.ensureLoaded();
      const { dailyUsage, premium } = deviceStateManager.getSnapshot();
      sendResponse({
        success: true,
        plan: deviceStateManager.isPremiumActive(premium) ? (premium.unlimited ? 'premium_unlimited' : 'premium') : 'free',
        premiumUntil: premium.until ? (typeof premium.until === 'string' ? premium.until : (new Date(premium.until)).toISOString()) : null,
        countToday: dailyUsage.count || 0,
        limit: DAILY_LIMIT
      });
    })();
    return true;
  }
  if (message.action === 'fetchPdfBinary') {
    (async () => {
      try {
        const resp = await fetch(message.url, { method: 'GET' });
        if (!resp.ok) { sendResponse({ ok: false, error: 'HTTP ' + resp.status }); return; }
        const buf = await resp.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buf);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        const b64 = btoa(binary);
        sendResponse({ ok: true, b64 });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  if (message.action === 'applySubscriptionKey') {
    (async () => {
      const key = String(message.key || '')
      const res = await deviceStateManager.applyKey(key);
      if (!res.ok) { sendResponse({ success: false, error: res.error || 'Falha' }); return; }
      try { await setStoredRawKey(key); } catch (e) {}
      await deviceStateManager.ensureLoaded();
      const { premium } = deviceStateManager.getSnapshot();
      sendResponse({ success: true, plan: res.plan, premiumUntil: premium.until || res.premiumUntil || null });
    })();
    return true;
  }

  if (message.action === 'generateSummary') {
    (async () => {
      const quotaCheck = await deviceStateManager.enforceQuotaOrFail();
      if (!quotaCheck.ok) { sendResponse({ success: false, error: quotaCheck.error }); return; }

      if (!message.text || message.text.length < 50) { sendResponse({ success: false, error: 'Conteúdo insuficiente para gerar resumo' }); return; }
      const fromPdf = message.source === 'pdf';
      const fileName = message.fileName || 'Documento PDF';

      const isPrem = deviceStateManager.isPremiumActive(quotaCheck.premium || {});
      const originalLevel = summarySettings.detailLevel;
      const mustDowngrade = !isPrem && String(originalLevel || '').toLowerCase() === 'profundo';
      if (mustDowngrade) summarySettings.detailLevel = 'long';

      try {
        const cooldown = await getCooldown();
        if (cooldown > Date.now()) { const secs = Math.ceil((cooldown - Date.now()) / 1000); sendResponse({ success: false, error: `Serviço temporariamente indisponível. Aguarde ${secs}s.` }); return; }
        const personaKey = (summarySettings.persona || '').trim();
        const settingsKey = JSON.stringify({ persona: personaKey, language: summarySettings.language, detail: summarySettings.detailLevel });
        const key = contentHash(settingsKey + '|' + message.text);
        const cached = await getFromCache(key);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
          await chrome.storage.local.set({ lastModelUsed: cached.model || 'cache' });
          await deviceStateManager.registerSuccessUsage();
          if (fromPdf) { await saveToHistory(message.text, cached.summary, sender.tab, { inferredTitle: cached.title || fileName, source: 'pdf', persona: personaKey }); sendResponse({ success: true, summary: cached.summary, title: cached.title || fileName, modelUsed: cached.model || 'cache' }); }
          else { await saveToHistory(message.text, cached.summary, sender.tab, { persona: personaKey }); sendResponse({ success: true, summary: cached.summary, title: sender?.tab?.title || 'Página', modelUsed: cached.model || 'cache' }); }
          return;
        }

        let modelUsed = null;
        let title = null;
        let summary = null;
        if (fromPdf) {
          const combined = await generatePdfTitleAndSummaryOR(message.text);
          title = combined.title || fileName;
          summary = combined.summary;
          modelUsed = combined.model;
        } else {
          const r = await generateSummaryOR(message.text);
          summary = r.text;
          modelUsed = r.model;
        }

        await saveToCache(key, { title: title || null, summary, model: modelUsed, timestamp: Date.now(), source: fromPdf ? 'pdf' : 'web' });
        await chrome.storage.local.set({ lastModelUsed: modelUsed });

        const extra = { persona: (summarySettings.persona || '').trim() };
        await deviceStateManager.registerSuccessUsage();
        if (fromPdf) { await saveToHistory(message.text, summary, sender.tab, { inferredTitle: title || fileName, source: 'pdf', ...extra }); sendResponse({ success: true, summary, title: title || fileName, modelUsed }); }
        else { await saveToHistory(message.text, summary, sender.tab, extra); sendResponse({ success: true, summary, title: sender?.tab?.title || 'Página', modelUsed }); }
      } catch (error) {
        const msg = (error && error.message) ? error.message : 'Falha ao acessar o serviço de IA';
        const status = (error && error.status) ? String(error.status) : (msg.match(/\b(\d{3})\b/) || [])[1];
        if (status === '401' || /User not found/i.test(msg)) {
          sendResponse({ success: false, error: 'Sua OpenRouter API Key parece inválida. Abra o popup e informe sua própria chave.' });
          return;
        }
        if (/429/.test(msg)) await setCooldown(20000);
        let display = msg;
        if (msg.includes('503') || /UNAVAILABLE/i.test(msg) || /Failed to fetch/i.test(msg)) display = 'Serviço temporariamente indisponível. Tente novamente em alguns segundos.';
        sendResponse({ success: false, error: display });
      } finally {
        if (mustDowngrade) summarySettings.detailLevel = originalLevel;
      }
    })();
    return true;
  }

  if (message.action === 'getHistory') { getHistory().then(h => sendResponse({ history: h })); return true; }
  if (message.action === 'clearHistory') { clearHistory().then(() => sendResponse({ success: true })); return true; }
  if (message.action === 'hardResetState') { (async () => { const out = await hardResetAll(); sendResponse({ success: true, ...out }); })(); return true; }
  if (message.action === 'forceFree') { (async () => { const out = await forceFreeLocal(); sendResponse({ success: true, ...out }); })(); return true; }
});

// =====================
// OpenRouter helpers
// =====================
function getMaxTokens() {
  switch ((summarySettings.detailLevel || '').toLowerCase()) {
    case 'short': return 600;
    case 'medium': return 900;
    case 'long': return 1400;
    case 'profundo': return 2200;
    default: return 1000;
  }
}

async function orRequest(messages, model) {
  await new Promise((resolve) => chrome.storage.sync.get(['summarySettings'], (r) => { if (r && r.summarySettings) summarySettings = { ...summarySettings, ...r.summarySettings }; resolve(); }));
  const headers = { 'Authorization': `Bearer ${getApiKey()}`, 'Content-Type': 'application/json', 'HTTP-Referer': chrome.runtime.getURL(''), 'X-Title': 'Auto-Summarizer OR' };
  const body = JSON.stringify({ model, messages, temperature: 0.7, max_tokens: getMaxTokens() });
  const resp = await fetch(OR_URL, { method: 'POST', headers, body, signal: currentAbortController?.signal });
  if (!resp.ok) { const detail = await resp.text(); const err = new Error(`OpenRouter API error: ${resp.status} - ${detail}`); err.status = resp.status; throw err; }
  const data = await resp.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error('Resposta inválida da OpenRouter');
  return { text: out, model };
}

async function orWithFallback(messages) {
  currentAbortController = new AbortController();
  const shouldFallback = (err) => {
    if (!err) return true;
    const s = err.status;
    const msg = String(err.message || '').toLowerCase();
    if (s === 401 || s === 403) return false;
    if (s === 429 || s === 503) return true;
    if (typeof s === 'number' && s >= 500) return true;
    if (!s) return true;
    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('timeout')) return true;
    return false;
  };

  try {
    return await orRequest(messages, PRIMARY_MODEL);
  } catch (e) {
    if (!shouldFallback(e)) throw e;
    if (e && (e.status === 429 || e.status === 503)) await setCooldown(20000);
    for (const m of FALLBACK_MODELS) {
      try {
        return await orRequest(messages, m);
      } catch (err) {
        if (shouldFallback(err)) {
          if (err && (err.status === 429 || err.status === 503)) await setCooldown(20000);
          continue;
        } else {
          throw err;
        }
      }
    }
    const dsKey = getDeepseekApiKey();
    if (dsKey) {
      try {
        const out = await deepseekDirect(messages, dsKey);
        return out;
      } catch (err) {
      }
    }
    throw new Error('Serviço temporariamente indisponível após múltiplas tentativas. Tente novamente em instantes.');
  }
}

function buildSummaryInstructions(text) {
  const level = (summarySettings.detailLevel || '').toLowerCase();
  let detailPrompt = '';
  switch (level) {
    case 'short': detailPrompt = 'Crie um resumo muito breve (máximo 3 pontos principais).'; break;
    case 'medium': detailPrompt = 'Crie um resumo conciso com os pontos principais (5-7 pontos).'; break;
    case 'long': detailPrompt = 'Crie um resumo detalhado e abrangente, incluindo seções e subtópicos relevantes.'; break;
    case 'profundo':
      detailPrompt = 'Crie um resumo EXTREMAMENTE PROFUNDO, LONGO e PRECISO. Estruture em seções claras: (1) Contexto e objetivo; (2) Metodologia (amostra, desenho, instrumentos, análises); (3) Resultados (com números‑chave); (4) Discussão (interpretações e limitações); (5) Implicações práticas e teóricas; (6) Conclusões; (7) Palavras‑chave.';
      break;
  }
  const persona = (summarySettings.persona || '').trim();
  const styleLine = persona ? `Adote apenas o TOM/ESTILO a seguir, sem aumentar profundidade além do nível escolhido: ${persona}.` : '';

  const defaultRules = `\n\nRegras de formatação (siga exatamente):\n1) Produza de 3 a 8 pontos principais como lista numerada (1., 2., 3., ...)\n2) Em cada item, comece com um tópico curto (3–8 palavras), seguido de dois pontos e, em seguida, uma explicação breve em uma única frase\n3) Quando for útil, adicione 1–3 subitens iniciados com "- " (hífen e espaço), cada um curto\n4) Não use markdown com **asteriscos**, títulos ou blocos de código\n5) Não envolva a resposta em blocos de código; retorne apenas texto simples estruturado`;

  const deepRules = `\n\nRegras do modo PROFUNDO (siga exatamente):\nA) Primeiro, liste os pontos principais como em uma lista numerada (1., 2., 3., ...), podendo incluir subitens com "- ".\nB) EM SEGUIDA, crie uma seção chamada EXPANSÕES e EXPANDA CADA SUBITEM listado anteriormente com 1–2 parágrafos explicativos, baseados no texto, com números, exemplos e nuances quando existirem.\nC) NÃO invente dados; se não houver números disponíveis, explique qualitativamente.\nD) Mantenha o tom/persona definidos sem aumentar a profundidade além do nível PROFUNDO.\nE) Retorne apenas texto simples (sem markdown de títulos), usando a etiqueta literal "EXPANSÕES:" para iniciar a parte de aprofundamento.`;

  const rules = level === 'profundo' ? deepRules : defaultRules;

  return `${detailPrompt} do seguinte texto em ${summarySettings.language === 'pt' ? 'português' : 'inglês'}.${styleLine ? `\n${styleLine}` : ''}${rules}\n\nTexto a resumir:\n${text.substring(0, 50000)}`;
}

async function generateSummaryOR(text) {
  const level = (summarySettings.detailLevel || '').toLowerCase();
  const persona = (summarySettings.persona || '').trim();
  const sys = persona
    ? `Você é um assistente de resumo. Mantenha o TOM/ESTILO indicado, mas NÃO aumente a complexidade/tamanho além do nível de detalhe selecionado: ${persona}. Siga as regras de formatação.`
    : 'Você é um assistente de resumo que retorna lista numerada com tópicos curtos e subitens quando necessário.';
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: buildSummaryInstructions(text) }
  ];
  const result = await orWithFallback(messages);

  if (level === 'profundo') {
    const hasExp = /\bEXPANSÕES\s*:/i.test(result.text);
    if (!hasExp) {
      try {
        const prompt2 = `A seguir está um RESUMO com subitens. Crie apenas a seção EXPANSÕES, expandindo cada subitem com 1–2 parágrafos, sem repetir o resumo inicial.\n\nRESUMO:\n${result.text.substring(0, 45000)}`;
        const messages2 = [
          { role: 'system', content: sys },
          { role: 'user', content: prompt2 }
        ];
        const r2 = await orWithFallback(messages2);
        result.text = `${result.text}\n\nEXPANSÕES:\n${r2.text}`;
      } catch (e) {}
    }
  }
  return result;
}

async function generatePdfTitleAndSummaryOR(text) {
  const level = (summarySettings.detailLevel || '').toLowerCase();
  const persona = (summarySettings.persona || '').trim();
  const styleLine = persona ? `\nInstrua-se a escrever exatamente no seguinte estilo/persona (sem quebrar as regras de formatação): ${persona}.` : '';
  const sys = persona
    ? `Você é um assistente de resumo. Mantenha o TOM/ESTILO indicado, mas NÃO aumente a complexidade/tamanho além do nível de detalhe selecionado: ${persona}. Siga as regras de formatação.`
    : 'Você é um assistente de resumo que retorna lista numerada com tópicos curtos e subitens quando necessário.';

  const base = `Você receberá o conteúdo textual de um arquivo PDF. Gere:\n- TITLE: um título curto (no máximo 10 palavras), sem aspas/markdown\n- SUMMARY: um resumo estruturado conforme regras abaixo${styleLine}`;
  const rulesDefault = `\n\nRegras do SUMMARY (siga exatamente):\n1) 3 a 8 itens numerados (1., 2., ...)\n2) Cada item: um tópico curto (3–8 palavras) seguido de dois pontos e uma frase breve\n3) Subitens opcionais iniciados com "- " (1–3)`;
  const rulesDeep = `\n\nRegras do SUMMARY no modo PROFUNDO:\n1) Faça como acima (itens numerados, subitens com "- ")\n2) Depois, crie a seção EXPANSÕES e expanda cada subitem com 1–2 parágrafos detalhados, sem inventar dados`;
  const prompt = `${base}${level === 'profundo' ? rulesDeep : rulesDefault}\n\nResponda estritamente neste formato:\nTITLE: <título curto>\nSUMMARY:\n1. <tópico curto>: <frase>\n- <subitem opcional>\n2. ...${level === 'profundo' ? '\n\nEXPANSÕES:\n<expansões de cada subitem>' : ''}\n\nConteúdo (parcial):\n${text.substring(0, 50000)}`;

  const messages = [ { role: 'system', content: sys }, { role: 'user', content: prompt } ];
  const { text: out, model } = await orWithFallback(messages);
  let title = null, summary = null;
  const lines = out.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.toUpperCase().startsWith('TITLE:')) title = l.substring(6).trim();
    if (l.toUpperCase().startsWith('SUMMARY:')) { summary = lines.slice(i + 1).join('\n').trim(); break; }
  }
  return { title, summary: summary || out, model };
}

// DeepSeek direto (último fallback)
async function deepseekDirect(messages, apiKey) {
  const url = 'https://api.deepseek.com/v1/chat/completions';
  const body = {
    model: 'deepseek-chat',
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: 0.7,
    max_tokens: 1024
  };
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: currentAbortController?.signal });
  if (!resp.ok) {
    const detail = await resp.text();
    const err = new Error(`DeepSeek API error: ${resp.status} - ${detail}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error('Resposta inválida da DeepSeek');
  return { text: out, model: 'deepseek-direct' };
}

function contentHash(str) { let h = 5381; for (let i = 0; i < str.length; i++) { h = ((h << 5) + h) + str.charCodeAt(i); h |= 0; } return `h${h}`; }

function obfuscateKey(k) {
  try {
    const s = String(k);
    const head = s.slice(0, 3);
    const tail = s.slice(-3);
    return head + '***' + tail;
  } catch { return '***'; }
}

async function resolveBackendBases() {
  try {
    const r = await prom((cb) => chrome.storage.sync.get(['summarySettings', 'as_last_backend_base'], cb));
    const configured = (r && r.summarySettings && r.summarySettings.backendBaseUrl) ? String(r.summarySettings.backendBaseUrl).trim() : '';
    const sticky = (r && r.as_last_backend_base) ? String(r.as_last_backend_base).trim() : '';
    const list = [];
    if (configured) list.push(configured.replace(/\/$/, ''));
    if (sticky && !list.includes(sticky)) list.push(sticky);
    for (const b of FALLBACK_BACKENDS) if (!list.includes(b)) list.push(b);
    return list;
  } catch (e) {
    return [...FALLBACK_BACKENDS];
  }
}

async function validateKeyServer(key) {
  const bases = await resolveBackendBases();
  let firstError = null;
  for (const base of bases) {
    try {
      const url = base.replace(/\/$/, '') + '/api/premium/keys/validate';
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      if (!resp.ok) { firstError = firstError || { ok: false, error: 'http_'+resp.status }; continue; }
      const data = await resp.json();
      const ms = (typeof data?.expires_at_ms === 'number' && data.expires_at_ms > 0) ? data.expires_at_ms : null;
      let iso = null;
      if (ms) iso = new Date(ms).toISOString();
      else if (data?.expires_at) { const d = new Date(data.expires_at); iso = isNaN(d.getTime()) ? null : d.toISOString(); }
      const ok = !!(data && data.valid === true && data.plan === 'premium' && data.status === 'active');
      if (ok) {
        try { await prom((cb)=>chrome.storage.sync.set({ as_last_backend_base: base.replace(/\/$/, '') }, cb)); } catch (e) {}
        return { ok: true, expires_at: iso, raw: data };
      }
      // Mantém info do primeiro erro significativo
      if (!firstError) firstError = { ok: false, error: data?.status || 'invalid', raw: data };
      // Se este backend diz revoked/expired, provavelmente é o correto: podemos retornar
      if (data?.status === 'revoked' || data?.status === 'expired') return { ok: false, error: data.status, raw: data };
      // Tenta próximo (pode haver divergência de ambientes)
    } catch (e) {
      firstError = firstError || { ok: false, error: String(e?.message || e) };
      continue;
    }
  }
  return firstError || { ok: false };
}

async function getFromCache(key) { const res = await chrome.storage.local.get('summaryCache'); return (res.summaryCache || {})[key] || null; }
async function saveToCache(key, value) { const res = await chrome.storage.local.get('summaryCache'); const cache = res.summaryCache || {}; cache[key] = value; const keys = Object.keys(cache); if (keys.length > 100) { let oldestKey = null, oldestTs = Infinity; for (const k of keys) { const ts = cache[k]?.timestamp || 0; if (ts < oldestTs) { oldestTs = ts; oldestKey = k; } } if (oldestKey) delete cache[oldestKey]; } await chrome.storage.local.set({ summaryCache: cache }); }
async function getCooldown() { const r = await chrome.storage.local.get('openrouterCooldownUntil'); return r.openrouterCooldownUntil || 0; }
async function setCooldown(ms) { const until = Date.now() + (ms || 20000); await chrome.storage.local.set({ openrouterCooldownUntil: until }); }

async function saveToHistory(originalText, summary, tab, options = {}) {
  try {
    const historyItem = { id: Date.now() + Math.random(), title: (options?.inferredTitle) || tab?.title || 'Página sem título', url: (options?.source === 'pdf') ? (tab?.url || 'arquivo-importado') : (tab?.url || 'URL desconhecida'), favicon: (tab?.favIconUrl && String(tab?.favIconUrl).trim()) ? tab.favIconUrl : null, isPdf: options?.source === 'pdf', source: options?.source || 'web', persona: options?.persona || '', originalText: originalText.substring(0, 500) + (originalText.length > 500 ? '...' : ''), summary: summary, timestamp: new Date().toISOString(), wordCount: originalText.split(' ').length };
    const result = await chrome.storage.local.get('summaryHistory'); const history = result.summaryHistory || []; history.unshift(historyItem); const limitedHistory = history.slice(0, 50); await chrome.storage.local.set({ summaryHistory: limitedHistory });
  } catch (error) { console.error('Erro ao salvar no histórico:', error); }
}
async function getHistory() { try { const r = await chrome.storage.local.get('summaryHistory'); return r.summaryHistory || []; } catch (e) { return []; } }
async function clearHistory() { try { await chrome.storage.local.remove('summaryHistory'); } catch (e) { throw e; } }