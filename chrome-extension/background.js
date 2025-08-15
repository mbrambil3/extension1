// Background script (OpenRouter only) com cache, cooldown e múltiplos fallbacks + Plano Free/Premium
let isExtensionActive = true;
let summarySettings = {
  autoSummary: true,
  language: 'pt',
  detailLevel: 'medium',
  persona: '',
  openrouterKey: '',
  deepseekKey: ''
};

// Plano/Quota
const DAILY_LIMIT = 30; // free
// Mantém a MASTER KEY atual até você nos enviar a nova. Podemos trocar depois rapidamente.
// MASTER KEY ofuscada (reconstruída em runtime). Técnica simples (XOR) para desestimular inspeção.
const _mk_x = [
  77 ^ 7, 65 ^ 7, 83 ^ 7, 84 ^ 7, 69 ^ 7, 82 ^ 7, 45 ^ 7, 54 ^ 7, 80 ^ 7,
  115 ^ 7, 117 ^ 7, 50 ^ 7, 53 ^ 7, 48 ^ 7, 50 ^ 7, 99 ^ 7, 88 ^ 7, 69 ^ 7, 68 ^ 7
];
const MASTER_KEY = String.fromCharCode(..._mk_x.map(n => n ^ 7));

// Controlador para permitir cancelar a geração em andamento
let currentAbortController = null;
let lastRequestTabId = null;

const DEFAULT_OR_API_KEY = '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'; // chave fornecida pelo usuário
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PRIMARY_MODEL = 'deepseek/deepseek-r1-0528:free';
const FALLBACK_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'qwen/qwen3-coder:free',
  'deepseek/deepseek-r1:free',
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

function getDeepseekApiKey() {
  // Primeiro, do settings; se vazio, tenta storage local (retrocompatibilidade)
  const user = (summarySettings.deepseekKey || '').trim();
  return user;
}

function loadSettingsFromStorage(callback) {
  chrome.storage.sync.get(['extensionActive', 'summarySettings'], (result) => {
    if (result && typeof result.extensionActive !== 'undefined') isExtensionActive = result.extensionActive;
    if (result && result.summarySettings) summarySettings = { ...summarySettings, ...result.summarySettings };
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
// Objetivo: sobreviver à desinstalação/reinstalação utilizando:
// 1) chrome.storage.sync (sincroniza na conta Google do usuário)
// 2) chrome.bookmarks como shadow store (dados em um bookmark "silencioso")
// Nenhum custo, nenhum domínio.

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
    // 1) Tenta sync
    const syncRes = await prom((cb) => chrome.storage.sync.get('as_device_state', cb));
    let st = syncRes?.as_device_state || null;

    // 2) Se não tiver, tenta bookmarks
    if (!st) {
      st = await this.loadFromBookmarks();
    }

    // 3) Importa legado do local (somente contagem) para primeira vez (NÃO importa premium antigo)
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

    // 4) Se ainda não houver, cria novo
    if (!st) {
      const deviceId = await sha256Hex(buildFingerprintString());
      st = { deviceId, premium: { until: null, unlimited: false, keyMasked: null }, dailyUsage: { date: todayStr(), count: 0 } };
    }

    // Reset diário
    const t = todayStr();
    if (st.dailyUsage?.date !== t) st.dailyUsage = { date: t, count: 0 };

    // Migração v1.0.5: invalidar qualquer premium antigo que não seja ilimitado (bloqueia chaves aleatórias do passado)
    try {
      const migRes = await prom((cb) => chrome.storage.sync.get('as_mig_v105_no_trial', cb));
      const migrated = !!(migRes && migRes.as_mig_v105_no_trial);
      if (!migrated) {
        if (st.premium && st.premium.unlimited !== true) {
          st.premium = { until: null, unlimited: false, keyMasked: null };
        }
        await prom((cb) => chrome.storage.sync.set({ as_mig_v105_no_trial: true }, cb));
      }
    } catch (e) {}

    this.state = st;
    await this.persist();
  }

  async persist() {
    if (!this.state) return;
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
    if (p.until) {
      try { return new Date(p.until).getTime() > Date.now(); } catch { return false; }
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
    const norm = key.toUpperCase();
    if (norm === MASTER_KEY.toUpperCase()) {
      this.state.premium = { unlimited: true, until: null, keyMasked: this.maskKey(key) };
      await this.persist();
      return { ok: true, plan: 'premium_unlimited', premiumUntil: null };
    }
    // NO MORE trial/30 days for random keys. Anything else is invalid.
    return { ok: false, error: 'KEY inválida' };
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
        // Fallback: procurar por URL e pegar a mais recente
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
    // Procura pasta existente
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
    // Cria pasta no nível da barra
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
        // Atualiza o primeiro
        await prom((cb) => chrome.bookmarks.update(existing[0].id, { title, url }, cb));
      } else {
        await prom((cb) => chrome.bookmarks.create({ parentId: folderId, title, url }, cb));
      }
    } catch (e) {
      // Ignore silenciosamente
    }
  }
}

const deviceStateManager = new DeviceStateManager();

