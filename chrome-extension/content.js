// Content script para detectar e extrair conteúdo
let sidePanelVisible = false;
let extractedText = '';
let isExtensionReady = false;

// Aguardar que a página carregue completamente
window.addEventListener('load', () => {
  setTimeout(initializeExtension, 2000);
});

// Inicializar extensão
function initializeExtension() {
  isExtensionReady = true;
  // Verificar se a extensão deve funcionar automaticamente
  chrome.runtime.sendMessage({ action: "getSettings" }, (response) => {
    if (chrome.runtime.lastError) {
      console.log('Erro ao conectar com background script:', chrome.runtime.lastError);
      return;
    }
    
    if (response && response.isActive && response.settings.autoSummary) {
      detectAndExtractContent();
    }
  });
}

// Escutar mensagens do background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Mensagem recebida no content script:', message);
  
  if (message.action === "generateSummary") {
    if (!isExtensionReady) {
      setTimeout(() => {
        detectAndExtractContent(true);
        sendResponse({ received: true });
      }, 1000);
      return true;
    }
    
    if (message.manual || !sidePanelVisible) {
      detectAndExtractContent(true);
    }
    sendResponse({ received: true });
    return true;
  }
});

// Detectar tipo de conteúdo e extrair texto
function detectAndExtractContent(forceGenerate = false) {
  const url = window.location.href;
  
  // Verificar se é PDF
  if (url.includes('.pdf') || document.querySelector('embed[type="application/pdf"]') || 
      document.querySelector('object[type="application/pdf"]')) {
    extractPDFContent(forceGenerate);
  } else {
    // Extrair texto de página web
    extractWebPageContent(forceGenerate);
  }
}

// Extrair conteúdo de PDF (usando PDF.js se disponível)
async function extractPDFContent(forceGenerate = false) {
  try {
    // Tentar usar PDF.js se estiver carregado
    if (window.PDFViewerApplication && window.PDFViewerApplication.pdfDocument) {
      const pdfDoc = window.PDFViewerApplication.pdfDocument;
      let fullText = '';
      
      for (let i = 1; i <= Math.min(pdfDoc.numPages, 10); i++) { // Limitar a 10 páginas
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
      }
      
      if (fullText.length > 500) {
        extractedText = fullText;
        if (forceGenerate || shouldAutoSummarize(fullText)) {
          generateSummary(fullText);
        }
      }
    } else {
      // Fallback: tentar extrair texto visível da página
      extractWebPageContent(forceGenerate);
    }
  } catch (error) {
    console.error('Erro ao extrair PDF:', error);
    extractWebPageContent(forceGenerate); // Fallback
  }
}

// Extrair conteúdo de página web
function extractWebPageContent(forceGenerate = false) {
  console.log('Extraindo conteúdo da página web...');
  
  // Seletores para áreas de conteúdo principais
  const contentSelectors = [
    'article',
    '[role="main"]',
    '.content',
    '.post-content',
    '.entry-content',
    '.article-body',
    '.article-content',
    '.post-body',
    'main',
    '.main-content',
    '.container'
  ];
  
  let content = null;
  
  // Tentar encontrar área de conteúdo principal
  for (const selector of contentSelectors) {
    const element = document.querySelector(selector);
    if (element && element.innerText && element.innerText.length > 500) {
      content = element;
      console.log('Conteúdo encontrado com seletor:', selector);
      break;
    }
  }
  
  // Se não encontrar, usar o body
  if (!content) {
    content = document.body;
    console.log('Usando body como fallback');
  }
  
  // Remover elementos desnecessários
  const elementsToRemove = [
    'script', 'style', 'nav', 'header', 'footer', 
    '.ad', '.advertisement', '.sidebar', '.menu',
    '.navigation', '.comments', '.social-share'
  ];
  const clonedContent = content.cloneNode(true);
  
  elementsToRemove.forEach(selector => {
    const elements = clonedContent.querySelectorAll(selector);
    elements.forEach(el => el.remove());
  });
  
  const text = clonedContent.innerText || clonedContent.textContent || '';
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  console.log('Texto extraído, tamanho:', cleanText.length);
  
  if (cleanText.length > 300) {
    extractedText = cleanText;
    if (forceGenerate || shouldAutoSummarize(cleanText)) {
      generateSummary(cleanText);
    } else {
      console.log('Texto não atende critérios para auto-resumo');
    }
  } else {
    console.log('Texto muito curto para resumo:', cleanText.length);
    if (forceGenerate) {
      showErrorPanel('Conteúdo insuficiente para gerar resumo (menos de 300 caracteres)');
    }
  }
}

// Verificar se deve gerar resumo automaticamente
function shouldAutoSummarize(text) {
  // Critérios para auto-resumo
  const wordCount = text.split(' ').length;
  return wordCount > 300; // Textos com mais de 300 palavras
}

