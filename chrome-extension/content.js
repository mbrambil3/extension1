// Content script para detectar e extrair conteúdo
let sidePanelVisible = false;
let extractedText = '';

// Verificar se a extensão deve funcionar automaticamente
chrome.runtime.sendMessage({ action: "getSettings" }, (response) => {
  if (response && response.isActive && response.settings.autoSummary) {
    // Aguardar carregamento completo da página
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(detectAndExtractContent, 1000);
      });
    } else {
      setTimeout(detectAndExtractContent, 1000);
    }
  }
});

// Escutar mensagens do background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "generateSummary") {
    if (message.manual || !sidePanelVisible) {
      detectAndExtractContent(true);
    }
    sendResponse({ received: true });
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
  // Seletores para áreas de conteúdo principais
  const contentSelectors = [
    'article',
    '[role="main"]',
    '.content',
    '.post-content',
    '.entry-content',
    '.article-body',
    'main',
    '.container'
  ];
  
  let content = null;
  
  // Tentar encontrar área de conteúdo principal
  for (const selector of contentSelectors) {
    content = document.querySelector(selector);
    if (content) break;
  }
  
  // Se não encontrar, usar o body
  if (!content) {
    content = document.body;
  }
  
  // Remover elementos desnecessários
  const elementsToRemove = ['script', 'style', 'nav', 'header', 'footer', '.ad', '.advertisement'];
  const clonedContent = content.cloneNode(true);
  
  elementsToRemove.forEach(selector => {
    const elements = clonedContent.querySelectorAll(selector);
    elements.forEach(el => el.remove());
  });
  
  const text = clonedContent.innerText || clonedContent.textContent || '';
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  if (cleanText.length > 500) {
    extractedText = cleanText;
    if (forceGenerate || shouldAutoSummarize(cleanText)) {
      generateSummary(cleanText);
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
  showLoadingPanel();
  
  chrome.runtime.sendMessage({
    action: "generateSummary",
    text: text
  }, (response) => {
    if (response && response.success) {
      showSummaryPanel(response.summary);
    } else {
      showErrorPanel(response?.error || 'Erro desconhecido');
    }
  });
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
  
  content.innerHTML = `
    <div class="summary-header">
      <h3>📄 Resumo Gerado</h3>
      <div class="header-actions">
        <button id="copy-summary" class="action-btn" title="Copiar">📋</button>
        <button id="close-panel" class="action-btn" title="Fechar">✕</button>
      </div>
    </div>
    <div class="summary-content">
      <div class="summary-text">${summary.replace(/\n/g, '<br>')}</div>
    </div>
    <div class="summary-footer">
      <small>Resumo gerado por IA • Auto-Summarizer</small>
    </div>
  `;
  
  // Adicionar event listeners
  document.getElementById('copy-summary').addEventListener('click', () => {
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