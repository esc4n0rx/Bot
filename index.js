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
        this.API_KEY = process.env.API_KEY || 'paulinho2025x';
        
        this.setupBot();
        this.startServer();
    }

    setupBot() {
        this.client.on('qr', async (qr) => {
            console.log('📱 QR Code gerado! Acesse /qrcode para escanear');
            this.qrCodeDataUrl = await qrcode.toDataURL(qr);
        });

        this.client.on('ready', () => {
            console.log('✅ Bot conectado com sucesso!');
            this.isReady = true;
            this.qrCodeDataUrl = null;
        });

        this.client.on('disconnected', () => {
            console.log('❌ Bot desconectado. Reiniciando...');
            this.isReady = false;
            this.client.initialize();
        });
    }

    startServer() {
        const app = express();
        const port = process.env.PORT || 4002;

        // Middleware para JSON com tratamento de erro melhorado
        app.use(express.json({ 
            limit: '1mb',
            verify: (req, res, buf, encoding) => {
                try {
                    JSON.parse(buf);
                } catch (e) {
                    console.error('❌ JSON inválido recebido:', buf.toString());
                    throw new Error('JSON inválido');
                }
            }
        }));

        // Middleware de log para debug
        app.use((req, res, next) => {
            console.log(`📥 ${req.method} ${req.path}`);
            if (req.method === 'POST') {
                console.log('📄 Body:', JSON.stringify(req.body, null, 2));
                console.log('📋 Headers:', req.headers);
            }
            next();
        });

        // Middleware de autenticação
        const auth = (req, res, next) => {
            const key = req.headers['x-api-key'];
            if (key !== this.API_KEY) {
                console.log('❌ API Key inválida:', key);
                return res.status(401).json({ erro: 'API Key inválida' });
            }
            next();
        };

        // Middleware de tratamento de erro JSON
        app.use((error, req, res, next) => {
            if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
                console.error('❌ Erro de JSON:', error.message);
                return res.status(400).json({ erro: 'JSON malformado' });
            }
            next();
        });

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
                console.log('📨 Tentativa de envio de mensagem');
                
                const { numero, mensagem } = req.body;

                // Validação detalhada
                if (!numero) {
                    return res.status(400).json({ erro: 'Campo "numero" é obrigatório' });
                }
                
                if (!mensagem) {
                    return res.status(400).json({ erro: 'Campo "mensagem" é obrigatório' });
                }

                if (typeof numero !== 'string' || typeof mensagem !== 'string') {
                    return res.status(400).json({ erro: 'Campos devem ser strings' });
                }

                // Verificar se bot está pronto
                if (!this.isReady) {
                    return res.status(503).json({ erro: 'Bot não está conectado' });
                }

                // Formatar número
                const numeroFormatado = this.formatarNumero(numero);
                
                console.log(`📤 Enviando para: ${numeroFormatado}`);
                console.log(`💬 Mensagem: ${mensagem}`);

                // Enviar mensagem
                await this.client.sendMessage(numeroFormatado, mensagem);

                console.log(`✅ Mensagem enviada com sucesso!`);

                res.json({
                    sucesso: true,
                    numero: numeroFormatado,
                    mensagem: mensagem,
                    horario: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                });

            } catch (error) {
                console.error('❌ Erro ao enviar:', error);
                res.status(500).json({ 
                    erro: 'Falha ao enviar mensagem',
                    detalhes: error.message
                });
            }
        });

        // Página inicial com status
        app.get('/', (req, res) => {
            res.json({
                bot: 'WhatsApp Bot Simplificado',
                status: this.isReady ? 'Conectado ✅' : 'Desconectado ❌',
                horario: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                rotas: {
                    'GET /qrcode': 'Ver QR Code para conectar',
                    'POST /enviar': 'Enviar mensagem (precisa de x-api-key no header)'
                },
                exemplo: {
                    url: '/enviar',
                    method: 'POST',
                    headers: { 'x-api-key': 'sua-chave', 'Content-Type': 'application/json' },
                    body: { numero: '11999999999', mensagem: 'Teste' }
                }
            });
        });

        app.listen(port, () => {
            console.log(`🚀 Bot rodando na porta ${port}`);
            console.log(`🔑 API Key: ${this.API_KEY}`);
        });
    }

    // Formatar número brasileiro
    formatarNumero(numero) {
        let limpo = numero.replace(/\D/g, '');
        
        if (limpo.length === 11 && limpo.startsWith('9')) {
            limpo = '55' + limpo;
        } else if (limpo.length === 10) {
            limpo = '559' + limpo;
        } else if (limpo.length === 13 && limpo.startsWith('55')) {
            // Já está formatado
        } else {
            console.warn('⚠️ Número com formato inesperado:', numero);
        }
        
        return limpo + '@c.us';
    }

    async iniciar() {
        console.log('🚀 Iniciando bot...');
        await this.client.initialize();
    }

    async parar() {
        console.log('🛑 Parando bot...');
        await this.client.destroy();
    }
}

const bot = new SimpleWhatsAppBot();
bot.iniciar().catch(console.error);

process.on('SIGINT', async () => {
    await bot.parar();
    process.exit(0);
});
