// Content script para detectar e extrair conteúdo
let sidePanelVisible = false;
let extractedText = '';
let isExtensionReady = false;

window.addEventListener('load', () => { setTimeout(initializeExtension, 2000); });

function initializeExtension() {
  isExtensionReady = true;
  chrome.runtime.sendMessage({ action: "getSettings" }, (response) => {
    if (chrome.runtime.lastError) { console.log('Erro ao conectar com background script:', chrome.runtime.lastError); return; }
    if (response && response.isActive && response.settings.autoSummary) { detectAndExtractContent(); }
  });
}

function quickCanStartExtraction() {
  const url = window.location.href;
  const isPdfUrl = /\.pdf($|\?|#)/i.test(url);
  const hasPdfEmbed = document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]');
  if (isPdfUrl || hasPdfEmbed) {
    // Se o viewer nativo não expõe PDFViewerApplication, pedimos o arquivo ao background e extraímos com PDF.js no content
    if (window.PDFViewerApplication && window.PDFViewerApplication.pdfDocument) { return { canStart: true, mode: 'pdfjs_viewer' }; }
    return { canStart: true, mode: 'fetch_pdf_via_bg' };
  }
  return { canStart: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.ping) { sendResponse({ pong: true }); return true; }
  if (message.action === 'extractPdfText') {
    (async () => {
      try {
        if (window.PDFViewerApplication && window.PDFViewerApplication.pdfDocument) {
          const pdfDoc = window.PDFViewerApplication.pdfDocument;
          let fullText = '';
          const pages = Math.min(pdfDoc.numPages, 10);
          for (let i = 1; i <= pages; i++) {
            const page = await pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(it => it.str).join(' ') + '\n';
          }
          fullText = (fullText || '').trim();
          if (fullText.length > 0) { sendResponse({ success: true, text: fullText }); return; }
        }
        sendResponse({ success: false, error: 'PDFViewerApplication não disponível.' });
      } catch (e) {
        sendResponse({ success: false, error: String(e && e.message || e) });
      }
    })();
    return true;
  }
  if (message.action === "generateSummary") {
    if (!isExtensionReady) {
      setTimeout(() => {
        const check = quickCanStartExtraction();
        if (!check.canStart) {
          // Não abrir painel de erro para PDFs; apenas responder
          sendResponse({ received: true, started: false, errorMessage: check.reason });
        } else { detectAndExtractContent(true); sendResponse({ received: true, started: true }); }
      }, 1000);
      return true;
    }
    const check = quickCanStartExtraction();
    if (!check.canStart) {
      sendResponse({ received: true, started: false, errorMessage: check.reason });
      return true;
    }
    if (message.manual || !sidePanelVisible) { detectAndExtractContent(true, check.mode); }
    sendResponse({ received: true, started: true });
    return true;
  }
});

function detectAndExtractContent(forceGenerate = false, mode = null) {
  const url = window.location.href;
  const isPdfPage = url.includes('.pdf') || document.querySelector('embed[type="application/pdf"]') || document.querySelector('object[type="application/pdf"]');
  if (isPdfPage) { extractPDFContent(forceGenerate, mode); }
  else { extractWebPageContent(forceGenerate); }
}

