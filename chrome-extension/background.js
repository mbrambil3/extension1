// Background script para coordenar a extensão
let isExtensionActive = true;
let summarySettings = {
  autoSummary: true,
  language: 'pt',
  detailLevel: 'medium'
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
    // Sempre retorne o estado real carregado do storage
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
      // Garantir consistência ao responder
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
    generateSummaryWithGemini(message.text, summarySettings)
      .then(async summary => {
        // Gerar um título com IA apenas para PDFs importados
        let inferredTitle = null;
        if (fromPdf) {
          try {
            inferredTitle = await generateTitleWithGemini(message.text, summarySettings, fileName);
          } catch (e) {
            inferredTitle = null;
          }
        }
        // Salvar no histórico
        await saveToHistory(message.text, summary, sender.tab, { inferredTitle: inferredTitle || fileName, source: fromPdf ? 'pdf' : 'web' });
        sendResponse({ success: true, summary, title: inferredTitle || fileName });
      })
      .catch(error => {
        // Trate erros de rede (Failed to fetch) e 503 com mensagem amigável
        const msg = (error && error.message) ? error.message : 'Falha ao acessar o serviço de IA';
        let display = msg;
        if (msg.includes('503') || /UNAVAILABLE/i.test(msg) || /Failed to fetch/i.test(msg)) {
          display = 'Serviço temporariamente indisponível. Tente novamente em alguns segundos.';
        }
        sendResponse({ success: false, error: display });
      });
    return true; // Mantém o canal de resposta aberto para async
  }

  if (message.action === 'summarizePdfBinary') {
    // Mantido para compatibilidade; hoje a extração ocorre no popup
    (async () => {
      try {
        const arrayBuffer = message.data;
        const name = message.name || 'Documento PDF';
        if (!arrayBuffer) throw new Error('Arquivo não recebido');
        const text = 'Arquivo importado: ' + name + ' (extração é feita no popup).';
        const summary = await generateSummaryWithGemini(text, summarySettings);
        const tabInfo = sender?.tab || { title: name, url: 'arquivo-importado' };
        await saveToHistory(text, summary, tabInfo);
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

// Função para gerar resumo usando Gemini API (com retry/backoff para 429/503)
async function generateSummaryWithGemini(text, settings) {
  const API_KEY = 'AIzaSyCGqaKkd1NKGfo9aygrx92ecIjy8nqlk0c';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
  
  // Configurar prompt baseado nas configurações
  let detailPrompt = '';
  switch (settings.detailLevel) {
    case 'short':
      detailPrompt = 'Crie um resumo muito breve (máximo 3 pontos principais)';
      break;
    case 'medium':
      detailPrompt = 'Crie um resumo conciso com os pontos principais (5-7 pontos)';
      break;
    case 'long':
      detailPrompt = 'Crie um resumo detalhado e abrangente';
      break;
  }
  
  const prompt = `${detailPrompt} do seguinte texto em ${settings.language === 'pt' ? 'português' : 'inglês'}.

Regras de formatação (siga exatamente):
1) Produza de 3 a 8 pontos principais como lista numerada (1., 2., 3., ...)
2) Em cada item, comece com um tópico curto (3–8 palavras), seguido de dois pontos e, em seguida, uma explicação breve em uma única frase
3) Quando for útil, adicione 1–3 subitens iniciados com "- " (hífen e espaço), cada um curto
4) Não use markdown com **asteriscos**, títulos ou blocos de código
5) Não envolva a resposta em blocos de código; retorne apenas texto simples estruturado

Texto a resumir:
${text.substring(0, 50000)}`; // Limitar texto para evitar exceder limites da API

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 1024,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
    ]
  });

  async function tryOnce() {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (!resp.ok) {
      const text = await resp.text();
      const err = new Error(`Erro na API: ${resp.status} - ${text}`);
      err.status = resp.status;
      throw err;
    }
    const data = await resp.json();
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      return data.candidates[0].content.parts[0].text;
    }
    throw new Error('Resposta inválida da API');
  }

  const maxAttempts = 3;
  let attempt = 0;
  while (true) {
    try {
      return await tryOnce();
    } catch (e) {
      attempt++;
      if (attempt >= maxAttempts || ![429, 500, 502, 503, 504].includes(e.status)) {
        throw e;
      }
      const delay = Math.min(4000, 500 * Math.pow(2, attempt - 1));
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Função para salvar resumo no histórico
async function saveToHistory(originalText, summary, tab, options = {}) {
  try {
    const historyItem = {
      id: Date.now() + Math.random(),
      title: tab?.title || 'Página sem título',
      url: tab?.url || 'URL desconhecida',
      favicon: tab?.favIconUrl || null,
      originalText: originalText.substring(0, 500) + (originalText.length > 500 ? '...' : ''),
      summary: summary,
      timestamp: new Date().toISOString(),
      wordCount: originalText.split(' ').length
    };
    
    const result = await chrome.storage.local.get('summaryHistory');
    const history = result.summaryHistory || [];
    
    // Adicionar no início da lista e manter apenas últimos 50
    history.unshift(historyItem);
    const limitedHistory = history.slice(0, 50);
    
    await chrome.storage.local.set({ summaryHistory: limitedHistory });
    console.log('Resumo salvo no histórico:', historyItem.title);
    
  } catch (error) {
    console.error('Erro ao salvar no histórico:', error);
  }
}

// Função para obter histórico
async function getHistory() {
  try {
    const result = await chrome.storage.local.get('summaryHistory');
    return result.summaryHistory || [];
  } catch (error) {
    console.error('Erro ao obter histórico:', error);
    return [];
  }
}

// Função para limpar histórico
async function clearHistory() {
  try {
    await chrome.storage.local.remove('summaryHistory');
    console.log('Histórico limpo com sucesso');
  } catch (error) {
    console.error('Erro ao limpar histórico:', error);
    throw error;
  }
}