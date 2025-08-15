// JavaScript para o popup da extensão
document.addEventListener('DOMContentLoaded', function() {
    try {
        const { version } = chrome.runtime.getManifest();
        const verEl = document.querySelector('.version');
        if (verEl && version) verEl.textContent = 'v' + version;
    } catch (e) {}

    loadSettings();
    setupEventListeners();
});

async function loadQuotaStatus() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getQuotaStatus' }, (resp) => {
            resolve(resp || { success: false });
        });
    });
}

function renderPlanStatus(status) {
    const el = document.getElementById('planStatus');
    if (!el || !status || !status.success) return;
    let txt = '';
    if (status.plan === 'premium_unlimited') txt = 'Plano: Premium Ilimitado';
    else if (status.plan === 'premium') {
        const until = status.premiumUntil ? new Date(status.premiumUntil) : null;
        txt = 'Plano: Premium' + (until ? ` (até ${until.toLocaleDateString('pt-BR')})` : '');
    } else txt = `Plano: Free • Hoje: ${status.countToday}/${status.limit}`;
    el.textContent = txt;
}

function updatePremiumUI(status) {
    const isPremium = status && status.success && (status.plan === 'premium' || status.plan === 'premium_unlimited');
    const applyBtn = document.getElementById('applyKeyBtn');
    const keyInput = document.getElementById('subscriptionKey');
    const hint = document.getElementById('subscriptionHint');
    if (!applyBtn || !keyInput || !hint) return;
    if (isPremium) {
        applyBtn.textContent = 'Premium ATIVADO';
        applyBtn.disabled = true;
        applyBtn.classList.add('disabled');
        keyInput.style.display = 'none';
        hint.style.display = 'none';
    } else {
        applyBtn.textContent = 'Ativar Premium';
        applyBtn.disabled = false;
        applyBtn.classList.remove('disabled');
        keyInput.style.display = 'block';
        hint.style.display = 'block';
    }
}

function loadSettings() {
    chrome.runtime.sendMessage({ action: "getSettings" }, async (response) => {
        if (response) {
            document.getElementById('autoSummary').checked = response.settings.autoSummary;
            document.getElementById('language').value = response.settings.language;
            document.getElementById('detailLevel').value = response.settings.detailLevel;
            document.getElementById('openrouterKey').value = response.settings.openrouterKey || '';

            document.getElementById('persona').value = response.settings.persona || '';
            try {
                const res = await chrome.storage.local.get('lastModelUsed');
                const model = (res && res.lastModelUsed) ? String(res.lastModelUsed) : '';
                let provider = '';
                const lower = model.toLowerCase();
                if (lower.includes('deepseek')) provider = 'Deepseek';
                else if (lower.includes('llama')) provider = 'Llama';
                else if (lower.includes('gpt')) provider = 'OpenAI';
                else if (lower.includes('gemini') || lower.includes('google')) provider = 'Gemini';
                else if (lower.includes('qwen')) provider = 'Qwen';
                else if (model.trim()) provider = 'Fallback';
                const footer = document.getElementById('providerDisplay');
                if (footer) footer.textContent = provider ? `Powered by ${provider}` : 'Powered by Deepseek';
            } catch (e) {}
        }
        const quota = await loadQuotaStatus();
        renderPlanStatus(quota);
        updatePremiumUI(quota);
    });
}

let personaDebounceTimer = null;

function saveSettingsInternal(showToastFlag) {
    const settings = {
        autoSummary: document.getElementById('autoSummary').checked,
        language: document.getElementById('language').value,
        detailLevel: document.getElementById('detailLevel').value,
        openrouterKey: document.getElementById('openrouterKey').value,
        deepseekKey: (document.getElementById('deepseekKey')?.value || ''),
        persona: document.getElementById('persona').value.trim()
    };
    chrome.runtime.sendMessage({ action: "updateSettings", isActive: settings.autoSummary, settings }, async (response) => {
        if (!response || !response.success) {
            if (showToastFlag) showToast('Erro ao salvar configurações', 'error');
            return;
        }
        updateStatusIndicator(response.isActive);
        if (showToastFlag) showToast('Configurações salvas!', 'success');
        const quota = await loadQuotaStatus();
        renderPlanStatus(quota);
        updatePremiumUI(quota);
    });
}

function saveSettings() { saveSettingsInternal(true); }
function saveSettingsSilent() { saveSettingsInternal(false); }

