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
    if (window.PDFViewerApplication && window.PDFViewerApplication.pdfDocument) { return { canStart: true }; }
    return { canStart: false, reason: 'PDF no visualizador nativo do Chrome não permite extração direta. Use Importar PDF no popup.' };
  }
  return { canStart: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.ping) { sendResponse({ pong: true }); return true; }
  if (message.action === "generateSummary") {
    if (!isExtensionReady) { setTimeout(() => { const check = quickCanStartExtraction(); if (!check.canStart) { showErrorPanel(check.reason); sendResponse({ received: true, started: false, errorMessage: check.reason }); } else { detectAndExtractContent(true); sendResponse({ received: true, started: true }); } }, 1000); return true; }
    const check = quickCanStartExtraction();
    if (!check.canStart) { showErrorPanel(check.reason); sendResponse({ received: true, started: false, errorMessage: check.reason }); return true; }
    if (message.manual || !sidePanelVisible) { detectAndExtractContent(true); }
    sendResponse({ received: true, started: true });
    return true;
  }
});

function detectAndExtractContent(forceGenerate = false) {
  const url = window.location.href;
  if (url.includes('.pdf') || document.querySelector('embed[type="application/pdf"]') || document.querySelector('object[type="application/pdf"]')) { extractPDFContent(forceGenerate); }
  else { extractWebPageContent(forceGenerate); }
}

async function extractPDFContent(forceGenerate = false) {
  try {
    if (window.PDFViewerApplication && window.PDFViewerApplication.pdfDocument) {
      const pdfDoc = window.PDFViewerApplication.pdfDocument; let fullText = '';
      for (let i = 1; i <= Math.min(pdfDoc.numPages, 10); i++) { const page = await pdfDoc.getPage(i); const textContent = await page.getTextContent(); const pageText = textContent.items.map(item => item.str).join(' '); fullText += pageText + '\n'; }
      if (fullText.length > 500) { extractedText = fullText; if (forceGenerate || shouldAutoSummarize(fullText)) { generateSummary(fullText); } }
      else { showErrorPanel('Não foi possível extrair texto suficiente do PDF.'); }
    } else { showErrorPanel('Este PDF parece estar no visualizador nativo. Use Importar PDF no popup.'); }
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

function generateSummary(text) {
  if (!text || text.length < 100) { showErrorPanel('Texto muito curto para gerar resumo'); return; }
  showLoadingPanel();
  try { window.__autoSummAbortController?.abort?.(); } catch (e) {}
  window.__autoSummAbortController = new AbortController();
  // Ler persona atual para exibir no rodapé
  try { chrome.runtime.sendMessage({ action: 'getSettings' }, (resp) => { window.__autoSummPersona = resp?.settings?.persona || ''; }); } catch (e) {}
  chrome.runtime.sendMessage({ action: "generateSummary", text: text }, (response) => {
    if (chrome.runtime.lastError) { showErrorPanel('Erro de comunicação: ' + chrome.runtime.lastError.message); return; }
    if (response && response.success) { showSummaryPanel(response.summary, response.modelUsed); }
    else { showErrorPanel(response?.error || 'Erro desconhecido ao gerar resumo'); }
  });
}

function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function formatStructuredSummary(text) {
  const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = []; let current = null;
  for (const line of lines) {
    const numMatch = line.match(/^(\d+)[\.\)]\s+(.*)$/);
    if (numMatch) { if (current) items.push(current); const rest = numMatch[2]; const parts = rest.split(':'); const title = parts.shift()?.trim() || rest.trim(); const desc = parts.join(':').trim(); current = { title, desc, subs: [] }; continue; }
    const subMatch = line.match(/^[-•]\s+(.*)$/); if (subMatch && current) { current.subs.push(subMatch[1].trim()); continue; }
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
  // Reduzir o nome do modelo para rótulo curto
  let modelShort = '';
  try {
    const low = String(modelUsed || '').toLowerCase();
    if (low.includes('deepseek')) modelShort = 'Deepseek';
    else if (low.includes('llama')) modelShort = 'Llama';
    else if (low.includes('gemini') || low.includes('google')) modelShort = 'Gemini';
    else if (low.includes('gpt')) modelShort = 'OpenAI';
    else if (low.includes('qwen')) modelShort = 'Qwen';
  } catch (e) {}
  // Acrescentar variação (r1, etc.) e se é free
  let modelVariant = '';
  let isFree = '';
  try {
    const raw = String(modelUsed || '');
    if (/r1/i.test(raw)) modelVariant = ' r1';
    if (/free/i.test(raw)) isFree = ' (free)';
  } catch (e) {}
  const modelInfo = modelShort ? ` • Modelo: ${escapeHtml(modelShort + modelVariant + isFree)}` : '';
  // Persona atual
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