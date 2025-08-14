// JavaScript para a página de histórico
let allHistory = [];
let filteredHistory = [];

document.addEventListener('DOMContentLoaded', function() {
    loadHistory();
    setupEventListeners();
});

// Configurar event listeners
function setupEventListeners() {
    // Busca
    document.getElementById('searchInput').addEventListener('input', function() {
        filterHistory();
    });
    
    // Filtros
    document.getElementById('filterTime').addEventListener('change', function() {
        filterHistory();
    });
    
    document.getElementById('sortBy').addEventListener('change', function() {
        filterHistory();
    });
    
    // Botões do header
    document.getElementById('clearHistory').addEventListener('click', function() {
        showConfirmModal();
    });
    
    document.getElementById('exportHistory').addEventListener('click', function() {
        exportHistory();
    });
    
    // Modal de confirmação
    document.getElementById('confirmClear').addEventListener('click', function() {
        clearHistory();
    });
    
    document.getElementById('cancelClear').addEventListener('click', function() {
        hideConfirmModal();
    });
}

// Carregar histórico
function loadHistory() {
    chrome.runtime.sendMessage({ action: "getHistory" }, function(response) {
        if (chrome.runtime.lastError) {
            console.error('Erro ao carregar histórico:', chrome.runtime.lastError);
            showEmptyState();
            return;
        }
        
        if (response && response.history) {
            allHistory = response.history;
            filteredHistory = [...allHistory];
            renderHistory();
        } else {
            showEmptyState();
        }
    });
}

// Filtrar histórico
function filterHistory() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const timeFilter = document.getElementById('filterTime').value;
    const sortBy = document.getElementById('sortBy').value;
    
    // Filtrar por busca
    let filtered = allHistory.filter(item => {
        return item.title.toLowerCase().includes(searchTerm) ||
               item.url.toLowerCase().includes(searchTerm) ||
               item.summary.toLowerCase().includes(searchTerm);
    });
    
    // Filtrar por tempo
    if (timeFilter !== 'all') {
        const now = new Date();
        const cutoff = new Date();
        
        switch (timeFilter) {
            case 'today':
                cutoff.setHours(0, 0, 0, 0);
                break;
            case 'week':
                cutoff.setDate(now.getDate() - 7);
                break;
            case 'month':
                cutoff.setMonth(now.getMonth() - 1);
                break;
        }
        
        filtered = filtered.filter(item => new Date(item.timestamp) >= cutoff);
    }
    
    // Ordenar
    switch (sortBy) {
        case 'newest':
            filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            break;
        case 'oldest':
            filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            break;
        case 'title':
            filtered.sort((a, b) => a.title.localeCompare(b.title));
            break;
    }
    
    filteredHistory = filtered;
    renderHistory();
}

// Renderizar histórico
function renderHistory() {
    const historyList = document.getElementById('historyList');
    const emptyState = document.getElementById('emptyState');
    
    if (filteredHistory.length === 0) {
        historyList.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    emptyState.style.display = 'none';
    historyList.style.display = 'flex';
    
    historyList.innerHTML = filteredHistory.map(item => createHistoryItemHTML(item)).join('');
    
    // Adicionar event listeners para os itens
    document.querySelectorAll('.history-item').forEach((item, index) => {
        item.addEventListener('click', function(e) {
            if (e.target.classList.contains('action-btn')) return;
            
            // Abrir URL original
            const historyItem = filteredHistory[index];
            if (historyItem.url && historyItem.url !== 'URL desconhecida') {
                chrome.tabs.create({ url: historyItem.url });
            }
        });
    });
    
    // Event listeners para botões de ação
    document.querySelectorAll('.copy-btn').forEach((btn, index) => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            copyToClipboard(filteredHistory[index].summary);
        });
    });
}

// Criar HTML para item do histórico
function createHistoryItemHTML(item) {
    const date = new Date(item.timestamp);
    const timeAgo = formatTimeAgo(date);
    const favicon = item.favicon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
    
    return `
        <div class="history-item">
            <div class="item-header">
                <img src="${favicon}" alt="" class="item-favicon" onerror="this.style.display='none'">
                <h3 class="item-title">${item.title}</h3>
            </div>
            
            <div class="item-meta">
                <div class="meta-item">
                    <span>🕒</span>
                    <span>${timeAgo}</span>
                </div>
                <div class="meta-item">
                    <span>📝</span>
                    <span>${item.wordCount} palavras</span>
                </div>
                <div class="meta-item">
                    <span>📅</span>
                    <span>${date.toLocaleDateString('pt-BR')}</span>
                </div>
            </div>
            
            ${item.url !== 'URL desconhecida' ? `<a href="${item.url}" class="item-url" target="_blank">${item.url}</a>` : ''}
            
            <div class="item-summary">
                ${item.summary}
            </div>
            
            <div class="item-actions">
                <button class="action-btn copy-btn">📋 Copiar</button>
                <button class="action-btn" onclick="shareItem('${item.id}')">🔗 Compartilhar</button>
            </div>
        </div>
    `;
}

// Formatar tempo relativo
function formatTimeAgo(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) return 'Agora mesmo';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min atrás`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} h atrás`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} dias atrás`;
    
    return date.toLocaleDateString('pt-BR');
}

// Copiar para clipboard
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Resumo copiado para a área de transferência!', 'success');
    }).catch(() => {
        showToast('Erro ao copiar', 'error');
    });
}

// Exportar histórico
function exportHistory() {
    const dataStr = JSON.stringify(allHistory, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `auto-summarizer-history-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('Histórico exportado com sucesso!', 'success');
}

// Mostrar modal de confirmação
function showConfirmModal() {
    document.getElementById('confirmModal').style.display = 'flex';
}

// Esconder modal de confirmação
function hideConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
}

// Limpar histórico
function clearHistory() {
    chrome.runtime.sendMessage({ action: "clearHistory" }, function(response) {
        if (chrome.runtime.lastError) {
            console.error('Erro ao limpar histórico:', chrome.runtime.lastError);
            showToast('Erro ao limpar histórico', 'error');
            return;
        }
        
        if (response && response.success) {
            allHistory = [];
            filteredHistory = [];
            showEmptyState();
            showToast('Histórico limpo com sucesso!', 'success');
        }
    });
    
    hideConfirmModal();
}

// Mostrar estado vazio
function showEmptyState() {
    document.getElementById('historyList').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
}

// Mostrar toast
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (container.contains(toast)) {
                container.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// Compartilhar item (placeholder)
function shareItem(id) {
    const item = allHistory.find(h => h.id == id);
    if (item) {
        const shareText = `${item.title}\n\nResumo: ${item.summary}\n\nFonte: ${item.url}`;
        
        if (navigator.share) {
            navigator.share({
                title: item.title,
                text: shareText,
                url: item.url
            });
        } else {
            copyToClipboard(shareText);
            showToast('Link copiado para compartilhar!', 'success');
        }
    }
}