function setupEventListeners() {
    document.getElementById('autoSummary').addEventListener('change', saveSettings);
    document.getElementById('language').addEventListener('change', saveSettings);
    document.getElementById('detailLevel').addEventListener('change', saveSettings);
    document.getElementById('openrouterKey').addEventListener('change', saveSettings);

    // Debounce no input da persona para evitar spam de toasts
    document.getElementById('persona').addEventListener('input', () => {
        clearTimeout(personaDebounceTimer);
        personaDebounceTimer = setTimeout(() => { saveSettingsSilent(); }, 500);
    });

    document.getElementById('applyKeyBtn').addEventListener('click', async () => {
        const key = (document.getElementById('subscriptionKey').value || '').trim();
        if (!key) { showToast('Informe a KEY de ASSINATURA', 'warning'); return; }
        chrome.runtime.sendMessage({ action: 'applySubscriptionKey', key }, async (resp) => {
            if (!resp || !resp.success) { showToast(resp?.error || 'Falha ao aplicar KEY', 'error'); return; }
            const quota = await loadQuotaStatus();
            renderPlanStatus(quota);
            updatePremiumUI(quota);
            showToast(quota.plan === 'premium_unlimited' ? 'Premium Ilimitado ativado!' : 'Premium ativado!', 'success');
        });
    });

    document.getElementById('generateNow').addEventListener('click', generateSummaryNow);
    document.getElementById('viewHistory').addEventListener('click', openHistoryWindow);

    const stopBtn = document.getElementById('stopNow');
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            try { chrome.runtime.sendMessage({ action: 'stopGeneration' }, () => {}); } catch (e) {}
            showToast('Geração interrompida', 'warning');
            stopBtn.style.display = 'none';
            const btn = document.getElementById('generateNow');
            if (btn) { btn.classList.remove('loading'); btn.textContent = '🎯 Gerar Resumo Agora'; }
        });
    }

    document.getElementById('pdfInput').addEventListener('change', async function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.type !== 'application/pdf') { showToast('Selecione um arquivo PDF', 'error'); return; }
        const reader = new FileReader();
        reader.onload = async function() {
            try {
                const arrayBuffer = reader.result;
                const uint8 = new Uint8Array(arrayBuffer);
                const pdfjs = window.pdfjsLib;
                if (!pdfjs) { showToast('PDF.js não carregou. Recarregue a extensão.', 'error'); return; }
                try { pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs/pdf.worker.min.js'); } catch (e) {}
                const doc = await pdfjs.getDocument({ data: uint8, disableWorker: true }).promise;
                let fullText = '';
                const pages = Math.min(doc.numPages, 10);
                for (let i = 1; i <= pages; i++) { const page = await doc.getPage(i); const content = await page.getTextContent(); fullText += content.items.map(it => it.str).join(' ') + '\n'; }
                fullText = (fullText || '').trim();
                if (!fullText || fullText.length < 50) { showToast('Não foi possível extrair texto do PDF', 'error'); return; }
                const payload = `Arquivo: ${file.name}\n\n${fullText.substring(0, 50000)}`;
                showToast('Importando PDF... O resumo aparecerá no Histórico em instantes.', 'success');
                chrome.runtime.sendMessage({ action: 'generateSummary', text: payload, source: 'pdf', fileName: file.name }, (response) => {
                    if (chrome.runtime.lastError) { showToast('Erro: ' + chrome.runtime.lastError.message, 'error'); return; }
                    if (response && response.success) { showToast('PDF enviado. Abra o Histórico para acompanhar.', 'success'); }
                    else { showToast(response?.error || 'Falha ao iniciar resumo do PDF', 'error'); }
                });
            } catch (err) { console.error('Falha ao processar PDF:', err); showToast('Falha ao processar PDF: ' + (err?.message || err), 'error'); }
        };
        reader.readAsArrayBuffer(file);
    });
}

function isRestrictedUrl(url) { return url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:') || url.startsWith('view-source:'); }
async function injectContentScript(tabId) { try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); return true; } catch (e) { return false; } }

async function requestPdfTextFromTab(tabId) {
    return new Promise((resolve) => {
        try {
            chrome.tabs.sendMessage(tabId, { action: 'extractPdfText' }, (resp) => {
                if (chrome.runtime.lastError) { resolve({ success: false, error: chrome.runtime.lastError.message }); return; }
                resolve(resp || { success: false });
            });
        } catch (e) { resolve({ success: false, error: String(e) }); }
    });
}

