const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { Groq } = require('groq-sdk');
const axios = require('axios');
require('dotenv').config();
const express = require('express');
const qrcode = require('qrcode');

class WhatsAppAPI {
    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                executablePath: '/usr/bin/chromium', 
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
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

        this.botNumber = null;
        this.qrCodeDataUrl = null;
        this.botStatus = "Iniciando...";
        this.isReady = false;
        
        // API Key para autenticação
        this.API_KEY = process.env.API_KEY || 'your-secret-api-key';
        
        this.setupEventHandlers();
        this.startWebServer();
    }
    
    setupEventHandlers() {
        this.client.on('qr', async (qr) => {
            console.log('📱 QR Code recebido! Acesse a rota /qrcode no seu navegador para escanear.');
            this.botStatus = "QR Code gerado. Escaneie para conectar.";
            this.qrCodeDataUrl = await qrcode.toDataURL(qr);
        });

        this.client.on('ready', async () => {
            console.log('✅ WhatsApp API conectada com sucesso!');
            this.botNumber = this.client.info.wid.user;
            this.botStatus = `Conectado e pronto para enviar mensagens via API`;
            this.qrCodeDataUrl = null;
            this.isReady = true;
            console.log(`🤖 API rodando no número: ${this.botNumber}`);
        });

        // REMOVIDO: Não processa mais mensagens recebidas automaticamente
        // O bot agora funciona apenas via API

        this.client.on('disconnected', (reason) => {
            console.log('❌ Cliente desconectado:', reason);
            this.botStatus = `Desconectado: ${reason}. Reiniciando...`;
            this.isReady = false;
            this.client.initialize();
        });
    }

    startWebServer() {
        const app = express();
        const port = process.env.PORT || 4002;

        // Middleware para parsing JSON
        app.use(express.json({ limit: '10mb' }));

        // Middleware de autenticação
        const authenticateAPI = (req, res, next) => {
            const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
            
            if (!apiKey || apiKey !== this.API_KEY) {
                return res.status(401).json({
                    status: 'error',
                    message: 'API Key inválida ou ausente'
                });
            }
            next();
        };

        // Status da API
        app.get('/status', (req, res) => {
            res.json({
                status: 'success',
                data: {
                    botStatus: this.botStatus,
                    isReady: this.isReady,
                    botNumber: this.botNumber
                }
            });
        });

        // QR Code para autenticação
        app.get('/qrcode', (req, res) => {
            if (this.qrCodeDataUrl) {
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
                res.send(`
                    <!DOCTYPE html>
                    <html>
                        <head>
                            <title>Status da API</title>
                            <meta http-equiv="refresh" content="5">
                        </head>
                        <body style="display: flex; justify-content: center; align-items: center; height: 100vh; flex-direction: column; font-family: sans-serif;">
                            <h1>WhatsApp API - Treinos PWA</h1>
                            <p>Status: ${this.botStatus}</p>
                            <p>Pronto: ${this.isReady ? 'Sim' : 'Não'}</p>
                            ${!this.isReady ? '<p>A página será atualizada automaticamente em 5 segundos.</p>' : ''}
                        </body>
                    </html>
                `);
            }
        });

        // ENDPOINT PRINCIPAL: Enviar mensagem via API
        app.post('/send-message', authenticateAPI, async (req, res) => {
            try {
                const { number, message, prompt } = req.body;

                // Validação dos dados
                if (!number || (!message && !prompt)) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Campos obrigatórios: number e (message ou prompt)'
                    });
                }

                // Verifica se o bot está pronto
                if (!this.isReady) {
                    return res.status(503).json({
                        status: 'error',
                        message: 'Bot não está conectado ao WhatsApp'
                    });
                }

                let finalMessage = message;

                // Se foi fornecido um prompt, gera a mensagem com IA
                if (prompt && !message) {
                    try {
                        console.log(`🧠 Gerando mensagem com IA para o prompt: "${prompt}"`);
                        
                        const chatCompletion = await this.groq.chat.completions.create({
                            messages: [
                                { 
                                    role: "system", 
                                    content: "Você é um assistente para um app de treinos na academia. Gere mensagens motivacionais, informativas ou de acompanhamento relacionadas a fitness, treinos e checkins na academia. Seja conciso, motivacional e use emojis quando apropriado." 
                                },
                                { role: "user", content: prompt }
                            ],
                            model: "llama3-8b-8192",
                            temperature: 0.7,
                            max_tokens: 300,
                        });

                        finalMessage = chatCompletion.choices[0]?.message?.content || "Mensagem não pôde ser gerada.";
                        console.log(`✅ Mensagem gerada: "${finalMessage}"`);
                        
                    } catch (aiError) {
                        console.error('❌ Erro ao gerar mensagem com IA:', aiError);
                        return res.status(500).json({
                            status: 'error',
                            message: 'Erro ao gerar mensagem com IA'
                        });
                    }
                }

                // Formatar número para WhatsApp
                const formattedNumber = this.formatWhatsAppNumber(number);
                
                console.log(`📤 Enviando mensagem para ${formattedNumber}: "${finalMessage}"`);

                // Enviar mensagem
                await this.client.sendMessage(formattedNumber, finalMessage);

                console.log(`✅ Mensagem enviada com sucesso para ${formattedNumber}`);

                res.json({
                    status: 'success',
                    message: 'Mensagem enviada com sucesso',
                    data: {
                        number: formattedNumber,
                        message: finalMessage,
                        timestamp: new Date().toISOString()
                    }
                });

            } catch (error) {
                console.error('❌ Erro ao enviar mensagem:', error);
                res.status(500).json({
                    status: 'error',
                    message: 'Erro interno ao enviar mensagem',
                    error: error.message
                });
            }
        });

        // ENDPOINT: Verificar se número está registrado no WhatsApp
        app.post('/check-number', authenticateAPI, async (req, res) => {
            try {
                const { number } = req.body;

                if (!number) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Campo obrigatório: number'
                    });
                }

                if (!this.isReady) {
                    return res.status(503).json({
                        status: 'error',
                        message: 'Bot não está conectado ao WhatsApp'
                    });
                }

                const formattedNumber = this.formatWhatsAppNumber(number);
                const isRegistered = await this.client.isRegisteredUser(formattedNumber);

                res.json({
                    status: 'success',
                    data: {
                        number: formattedNumber,
                        isRegistered: isRegistered
                    }
                });

            } catch (error) {
                console.error('❌ Erro ao verificar número:', error);
                res.status(500).json({
                    status: 'error',
                    message: 'Erro ao verificar número',
                    error: error.message
                });
            }
        });

        // ENDPOINT: Envio em lote (múltiplos números)
        app.post('/send-bulk', authenticateAPI, async (req, res) => {
            try {
                const { numbers, message, prompt } = req.body;

                if (!numbers || !Array.isArray(numbers) || (!message && !prompt)) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Campos obrigatórios: numbers (array) e (message ou prompt)'
                    });
                }

                if (!this.isReady) {
                    return res.status(503).json({
                        status: 'error',
                        message: 'Bot não está conectado ao WhatsApp'
                    });
                }

                let finalMessage = message;

                // Gerar mensagem com IA se necessário
                if (prompt && !message) {
                    try {
                        const chatCompletion = await this.groq.chat.completions.create({
                            messages: [
                                { 
                                    role: "system", 
                                    content: "Você é um assistente para um app de treinos na academia. Gere mensagens motivacionais, informativas ou de acompanhamento relacionadas a fitness, treinos e checkins na academia. Seja conciso, motivacional e use emojis quando apropriado." 
                                },
                                { role: "user", content: prompt }
                            ],
                            model: "llama3-8b-8192",
                            temperature: 0.7,
                            max_tokens: 300,
                        });

                        finalMessage = chatCompletion.choices[0]?.message?.content || "Mensagem não pôde ser gerada.";
                        
                    } catch (aiError) {
                        console.error('❌ Erro ao gerar mensagem com IA:', aiError);
                        return res.status(500).json({
                            status: 'error',
                            message: 'Erro ao gerar mensagem com IA'
                        });
                    }
                }

                const results = [];
                const errors = [];

                // Enviar para cada número com delay para evitar spam
                for (let i = 0; i < numbers.length; i++) {
                    try {
                        const formattedNumber = this.formatWhatsAppNumber(numbers[i]);
                        await this.client.sendMessage(formattedNumber, finalMessage);
                        
                        results.push({
                            number: formattedNumber,
                            status: 'sent',
                            timestamp: new Date().toISOString()
                        });

                        console.log(`✅ Mensagem enviada para ${formattedNumber} (${i + 1}/${numbers.length})`);

                        // Delay de 2 segundos entre envios para evitar bloqueio
                        if (i < numbers.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }

                    } catch (error) {
                        console.error(`❌ Erro ao enviar para ${numbers[i]}:`, error);
                        errors.push({
                            number: numbers[i],
                            error: error.message
                        });
                    }
                }

                res.json({
                    status: 'success',
                    message: `Mensagens processadas: ${results.length} enviadas, ${errors.length} com erro`,
                    data: {
                        sent: results,
                        errors: errors,
                        message: finalMessage
                    }
                });

            } catch (error) {
                console.error('❌ Erro no envio em lote:', error);
                res.status(500).json({
                    status: 'error',
                    message: 'Erro interno no envio em lote',
                    error: error.message
                });
            }
        });

        app.get('/', (req, res) => {
            res.json({
                status: 'success',
                message: 'WhatsApp API para Treinos PWA',
                data: {
                    botStatus: this.botStatus,
                    isReady: this.isReady,
                    endpoints: {
                        'GET /status': 'Status da API',
                        'GET /qrcode': 'QR Code para autenticação',
                        'POST /send-message': 'Enviar mensagem individual',
                        'POST /check-number': 'Verificar se número está no WhatsApp',
                        'POST /send-bulk': 'Envio em lote'
                    }
                }
            });
        });

        app.listen(port, () => {
            console.log(`🚀 WhatsApp API rodando na porta ${port}`);
            console.log(`📋 Endpoints disponíveis:`);
            console.log(`   GET  / - Informações da API`);
            console.log(`   GET  /status - Status da conexão`);
            console.log(`   GET  /qrcode - QR Code para autenticação`);
            console.log(`   POST /send-message - Enviar mensagem`);
            console.log(`   POST /check-number - Verificar número`);
            console.log(`   POST /send-bulk - Envio em lote`);
        });
    }

    // Função para formatar número do WhatsApp
    formatWhatsAppNumber(number) {
        // Remove caracteres especiais
        let cleaned = number.replace(/\D/g, '');
        
        // Se não tem código do país, assume Brasil (55)
        if (cleaned.length === 11 && cleaned.startsWith('9')) {
            cleaned = '55' + cleaned;
        } else if (cleaned.length === 10) {
            cleaned = '559' + cleaned;
        }
        
        return cleaned + '@c.us';
    }

    async start() {
        console.log('🚀 Iniciando WhatsApp API para Treinos...');
        
        if (!process.env.GROQ_API_KEY) {
            console.error('❌ GROQ_API_KEY não encontrada no arquivo .env');
            process.exit(1);
        }

        if (!process.env.API_KEY) {
            console.warn('⚠️  API_KEY não definida no .env, usando padrão. MUDE EM PRODUÇÃO!');
        }
        
        console.log('✅ Configurações carregadas.');
        this.botStatus = "Inicializando cliente WhatsApp...";
        await this.client.initialize();
    }

    async stop() {
        console.log('🛑 Encerrando API...');
        await this.client.destroy();
    }
}

const api = new WhatsAppAPI();
api.start().catch(error => {
    console.error("❌ Falha ao iniciar a API:", error);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Recebido sinal de interrupção...');
    await api.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Recebido sinal de término...');
    await api.stop();
    process.exit(0);
});
