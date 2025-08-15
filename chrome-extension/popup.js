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

function loadSettings() {
    chrome.runtime.sendMessage({ action: "getSettings" }, async (response) => {
        if (response) {
            document.getElementById('autoSummary').checked = response.settings.autoSummary;
            document.getElementById('language').value = response.settings.language;
            document.getElementById('detailLevel').value = response.settings.detailLevel;
            document.getElementById('openrouterKey').value = response.settings.openrouterKey || '';
            document.getElementById('persona').value = response.settings.persona || 'assertivo';
            // Indicador de Extensão Ativa/Inativa removido
            // Atualiza texto do provedor no rodapé com base no último modelo utilizado
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
                if (footer) {
                    if (provider) footer.textContent = `Powered by ${provider}`;
                    else footer.textContent = 'Powered by Deepseek';
                }
            } catch (e) {}
        }
    });
}

function setupEventListeners() {
    document.getElementById('autoSummary').addEventListener('change', saveSettings);
    document.getElementById('language').addEventListener('change', saveSettings);
    document.getElementById('detailLevel').addEventListener('change', saveSettings);
    document.getElementById('openrouterKey').addEventListener('change', saveSettings);

    document.getElementById('generateNow').addEventListener('click', generateSummaryNow);
    document.getElementById('viewHistory').addEventListener('click', openHistoryWindow);

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

function saveSettings() {
    const settings = {
        autoSummary: document.getElementById('autoSummary').checked,
        language: document.getElementById('language').value,
        detailLevel: document.getElementById('detailLevel').value,
        openrouterKey: document.getElementById('openrouterKey').value
    };
    chrome.runtime.sendMessage({ action: "updateSettings", isActive: settings.autoSummary, settings }, (response) => {
        if (response && response.success) {
            updateStatusIndicator(response.isActive);
            showToast('Configurações salvas!', 'success');
        } else {
            showToast('Erro ao salvar configurações', 'error');
        }
    });
}

function isRestrictedUrl(url) { return url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:') || url.startsWith('view-source:'); }
async function injectContentScript(tabId) { try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); return true; } catch (e) { return false; } }

function generateSummaryNow() {
    const button = document.getElementById('generateNow');
    button.classList.add('loading');
    button.textContent = 'Gerando...';
    chrome.tabs.query({ active: true, currentWindow: true }, async function(tabs) {
        const tab = tabs[0];
        if (!tab) { button.classList.remove('loading'); button.textContent = '🎯 Gerar Resumo Agora'; showToast('Nenhuma aba ativa encontrada', 'error'); return; }
        if (isRestrictedUrl(tab.url || '')) { button.classList.remove('loading'); button.textContent = '🎯 Gerar Resumo Agora'; showToast('Esta página não permite injeção de conteúdo (chrome://, etc.)', 'warning'); return; }
        function sendGenerate() {
            chrome.tabs.sendMessage(tab.id, { action: 'generateSummary', manual: true }, function(response) {
                button.classList.remove('loading');
                button.textContent = '🎯 Gerar Resumo Agora';
                if (chrome.runtime.lastError) { const msg = chrome.runtime.lastError.message || ''; if (msg.includes('Receiving end does not exist')) { showToast('Tentando preparar a página, clique novamente...', 'warning'); } else { showToast('Erro: ' + msg, 'error'); } return; }
                if (response && response.received) { if (response.started) { showToast('Resumo sendo gerado...', 'success'); } else { showToast(response.errorMessage || 'Conteúdo não suportado para extração direta', 'warning'); } } else { showToast('A página pode não ter conteúdo suficiente', 'warning'); }
            });
        }
        chrome.tabs.sendMessage(tab.id, { ping: true }, async function(response) {
            if (chrome.runtime.lastError || !response || !response.pong) { const injected = await injectContentScript(tab.id); if (injected) { setTimeout(() => { chrome.tabs.sendMessage(tab.id, { ping: true }, function(resp2) { if (!chrome.runtime.lastError && resp2 && resp2.pong) { sendGenerate(); } else { showToast('Não foi possível preparar a página para resumo', 'error'); } }); }, 300); } else { showToast('Não foi possível preparar a página para resumo', 'error'); } button.classList.remove('loading'); button.textContent = '🎯 Gerar Resumo Agora'; return; }
            sendGenerate();
        });
    });
}

function openHistoryWindow() { chrome.tabs.create({ url: chrome.runtime.getURL('history.html') }); }

function updateStatusIndicator() {
    // Removido indicador de Extensão Ativa/Inativa conforme solicitado
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('show'); }, 100);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => { if (container.contains(toast)) container.removeChild(toast); }, 300); }, 3000);
}

document.addEventListener('visibilitychange', async function() {
    if (!document.hidden) {
        loadSettings();
    }
});