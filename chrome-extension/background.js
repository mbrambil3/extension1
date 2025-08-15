// Background script (OpenRouter only) com cache, cooldown e múltiplos fallbacks
let isExtensionActive = true;
let summarySettings = {
  autoSummary: true,
  language: 'pt',
  detailLevel: 'medium',
  persona: 'assertivo',
  openrouterKey: ''
};

// DeepSeek fallback (direto, sem OpenRouter)
const DEEPSEEK_API_KEY = 'sk-69684eabfdb14af991e944c2472ad0b8';
const DS_URL = 'https://api.deepseek.com/chat/completions';

// Controlador para permitir cancelar a geração em andamento
let currentAbortController = null;

const DEFAULT_OR_API_KEY = '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';
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
]; // fallback é automático e ocorre em caso de 429/503, com cooldown progressivo
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function getApiKey() {
  const user = (summarySettings.openrouterKey || '').trim();
  return user || DEFAULT_OR_API_KEY;
}

function loadSettingsFromStorage(callback) {
  chrome.storage.sync.get(['extensionActive', 'summarySettings'], (result) => {
    if (result && typeof result.extensionActive !== 'undefined') isExtensionActive = result.extensionActive;
    if (result && result.summarySettings) summarySettings = { ...summarySettings, ...result.summarySettings };
    if (typeof callback === 'function') callback({ isExtensionActive, summarySettings });
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  if (message.action === 'generateSummary') {
    if (!message.text || message.text.length < 50) { sendResponse({ success: false, error: 'Conteúdo insuficiente para gerar resumo' }); return true; }
    const fromPdf = message.source === 'pdf';
    const fileName = message.fileName || 'Documento PDF';

    (async () => {
      try {
        const cooldown = await getCooldown();
        if (cooldown > Date.now()) { const secs = Math.ceil((cooldown - Date.now()) / 1000); sendResponse({ success: false, error: `Serviço temporariamente indisponível. Aguarde ${secs}s.` }); return; }
        const key = contentHash(message.text);
        const cached = await getFromCache(key);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
          await chrome.storage.local.set({ lastModelUsed: cached.model || 'cache' });
          if (fromPdf) { await saveToHistory(message.text, cached.summary, sender.tab, { inferredTitle: cached.title || fileName, source: 'pdf' }); sendResponse({ success: true, summary: cached.summary, title: cached.title || fileName, modelUsed: cached.model || 'cache' }); }
          else { await saveToHistory(message.text, cached.summary, sender.tab); sendResponse({ success: true, summary: cached.summary, title: sender?.tab?.title || 'Página', modelUsed: cached.model || 'cache' }); }
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

        if (fromPdf) { await saveToHistory(message.text, summary, sender.tab, { inferredTitle: title || fileName, source: 'pdf' }); sendResponse({ success: true, summary, title: title || fileName, modelUsed }); }
        else { await saveToHistory(message.text, summary, sender.tab); sendResponse({ success: true, summary, title: sender?.tab?.title || 'Página', modelUsed }); }
      } catch (error) {
        const msg = (error && error.message) ? error.message : 'Falha ao acessar o serviço de IA';
        const status = (error && error.status) ? String(error.status) : (msg.match(/\b(\d{3})\b/) || [])[1];
        // Tratamento dedicado para credenciais inválidas
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

async function orRequest(messages, model) {
  // Sempre buscar a chave mais recente antes de requisitar (caso usuário tenha acabado de salvar no popup)
  await new Promise((resolve) => chrome.storage.sync.get(['summarySettings'], (r) => { if (r && r.summarySettings) summarySettings = { ...summarySettings, ...r.summarySettings }; resolve(); }));
  const headers = { 'Authorization': `Bearer ${getApiKey()}`, 'Content-Type': 'application/json', 'HTTP-Referer': chrome.runtime.getURL(''), 'X-Title': 'Auto-Summarizer OR' };
  const body = JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 1024 });
  const resp = await fetch(OR_URL, { method: 'POST', headers, body });
  if (!resp.ok) { const detail = await resp.text(); const err = new Error(`OpenRouter API error: ${resp.status} - ${detail}`); err.status = resp.status; throw err; }
  const data = await resp.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error('Resposta inválida da OpenRouter');
  return { text: out, model };
}

async function deepseekRequest(messages) {
  const headers = { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.7, max_tokens: 1024 });
  const resp = await fetch(DS_URL, { method: 'POST', headers, body });
  if (!resp.ok) { const detail = await resp.text(); const err = new Error(`DeepSeek API error: ${resp.status} - ${detail}`); err.status = resp.status; throw err; }
  const data = await resp.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error('Resposta inválida do DeepSeek');
  return { text: out, model: 'deepseek-chat' };
}

async function orWithFallback(messages) {
  currentAbortController = new AbortController();
  const shouldFallback = (err) => {
    if (!err) return true;
    const s = err.status;
    const msg = String(err.message || '').toLowerCase();
    if (s === 429 || s === 503) return true; // limite/indisponível
    if (typeof s === 'number' && s >= 500) return true; // outros 5xx
    if (!s) return true; // erros de rede/fetch
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
    // Tentar DeepSeek como último recurso (inclui casos 401 também)
    try {
      return await deepseekRequest(messages);
    } catch (dsErr) {
      throw dsErr;
    }
  }
}

function buildSummaryInstructions(text) {
  let detailPrompt = '';
  switch (summarySettings.detailLevel) {
    case 'short': detailPrompt = 'Crie um resumo muito breve (máximo 3 pontos principais)'; break;
    case 'medium': detailPrompt = 'Crie um resumo conciso com os pontos principais (5-7 pontos)'; break;
    case 'long': detailPrompt = 'Crie um resumo detalhado e abrangente'; break;
  }
  const persona = (summarySettings.persona || 'assertivo').trim();
  return `${detailPrompt} do seguinte texto em ${summarySettings.language === 'pt' ? 'português' : 'inglês'}, com tom ${persona}.

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
  const messages = [ { role: 'system', content: 'Você é um assistente de resumo que retorna lista numerada com tópicos curtos e subitens quando necessário.' }, { role: 'user', content: buildSummaryInstructions(text) } ];
  return await orWithFallback(messages);
}

async function generatePdfTitleAndSummaryOR(text) {
  const prompt = `Você receberá o conteúdo textual de um arquivo PDF. Gere:\n- TITLE: um título curto (no máximo 10 palavras), sem aspas/markdown\n- SUMMARY: um resumo estruturado conforme regras abaixo\n\nRegras do SUMMARY (siga exatamente):\n1) 3 a 8 itens numerados (1., 2., ...)\n2) Cada item: um tópico curto (3–8 palavras) seguido de dois pontos e uma frase breve\n3) Subitens opcionais iniciados com \"- \" (1–3)\n\nResponda estritamente neste formato:\nTITLE: <título curto>\nSUMMARY:\n1. <tópico curto>: <frase>\n- <subitem opcional>\n2. ...\n\nConteúdo (parcial):\n${text.substring(0, 50000)}`;
  const messages = [ { role: 'user', content: prompt } ];
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
    const historyItem = { id: Date.now() + Math.random(), title: (options?.inferredTitle) || tab?.title || 'Página sem título', url: (options?.source === 'pdf') ? (tab?.url || 'arquivo-importado') : (tab?.url || 'URL desconhecida'), favicon: (tab?.favIconUrl && String(tab.favIconUrl).trim()) ? tab.favIconUrl : null, isPdf: options?.source === 'pdf', source: options?.source || 'web', originalText: originalText.substring(0, 500) + (originalText.length > 500 ? '...' : ''), summary: summary, timestamp: new Date().toISOString(), wordCount: originalText.split(' ').length };
    const result = await chrome.storage.local.get('summaryHistory'); const history = result.summaryHistory || []; history.unshift(historyItem); const limitedHistory = history.slice(0, 50); await chrome.storage.local.set({ summaryHistory: limitedHistory });
  } catch (error) { console.error('Erro ao salvar no histórico:', error); }
}
async function getHistory() { try { const r = await chrome.storage.local.get('summaryHistory'); return r.summaryHistory || []; } catch (e) { return []; } }
async function clearHistory() { try { await chrome.storage.local.remove('summaryHistory'); } catch (e) { throw e; } }