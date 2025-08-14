// JavaScript para o popup da extensão
document.addEventListener('DOMContentLoaded', function() {
    // Atualizar versão dinamicamente a partir do manifest
    try {
        const { version } = chrome.runtime.getManifest();
        const verEl = document.querySelector('.version');
        if (verEl && version) verEl.textContent = 'v' + version;
    } catch (e) { /* noop */ }

    loadSettings();
    setupEventListeners();
});

// Carregar configurações salvas
function loadSettings() {
    chrome.runtime.sendMessage({ action: "getSettings" }, (response) => {
        if (response) {
            // Configurar toggle de resumo automático
            document.getElementById('autoSummary').checked = response.settings.autoSummary;
            
            // Configurar idioma
            document.getElementById('language').value = response.settings.language;
            
            // Configurar nível de detalhe
            document.getElementById('detailLevel').value = response.settings.detailLevel;
            
            // Atualizar status da extensão
            updateStatusIndicator(response.isActive);
        }
    });
}

function isRestrictedUrl(url) {
    return url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:') || url.startsWith('view-source:');
}

async function injectContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        return true;
    } catch (e) {
        console.warn('Falha ao injetar content.js:', e);
        return false;
    }
}

// Configurar event listeners
function setupEventListeners() {
    // Toggle de resumo automático
    document.getElementById('autoSummary').addEventListener('change', function() {
        saveSettings();
    });
    
    // Seletor de idioma
    document.getElementById('language').addEventListener('change', function() {
        saveSettings();
    });
    
    // Seletor de nível de detalhe
    document.getElementById('detailLevel').addEventListener('change', function() {
        saveSettings();
    });
    
    // Botão para gerar resumo agora
    document.getElementById('generateNow').addEventListener('click', function() {
        generateSummaryNow();
    });
    
    // Botão para ver histórico
    document.getElementById('viewHistory').addEventListener('click', function() {
        openHistoryWindow();
    });

    // Importar PDF
    document.getElementById('pdfInput').addEventListener('change', async function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.type !== 'application/pdf') {
            showToast('Selecione um arquivo PDF', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = async function() {
            try {
                const arrayBuffer = reader.result;
                const uint8 = new Uint8Array(arrayBuffer);
                const pdfjs = window.pdfjsLib;
                if (!pdfjs) {
                    showToast('PDF.js não carregou. Recarregue a extensão.', 'error');
                    return;
                }
                try {
                    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs/pdf.worker.min.js');
                } catch (e) { /* opcional */ }
                const doc = await pdfjs.getDocument({ data: uint8, disableWorker: true }).promise;
                let fullText = '';
                const pages = Math.min(doc.numPages, 10);
                for (let i = 1; i <= pages; i++) {
                    const page = await doc.getPage(i);
                    const content = await page.getTextContent();
                    fullText += content.items.map(it => it.str).join(' ') + '\n';
                }
                fullText = (fullText || '').trim();
                if (!fullText || fullText.length < 50) {
                    showToast('Não foi possível extrair texto do PDF', 'error');
                    return;
                }
                const payload = `Arquivo: ${file.name}\n\n${fullText.substring(0, 50000)}`;
                chrome.runtime.sendMessage({ action: 'generateSummary', text: payload, source: 'pdf', fileName: file.name }, (response) => {
                    if (chrome.runtime.lastError) {
                        showToast('Erro: ' + chrome.runtime.lastError.message, 'error');
                        return;
                    }
                    if (response && response.success) {
                        showToast('PDF enviado para resumo. Abra o Histórico para acompanhar.', 'success');
                        // Não fechar automaticamente; instruir o usuário a abrir o histórico
                    } else {
                        showToast(response?.error || 'Falha ao iniciar resumo do PDF', 'error');
                    }
                });
            } catch (err) {
                console.error('Falha ao processar PDF:', err);
                showToast('Falha ao processar PDF: ' + (err?.message || err), 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

// Salvar configurações
function saveSettings() {
    const settings = {
        autoSummary: document.getElementById('autoSummary').checked,
        language: document.getElementById('language').value,
        detailLevel: document.getElementById('detailLevel').value
    };
    
    chrome.runtime.sendMessage({
        action: "updateSettings",
        isActive: document.getElementById('autoSummary').checked,
        settings: settings
    }, (response) => {
        if (response && response.success) {
            showToast('Configurações salvas!', 'success');
        } else {
            showToast('Erro ao salvar configurações', 'error');
        }
    });
}

// Gerar resumo manualmente com fallback de injeção
function generateSummaryNow() {
    const button = document.getElementById('generateNow');
    button.classList.add('loading');
    button.textContent = 'Gerando...';
    
    chrome.tabs.query({ active: true, currentWindow: true }, async function(tabs) {
        const tab = tabs[0];
        if (!tab) {
            button.classList.remove('loading');
            button.textContent = '🎯 Gerar Resumo Agora';
            showToast('Nenhuma aba ativa encontrada', 'error');
            return;
        }
        if (isRestrictedUrl(tab.url || '')) {
            button.classList.remove('loading');
            button.textContent = '🎯 Gerar Resumo Agora';
            showToast('Esta página não permite injeção de conteúdo (chrome://, etc.)', 'warning');
            return;
        }

        function sendGenerate() {
            chrome.tabs.sendMessage(tab.id, { action: 'generateSummary', manual: true }, function(response) {
                button.classList.remove('loading');
                button.textContent = '🎯 Gerar Resumo Agora';
                if (chrome.runtime.lastError) {
                    const msg = chrome.runtime.lastError.message || '';
                    if (msg.includes('Receiving end does not exist')) {
                        showToast('Tentando preparar a página, clique novamente...', 'warning');
                    } else {
                        showToast('Erro: ' + msg, 'error');
                    }
                    return;
                }
                if (response && response.received) {
                    if (response.started) {
                        showToast('Resumo sendo gerado...', 'success');
                        setTimeout(() => window.close(), 1200);
                    } else {
                        showToast(response.errorMessage || 'Conteúdo não suportado para extração direta', 'warning');
                    }
                } else {
                    showToast('A página pode não ter conteúdo suficiente', 'warning');
                }
            });
        }

        // Tenta enviar; se não houver receiver, injeta e pede para clicar de novo
        chrome.tabs.sendMessage(tab.id, { ping: true }, async function(response) {
            if (chrome.runtime.lastError || !response || !response.pong) {
                const injected = await injectContentScript(tab.id);
                if (injected) {
                    // Tenta novamente automaticamente após injeção
                    setTimeout(() => {
                        chrome.tabs.sendMessage(tab.id, { ping: true }, function(resp2) {
                            if (!chrome.runtime.lastError && resp2 && resp2.pong) {
                                sendGenerate();
                            } else {
                                showToast('Não foi possível preparar a página para resumo', 'error');
                            }
                        });
                    }, 300);
                } else {
                    showToast('Não foi possível preparar a página para resumo', 'error');
                }
                button.classList.remove('loading');
                button.textContent = '🎯 Gerar Resumo Agora';
                return;
            }
            // Receiver existe, podemos enviar
            sendGenerate();
        });
    });
}

// Abrir janela de histórico
function openHistoryWindow() {
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
}

// Atualizar indicador de status
function updateStatusIndicator(isActive) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    if (isActive) {
        statusDot.classList.remove('inactive');
        statusDot.classList.add('active');
        statusText.textContent = 'Extensão Ativa';
    } else {
        statusDot.classList.remove('active');
        statusDot.classList.add('inactive');
        statusText.textContent = 'Extensão Inativa';
    }
}

// Mostrar toast de notificação
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => { toast.classList.add('show'); }, 100);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { if (container.contains(toast)) container.removeChild(toast); }, 300);
    }, 3000);
}

// Capturar erros de runtime do Chrome
chrome.runtime.onMessage.addListener(function(message) {
    if (message.action === "showToast") {
        showToast(message.text, message.type);
    }
});

// Verificar se a extensão ainda está ativa quando o popup é aberto
document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        loadSettings(); // Recarregar configurações quando o popup volta a ficar visível
    }
});