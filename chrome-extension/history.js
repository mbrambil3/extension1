// JavaScript para a página de histórico
let allHistory = [];
let filteredHistory = [];

document.addEventListener('DOMContentLoaded', function() {
    loadHistory();
    setupEventListeners();
});

// Utilidades de formatação (mesma lógica do content.js)
function escapeHtml(s) {
    return (s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatStructuredSummary(text) {
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
        if (current) {
            current.desc = (current.desc ? current.desc + ' ' : '') + line;
        }
    }
    if (current) items.push(current);

    if (items.length === 0) {
        return '<div class="summary-plain">' + escapeHtml(text).replace(/\n/g, '<br>') + '</div>';
    }

    let html = '<ol class="summary-list">';
    for (const it of items) {
        html += '<li><span class="summary-topic">' + escapeHtml(it.title) + '</span>';
        if (it.desc) html += ': ' + escapeHtml(it.desc);
        if (it.subs && it.subs.length) {
            html += '<ul class="summary-sublist">';
            for (const s of it.subs) html += '<li>' + escapeHtml(s) + '</li>';
            html += '</ul>';
        }
        html += '</li>';
    }
    html += '</ol>';
    return html;
}

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
    const isPdf = item.isPdf === true || item.url === 'arquivo-importado';
    const pdfIconHtml = '<span class="item-favicon" style="width:20px;height:20px;display:inline-block;line-height:0;">'
        + '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#ef4444">'
        + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2l4 4h-4V4zM8 13h2.5a1.5 1.5 0 0 0 0-3H8v3zm0 1v3H7v-7h3.5a2.5 2.5 0 1 1 0 5H8zm7-1h-2v4h-1v-7h3a1.5 1.5 0 1 1 0 3zm-2-1h2a.5.5 0 1 0 0-1h-2v1z"/>'
        + '</svg>'
        + '</span>';
    const faviconUrl = item.favicon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
    const siteIconHtml = '<img src="' + faviconUrl + '" alt="Favicon" class="item-favicon" onerror="this.style.display=\'none\'">';
    const formatted = formatStructuredSummary(item.summary);
    
    return `
        <div class="history-item">
            <div class="item-header">
                ${isPdf ? pdfIconHtml : siteIconHtml}
                <h3 class="item-title">${item.title}</h3>
            </div>
            
            <div class="item-meta">
                <div class="meta-item">
                    <span>🎭</span>
                    <span>${escapeHtml(item.persona || 'assertivo')}</span>
                </div>
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
                ${formatted}
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