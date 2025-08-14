# Auto-Summarizer - Extensão do Chrome

Uma extensão inteligente para Google Chrome que gera automaticamente resumos de artigos e PDFs usando IA.

## 🚀 Funcionalidades

- **Resumo Automático**: Detecta automaticamente artigos longos e PDFs, gerando resumos instantâneos
- **Painel Lateral**: Interface elegante e não-intrusiva que aparece no lado direito da tela
- **Integração com Gemini AI**: Utiliza a API do Google Gemini para gerar resumos de alta qualidade
- **Suporte a PDFs**: Extrai texto de documentos PDF e gera resumos
- **Configurações Personalizáveis**: 
  - Ativar/desativar resumo automático
  - Escolher idioma (Português/Inglês)
  - Ajustar nível de detalhe (Breve/Médio/Detalhado)
- **Atalho de Teclado**: `Ctrl+Shift+S` para gerar resumos manualmente
- **Design Responsivo**: Interface adaptável com suporte a modo claro/escuro

## 📦 Instalação

### Pré-requisitos
- Google Chrome (versão 88 ou superior)
- Chave da API do Google Gemini (já incluída na extensão)

### Passos para Instalação

1. **Baixar os Arquivos**
   - Faça download de todos os arquivos da extensão
   - Certifique-se de que todos os arquivos estão em uma pasta chamada `chrome-extension`

2. **Abrir o Chrome**
   - Abra o Google Chrome
   - Digite `chrome://extensions/` na barra de endereços

3. **Ativar Modo Desenvolvedor**
   - No canto superior direito, ative o "Modo do desenvolvedor"

4. **Carregar Extensão**
   - Clique em "Carregar extensão sem compactação"
   - Selecione a pasta `chrome-extension` que contém todos os arquivos
   - A extensão será instalada e aparecerá na lista

5. **Fixar Extensão (Opcional)**
   - Clique no ícone de extensões na barra do Chrome (quebra-cabeça)
   - Encontre "Auto-Summarizer" e clique no ícone de pin para fixar

## 🎯 Como Usar

### Resumo Automático
1. Navegue para qualquer artigo online ou abra um PDF
2. A extensão detectará automaticamente conteúdo longo (mais de 300 palavras)
3. Um painel lateral aparecerá com o resumo gerado

### Resumo Manual
1. Pressione `Ctrl+Shift+S` em qualquer página
2. Ou clique no ícone da extensão e depois em "Gerar Resumo Agora"

### Configurações
1. Clique no ícone da extensão na barra do Chrome
2. Ajuste as configurações conforme necessário:
   - **Resumo Automático**: Liga/desliga a geração automática
   - **Idioma**: Escolha entre Português e Inglês
   - **Nível de Detalhe**: Selecione Breve, Médio ou Detalhado

## 🛠️ Estrutura dos Arquivos

```
chrome-extension/
├── manifest.json          # Configuração principal da extensão
├── background.js          # Script de background (coordenação)
├── content.js            # Script de conteúdo (extração de texto)
├── popup.html            # Interface do popup de configurações
├── popup.js              # Lógica do popup
├── popup.css             # Estilos do popup
├── sidepanel.css         # Estilos do painel lateral
└── README.md             # Este arquivo
```

## 🔧 Funcionalidades Técnicas

- **Manifest V3**: Utiliza a versão mais recente do sistema de extensões do Chrome
- **Extração Inteligente**: Detecta automaticamente áreas de conteúdo principal em páginas web
- **Suporte a PDF**: Integração com PDF.js para extração de texto de documentos PDF
- **API Gemini**: Utiliza o Google Gemini Pro para geração de resumos de alta qualidade
- **Armazenamento Local**: Salva configurações usando chrome.storage
- **Interface Responsiva**: Design adaptável com animações suaves

## 🎨 Design

- **Painel Lateral**: Ocupa máximo 30% da largura da tela
- **Modo Escuro**: Detecta automaticamente as preferências do sistema
- **Animações**: Transições suaves para melhor experiência do usuário
- **Acessibilidade**: Interface otimizada para todos os usuários

## 🔒 Privacidade e Segurança

- A extensão apenas processa texto da página ativa quando solicitado
- Dados não são armazenados em servidores externos
- Comunicação segura com a API do Gemini via HTTPS
- Permissões mínimas necessárias para funcionamento

## 🚨 Solução de Problemas

### Extensão não funciona
- Verifique se o "Modo desenvolvedor" está ativado
- Certifique-se de que todos os arquivos estão presentes
- Recarregue a extensão em `chrome://extensions/`

### Resumos não são gerados
- Teste a conexão da API no popup da extensão
- Verifique se a página tem conteúdo textual suficiente (>300 palavras)
- Certifique-se de que a extensão está ativada nas configurações

### Painel não aparece
- Verifique se existem outros elementos sobrepondo o painel
- Teste com o atalho `Ctrl+Shift+S`
- Recarregue a página e tente novamente

## 📝 Notas de Desenvolvimento

- A extensão foi desenvolvida seguindo as melhores práticas do Manifest V3
- Código comentado para facilitar manutenção e modificações futuras
- Interface moderna usando CSS3 e animações suaves
- Suporte completo para diferentes tipos de conteúdo web

## 🆕 Versão Atual: 1.0.0

Primeira versão estável com todas as funcionalidades principais implementadas.

---

**Desenvolvido com 💙 usando Gemini AI**