const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { Groq } = require('groq-sdk');
const axios = require('axios');
// --- NOVA DEPENDÊNCIA ---
const { createCanvas } = require('canvas');
require('dotenv').config();

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

        this.systemPrompt = `Você é um assistente de IA para um bot de WhatsApp, especialista em interpretar pedidos para criar mídias. Sua única função é analisar o texto do usuário e retornar um objeto JSON bem formatado.

REGRAS RÍGIDAS:
- Sua resposta DEVE SER APENAS o objeto JSON, sem nenhum texto adicional.
- Analise se o usuário quer uma FIGURINHA (com texto), uma IMAGEM (desenhada) ou uma PIADA.
- Para figurinhas com texto, o comando é "sticker". O prompt deve ser o texto exato para a figurinha.
- Para gerar imagens complexas/desenhos, o comando é "image". O prompt deve ser a descrição da imagem.
- Se o pedido for uma piada, use o comando "joke".
- Se não for possível determinar a intenção, use o comando "help".

Estrutura do JSON:
{
  "command": "sticker" | "image" | "joke" | "help",
  "prompt": "O texto para a figurinha, a descrição para a imagem, ou o tema da piada."
}

Exemplos de conversão:
- Usuário: "cria uma figurinha com o texto 'bom dia grupo'" -> {"command": "sticker", "prompt": "bom dia grupo"}
- Usuário: "faz uma figurinha escrito 'a mimir'" -> {"command": "sticker", "prompt": "a mimir"}
- Usuário: "desenhe um cachorro de óculos escuros na praia" -> {"command": "image", "prompt": "um cachorro de óculos escuros na praia, estilo desenho animado"}
- Usuário: "gere uma imagem de um carro voador" -> {"command": "image", "prompt": "um carro voador em uma cidade futurista"}
- Usuário: "me conta uma piada sobre tecnologia" -> {"command": "joke", "prompt": "tecnologia"}
- Usuário: "qual a previsão do tempo?" -> {"command": "help", "prompt": null}
`;

        this.botNumber = null;
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('qr', (qr) => {
            console.log('📱 Escaneie o QR Code com seu WhatsApp:');
            qrcode.generate(qr, { small: true });
        });

        this.client.on('ready', async () => {
            console.log('✅ Bot de Figurinhas conectado com sucesso!');
            this.botNumber = this.client.info.wid.user;
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

            // --- LÓGICA ATUALIZADA ---
            switch (command) {
                case 'sticker':
                    await this.generateTextSticker(message, prompt); // Chama a função local
                    break;
                case 'image':
                    await this.generateImageFromHF(message, prompt); // Chama a função da API
                    break;
                case 'joke':
                    await this.tellJoke(message, prompt);
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

    // --- NOVO MÉTODO PARA GERAR FIGURINHAS COM TEXTO LOCALMENTE ---
    async generateTextSticker(message, text) {
        try {
            await message.react('✍️');
            await message.reply(`Criando sua figurinha com o texto: "${text}"...`);
            console.log(`🎨 Gerando figurinha localmente com o texto: "${text}"`);
            
            const canvas = createCanvas(512, 512);
            const context = canvas.getContext('2d');

            // Fundo branco
            context.fillStyle = 'white';
            context.fillRect(0, 0, 512, 512);

            // Configurações do texto
            context.fillStyle = 'black';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            
            // Lógica para ajustar o tamanho da fonte e quebrar linha
            let fontSize = 100;
            context.font = `bold ${fontSize}px Arial`;
            
            const words = text.split(' ');
            let lines = [];
            let currentLine = words[0];

            for (let i = 1; i < words.length; i++) {
                let testLine = currentLine + ' ' + words[i];
                let metrics = context.measureText(testLine);
                if (metrics.width > 480 && i > 0) { // 480 para ter uma margem
                    lines.push(currentLine);
                    currentLine = words[i];
                } else {
                    currentLine = testLine;
                }
            }
            lines.push(currentLine);

            // Reduz o tamanho da fonte se o texto for muito grande
            while (context.measureText(lines.join('\n')).width > 480 || lines.length * fontSize > 480) {
                 fontSize--;
                 context.font = `bold ${fontSize}px Arial`;
            }
            
            const lineHeight = fontSize * 1.2;
            const startY = 256 - (lines.length - 1) * lineHeight / 2;

            for(let i = 0; i < lines.length; i++) {
                context.fillText(lines[i], 256, startY + (i * lineHeight));
            }

            const buffer = canvas.toBuffer('image/png');
            const media = new MessageMedia('image/png', buffer.toString('base64'), 'sticker.png');

            console.log('🚀 Enviando figurinha...');
            await message.reply(media, undefined, { sendMediaAsSticker: true, stickerName: 'Criado por IA 🤖', stickerAuthor: 'StickerBot' });
            await message.react('✅');

        } catch (error) {
            console.error('❌ Erro ao gerar figurinha local:', error);
            await message.reply('🤖 Falhei em criar sua figurinha. Tente um texto mais simples.');
            await message.react('❌');
        }
    }

    // --- MÉTODO RENOMEADO E ESPECÍFICO PARA GERAR IMAGENS PELA API ---
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

    async tellJoke(message, theme) {
        // (Esta função permanece inalterada)
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

    async showHelp(message) {
        // (Esta função permanece inalterada)
        const helpText = `🤖 *Olá! Sou seu assistente de figurinhas e imagens!*

Para me usar, me mencione no grupo ou mande uma mensagem no privado com um dos comandos:

1️⃣ *Para criar FIGURINHAS (com texto):*
   • "@bot faz uma figurinha com o texto 'sextou!'"
   • "@bot figurinha: 'hoje eu tô só o pó'"

2️⃣ *Para gerar IMAGENS (desenhos):*
   • "@bot desenhe um gato tocando guitarra"
   • "@bot imagem: um robô surfando em marte"

3️⃣ *Para PIADAS:*
   • "@bot me conta uma piada"

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
        await this.client.initialize();
    }

    async stop() {
        console.log('🛑 Encerrando bot...');
        await this.client.destroy();
    }
}

// Inicializar e iniciar o bot
const bot = new StickerBotIA();
bot.start().catch(error => {
    console.error("❌ Falha ao iniciar o bot:", error);
});

// Tratamento para encerramento gracioso
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