async function extractPdfFromUrl(url) {
    const pdfjs = window.pdfjsLib;
    if (!pdfjs) throw new Error('PDF.js não carregou');
    try { pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs/pdf.worker.min.js'); } catch (e) {}
    // Tenta carregar via PDF.js por URL diretamente
    try {
        const doc = await pdfjs.getDocument({ url, disableWorker: true, withCredentials: false }).promise;
        let fullText = '';
        const pages = Math.min(doc.numPages, 10);
        for (let i = 1; i <= pages; i++) { const page = await doc.getPage(i); const content = await page.getTextContent(); fullText += content.items.map(it => it.str).join(' ') + '\n'; }
        return (fullText || '').trim();
    } catch (e) {
        // Fallback: tentar baixar bytes e carregar por data
        const resp = await fetch(url).catch(() => null);
        if (!resp || !resp.ok) throw new Error('Falha ao baixar PDF');
        const buf = await resp.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableWorker: true }).promise;
        let fullText = '';
        const pages = Math.min(doc.numPages, 10);
        for (let i = 1; i <= pages; i++) { const page = await doc.getPage(i); const content = await page.getTextContent(); fullText += content.items.map(it => it.str).join(' ') + '\n'; }
        return (fullText || '').trim();
    }
}

function fileNameFromUrl(url) { try { const u = new URL(url); const p = u.pathname.split('/').pop() || 'documento.pdf'; return decodeURIComponent(p); } catch { return 'documento.pdf'; } }

function openFileAccessHelp() {
    const extId = chrome.runtime.id;
    const url = `chrome://extensions/?id=${extId}`;
    try { chrome.tabs.create({ url }); } catch (e) {}
    showToast('Para resumir PDFs locais (file://), habilite "Permitir acesso a URLs de arquivos" na página da extensão e tente novamente.', 'warning');
}

