// JavaScript para a página de histórico
let allHistory = [];
let filteredHistory = [];

document.addEventListener('DOMContentLoaded', function() {
    loadHistory();
    setupEventListeners();
    // Carregar status do plano e ajustar badge
    chrome.runtime.sendMessage({ action: 'getQuotaStatus' }, function(resp) {
        try {
            const badge = document.getElementById('planBadge');
            if (!badge) return;
            if (resp && resp.success) {
                if (resp.plan === 'premium' || resp.plan === 'premium_unlimited') { badge.textContent = 'Premium'; badge.classList.remove('free'); badge.classList.add('premium'); }
                else { badge.textContent = 'Free'; badge.classList.remove('premium'); badge.classList.add('free'); }
            } else { badge.textContent = 'Free'; badge.classList.add('free'); }
        } catch (e) {}
    });
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

// ... restante do arquivo permanece igual ...