// Gerar resumo usando background script
function generateSummary(text) {
  if (!text || text.length < 100) {
    showErrorPanel('Texto muito curto para gerar resumo');
    return;
  }
  
  showLoadingPanel();
  
  console.log('Enviando texto para background script, tamanho:', text.length);
  
  chrome.runtime.sendMessage({
    action: "generateSummary",
    text: text
  }, (response) => {
    console.log('Resposta do background script:', response);
    
    if (chrome.runtime.lastError) {
      console.error('Erro de runtime:', chrome.runtime.lastError);
      showErrorPanel('Erro de comunicação: ' + chrome.runtime.lastError.message);
      return;
    }
    
    if (response && response.success) {
      showSummaryPanel(response.summary);
    } else {
      showErrorPanel(response?.error || 'Erro desconhecido ao gerar resumo');
    }
  });
}

// Utilidades de formatação
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatStructuredSummary(text) {
  // Tenta converter lista numerada (1. Item: descrição) + subitens iniciados com "- " em HTML
  const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];
  let current = null;
  for (const line of lines) {
    const numMatch = line.match(/^(\d+)[\.\)]\s+(.*)$/);
    if (numMatch) {
      if (current) items.push(current);
      const rest = numMatch[2];
      const parts = rest.split(':');
      const title = parts.shift()?.trim() || rest.trim();
      const desc = parts.join(':').trim();
      current = { title, desc, subs: [] };
      continue;
    }
    const subMatch = line.match(/^[-•]\s+(.*)$/);
    if (subMatch && current) {
      current.subs.push(subMatch[1].trim());
      continue;
    }
    // Linha solta: agrega na descrição do item atual
    if (current) {
      current.desc = (current.desc ? current.desc + ' ' : '') + line;
    }
  }
  if (current) items.push(current);

  if (items.length === 0) {
    // Fallback: apenas quebra de linha
    return '<div class="summary-plain">' + escapeHtml(text).replace(/\n/g, '<br>') + '</div>';
  }

  let html = '<ol class="summary-list">';
  for (const it of items) {
    html += '<li><span class="summary-topic">' + escapeHtml(it.title) + '</span>';
    if (it.desc) html += ': ' + escapeHtml(it.desc);
    if (it.subs && it.subs.length) {
      html += '<ul class="summary-sublist">';
      for (const s of it.subs) {
        html += '<li>' + escapeHtml(s) + '</li>';
      }
      html += '</ul>';
    }
    html += '</li>';
  }
  html += '</ol>';
  return html;
}

// Mostrar painel de carregamento
function showLoadingPanel() {
  createSidePanel();
  const panel = document.getElementById('auto-summarizer-panel');
  const content = panel.querySelector('.panel-content');
  
  content.innerHTML = `
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Gerando resumo...</p>
    </div>
  `;
  
  showPanel();
}

// Mostrar painel com resumo
function showSummaryPanel(summary) {
  const panel = document.getElementById('auto-summarizer-panel');
  const content = panel.querySelector('.panel-content');
  
  const formatted = formatStructuredSummary(summary);

  content.innerHTML = `
    <div class="summary-header">
      <h3>📄 Resumo Gerado</h3>
      <div class="header-actions">
        <button id="copy-summary" class="action-btn" title="Copiar">📋</button>
        <button id="close-panel" class="action-btn" title="Fechar">✕</button>
      </div>
    </div>
    <div class="summary-content">
      <div class="summary-text">${formatted}</div>
    </div>
    <div class="summary-footer">
      <small>Resumo gerado por IA • Auto-Summarizer</small>
    </div>
  `;
  
  // Adicionar event listeners
  document.getElementById('copy-summary').addEventListener('click', () => {
    // Copiar versão em texto simples
    navigator.clipboard.writeText(summary).then(() => {
      showToast('Resumo copiado!');
    });
  });
  
  document.getElementById('close-panel').addEventListener('click', hidePanel);
  
  showPanel();
}

// Mostrar painel de erro
function showErrorPanel(error) {
  const panel = document.getElementById('auto-summarizer-panel');
  const content = panel.querySelector('.panel-content');
  
  content.innerHTML = `
    <div class="error-container">
      <h3>⚠️ Erro ao Gerar Resumo</h3>
      <p>${error}</p>
      <button id="retry-summary" class="retry-btn">Tentar Novamente</button>
      <button id="close-panel" class="action-btn">Fechar</button>
    </div>
  `;
  
  document.getElementById('retry-summary').addEventListener('click', () => {
    if (extractedText) {
      generateSummary(extractedText);
    }
  });
  
  document.getElementById('close-panel').addEventListener('click', hidePanel);
  
  showPanel();
}

// Criar painel lateral
function createSidePanel() {
  if (document.getElementById('auto-summarizer-panel')) return;
  
  const panel = document.createElement('div');
  panel.id = 'auto-summarizer-panel';
  panel.className = 'auto-summarizer-panel hidden';
  
  panel.innerHTML = `
    <div class="panel-content">
      <!-- Conteúdo será inserido dinamicamente -->
    </div>
  `;
  
  document.body.appendChild(panel);
}

// Mostrar painel
function showPanel() {
  const panel = document.getElementById('auto-summarizer-panel');
  if (panel) {
    panel.classList.remove('hidden');
    sidePanelVisible = true;
  }
}

// Esconder painel
function hidePanel() {
  const panel = document.getElementById('auto-summarizer-panel');
  if (panel) {
    panel.classList.add('hidden');
    sidePanelVisible = false;
  }
}

// Mostrar toast de feedback
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'auto-summarizer-toast';
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('show');
  }, 100);
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, 2000);
}