function generateSummaryNow() {
    const button = document.getElementById('generateNow');
    button.classList.add('loading');
    button.textContent = 'Gerando...';
    const stopBtn = document.getElementById('stopNow');
    if (stopBtn) stopBtn.style.display = 'inline-block';

    // Salvar configurações atuais silenciosamente antes de gerar
    saveSettingsSilent();

    chrome.tabs.query({ active: true, currentWindow: true }, async function(tabs) {
        const tab = tabs[0];
        if (!tab) { button.classList.remove('loading'); button.textContent = '🎯 Gerar Resumo Agora'; showToast('Nenhuma aba ativa encontrada', 'error'); return; }

        // Se for PDF no leitor nativo (URL .pdf) ou PDF no viewer do Chrome com parâmetro src
        const isChromePdfViewer = (tab.url || '').startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai');
        let pdfUrlCandidate = null;
        if (/\.pdf($|\?|#)/i.test(tab.url || '')) {
            pdfUrlCandidate = tab.url;
        } else if (isChromePdfViewer) {
            try {
                const u = new URL(tab.url);
                const src = u.searchParams.get('src');
                if (src) pdfUrlCandidate = decodeURIComponent(src);
            } catch (e) {}
        }
        if (pdfUrlCandidate) {
            // Primeiro, tente extrair diretamente do viewer (se disponível)
            const resp = await requestPdfTextFromTab(tab.id);
            if (resp && resp.success && resp.text && resp.text.length > 50) {
                const payload = `Arquivo: ${fileNameFromUrl(tab.url)}\n\n${resp.text.substring(0, 50000)}`;
                chrome.runtime.sendMessage({ action: 'generateSummary', text: payload, source: 'pdf', fileName: fileNameFromUrl(tab.url) }, (response) => {
                    button.classList.remove('loading'); button.textContent = '🎯 Gerar Resumo Agora'; if (stopBtn) stopBtn.style.display = 'none';
                    if (chrome.runtime.lastError) { showToast('Erro: ' + chrome.runtime.lastError.message, 'error'); return; }
                    if (response && response.success) { showToast('Resumo do PDF gerado (Histórico atualizado)', 'success'); }
                    else { showToast(response?.error || 'Falha ao gerar resumo do PDF', 'error'); }
                });
                return;
            }
            // Se for file:// e não conseguiu extrair do viewer, verificar permissão
            if ((tab.url || '').startsWith('file://')) {
                if (chrome.extension && chrome.extension.isAllowedFileSchemeAccess) {
                    chrome.extension.isAllowedFileSchemeAccess(async (allowed) => {
                        if (!allowed) {
                            button.classList.remove('loading'); button.textContent = '🎯 Gerar Resumo Agora'; if (stopBtn) stopBtn.style.display = 'none';
                            openFileAccessHelp();
                            return;
                        }
                        try {
                            const text = await extractPdfFromUrl(tab.url);
                            if (!text || text.length < 50) throw new Error('Não foi possível extrair texto do PDF');
                            const payload = `Arquivo: ${fileNameFromUrl(tab.url)}\n\n${text.substring(0, 50000)}`;
                            chrome.runtime.sendMessage({ action: 'generateSummary', text: payload, source: 'pdf', fileName: fileNameFromUrl(tab.url) }, (response) => {
                                button.classList.remove('loading'); button.textContent = '🎯 Gerar Resumo Agora'; if (stopBtn) stopBtn.style.display = 'none';
                                if (chrome.runtime.lastError) { showToast('Erro: ' + chrome.runtime.lastError.message, 'error'); return; }
                                if (response && response.success) { showToast('Resumo do PDF gerado (Histórico atualizado)', 'success'); }
                                else { showToast(response?.error || 'Falha ao gerar resumo do PDF', 'error'); }
                            });
                        } catch (e) {
                            button.classList.remove('loading'); button.textContent = '🎯 Gerar Resumo Agora'; if (stopBtn) stopBtn.style.display = 'none';
                            showToast('Falha ao processar PDF local. Use Importar PDF no popup ou habilite acesso a arquivos.', 'error');
                        }
                    });
                    return;
                } else {
                    button.classList.remove('loading'); button.textContent = '🎯 Gerar Resumo Agora'; if (stopBtn) stopBtn.style.display = 'none';
                    openFileAccessHelp();
                    return;
                }
            }
            // PDFs http/https como fallback
            try {
                const text = await extractPdfFromUrl(tab.url);
                if (!text || text.length < 50) throw new Error('Não foi possível extrair texto do PDF');
                const payload = `Arquivo: ${fileNameFromUrl(tab.url)}\n\n${text.substring(0, 50000)}`;
                chrome.runtime.sendMessage({ action: 'generateSummary', text: payload, source: 'pdf', fileName: fileNameFromUrl(tab.url) }, (response) => {
                    button.classList.remove('loading'); button.textContent = '🎯 Gerar Resumo Agora'; if (stopBtn) stopBtn.style.display = 'none';
                    if (chrome.runtime.lastError) { showToast('Erro: ' + chrome.runtime.lastError.message, 'error'); return; }
                    if (response && response.success) { showToast('Resumo do PDF gerado (Histórico atualizado)', 'success'); }
                    else { showToast(response?.error || 'Falha ao gerar resumo do PDF', 'error'); }
                });
                return;
            } catch (e) {
                button.classList.remove('loading'); button.textContent = '🎯 Gerar Resumo Agora'; if (stopBtn) stopBtn.style.display = 'none';
                showToast('Falha ao processar PDF. Tente importar o arquivo pelo popup.', 'error');
                return;
            }
        }

        if (isRestrictedUrl(tab.url || '')) { button.classList.remove('loading'); button.textContent = '🎯 Gerar Resumo Agora'; showToast('Esta página não permite injeção de conteúdo (chrome://, etc.)', 'warning'); return; }
        function sendGenerate() {
            chrome.tabs.sendMessage(tab.id, { action: 'generateSummary', manual: true }, function(response) {
                button.classList.remove('loading');
                button.textContent = '🎯 Gerar Resumo Agora';
                if (stopBtn) stopBtn.style.display = 'none';
                if (chrome.runtime.lastError) { const msg = chrome.runtime.lastError.message || ''; if (msg.includes('Receiving end does not exist')) { showToast('Tentando preparar a página, clique novamente...', 'warning'); } else { showToast('Erro: ' + msg, 'error'); } return; }
                if (response && response.received) { if (response.started) { showToast('Resumo sendo gerado...', 'success'); } else { showToast(response.errorMessage || 'Conteúdo não suportado para extração direta', 'warning'); } } else { showToast('A página pode não ter conteúdo suficiente', 'warning'); }
            });
        }
        chrome.tabs.sendMessage(tab.id, { ping: true }, async function(response) {
            if (chrome.runtime.lastError || !response || !response.pong) {
                const injected = await injectContentScript(tab.id);
                if (injected) {
                    setTimeout(() => {
                        chrome.tabs.sendMessage(tab.id, { ping: true }, function(resp2) {
                            if (!chrome.runtime.lastError && resp2 && resp2.pong) { sendGenerate(); }
                            else { showToast('Não foi possível preparar a página para resumo', 'error'); }
                        });
                    }, 300);
                } else {
                    showToast('Não foi possível preparar a página para resumo', 'error');
                }
                button.classList.remove('loading');
                button.textContent = '🎯 Gerar Resumo Agora';
                return;
            }
            sendGenerate();
        });
    });
}

function openHistoryWindow() { chrome.tabs.create({ url: chrome.runtime.getURL('history.html') }); }

function updateStatusIndicator() { /* indicador removido */ }

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('show'); }, 100);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => { if (container.contains(toast)) container.removeChild(toast); }, 300); }, 3000);
}