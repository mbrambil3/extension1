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

const CHECKOUT_URL = 'https://lastlink.com/p/C55E28191/checkout-payment';
const WHATSAPP_LINK = 'https://wa.me/message/TUOHH5MFFZQSL1';
const BACKEND_BASE = 'https://pdf-reader-plus.preview.emergentagent.com';
const CLAIM_URL = BACKEND_BASE + '/api/premium/claim'; // não usado mais

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
    const subscribeBtn = document.getElementById('subscribeBtn');
    const waBtn = document.getElementById('whatsappKeyBtn');
    if (!applyBtn || !keyInput || !hint) return;

    if (subscribeBtn) { subscribeBtn.classList.toggle('hidden', !!isPremium); }
    if (waBtn) { waBtn.classList.toggle('hidden', !!isPremium); }
    try {
        const descSubscribe = document.getElementById('descSubscribe');
        const descWhats = document.getElementById('descWhats');
        const sep1 = document.getElementById('sep1');
        const sep2 = document.getElementById('sep2');
        [descSubscribe, descWhats, sep1, sep2].forEach(el => { if (el) el.style.display = isPremium ? 'none' : ''; });
    } catch (e) {}

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

function isValidEmail(email) {
    const s = String(email || '').trim();
    if (!s || s.length < 5) return false;
    return /.+@.+\..+/.test(s);
}

function setupEventListeners() {
    document.getElementById('autoSummary').addEventListener('change', saveSettings);
    document.getElementById('language').addEventListener('change', saveSettings);
    document.getElementById('detailLevel').addEventListener('change', saveSettings);
    document.getElementById('openrouterKey').addEventListener('change', saveSettings);

    document.getElementById('persona').addEventListener('input', () => {
        clearTimeout(personaDebounceTimer);
        personaDebounceTimer = setTimeout(() => { saveSettingsSilent(); }, 500);
    });

    const subscribeBtn = document.getElementById('subscribeBtn');
    if (subscribeBtn) {
        subscribeBtn.addEventListener('click', () => {
            try { chrome.tabs.create({ url: CHECKOUT_URL }); } catch (e) { window.open(CHECKOUT_URL, '_blank'); }
        });
    }

    const waBtn = document.getElementById('whatsappKeyBtn');
    if (waBtn) {
        waBtn.addEventListener('click', () => {
            try { chrome.tabs.create({ url: WHATSAPP_LINK }); } catch (e) { window.open(WHATSAPP_LINK, '_blank'); }
        });
    }

    document.getElementById('applyKeyBtn').addEventListener('click', async () => {
        const key = (document.getElementById('subscriptionKey').value || '').trim();
        if (!key) { showToast('Informe a KEY de ASSINATURA', 'warning'); return; }
        chrome.runtime.sendMessage({ action: 'applySubscriptionKey', key }, async (resp) => {
            if (!resp || !resp.success) { showToast(resp?.error || 'Falha ao aplicar KEY', 'error'); return; }
            const quota = await loadQuotaStatus();
            renderPlanStatus(quota);
            updatePremiumUI(quota);
            showToast(quota.plan === 'premium_unlimited' ? 'Premium Ilimitado ativado!' : 'Premium ativado!', 'success');
            try { document.getElementById('subscriptionKey').value = ''; } catch (e) {}
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

// Inicia resumo via content script na aba ativa
function generateSummaryNow() {
    const btn = document.getElementById('generateNow');
    const stopBtn = document.getElementById('stopNow');
    try { btn.classList.add('loading'); btn.textContent = 'Gerando...'; if (stopBtn) stopBtn.style.display = 'inline-flex'; } catch (e) {}
    try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab || !tab.id) {
                showToast('Nenhuma aba ativa encontrada', 'warning');
                try { if (stopBtn) stopBtn.style.display = 'none'; btn.classList.remove('loading'); btn.textContent = '🎯 Gerar Resumo Agora'; } catch (e) {}
                return;
            }
            chrome.tabs.sendMessage(tab.id, { action: 'generateSummary', manual: true }, (response) => {
                if (chrome.runtime.lastError) {
                    showToast('Erro: ' + chrome.runtime.lastError.message, 'error');
                    try { if (stopBtn) stopBtn.style.display = 'none'; btn.classList.remove('loading'); btn.textContent = '🎯 Gerar Resumo Agora'; } catch (e) {}
                    return;
                }
                if (response && response.started) {
                    showToast('Gerando resumo...', 'success');
                    try { btn.classList.remove('loading'); btn.textContent = '🎯 Gerar Resumo Agora'; } catch (e) {}
                } else {
                    const msg = (response && response.errorMessage) ? response.errorMessage : 'Não foi possível iniciar a geração';
                    showToast(msg, 'warning');
                    try { if (stopBtn) stopBtn.style.display = 'none'; btn.classList.remove('loading'); btn.textContent = '🎯 Gerar Resumo Agora'; } catch (e) {}
                }
            });
        });
    } catch (e) {
        showToast('Falha ao iniciar: ' + (e && e.message ? e.message : e), 'error');
        try { if (stopBtn) stopBtn.style.display = 'none'; btn.classList.remove('loading'); btn.textContent = '🎯 Gerar Resumo Agora'; } catch (e2) {}
    }
}

function openHistoryWindow() {
    try {
        const url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
          ? chrome.runtime.getURL('history.html')
          : 'history.html';
        try { chrome.tabs.create({ url }); }
        catch (e) { window.open(url, '_blank'); }
    } catch (eOuter) {
        try { window.open('history.html', '_blank'); }
        catch (e2) { showToast('Não foi possível abrir o histórico', 'error'); }
    }
}

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

// ... resto do arquivo inalterado