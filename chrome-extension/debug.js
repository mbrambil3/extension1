console.log('=== AUTO-SUMMARIZER DEBUG ===');

// Teste da API Gemini diretamente
async function testGeminiAPI() {
    const API_KEY = 'AIzaSyCGqaKkd1NKGfo9aygrx92ecIjy8nqlk0c';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
    
    const testText = 'Este é um teste da API do Gemini. Por favor, resuma este texto de forma breve e concisa em português.';
    
    try {
        console.log('Fazendo chamada para:', endpoint);
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Crie um resumo breve do seguinte texto em português: ${testText}`
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1024,
                },
                safetySettings: [
                    {
                        category: "HARM_CATEGORY_HARASSMENT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    }
                ]
            })
        });
        
        console.log('Status da resposta:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Erro da API:', errorText);
            return;
        }
        
        const data = await response.json();
        console.log('Dados recebidos:', data);
        
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
            console.log('✅ SUCESSO! Resumo gerado:', data.candidates[0].content.parts[0].text);
        } else {
            console.log('❌ Estrutura de resposta inesperada');
        }
        
    } catch (error) {
        console.error('❌ Erro na requisição:', error);
    }
}

// Executar teste se estivermos no contexto do navegador
if (typeof window !== 'undefined') {
    console.log('Teste pode ser executado no console com: testGeminiAPI()');
    window.testGeminiAPI = testGeminiAPI;
}

// Instruções de uso
console.log(`
=== INSTRUÇÕES DE DEBUG ===

1. Para testar no console do navegador:
   testGeminiAPI()

2. Para testar na extensão:
   - Abra chrome://extensions/
   - Clique em "service worker" na Auto-Summarizer
   - Cole este código no console

3. Para verificar logs da extensão:
   - F12 na página onde está testando
   - Verifique se aparecem mensagens da extensão

===========================
`);