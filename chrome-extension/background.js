// Background script (OpenRouter only) com cache, cooldown e fallback
let isExtensionActive = true;
let summarySettings = {
  autoSummary: true,
  language: 'pt',
  detailLevel: 'medium',
  openrouterKey: ''
};

const DEFAULT_OR_API_KEY = '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';
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PRIMARY_MODEL = 'deepseek/deepseek-r1-0528:free';
const FALLBACK_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
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
        // Cooldown global
        const cooldown = await getCooldown();
        if (cooldown > Date.now()) {
          const secs = Math.ceil((cooldown - Date.now()) / 1000);
          sendResponse({ success: false, error: `Serviço temporariamente indisponível. Aguarde ${secs}s.` });
          return;
        }
        // Cache
        const key = contentHash(message.text);
        const cached = await getFromCache(key);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
          if (fromPdf) {
            await saveToHistory(message.text, cached.summary, sender.tab, { inferredTitle: cached.title || fileName, source: 'pdf' });
            sendResponse({ success: true, summary: cached.summary, title: cached.title || fileName });
          } else {
            await saveToHistory(message.text, cached.summary, sender.tab);
            sendResponse({ success: true, summary: cached.summary, title: sender?.tab?.title || 'Página' });
          }
          return;
        }

        let title = null;
        let summary = null;
        if (fromPdf) {
          // Uma única chamada retornando TÍTULO + RESUMO
          const combined = await generatePdfTitleAndSummaryWithOR(message.text);
          title = combined.title || fileName;
          summary = combined.summary;
        } else {
          summary = await generateSummaryWithOR(message.text);
        }

        // Salvar cache
        await saveToCache(key, { title: title || null, summary, timestamp: Date.now(), source: fromPdf ? 'pdf' : 'web' });

        if (fromPdf) {
          await saveToHistory(message.text, summary, sender.tab, { inferredTitle: title || fileName, source: 'pdf' });
          sendResponse({ success: true, summary, title: title || fileName });
        } else {
          await saveToHistory(message.text, summary, sender.tab);
          sendResponse({ success: true, summary, title: sender?.tab?.title || 'Página' });
        }
      } catch (error) {
        const msg = (error && error.message) ? error.message : 'Falha ao acessar o serviço de IA';
        if (/429/.test(msg)) await setCooldown(20000); // 20s
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

// ================= OpenRouter helpers =================
async function orRequest(messages, model) {
  const headers = {
    'Authorization': `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': chrome.runtime.getURL(''),
    'X-Title': 'Auto-Summarizer DeepSeek'
  };
  const body = JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 1024 });
  const resp = await fetch(OR_URL, { method: 'POST', headers, body });
  if (!resp.ok) {
    const detail = await resp.text();
    const err = new Error(`OpenRouter API error: ${resp.status} - ${detail}`);
    err.status = resp.status; throw err;
  }
  const data = await resp.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error('Resposta inválida da OpenRouter');
  return out;
}

async function orWithFallback(messages) {
  try {
    return await orRequest(messages, PRIMARY_MODEL);
  } catch (e) {
    if (e.status === 429 || e.status === 503) {
      // cooldown rápido
      await setCooldown(20000);
      return await orRequest(messages, FALLBACK_MODEL);
    }
    throw e;
  }
}

function buildSummaryInstructions(text) {
  let detailPrompt = '';
  switch (summarySettings.detailLevel) {
    case 'short': detailPrompt = 'Crie um resumo muito breve (máximo 3 pontos principais)'; break;
    case 'medium': detailPrompt = 'Crie um resumo conciso com os pontos principais (5-7 pontos)'; break;
    case 'long': detailPrompt = 'Crie um resumo detalhado e abrangente'; break;
  }
  return `${detailPrompt} do seguinte texto em ${summarySettings.language === 'pt' ? 'português' : 'inglês'}.

Regras de formatação (siga exatamente):
1) Produza de 3 a 8 pontos principais como lista numerada (1., 2., 3., ...)
2) Em cada item, comece com um tópico curto (3–8 palavras), seguido de dois pontos e, em seguida, uma explicação breve em uma única frase
3) Quando for útil, adicione 1–3 subitens iniciados com "- " (hífen e espaço), cada um curto
4) Não use markdown com **asteriscos**, títulos ou blocos de código
5) Não envolva a resposta em blocos de código; retorne apenas texto simples estruturado

