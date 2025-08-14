# 📋 INSTRUÇÕES DE INSTALAÇÃO - Auto-Summarizer (VERSÃO CORRIGIDA)

## 🔧 Correções Implementadas

✅ **API Gemini atualizada** - Endpoint corrigido para `gemini-1.5-flash`  
✅ **Comunicação entre scripts melhorada** - Melhor tratamento de erros  
✅ **Logs de debug adicionados** - Para facilitar resolução de problemas  
✅ **Validação de conteúdo aprimorada** - Extração mais robusta de texto  

---

## 📦 Instalação Passo a Passo

### 1. Preparar os Arquivos
- Certifique-se de que todos os arquivos estão na pasta `/app/chrome-extension/`
- **IMPORTANTE**: Use os arquivos atualizados (versão corrigida)

### 2. Instalar no Chrome
1. Abra o Chrome e vá para `chrome://extensions/`
2. **Ative o "Modo do desenvolvedor"** (canto superior direito)
3. Clique em **"Carregar extensão sem compactação"**
4. Selecione a pasta `/app/chrome-extension/` completa
5. A extensão deve aparecer sem erros

### 3. Verificar Instalação
- ✅ Status deve mostrar "Ativada" em verde
- ✅ Não deve haver erros vermelhos
- ✅ Ícone da extensão aparece na barra

## 🧪 Testes Pós-Instalação

### Teste 1: Conexão API
1. **Clique no ícone da extensão**
2. Clique em **"🔗 Testar Conexão API"**
3. **RESULTADO ESPERADO**: "✅ Conexão OK! API funcionando"

### Teste 2: Resumo Manual
1. Abra o arquivo **`teste.html`** no Chrome (arrastar para o navegador)
2. **Pressione `Ctrl+Shift+S`** ou clique no ícone da extensão → "Gerar Resumo Agora"
3. **RESULTADO ESPERADO**: Painel lateral aparece com resumo do texto

### Teste 3: Resumo Automático
1. Com resumo automático ativado (padrão)
2. Navegue para **Wikipedia** ou site de notícias com artigo longo
3. **RESULTADO ESPERADO**: Painel aparece automaticamente

## 🔍 Solução de Problemas

### ❌ Problema: "Erro na API: 404"
**SOLUÇÃO APLICADA**:
- ✅ Endpoint atualizado para `gemini-1.5-flash`
- ✅ Safety settings adicionados
- ✅ Melhor tratamento de erro HTTP

### ❌ Problema: "Erro ao comunicar com a página"
**SOLUÇÕES APLICADAS**:
- ✅ Melhor sincronização entre scripts
- ✅ Verificação de `chrome.runtime.lastError`
- ✅ Logs de debug adicionados
- ✅ Timeout aumentado para 2 segundos na inicialização

### 🛠️ Debug (Se ainda houver problemas)

#### Verificar Console do Background:
1. Vá para `chrome://extensions/`
2. Encontre "Auto-Summarizer"
3. Clique em **"service worker"** ou **"background page"**
4. Abra o **Console** para ver logs

#### Verificar Console da Página:
1. Na página onde está testando
2. Pressione **F12**
3. Vá para aba **Console**
4. Procure por mensagens da extensão

#### Logs Esperados:
```
Fazendo chamada para API Gemini...
Resposta da API: 200
Dados recebidos: [objeto com resumo]
```

## 🎯 URLs de Teste Recomendadas

### Sites que Funcionam Bem:
- **Wikipedia**: `https://pt.wikipedia.org/wiki/Intelig%C3%AAncia_artificial`
- **G1 Notícias**: Qualquer artigo longo
- **Medium**: Artigos técnicos
- **Blog posts**: Com mais de 500 palavras

### Teste com PDF:
- Abra qualquer PDF no Chrome
- A extensão deve extrair texto automaticamente

## ⚙️ Configurações Recomendadas

### Primeira Configuração:
1. **Resumo Automático**: ✅ Ativado
2. **Idioma**: Português
3. **Nível de Detalhe**: Médio

### Para Debug/Teste:
- Abra **DevTools** (F12) para ver logs
- Use **`teste.html`** incluído na extensão
- Teste tanto manual quanto automático

## 📞 Se Ainda Houver Problemas

### Passos de Diagnóstico:

1. **Recarregar Extensão**:
   - Vá para `chrome://extensions/`
   - Clique no ícone de **"Recarregar"** na extensão

2. **Verificar Permissões**:
   - A extensão deve ter acesso a "todas as abas"
   - Deve mostrar permissões para `<all_urls>`

3. **Teste em Aba Anônima**:
   - Abra janela anônima
   - Ative a extensão para modo anônimo
   - Teste novamente

4. **Limpar Cache**:
   - `chrome://extensions/`
   - Remover extensão
   - Adicionar novamente

### Informações para Debug:
- **Versão do Chrome**: Verifique se é 88+
- **Sistema Operacional**: Windows/Mac/Linux
- **Console Errors**: Copie mensagens de erro exatas
- **URL de Teste**: Qual site estava usando

## 🎉 Funcionalidades Disponíveis Após Instalação

### ⚡ Automático:
- Detecta artigos longos (>300 palavras)
- Gera resumo sem intervenção
- Aparece em painel lateral elegante

### 🎮 Manual:
- **`Ctrl+Shift+S`**: Atalho universal
- **Botão no popup**: Gerar resumo agora
- **Configurações**: Personalizar comportamento

### 📱 Interface:
- **Painel lateral**: Máximo 30% da tela
- **Modo escuro/claro**: Automático
- **Animações suaves**: Experiência premium
- **Copiar texto**: Um clique para copiar resumo

---

## ✅ Checklist Final

- [ ] Chrome atualizado (versão 88+)
- [ ] Extensão instalada sem erros
- [ ] Modo desenvolvedor ativado
- [ ] Teste de API com sucesso ✅
- [ ] Teste manual funcionando (Ctrl+Shift+S)
- [ ] Teste automático funcionando
- [ ] Console sem erros críticos

**🎯 Se todos os itens estão ✅, a extensão está funcionando perfeitamente!**

---

*Versão 1.1 - Problemas Corrigidos - Janeiro 2025*