// ============ Mensageria ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'stopGeneration') {
    try { currentAbortController?.abort?.(); } catch (e) {}
    sendResponse({ success: true, stopped: true });
    return true;
  }
  if (message.action === 'getSettings') {
    loadSettingsFromStorage(() => sendResponse({ isActive: isExtensionActive, settings: summarySettings }));
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
        premiumUntil: premium.until || null,
        countToday: dailyUsage.count || 0,
        limit: DAILY_LIMIT
      });
    })();
    return true;
  }
  if (message.action === 'applySubscriptionKey') {
    (async () => {
      const res = await deviceStateManager.applyKey(message.key || '');
      if (!res.ok) { sendResponse({ success: false, error: res.error || 'Falha' }); return; }
      sendResponse({ success: true, plan: res.plan, premiumUntil: res.premiumUntil });
    })();
    return true;
  }

  if (message.action === 'generateSummary') {
    // Enforce quota antes de qualquer coisa
    (async () => {
      const quotaCheck = await deviceStateManager.enforceQuotaOrFail();
      if (!quotaCheck.ok) { sendResponse({ success: false, error: quotaCheck.error }); return; }

      if (!message.text || message.text.length < 50) { sendResponse({ success: false, error: 'Conteúdo insuficiente para gerar resumo' }); return; }
      const fromPdf = message.source === 'pdf';
      const fileName = message.fileName || 'Documento PDF';

      try {
        const cooldown = await getCooldown();
        if (cooldown > Date.now()) { const secs = Math.ceil((cooldown - Date.now()) / 1000); sendResponse({ success: false, error: `Serviço temporariamente indisponível. Aguarde ${secs}s.` }); return; }
        const personaKey = (summarySettings.persona || '').trim();
        const settingsKey = JSON.stringify({ persona: personaKey, language: summarySettings.language, detail: summarySettings.detailLevel });
        const key = contentHash(settingsKey + '|' + message.text);
        const cached = await getFromCache(key);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
          await chrome.storage.local.set({ lastModelUsed: cached.model || 'cache' });
          // Contabiliza uso
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
        // Contabiliza uso
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
      }
    })();
    return true;
  }

  if (message.action === 'getHistory') { getHistory().then(h => sendResponse({ history: h })); return true; }
  if (message.action === 'clearHistory') { clearHistory().then(() => sendResponse({ success: true })); return true; }
});

// =====================
// OpenRouter helpers
// =====================
async function orRequest(messages, model) {
  await new Promise((resolve) => chrome.storage.sync.get(['summarySettings'], (r) => { if (r && r.summarySettings) summarySettings = { ...summarySettings, ...r.summarySettings }; resolve(); }));
  const headers = { 'Authorization': `Bearer ${getApiKey()}`, 'Content-Type': 'application/json', 'HTTP-Referer': chrome.runtime.getURL(''), 'X-Title': 'Auto-Summarizer OR' };
  const body = JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 1024 });
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
    throw new Error('Serviço temporariamente indisponível após múltiplas tentativas. Tente novamente em instantes.');
  }
}

function buildSummaryInstructions(text) {
  let detailPrompt = '';
  switch (summarySettings.detailLevel) {
    case 'short': detailPrompt = 'Crie um resumo muito breve (máximo 3 pontos principais)'; break;
    case 'medium': detailPrompt = 'Crie um resumo conciso com os pontos principais (5-7 pontos)'; break;
    case 'long': detailPrompt = 'Crie um resumo detalhado e abrangente'; break;
  }
  const persona = (summarySettings.persona || '').trim();
  const styleLine = persona ? `Adote exatamente o seguinte estilo/persona ao responder (sem quebrar as regras de formatação): ${persona}.` : '';
  return `${detailPrompt} do seguinte texto em ${summarySettings.language === 'pt' ? 'português' : 'inglês'}.${styleLine ? `\n${styleLine}` : ''}

Regras de formatação (siga exatamente):
1) Produza de 3 a 8 pontos principais como lista numerada (1., 2., 3., ...)
2) Em cada item, comece com um tópico curto (3–8 palavras), seguido de dois pontos e, em seguida, uma explicação breve em uma única frase
3) Quando for útil, adicione 1–3 subitens iniciados com "- " (hífen e espaço), cada um curto
4) Não use markdown com **asteriscos**, títulos ou blocos de código
5) Não envolva a resposta em blocos de código; retorne apenas texto simples estruturado

Texto a resumir:
${text.substring(0, 50000)}`;
}

async function generateSummaryOR(text) {
  const persona = (summarySettings.persona || '').trim();
  const sys = persona
    ? `Você é um assistente de resumo. Mantenha exatamente o estilo/persona a seguir durante toda a resposta: ${persona}. Siga as regras de formatação.`
    : 'Você é um assistente de resumo que retorna lista numerada com tópicos curtos e subitens quando necessário.';
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: buildSummaryInstructions(text) }
  ];
  return await orWithFallback(messages);
}

async function generatePdfTitleAndSummaryOR(text) {
  const persona = (summarySettings.persona || '').trim();
  const styleLine = persona ? `\nInstrua-se a escrever exatamente no seguinte estilo/persona (sem quebrar as regras de formatação): ${persona}.` : '';
  const sys = persona
    ? `Você é um assistente de resumo. Mantenha exatamente o estilo/persona a seguir durante toda a resposta: ${persona}. Siga as regras de formatação.`
    : 'Você é um assistente de resumo que retorna lista numerada com tópicos curtos e subitens quando necessário.';
  const prompt = `Você receberá o conteúdo textual de um arquivo PDF. Gere:\n- TITLE: um título curto (no máximo 10 palavras), sem aspas/markdown\n- SUMMARY: um resumo estruturado conforme regras abaixo${styleLine}\n\nRegras do SUMMARY (siga exatamente):\n1) 3 a 8 itens numerados (1., 2., ...)\n2) Cada item: um tópico curto (3–8 palavras) seguido de dois pontos e uma frase breve\n3) Subitens opcionais iniciados com "- " (1–3)\n\nResponda estritamente neste formato:\nTITLE: <título curto>\nSUMMARY:\n1. <tópico curto>: <frase>\n- <subitem opcional>\n2. ...\n\nConteúdo (parcial):\n${text.substring(0, 50000)}`;
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

function contentHash(str) { let h = 5381; for (let i = 0; i < str.length; i++) { h = ((h << 5) + h) + str.charCodeAt(i); h |= 0; } return `h${h}`; }
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