Texto a resumir:
${text.substring(0, 50000)}`;
}

async function generateSummaryWithOR(text) {
  const messages = [
    { role: 'system', content: 'Você é um assistente de resumo que retorna lista numerada com tópicos curtos e subitens quando necessário.' },
    { role: 'user', content: buildSummaryInstructions(text) }
  ];
  return await orWithFallback(messages);
}

async function generatePdfTitleAndSummaryWithOR(text) {
  const prompt = `Você receberá o conteúdo textual de um arquivo PDF. Gere:
- TITLE: um título curto (no máximo 10 palavras), sem aspas/markdown
- SUMMARY: um resumo estruturado conforme regras abaixo

Regras do SUMMARY (siga exatamente):
1) 3 a 8 itens numerados (1., 2., ...)
2) Cada item: um tópico curto (3–8 palavras) seguido de dois pontos e uma frase breve
3) Subitens opcionais iniciados com "- " (1–3)

Responda estritamente neste formato:
TITLE: <título curto>
SUMMARY:
1. <tópico curto>: <frase>
- <subitem opcional>
2. ...

Conteúdo (parcial):
${text.substring(0, 50000)}`;
  const messages = [ { role: 'user', content: prompt } ];
  const out = await orWithFallback(messages);
  // Parse
  let title = null, summary = null;
  const lines = out.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.toUpperCase().startsWith('TITLE:')) {
      title = l.substring(6).trim();
      // SUMMARY starts after we encounter 'SUMMARY:'
    }
    if (l.toUpperCase().startsWith('SUMMARY:')) {
      summary = lines.slice(i + 1).join('\n').trim();
      break;
    }
  }
  return { title, summary: summary || out };
}

// ================= Cache & Cooldown =================
function contentHash(str) {
  // djb2 simple hash
  let h = 5381; for (let i = 0; i < str.length; i++) { h = ((h << 5) + h) + str.charCodeAt(i); h |= 0; }
  return `h${h}`;
}

async function getFromCache(key) {
  const res = await chrome.storage.local.get('summaryCache');
  const cache = res.summaryCache || {};
  return cache[key] || null;
}

async function saveToCache(key, value) {
  const res = await chrome.storage.local.get('summaryCache');
  const cache = res.summaryCache || {};
  cache[key] = value;
  // manter no máximo 100 entradas
  const keys = Object.keys(cache);
  if (keys.length > 100) {
    // remove mais antigo
    let oldestKey = null, oldestTs = Infinity;
    for (const k of keys) { const ts = cache[k]?.timestamp || 0; if (ts < oldestTs) { oldestTs = ts; oldestKey = k; } }
    if (oldestKey) delete cache[oldestKey];
  }
  await chrome.storage.local.set({ summaryCache: cache });
}

async function getCooldown() {
  const res = await chrome.storage.local.get('openrouterCooldownUntil');
  return res.openrouterCooldownUntil || 0;
}

async function setCooldown(ms) {
  const until = Date.now() + (ms || 20000);
  await chrome.storage.local.set({ openrouterCooldownUntil: until });
}

// ================= Histórico =================
async function saveToHistory(originalText, summary, tab, options = {}) {
  try {
    const historyItem = {
      id: Date.now() + Math.random(),
      title: (options?.inferredTitle) || tab?.title || 'Página sem título',
      url: (options?.source === 'pdf') ? (tab?.url || 'arquivo-importado') : (tab?.url || 'URL desconhecida'),
      favicon: tab?.favIconUrl || null,
      originalText: originalText.substring(0, 500) + (originalText.length > 500 ? '...' : ''),
      summary: summary,
      timestamp: new Date().toISOString(),
      wordCount: originalText.split(' ').length
    };
    const result = await chrome.storage.local.get('summaryHistory');
    const history = result.summaryHistory || [];
    history.unshift(historyItem);
    const limitedHistory = history.slice(0, 50);
    await chrome.storage.local.set({ summaryHistory: limitedHistory });
  } catch (error) { console.error('Erro ao salvar no histórico:', error); }
}

async function getHistory() { try { const r = await chrome.storage.local.get('summaryHistory'); return r.summaryHistory || []; } catch (e) { return []; } }
async function clearHistory() { try { await chrome.storage.local.remove('summaryHistory'); } catch (e) { throw e; } }