// Background script para coordenar a extensão
let isExtensionActive = true;
let summarySettings = {
  autoSummary: true,
  language: 'pt',
  detailLevel: 'medium',
  provider: 'gemini',
  openrouterKey: ''
};

// Carregar configurações ao iniciar e a cada inicialização do service worker
function loadSettingsFromStorage(callback) {
  chrome.storage.sync.get(['extensionActive', 'summarySettings'], (result) => {
    if (result && typeof result.extensionActive !== 'undefined') {
      isExtensionActive = result.extensionActive;
    }
    if (result && result.summarySettings) {
      summarySettings = { ...summarySettings, ...result.summarySettings };
    }
    if (typeof callback === 'function') callback({ isExtensionActive, summarySettings });
  });
}

// Inicializações
loadSettingsFromStorage();
chrome.runtime.onInstalled.addListener(() => {
  loadSettingsFromStorage();
});
chrome.runtime.onStartup?.addListener?.(() => {
  loadSettingsFromStorage();
});

// Escutar atalho de teclado
chrome.commands.onCommand.addListener((command) => {
  if (command === "generate_summary") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { 
          action: "generateSummary", 
          manual: true 
        });
      }
    });
  }
});

// Gerenciar mensagens entre scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getSettings") {
    loadSettingsFromStorage(() => {
      sendResponse({ 
        isActive: isExtensionActive,
        settings: summarySettings 
      });
    });
    return true;
  }
  
  if (message.action === "updateSettings") {
    if (typeof message.isActive === 'boolean') {
      isExtensionActive = message.isActive;
    }
    if (message.settings && typeof message.settings === 'object') {
      summarySettings = { ...summarySettings, ...message.settings };
    }
    chrome.storage.sync.set({
      extensionActive: isExtensionActive,
      summarySettings: summarySettings
    }, () => {
      sendResponse({ success: true, isActive: isExtensionActive, settings: summarySettings });
    });
    return true;
  }
  
  if (message.action === "generateSummary") {
    if (!message.text || message.text.length < 50) {
      sendResponse({ success: false, error: 'Conteúdo insuficiente para gerar resumo' });
      return true;
    }
    const fromPdf = message.source === 'pdf';
    const fileName = message.fileName || 'Documento PDF';

    const run = async () => {
      const provider = (summarySettings.provider || 'gemini').toLowerCase();
      let summary = '';
      if (provider === 'deepseek') {
        summary = await generateSummaryWithOpenRouter(message.text, summarySettings);
      } else {
        summary = await generateSummaryWithGemini(message.text, summarySettings);
      }

      if (fromPdf) {
        let inferredTitle = null;
        try {
          if (provider === 'deepseek') {
            inferredTitle = await generateTitleWithOpenRouter(message.text, summarySettings, fileName);
          } else {
            inferredTitle = await generateTitleWithGemini(message.text, summarySettings, fileName);
          }
        } catch (e) { inferredTitle = null; }
        await saveToHistory(message.text, summary, sender.tab, { inferredTitle: inferredTitle || fileName, source: 'pdf' });
        sendResponse({ success: true, summary, title: inferredTitle || fileName });
      } else {
        // Websites: manter título da aba intacto
        await saveToHistory(message.text, summary, sender.tab);
        sendResponse({ success: true, summary, title: sender?.tab?.title || 'Página' });
      }
    };

    run().catch(error => {
      const msg = (error && error.message) ? error.message : 'Falha ao acessar o serviço de IA';
      let display = msg;
      if (msg.includes('503') || /UNAVAILABLE/i.test(msg) || /Failed to fetch/i.test(msg)) {
        display = 'Serviço temporariamente indisponível. Tente novamente em alguns segundos.';
      }
      sendResponse({ success: false, error: display });
    });
    return true;
  }
  
  if (message.action === 'summarizePdfBinary') {
    // Mantido para compatibilidade (atual extração é feita no popup)
    (async () => {
      try {
        const arrayBuffer = message.data;
        const name = message.name || 'Documento PDF';
        if (!arrayBuffer) throw new Error('Arquivo não recebido');
        const text = 'Arquivo importado: ' + name + ' (extração é feita no popup).';
        const provider = (summarySettings.provider || 'gemini').toLowerCase();
        const summary = provider === 'deepseek'
          ? await generateSummaryWithOpenRouter(text, summarySettings)
          : await generateSummaryWithGemini(text, summarySettings);
        const tabInfo = sender?.tab || { title: name, url: 'arquivo-importado' };
        await saveToHistory(text, summary, tabInfo, { inferredTitle: name, source: 'pdf' });
        sendResponse({ success: true, summary });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  
  if (message.action === "getHistory") {
    getHistory().then(history => sendResponse({ history }));
    return true;
  }
  
  if (message.action === "clearHistory") {
    clearHistory().then(() => sendResponse({ success: true }));
    return true;
  }
});

// ===== Gemini =====
async function generateSummaryWithGemini(text, settings) {
  const API_KEY = 'AIzaSyCGqaKkd1NKGfo9aygrx92ecIjy8nqlk0c';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
  let detailPrompt = '';
  switch (settings.detailLevel) {
    case 'short': detailPrompt = 'Crie um resumo muito breve (máximo 3 pontos principais)'; break;
    case 'medium': detailPrompt = 'Crie um resumo conciso com os pontos principais (5-7 pontos)'; break;
    case 'long': detailPrompt = 'Crie um resumo detalhado e abrangente'; break;
  }
  const prompt = `${detailPrompt} do seguinte texto em ${settings.language === 'pt' ? 'português' : 'inglês'}.

Regras de formatação (siga exatamente):
1) Produza de 3 a 8 pontos principais como lista numerada (1., 2., 3., ...)
2) Em cada item, comece com um tópico curto (3–8 palavras), seguido de dois pontos e, em seguida, uma explicação breve em uma única frase
3) Quando for útil, adicione 1–3 subitens iniciados com "- " (hífen e espaço), cada um curto
4) Não use markdown com **asteriscos**, títulos ou blocos de código
5) Não envolva a resposta em blocos de código; retorne apenas texto simples estruturado

Texto a resumir:
${text.substring(0, 50000)}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 1024 }
  });

  const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (!resp.ok) {
    const t = await resp.text();
    const err = new Error(`Erro na API: ${resp.status} - ${t}`);
    err.status = resp.status; throw err;
  }
  const data = await resp.json();
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) throw new Error('Resposta inválida da API');
  return out;
}

async function generateTitleWithGemini(text, settings, fallbackName) {
  const API_KEY = 'AIzaSyCGqaKkd1NKGfo9aygrx92ecIjy8nqlk0c';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
  const prompt = `Gere um título curto e descritivo (no máximo 10 palavras) para o seguinte conteúdo de arquivo PDF. Não use aspas, não use markdown. Caso seja um documento de empresa, inclua o nome/identificador.\n\nConteúdo (parcial):\n${text.substring(0, 2000)}`;
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
  const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (!resp.ok) return fallbackName;
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || fallbackName;
}

// ===== OpenRouter / DeepSeek =====
async function generateSummaryWithOpenRouter(text, settings) {
  const apiKey = settings.openrouterKey || '';
  if (!apiKey || !apiKey.startsWith('sk-')) {
    throw new Error('OpenRouter API Key ausente. Configure no popup.');
  }
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  let detailPrompt = '';
  switch (settings.detailLevel) {
    case 'short': detailPrompt = 'Crie um resumo muito breve (máximo 3 pontos principais)'; break;
    case 'medium': detailPrompt = 'Crie um resumo conciso com os pontos principais (5-7 pontos)'; break;
    case 'long': detailPrompt = 'Crie um resumo detalhado e abrangente'; break;
  }
  const userText = `${detailPrompt} do seguinte texto em ${settings.language === 'pt' ? 'português' : 'inglês'}.\n\nRegras de formatação (siga exatamente):\n1) Produza de 3 a 8 pontos principais como lista numerada (1., 2., 3., ...)\n2) Em cada item, comece com um tópico curto (3–8 palavras), seguido de dois pontos e, em seguida, uma explicação breve em uma única frase\n3) Quando for útil, adicione 1–3 subitens iniciados com "- " (hífen e espaço), cada um curto\n4) Não use markdown com **asteriscos**, títulos ou blocos de código\n5) Não envolva a resposta em blocos de código; retorne apenas texto simples estruturado\n\nTexto a resumir:\n${text.substring(0, 50000)}`;

  const payload = {
    model: 'deepseek/deepseek-r1-0528:free',
    messages: [
      { role: 'system', content: 'Você é um assistente de resumo que retorna lista numerada com tópicos curtos e subitens quando necessário.' },
      { role: 'user', content: userText }
    ],
    temperature: 0.7,
    max_tokens: 1024
  };

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': chrome.runtime.getURL(''),
    'X-Title': 'Auto-Summarizer DeepSeek'
  };

  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!resp.ok) {
    let detail = await resp.text();
    throw new Error(`OpenRouter API error: ${resp.status} - ${detail}`);
  }
  const data = await resp.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error('Resposta inválida da OpenRouter');
  return out;
}

async function generateTitleWithOpenRouter(text, settings, fallbackName) {
  const apiKey = settings.openrouterKey || '';
  if (!apiKey || !apiKey.startsWith('sk-')) return fallbackName;
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const prompt = `Gere um título curto e descritivo (no máximo 10 palavras) para o seguinte conteúdo de arquivo PDF. Não use aspas, não use markdown. Caso seja um documento de empresa, inclua o nome/identificador.\n\nConteúdo (parcial):\n${text.substring(0, 2000)}`;
  const payload = {
    model: 'deepseek/deepseek-r1-0528:free',
    messages: [ { role: 'user', content: prompt } ],
    temperature: 0.2,
    max_tokens: 64
  };
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': chrome.runtime.getURL(''),
    'X-Title': 'Auto-Summarizer DeepSeek'
  };
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!resp.ok) return fallbackName;
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() || fallbackName;
}

// Histórico
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
  } catch (error) {
    console.error('Erro ao salvar no histórico:', error);
  }
}

async function getHistory() {
  try {
    const result = await chrome.storage.local.get('summaryHistory');
    return result.summaryHistory || [];
  } catch (error) {
    console.error('Erro ao obter histórico:', error);
    return [];
  }
}

async function clearHistory() {
  try {
    await chrome.storage.local.remove('summaryHistory');
  } catch (error) {
    console.error('Erro ao limpar histórico:', error);
    throw error;
  }
}