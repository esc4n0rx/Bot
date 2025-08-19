const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
require('dotenv').config();

class SimpleWhatsAppBot {
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

        this.qrCodeDataUrl = null;
        this.isReady = false;
        this.API_KEY = process.env.API_KEY || 'sua-chave-secreta';
        
        this.setupBot();
        this.startServer();
    }

    setupBot() {
        // Quando receber QR Code
        this.client.on('qr', async (qr) => {
            console.log('📱 QR Code gerado! Acesse /qrcode para escanear');
            this.qrCodeDataUrl = await qrcode.toDataURL(qr);
        });

        // Quando conectar
        this.client.on('ready', () => {
            console.log('✅ Bot conectado com sucesso!');
            this.isReady = true;
            this.qrCodeDataUrl = null;
        });

        // Se desconectar
        this.client.on('disconnected', () => {
            console.log('❌ Bot desconectado. Reiniciando...');
            this.isReady = false;
            this.client.initialize();
        });
    }

    startServer() {
        const app = express();
        const port = process.env.PORT || 4002;

        app.use(express.json());

        // Middleware de autenticação simples
        const auth = (req, res, next) => {
            const key = req.headers['x-api-key'];
            if (key !== this.API_KEY) {
                return res.status(401).json({ erro: 'API Key inválida' });
            }
            next();
        };

        // ROTA 1: QR Code
        app.get('/qrcode', (req, res) => {
            if (this.qrCodeDataUrl) {
                res.send(`
                    <html>
                        <body style="text-align: center; padding: 50px; font-family: Arial;">
                            <h2>Escaneie o QR Code com seu WhatsApp</h2>
                            <img src="${this.qrCodeDataUrl}" style="max-width: 300px;">
                        </body>
                    </html>
                `);
            } else if (this.isReady) {
                res.send(`
                    <html>
                        <body style="text-align: center; padding: 50px; font-family: Arial;">
                            <h2>✅ Bot conectado e pronto!</h2>
                            <p>Use a API para enviar mensagens</p>
                        </body>
                    </html>
                `);
            } else {
                res.send(`
                    <html>
                        <head><meta http-equiv="refresh" content="3"></head>
                        <body style="text-align: center; padding: 50px; font-family: Arial;">
                            <h2>Iniciando bot...</h2>
                            <p>Aguarde o QR Code aparecer</p>
                        </body>
                    </html>
                `);
            }
        });

        // ROTA 2: Enviar mensagem
        app.post('/enviar', auth, async (req, res) => {
            try {
                const { numero, mensagem } = req.body;

                // Validação
                if (!numero || !mensagem) {
                    return res.status(400).json({ 
                        erro: 'Campos obrigatórios: numero e mensagem' 
                    });
                }

                // Verificar se bot está pronto
                if (!this.isReady) {
                    return res.status(503).json({ 
                        erro: 'Bot não está conectado' 
                    });
                }

                // Formatar número
                const numeroFormatado = this.formatarNumero(numero);
                
                // Enviar mensagem
                await this.client.sendMessage(numeroFormatado, mensagem);

                console.log(`✅ Mensagem enviada para ${numeroFormatado}: ${mensagem}`);

                res.json({
                    sucesso: true,
                    numero: numeroFormatado,
                    mensagem: mensagem,
                    horario: new Date().toLocaleString('pt-BR')
                });

            } catch (error) {
                console.error('❌ Erro ao enviar:', error);
                res.status(500).json({ 
                    erro: 'Falha ao enviar mensagem' 
                });
            }
        });

        // Página inicial
        app.get('/', (req, res) => {
            res.json({
                bot: 'WhatsApp Bot Simplificado',
                status: this.isReady ? 'Conectado' : 'Desconectado',
                rotas: {
                    'GET /qrcode': 'Ver QR Code para conectar',
                    'POST /enviar': 'Enviar mensagem (precisa de x-api-key no header)'
                }
            });
        });

        app.listen(port, () => {
            console.log(`🚀 Bot rodando na porta ${port}`);
            console.log(`📋 Rotas:`);
            console.log(`   GET  / - Status`);
            console.log(`   GET  /qrcode - QR Code`);
            console.log(`   POST /enviar - Enviar mensagem`);
        });
    }

    // Formatar número brasileiro
    formatarNumero(numero) {
        let limpo = numero.replace(/\D/g, '');
        
        // Se tem 11 dígitos e começa com 9 (celular)
        if (limpo.length === 11 && limpo.startsWith('9')) {
            limpo = '55' + limpo;
        }
        // Se tem 10 dígitos (celular sem 9)
        else if (limpo.length === 10) {
            limpo = '559' + limpo;
        }
        
        return limpo + '@c.us';
    }

    async iniciar() {
        console.log('🚀 Iniciando bot...');
        
        if (!process.env.API_KEY) {
            console.warn('⚠️  Defina API_KEY no arquivo .env');
        }
        
        await this.client.initialize();
    }

    async parar() {
        console.log('🛑 Parando bot...');
        await this.client.destroy();
    }
}

// Iniciar o bot
const bot = new SimpleWhatsAppBot();
bot.iniciar().catch(console.error);

// Parar graciosamente
process.on('SIGINT', async () => {
    await bot.parar();
    process.exit(0);
});
