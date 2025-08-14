# 📋 INSTRUÇÕES DE INSTALAÇÃO - Auto-Summarizer

## 🎯 O que é a Auto-Summarizer?

A Auto-Summarizer é uma extensão inteligente para Google Chrome que gera automaticamente resumos de artigos e PDFs usando a API do Google Gemini. A extensão detecta quando você está lendo um texto longo e cria um resumo conciso que aparece em um painel lateral elegante.

## 📦 Instalação Passo a Passo

### 1. Preparar os Arquivos
- Certifique-se de que todos os arquivos estão na pasta `/app/chrome-extension/`
- Verifique se os seguintes arquivos estão presentes:
  - `manifest.json`
  - `background.js`
  - `content.js`
  - `popup.html`
  - `popup.js`
  - `popup.css`
  - `sidepanel.css`

### 2. Abrir o Google Chrome
- Abra o navegador Google Chrome
- Na barra de endereços, digite: `chrome://extensions/`
- Pressione Enter

### 3. Ativar o Modo Desenvolvedor
- No canto superior direito da página, você verá um botão "Modo do desenvolvedor"
- **Clique para ATIVAR** o "Modo do desenvolvedor"
- Novos botões aparecerão na página

### 4. Carregar a Extensão
- Clique no botão **"Carregar extensão sem compactação"**
- Navegue até a pasta `/app/chrome-extension/` no seu computador
- **Selecione a pasta inteira** (não os arquivos individuais)
- Clique em "Selecionar pasta" ou "OK"

### 5. Verificar a Instalação
- A extensão "Auto-Summarizer" deve aparecer na lista de extensões
- Você deve ver o status "Ativada" em verde
- Se houver erros, eles aparecerão em vermelho

### 6. Fixar a Extensão (Recomendado)
- Clique no ícone de **quebra-cabeça** na barra do Chrome (ícone de extensões)
- Encontre "Auto-Summarizer" na lista
- Clique no ícone de **alfinete** para fixar a extensão na barra

## 🚀 Primeiros Passos

### Teste Inicial
1. **Clique no ícone da extensão** na barra do Chrome
2. Clique em **"Testar Conexão API"** para verificar se tudo funciona
3. Se o teste for bem-sucedido, você verá "Conexão OK!"

### Configurações Básicas
1. **Resumo Automático**: Deixe ativado para resumos automáticos
2. **Idioma**: Escolha "Português" para resumos em português
3. **Nível de Detalhe**: Recomendo começar com "Médio"

### Primeiro Uso
1. Navegue para qualquer artigo online (ex: Wikipedia, notícias)
2. A extensão detectará automaticamente textos longos
3. Um painel aparecerá no lado direito com o resumo
4. Use `Ctrl+Shift+S` para gerar resumos manualmente

## 🔧 Funcionalidades Principais

### ⚡ Resumo Automático
- Detecta automaticamente artigos e textos longos (>300 palavras)
- Gera resumos instantâneos sem intervenção
- Funciona em qualquer site com conteúdo textual

### 📄 Suporte a PDFs
- Extrai texto de documentos PDF automaticamente
- Gera resumos de documentos acadêmicos e artigos
- Funciona com PDFs abertos no navegador

### 🎨 Interface Elegante
- Painel lateral que ocupa máximo 30% da tela
- Design moderno com suporte a modo claro/escuro
- Animações suaves e não-intrusivas

### ⌨️ Atalhos de Teclado
- **Ctrl+Shift+S**: Gerar resumo manualmente
- Funciona em qualquer página

### ⚙️ Configurações Personalizáveis
- **Ligar/Desligar**: Controle total sobre quando usar
- **Idioma**: Português ou Inglês
- **Detalhe**: Breve, Médio ou Detalhado

## 🛠️ Solução de Problemas

### ❌ Erro: "Não foi possível carregar a extensão"
**Solução:**
- Verifique se todos os arquivos estão na pasta
- Certifique-se que o `manifest.json` está válido
- Reative o "Modo desenvolvedor"

### ❌ Extensão instalada mas não funciona
**Solução:**
- Clique em "Recarregar" na página de extensões
- Feche e abra o Chrome novamente
- Teste a conexão API no popup da extensão

### ❌ Resumos não são gerados
**Soluções:**
1. Verifique se o site tem texto suficiente (>300 palavras)
2. Teste com `Ctrl+Shift+S` manualmente
3. Verifique se a extensão está ativada nas configurações
4. Teste a conexão API no popup

### ❌ Painel lateral não aparece
**Soluções:**
- Verifique se não há outros elementos bloqueando
- Use o atalho `Ctrl+Shift+S`
- Recarregue a página e tente novamente
- Verifique as configurações de zoom da página

## 📝 Dicas de Uso

### 📚 Melhores Sites para Testar
- **Wikipedia**: Artigos longos e bem estruturados
- **Sites de notícias**: Artigos jornalísticos
- **Blogs técnicos**: Conteúdo especializado
- **PDFs acadêmicos**: Pesquisas e artigos científicos

### 🎯 Como Obter Melhores Resumos
1. **Use textos bem estruturados** com parágrafos claros
2. **Textos mais longos** geram resumos mais precisos
3. **Escolha o nível de detalhe** adequado ao conteúdo
4. **Configure o idioma correto** para melhores resultados

### ⚡ Otimização de Uso
- **Desative resumo automático** se preferir controle manual
- **Use atalhos de teclado** para workflow mais rápido
- **Teste diferentes níveis** de detalhe conforme necessário

## 🔒 Privacidade e Dados

- ✅ **Dados não são armazenados** em servidores externos
- ✅ **Processamento local** na extensão
- ✅ **Comunicação segura** com API Gemini via HTTPS
- ✅ **Permissões mínimas** necessárias
- ✅ **Sem rastreamento** de atividade do usuário

## 📞 Suporte

Se você encontrar problemas ou tiver dúvidas:

1. **Verifique primeiro** esta documentação
2. **Teste a conexão API** no popup da extensão  
3. **Recarregue a extensão** se necessário
4. **Reinicie o Chrome** como último recurso

---

## ✅ Checklist de Instalação

- [ ] Google Chrome atualizado
- [ ] Arquivos da extensão baixados
- [ ] Modo desenvolvedor ativado
- [ ] Extensão carregada sem erros
- [ ] Teste de API realizado com sucesso
- [ ] Configurações personalizadas conforme preferência
- [ ] Primeiro teste em site real realizado

**🎉 Parabéns! Sua Auto-Summarizer está pronta para uso!**

---

*Versão 1.0.0 - Desenvolvido com Gemini AI*