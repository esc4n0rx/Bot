const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { Groq } = require('groq-sdk');
const axios = require('axios');
const { createCanvas } = require('canvas');
require('dotenv').config();
// --- NOVAS DEPENDÊNCIAS ---
const express = require('express');
const qrcode = require('qrcode');

class StickerBotIA {
    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ]
            }
        });

        this.groq = new Groq({
            apiKey: process.env.GROQ_API_KEY
        });

        this.systemPrompt = `Você é um assistente de IA para um bot de WhatsApp, especialista em interpretar pedidos para criar mídias e responder perguntas. Sua única função é analisar o texto do usuário e retornar um objeto JSON bem formatado.

REGRAS RÍGIDAS:
- Sua resposta DEVE SER APENAS o objeto JSON, sem nenhum texto adicional.
- Analise se o usuário quer uma FIGURINHA (com texto), uma IMAGEM (desenhada), um ÁUDIO (texto para fala), uma PIADA ou uma CONVERSA (resposta direta).
- Para figurinhas com texto, o comando é "sticker". O prompt deve ser o texto exato para a figurinha.
- Para gerar imagens complexas/desenhos, o comando é "image". O prompt deve ser a descrição da imagem.
- Para gerar áudio, o comando é "audio". O prompt deve ser o texto que será falado.
- Se o pedido for uma piada, use o comando "joke".
- Se o usuário fizer uma pergunta ou quiser conversar, use o comando "chat".
- Se não for possível determinar a intenção, use o comando "help".

Estrutura do JSON:
{
  "command": "sticker" | "image" | "audio" | "joke" | "chat" | "help",
  "prompt": "O conteúdo apropriado para cada comando"
}

Exemplos de conversão:
- Usuário: "cria uma figurinha com o texto 'bom dia grupo'" -> {"command": "sticker", "prompt": "bom dia grupo"}
- Usuário: "faz uma figurinha escrito 'a mimir'" -> {"command": "sticker", "prompt": "a mimir"}
- Usuário: "desenhe um cachorro de óculos escuros na praia" -> {"command": "image", "prompt": "um cachorro de óculos escuros na praia, estilo desenho animado"}
- Usuário: "gere uma imagem de um carro voador" -> {"command": "image", "prompt": "um carro voador em uma cidade futurista"}
- Usuário: "me conta uma piada sobre tecnologia" -> {"command": "joke", "prompt": "tecnologia"}
- Usuário: "gera um audio dizendo 'olá pessoal'" -> {"command": "audio", "prompt": "olá pessoal"}
- Usuário: "preciso que faça um audio com 'bom dia'" -> {"command": "audio", "prompt": "bom dia"}
- Usuário: "como está o tempo hoje?" -> {"command": "chat", "prompt": "como está o tempo hoje?"}
- Usuário: "qual a capital do brasil?" -> {"command": "chat", "prompt": "qual a capital do brasil?"}
- Usuário: "qual a previsão do tempo?" -> {"command": "help", "prompt": null}
`;

        this.botNumber = null;
        this.qrCodeDataUrl = null; // Para armazenar o QR code
        this.botStatus = "Iniciando..."; // Para armazenar o status do bot
        this.setupEventHandlers();
        this.startWebServer(); // Inicia o servidor web
    }
    
    // --- MÉTODO DO SERVIDOR WEB ATUALIZADO ---
    startWebServer() {
        const app = express();
        const port = process.env.PORT || 3000;

        app.get('/qrcode', (req, res) => {
            if (this.qrCodeDataUrl) {
                // Se o QR code já foi gerado, mostra a imagem
                res.send(`
                    <!DOCTYPE html>
                    <html>
                        <head>
                            <title>QR Code WhatsApp</title>
                        </head>
                        <body style="display: flex; justify-content: center; align-items: center; height: 100vh; flex-direction: column; font-family: sans-serif;">
                            <h1>Escaneie o QR Code com seu WhatsApp</h1>
                            <img src="${this.qrCodeDataUrl}" alt="QR Code">
                            <p style="margin-top: 20px;">Status: ${this.botStatus}</p>
                        </body>
                    </html>
                `);
            } else {
                // Se ainda não foi gerado, mostra uma página que se atualiza sozinha
                res.send(`
                    <!DOCTYPE html>
                    <html>
                        <head>
                            <title>Aguardando QR Code</title>
                            <meta http-equiv="refresh" content="5">
                        </head>
                        <body style="display: flex; justify-content: center; align-items: center; height: 100vh; flex-direction: column; font-family: sans-serif;">
                            <h1>Aguardando geração do QR Code...</h1>
                            <p>A página será atualizada automaticamente em 5 segundos.</p>
                             <p style="margin-top: 20px;">Status: ${this.botStatus}</p>
                        </body>
                    </html>
                `);
            }
        });
        
        app.get('/', (req, res) => {
            res.send(`Servidor do Bot de Figurinhas está rodando! Status: ${this.botStatus}. Acesse /qrcode para ver o QR Code.`);
        });

        app.listen(port, () => {
            console.log(`🚀 Servidor web rodando. Acesse a URL do seu serviço para conectar.`);
        });
    }

    setupEventHandlers() {
        this.client.on('qr', async (qr) => {
            console.log('📱 QR Code recebido! Acesse a rota /qrcode no seu navegador para escanear.');
            this.botStatus = "QR Code gerado. Escaneie para conectar.";
            this.qrCodeDataUrl = await qrcode.toDataURL(qr);
        });

        this.client.on('ready', async () => {
            console.log('✅ Bot de Figurinhas conectado com sucesso!');
            this.botNumber = this.client.info.wid.user;
            this.botStatus = `Conectado com o número ${this.botNumber}`;
            this.qrCodeDataUrl = null; // Limpa o QR code após a conexão
            console.log(`🤖 Bot rodando no número: ${this.botNumber}`);
        });

        this.client.on('message', async (message) => {
            if (message.fromMe) return;

            const messageText = message.body || '';
            const isGroup = message.from.includes('@g.us');
            const mentioned = await message.getMentions();
            const isMentioned = mentioned.some(contact => contact.id.user === this.botNumber);
            
            if ((isGroup && isMentioned) || !isGroup) {
                const commandText = messageText.replace(/@\d+/g, '').trim();
                if (commandText) {
                    console.log(`📨 Comando recebido de ${message.from}: ${commandText}`);
                    await this.processCommand(message, commandText);
                }
            }
        });
        
        this.client.on('disconnected', (reason) => {
            console.log('❌ Cliente desconectado:', reason);
            this.botStatus = `Desconectado: ${reason}. Reiniciando...`;
            this.client.initialize(); // Tenta reiniciar ao desconectar
        });
    }

    async processCommand(message, text) {
        try {
            await message.react('🤖');
            console.log('🧠 Interpretando comando com a IA...');

            const chatCompletion = await this.groq.chat.completions.create({
                messages: [
                    { role: "system", content: this.systemPrompt },
                    { role: "user", content: text }
                ],
                model: "llama3-8b-8192",
                temperature: 0,
                max_tokens: 200,
                top_p: 1,
                response_format: { type: "json_object" }
            });

            const responseContent = chatCompletion.choices[0]?.message?.content;
            if (!responseContent) throw new Error("Resposta da IA vazia.");

            const parsedResponse = JSON.parse(responseContent);
            const { command, prompt } = parsedResponse;

            console.log(`✅ Comando interpretado: ${command} | Prompt: ${prompt}`);

            switch (command) {
                case 'sticker':
                    await this.generateTextSticker(message, prompt);
                    break;
                case 'image':
                    await this.generateImageFromHF(message, prompt);
                    break;
                case 'audio':
                    await this.generateAudioFromHF(message, prompt);
                    break;
                case 'joke':
                    await this.tellJoke(message, prompt);
                    break;
                case 'chat':
                    await this.chatWithAI(message, prompt);
                    break;
                default:
                    await this.showHelp(message);
                    break;
            }
        } catch (error) {
            console.error('❌ Erro ao processar comando:', error);
            await message.reply('🤖 Ops! Algo deu errado. Tente ser mais específico, por exemplo: `cria uma figurinha com o texto "sextou"`');
        }
    }

    /**
     * Gera uma cor hexadecimal aleatória.
     * @returns {string} Uma string de cor no formato #RRGGBB.
     */
    getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    /**
     * Determina se a cor de texto deve ser preta ou branca com base na cor de fundo.
     * @param {string} bgColor - A cor de fundo em formato hexadecimal.
     * @returns {string} Retorna '#000000' (preto) ou '#FFFFFF' (branco).
     */
    getTextColorForBackground(bgColor) {
        const color = (bgColor.charAt(0) === '#') ? bgColor.substring(1, 7) : bgColor;
        const r = parseInt(color.substring(0, 2), 16); // Red
        const g = parseInt(color.substring(2, 4), 16); // Green
        const b = parseInt(color.substring(4, 6), 16); // Blue
        // Fórmula para calcular o brilho da cor
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return (brightness > 125) ? '#000000' : '#FFFFFF';
    }

    async generateTextSticker(message, text) {
        try {
            await message.react('✍️');
            await message.reply(`Criando sua figurinha com o texto: "${text}"...`);
            console.log(`🎨 Gerando figurinha via API com o texto: "${text}"`);
    
            const backgroundColor = this.getRandomColor();
            const textColor = this.getTextColorForBackground(backgroundColor);
            
            // Codifica o texto para ser usado em uma URL
            const encodedText = encodeURIComponent(text.toUpperCase());
    
            // Monta a URL da API do QuickChart com HTML e CSS
            const chartConfig = {
                width: 512,
                height: 512,
                backgroundColor: backgroundColor,
                // Usamos HTML para estilizar o texto, centralizando-o vertical e horizontalmente
                chart: `
                <div style="
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    text-align: center; 
                    width: 100%; 
                    height: 100%; 
                    font-family: Arial, sans-serif; 
                    font-weight: bold;
                    font-size: 80px; 
                    color: ${textColor}; 
                    padding: 20px;
                    line-height: 1.2;
                    ">
                    ${text.toUpperCase()}
                </div>`
            };
    
            const apiUrl = 'https://quickchart.io/chart';
            
            // Faz a requisição para a API para obter a imagem
            const response = await axios.post(apiUrl, chartConfig, {
                responseType: 'arraybuffer' // Essencial para receber a imagem como buffer
            });
    
            // Cria a mídia a partir da resposta da API
            const media = new MessageMedia('image/png', Buffer.from(response.data).toString('base64'), 'sticker.png');
    
            console.log('🚀 Enviando figurinha...');
            await message.reply(media, undefined, { 
                sendMediaAsSticker: true, 
                stickerName: 'Criado por IA 🤖', 
                stickerAuthor: 'StickerBot' 
            });
            await message.react('✅');
    
        } catch (error) {
            console.error('❌ Erro ao gerar figurinha via API:', error);
            await message.reply('🤖 Falhei em criar sua figurinha. A API externa pode estar indisponível.');
            await message.react('❌');
        }
    }

    async generateImageFromHF(message, prompt) {
        try {
            await message.react('🎨');
            await message.reply(`Gerando sua imagem: "${prompt}"...`);

            const { Client: GradioClient } = await import('@gradio/client');
            
            console.log(`⏳ Conectando ao Hugging Face para gerar: "${prompt}"`);
            const hfClient = await GradioClient.connect("black-forest-labs/FLUX.1-dev");
            const result = await hfClient.predict("/infer", {
                prompt: prompt,
                seed: Math.floor(Math.random() * 100000),
                randomize_seed: true,
                width: 1024,
                height: 1024,
                guidance_scale: 3.5,
                num_inference_steps: 20,
            });

            const imageUrl = result.data[0].url;
            if (!imageUrl) throw new Error("API do Hugging Face não retornou uma imagem.");

            console.log('✅ Imagem da API gerada, fazendo download...');
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const media = new MessageMedia('image/jpeg', Buffer.from(response.data).toString('base64'), 'image.jpg');

            console.log('🚀 Enviando imagem...');
            await message.reply(media);
            await message.react('✅');

        } catch (error) {
            console.error('❌ Erro ao gerar mídia pela API:', error);
            await message.reply('🤖 Falhei em criar sua imagem. A API externa pode estar ocupada. Tente novamente em alguns instantes.');
            await message.react('❌');
        }
    }

    async generateAudioFromHF(message, text) {
        try {
            await message.react('🎵');
            await message.reply(`Gerando seu áudio: "${text}"...`);

            const { Client: GradioClient } = await import('@gradio/client');
            
            console.log(`🎤 Conectando ao Hugging Face para gerar áudio: "${text}"`);
            const hfClient = await GradioClient.connect("NihalGazi/Text-To-Speech-Unlimited");
            
            const result = await hfClient.predict("/text_to_speech_app", {
                prompt: text,
                voice: "alloy",
                emotion: text,
                use_random_seed: true,
                specific_seed: Math.floor(Math.random() * 100000),
            });

            console.log('🔍 Resultado da API:', JSON.stringify(result, null, 2));

            // Extrair a URL do áudio da resposta
            let audioUrl = null;
            if (result.data && Array.isArray(result.data)) {
                // Tentar diferentes índices onde o áudio pode estar
                for (let i = 0; i < result.data.length; i++) {
                    const item = result.data[i];
                    if (typeof item === 'string' && (item.includes('.wav') || item.includes('.mp3') || item.includes('audio'))) {
                        audioUrl = item;
                        break;
                    } else if (item && typeof item === 'object' && item.url) {
                        audioUrl = item.url;
                        break;
                    }
                }
            }

            if (!audioUrl) {
                throw new Error("API do Hugging Face não retornou uma URL de áudio válida.");
            }

            console.log('✅ Áudio da API gerado, fazendo download...', audioUrl);
            const response = await axios.get(audioUrl, { responseType: 'arraybuffer' });
            
            // Detectar o tipo de arquivo baseado na URL ou cabeçalhos
            let mimeType = 'audio/mpeg';
            let extension = 'mp3';
            
            if (audioUrl.includes('.wav')) {
                mimeType = 'audio/wav';
                extension = 'wav';
            } else if (audioUrl.includes('.ogg')) {
                mimeType = 'audio/ogg';
                extension = 'ogg';
            }

            const media = new MessageMedia(mimeType, Buffer.from(response.data).toString('base64'), `audio.${extension}`);

            console.log('🚀 Enviando áudio...');
            await message.reply(media);
            await message.react('✅');

        } catch (error) {
            console.error('❌ Erro ao gerar áudio pela API:', error);
            await message.reply('🤖 Falhei em criar seu áudio. A API externa pode estar ocupada. Tente novamente em alguns instantes.');
            await message.react('❌');
        }
    }

    async tellJoke(message, theme) {
        await message.react('😂');
        await message.reply(`Ok, me pediram uma piada sobre "${theme}". Lá vai...`);
        const jokePrompt = `Conte uma piada curta e engraçada sobre ${theme}. Use humor brasileiro e emojis.`;
        const chatCompletion = await this.groq.chat.completions.create({
            messages: [{ role: "user", content: jokePrompt }],
            model: "llama3-8b-8192",
            temperature: 1,
            max_tokens: 150,
        });
        const joke = chatCompletion.choices[0]?.message?.content || "Meu cérebro de piadas travou! 😅";
        await message.reply(joke);
    }

    async chatWithAI(message, prompt) {
        try {
            await message.react('💬');
            console.log(`💭 Processando conversa: "${prompt}"`);
            
            const chatCompletion = await this.groq.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: "Você é um assistente amigável e útil. Responda de forma natural, concisa e em português brasileiro. Use emojis quando apropriado." 
                    },
                    { role: "user", content: prompt }
                ],
                model: "llama3-8b-8192",
                temperature: 0.7,
                max_tokens: 500,
            });

            const response = chatCompletion.choices[0]?.message?.content || "Desculpe, não consegui processar sua pergunta. 😅";
            await message.reply(response);
            await message.react('✅');

        } catch (error) {
            console.error('❌ Erro ao conversar com a IA:', error);
            await message.reply('🤖 Ops! Não consegui processar sua pergunta no momento. Tente novamente.');
            await message.react('❌');
        }
    }

    async showHelp(message) {
        const helpText = `🤖 *Olá! Sou seu assistente de figurinhas, imagens e áudios!*

Para me usar, me mencione no grupo ou mande uma mensagem no privado com um dos comandos:

1️⃣ *Para criar FIGURINHAS (com texto):*
   • "@bot faz uma figurinha com o texto 'sextou!'"
   • "@bot figurinha: 'hoje eu tô só o pó'"

2️⃣ *Para gerar IMAGENS (desenhos):*
   • "@bot desenhe um gato tocando guitarra"
   • "@bot imagem: um robô surfando em marte"

3️⃣ *Para gerar ÁUDIO (texto para fala):*
   • "@bot gera um áudio dizendo 'olá pessoal'"
   • "@bot preciso que faça um áudio com 'bom dia'"

4️⃣ *Para PIADAS:*
   • "@bot me conta uma piada"

5️⃣ *Para CONVERSAR:*
   • "@bot qual a capital do Brasil?"
   • "@bot como você está hoje?"

É só pedir que a mágica acontece! ✨`;
        await message.reply(helpText);
    }

    async start() {
        console.log('🚀 Iniciando o Bot de Figurinhas...');
        if (!process.env.GROQ_API_KEY) {
            console.error('❌ GROQ_API_KEY não encontrada no arquivo .env');
            process.exit(1);
        }
        console.log('✅ Chave da API da Groq carregada.');
        this.botStatus = "Inicializando cliente WhatsApp...";
        await this.client.initialize();
    }

    async stop() {
        console.log('🛑 Encerrando bot...');
        await this.client.destroy();
    }
}

const bot = new StickerBotIA();
bot.start().catch(error => {
    console.error("❌ Falha ao iniciar o bot:", error);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Recebido sinal de interrupção...');
    await bot.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Recebido sinal de término...');
    await bot.stop();
    process.exit(0);
});