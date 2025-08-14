// JavaScript para o popup da extensão
document.addEventListener('DOMContentLoaded', function() {
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
    
    // Botão para testar conexão API
    document.getElementById('testConnection').addEventListener('click', function() {
        testAPIConnection();
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
        isActive: true,
        settings: settings
    }, (response) => {
        if (response && response.success) {
            showToast('Configurações salvas!', 'success');
        } else {
            showToast('Erro ao salvar configurações', 'error');
        }
    });
}

// Gerar resumo manualmente
function generateSummaryNow() {
    const button = document.getElementById('generateNow');
    button.classList.add('loading');
    button.textContent = 'Gerando...';
    
    // Enviar mensagem para a aba ativa
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "generateSummary",
                manual: true
            }, function(response) {
                button.classList.remove('loading');
                button.textContent = '🎯 Gerar Resumo Agora';
                
                if (response && response.received) {
                    showToast('Resumo sendo gerado...', 'success');
                    // Fechar popup após iniciar o processo
                    setTimeout(() => window.close(), 1000);
                } else {
                    showToast('Erro ao comunicar com a página', 'error');
                }
            });
        } else {
            button.classList.remove('loading');
            button.textContent = '🎯 Gerar Resumo Agora';
            showToast('Nenhuma aba ativa encontrada', 'error');
        }
    });
}

// Testar conexão com a API
function testAPIConnection() {
    const button = document.getElementById('testConnection');
    button.classList.add('loading');
    button.textContent = 'Testando...';
    
    // Texto de teste simples
    const testText = 'Este é um teste de conexão com a API do Gemini para verificar se a extensão Auto-Summarizer está funcionando corretamente.';
    
    chrome.runtime.sendMessage({
        action: "generateSummary",
        text: testText
    }, function(response) {
        button.classList.remove('loading');
        button.textContent = '🔗 Testar Conexão API';
        
        if (response && response.success) {
            showToast('Conexão OK! API funcionando', 'success');
        } else {
            showToast('Erro na conexão: ' + (response?.error || 'Desconhecido'), 'error');
        }
    });
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
    
    // Animar entrada
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    // Remover após 3 segundos
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (container.contains(toast)) {
                container.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// Capturar erros de runtime do Chrome
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
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