async function extractPDFContent(forceGenerate = false, mode = null) {
  try {
    if (window.PDFViewerApplication && window.PDFViewerApplication.pdfDocument) {
      const pdfDoc = window.PDFViewerApplication.pdfDocument; let fullText = '';
      for (let i = 1; i <= Math.min(pdfDoc.numPages, 10); i++) { const page = await pdfDoc.getPage(i); const textContent = await page.getTextContent(); const pageText = textContent.items.map(item => item.str).join(' '); fullText += pageText + '\n'; }
      if (fullText.length > 500) { extractedText = fullText; if (forceGenerate || shouldAutoSummarize(fullText)) { generateSummary(fullText, { source: 'pdf', fileName: (document.title || 'Documento PDF') }); } }
      else { showErrorPanel('Não foi possível extrair texto suficiente do PDF.'); }
    } else if (mode === 'fetch_pdf_via_bg') {
      // Pede o binário do PDF ao background e extrai com PDF.js embutido
      try {
        chrome.runtime.sendMessage({ action: 'fetchPdfBinary', url: window.location.href }, async (resp) => {
          if (!resp || !resp.ok) { showErrorPanel('Falha ao obter PDF: ' + (resp?.error || 'desconhecido')); return; }
          const b64 = resp.b64 || '';
          const raw = atob(b64);
          const len = raw.length; const arr = new Uint8Array(len);
          for (let i = 0; i < len; i++) arr[i] = raw.charCodeAt(i);
          let pdfjsLib = window['pdfjsLib'];
          if (!pdfjsLib) {
            // pdfjs agora é injetado via manifest; se ainda não estiver disponível, oriente o usuário
            showErrorPanel('PDF.js não carregado pela extensão. Recarregue a página e tente novamente.');
            return;
          }
          try { pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs/pdf.worker.min.js'); } catch (e) {}
          const doc = await pdfjsLib.getDocument({ data: arr, disableWorker: true }).promise;
          let fullText = '';
          const pages = Math.min(doc.numPages, 10);
          for (let i = 1; i <= pages; i++) { const page = await doc.getPage(i); const content = await page.getTextContent(); fullText += content.items.map(it => it.str).join(' ') + '\n'; }
          fullText = (fullText || '').trim();
          if (fullText.length > 300) { if (forceGenerate || shouldAutoSummarize(fullText)) { generateSummary(fullText, { source: 'pdf', fileName: (document.title || 'Documento PDF') }); } }
          else { showErrorPanel('PDF muito curto para gerar resumo.'); }
        });
      } catch (e) { showErrorPanel('Erro ao obter PDF: ' + (e?.message || e)); }
    } else {
      // Viewer nativo sem API e sem modo fetch
      showErrorPanel('PDF detectado, mas não é possível ler o conteúdo automaticamente nesta aba.');
    }
  } catch (error) { console.error('Erro ao extrair PDF:', error); showErrorPanel('Erro ao extrair conteúdo do PDF.'); }
}

function extractWebPageContent(forceGenerate = false) {
  const contentSelectors = ['article','[role="main"]','.content','.post-content','.entry-content','.article-body','.article-content','.post-body','main','.main-content','.container'];
  let content = null;
  for (const selector of contentSelectors) { const element = document.querySelector(selector); if (element && element.innerText && element.innerText.length > 500) { content = element; break; } }
  if (!content) content = document.body;
  const elementsToRemove = ['script','style','nav','header','footer','.ad','.advertisement','.sidebar','.menu','.navigation','.comments','.social-share'];
  const clonedContent = content.cloneNode(true);
  elementsToRemove.forEach(sel => { const els = clonedContent.querySelectorAll(sel); els.forEach(el => el.remove()); });
  const text = clonedContent.innerText || clonedContent.textContent || '';
  const cleanText = text.replace(/\s+/g, ' ').trim();
  if (cleanText.length > 300) { extractedText = cleanText; if (forceGenerate || shouldAutoSummarize(cleanText)) { generateSummary(cleanText); } }
  else { if (forceGenerate) { showErrorPanel('Conteúdo insuficiente para gerar resumo (menos de 300 caracteres)'); } }
}

function shouldAutoSummarize(text) { const wordCount = text.split(' ').length; return wordCount > 300; }

function generateSummary(text, extra = {}) {
  if (!text || text.length < 100) { showErrorPanel('Texto muito curto para gerar resumo'); return; }
  showLoadingPanel();
  try { window.__autoSummAbortController?.abort?.(); } catch (e) {}
  window.__autoSummAbortController = new AbortController();
  // Ler persona atual para exibir no rodapé
  try { chrome.runtime.sendMessage({ action: 'getSettings' }, (resp) => { window.__autoSummPersona = resp?.settings?.persona || ''; }); } catch (e) {}
  const payload = { action: "generateSummary", text: text, ...extra };
  chrome.runtime.sendMessage(payload, (response) => {
    if (chrome.runtime.lastError) { showErrorPanel('Erro de comunicação: ' + chrome.runtime.lastError.message); return; }
    if (response && response.success) { showSummaryPanel(response.summary, response.modelUsed); }
    else { showErrorPanel(response?.error || 'Erro desconhecido ao gerar resumo'); }
  });
}

function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;/g,).replace(/>/g, '&gt;'); }

function formatStructuredSummary(text) {
  const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = []; let current = null;
  for (const line of lines) {
    const numMatch = line.match(/^(\d+)[\.\)]\s+(.*)$/);
    if (numMatch) { if (current) items.push(current); const rest = numMatch[2]; const parts = rest.split(':'); const title = parts.shift()?.trim() || rest.trim(); const desc = parts.join(':').trim(); current = { title, desc, subs: [] }; continue; }
    const subMatch = line.match(/^[–\-•]\s+(.*)$/); if (subMatch && current) { current.subs.push(subMatch[1].trim()); continue; }
    if (current) { current.desc = (current.desc ? current.desc + ' ' : '') + line; }
  }
  if (current) items.push(current);
  if (items.length === 0) { return '<div class="summary-plain">' + escapeHtml(text).replace(/\n/g, '<br>') + '</div>'; }
  let html = '<ol class="summary-list">';
  for (const it of items) { html += '<li><span class="summary-topic">' + escapeHtml(it.title) + '</span>'; if (it.desc) html += ': ' + escapeHtml(it.desc); if (it.subs && it.subs.length) { html += '<ul class="summary-sublist">'; for (const s of it.subs) { html += '<li>' + escapeHtml(s) + '</li>'; } html += '</ul>'; } html += '</li>'; }
  html += '</ol>'; return html;
}

function showLoadingPanel() {
  createSidePanel();
  const panel = document.getElementById('auto-summarizer-panel');
  const content = panel.querySelector('.panel-content');
  content.innerHTML = `
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Gerando resumo...</p>
      <button id="stop-autosummary" class="action-btn" style="margin-top:12px;">⏹️ Parar</button>
    </div>
  `;
  showPanel();
  try {
    document.getElementById('stop-autosummary')?.addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ action: 'stopGeneration' }, () => {}); } catch (e) {}
      hidePanel();
      showToast('Geração interrompida');
    });
  } catch (e) {}
}

function showSummaryPanel(summary, modelUsed) {
  const panel = document.getElementById('auto-summarizer-panel');
  const content = panel.querySelector('.panel-content');
  const formatted = formatStructuredSummary(summary);
  let modelShort = '';
  try {
    const low = String(modelUsed || '').toLowerCase();
    if (low.includes('deepseek')) modelShort = 'Deepseek';
    else if (low.includes('llama')) modelShort = 'Llama';
    else if (low.includes('gemini') || low.includes('google')) modelShort = 'Gemini';
    else if (low.includes('gpt')) modelShort = 'OpenAI';
    else if (low.includes('qwen')) modelShort = 'Qwen';
  } catch (e) {}
  let modelVariant = '';
  let isFree = '';
  try {
    const raw = String(modelUsed || '');
    if (/r1/i.test(raw)) modelVariant = ' r1';
    if (/free/i.test(raw)) isFree = ' (free)';
  } catch (e) {}
  const modelInfo = modelShort ? ` • Modelo: ${escapeHtml(modelShort + modelVariant + isFree)}` : '';
  let personaTxt = '';
  try {
    const p = (window.__autoSummPersona || '').trim();
    if (p) personaTxt = ` • Tom: ${escapeHtml(p)}`;
  } catch (e) {}

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
      <small>Resumo gerado por IA${modelInfo}${personaTxt}</small>
    </div>
  `;
  document.getElementById('copy-summary').addEventListener('click', () => { navigator.clipboard.writeText(summary).then(() => { showToast('Resumo copiado!'); }); });
  document.getElementById('close-panel').addEventListener('click', hidePanel);
  showPanel();
}

function showErrorPanel(error) {
  createSidePanel();
  const panel = document.getElementById('auto-summarizer-panel');
  const content = panel.querySelector('.panel-content');
  content.innerHTML = `
    <div class="error-container">
      <h3>⚠️ Erro ao Gerar Resumo</h3>
      <p>${escapeHtml(error)}</p>
      <button id="close-panel" class="action-btn">Fechar</button>
    </div>
  `;
  document.getElementById('close-panel').addEventListener('click', hidePanel);
  showPanel();
}

function createSidePanel() {
  if (document.getElementById('auto-summarizer-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'auto-summarizer-panel';
  panel.className = 'auto-summarizer-panel hidden';
  panel.innerHTML = `<div class="panel-content"></div>`;
  document.body.appendChild(panel);
}
function showPanel() { const panel = document.getElementById('auto-summarizer-panel'); if (panel) { panel.classList.remove('hidden'); sidePanelVisible = true; } }
function hidePanel() { const panel = document.getElementById('auto-summarizer-panel'); if (panel) { panel.classList.add('hidden'); sidePanelVisible = false; } }
function showToast(message) { const toast = document.createElement('div'); toast.className = 'auto-summarizer-toast'; toast.textContent = message; document.body.appendChild(toast); setTimeout(() => { toast.classList.add('show'); }, 100); setTimeout(() => { toast.classList.remove('show'); setTimeout(() => { document.body.removeChild(toast); }, 300); }, 2000); }