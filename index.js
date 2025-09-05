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
        this.SYSTEM_WEBHOOK_URL = process.env.SYSTEM_WEBHOOK_URL; // Nova variável
        this.SYSTEM_WEBHOOK_TOKEN = process.env.SYSTEM_WEBHOOK_TOKEN; // Nova variável
        
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

        // NOVA FUNCIONALIDADE: Escutar mensagens recebidas
        this.client.on('message', async (message) => {
            try {
                await this.processReceivedMessage(message);
            } catch (error) {
                console.error('❌ Erro ao processar mensagem recebida:', error);
            }
        });
    }

    // NOVA FUNÇÃO: Processar mensagens recebidas para aprovação de checklist
    async processReceivedMessage(message) {
        // Verificar se é uma mensagem de texto de contato (não grupo)
        if (!message.body || message.from.includes('@g.us')) {
            return; // Ignorar mensagens de grupo ou vazias
        }

        const messageText = message.body.trim().toUpperCase();
        const fromNumber = message.from.replace('@c.us', '');
        
        // Verificar se é resposta de aprovação (SIM ou NÃO)
        if (messageText === 'SIM' || messageText === 'NÃO') {
            console.log(`📨 Resposta de aprovação recebida: ${messageText} de ${fromNumber}`);
            
            // Enviar para o sistema
            await this.sendApprovalToSystem(fromNumber, messageText === 'SIM');
            
            // Confirmar recebimento
            const confirmMessage = messageText === 'SIM' 
                ? '✅ Aprovação registrada com sucesso!' 
                : '❌ Rejeição registrada com sucesso!';
            
            await this.client.sendMessage(message.from, confirmMessage);
        }
    }

    // NOVA FUNÇÃO: Enviar resposta de aprovação para o sistema
    async sendApprovalToSystem(phoneNumber, approved) {
        if (!this.SYSTEM_WEBHOOK_URL || !this.SYSTEM_WEBHOOK_TOKEN) {
            console.warn('⚠️ Webhook do sistema não configurado');
            return;
        }

        try {
            const response = await fetch(`${this.SYSTEM_WEBHOOK_URL}/api/whatsapp/webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.SYSTEM_WEBHOOK_TOKEN}`
                },
                body: JSON.stringify({
                    phoneNumber: phoneNumber,
                    approved: approved,
                    timestamp: new Date().toISOString()
                })
            });

            if (response.ok) {
                console.log('✅ Resposta enviada para o sistema com sucesso');
            } else {
                console.error('❌ Erro ao enviar resposta para o sistema:', await response.text());
            }
        } catch (error) {
            console.error('❌ Erro na requisição para o sistema:', error);
        }
    }

    startServer() {
        const app = express();
        const port = process.env.PORT || 4002;

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

        app.use((req, res, next) => {
            console.log(`🔥 ${req.method} ${req.path}`);
            if (req.method === 'POST') {
                console.log('📄 Body:', JSON.stringify(req.body, null, 2));
            }
            next();
        });

        const auth = (req, res, next) => {
            const key = req.headers['x-api-key'];
            if (key !== this.API_KEY) {
                return res.status(401).json({ erro: 'API Key inválida' });
            }
            next();
        };

        app.use((error, req, res, next) => {
            if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
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

        // ROTA 2: Enviar mensagem (contato privado) - ATUALIZADA para incluir código do checklist
        app.post('/enviar', auth, async (req, res) => {
            try {
                const { numero, mensagem, checklistCodigo } = req.body;

                if (!numero || !mensagem) {
                    return res.status(400).json({ erro: 'Campos obrigatórios: numero e mensagem' });
                }

                if (!this.isReady) {
                    return res.status(503).json({ erro: 'Bot não está conectado' });
                }

                const numeroFormatado = this.formatarNumero(numero);
                
                // Adicionar código do checklist na mensagem se fornecido
                let mensagemFinal = mensagem;
                if (checklistCodigo) {
                    mensagemFinal += `\n\n🔑 Código: ${checklistCodigo}`;
                }
                
                await this.client.sendMessage(numeroFormatado, mensagemFinal);
                console.log(`✅ Mensagem enviada para contato: ${numeroFormatado}`);

                res.json({
                    sucesso: true,
                    tipo: 'contato',
                    numero: numeroFormatado,
                    mensagem: mensagemFinal,
                    checklistCodigo: checklistCodigo || null,
                    horario: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                });

            } catch (error) {
                console.error('❌ Erro ao enviar para contato:', error);
                res.status(500).json({ 
                    erro: 'Falha ao enviar mensagem',
                    detalhes: error.message
                });
            }
        });

        // ROTA 3: Enviar mensagem para grupo
        app.post('/enviar-grupo', auth, async (req, res) => {
            try {
                const { grupo, mensagem } = req.body;

                if (!grupo || !mensagem) {
                    return res.status(400).json({ erro: 'Campos obrigatórios: grupo e mensagem' });
                }

                if (!this.isReady) {
                    return res.status(503).json({ erro: 'Bot não está conectado' });
                }

                console.log(`🔍 Procurando grupo: ${grupo}`);

                // Buscar grupo pelo nome
                const chats = await this.client.getChats();
                const grupoEncontrado = chats.find(chat => 
                    chat.isGroup && 
                    chat.name.toLowerCase().includes(grupo.toLowerCase())
                );

                if (!grupoEncontrado) {
                    return res.status(404).json({ 
                        erro: 'Grupo não encontrado',
                        sugestao: 'Verifique se o nome está correto e se você faz parte do grupo'
                    });
                }

                console.log(`📤 Enviando para grupo: ${grupoEncontrado.name} (${grupoEncontrado.id._serialized})`);

                await this.client.sendMessage(grupoEncontrado.id._serialized, mensagem);
                console.log(`✅ Mensagem enviada para o grupo!`);

                res.json({
                    sucesso: true,
                    tipo: 'grupo',
                    grupo: grupoEncontrado.name,
                    grupoId: grupoEncontrado.id._serialized,
                    mensagem: mensagem,
                    horario: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                });

            } catch (error) {
                console.error('❌ Erro ao enviar para grupo:', error);
                res.status(500).json({ 
                    erro: 'Falha ao enviar mensagem para grupo',
                    detalhes: error.message
                });
            }
        });

        // ROTA 4: Listar grupos disponíveis
        app.get('/grupos', auth, async (req, res) => {
            try {
                if (!this.isReady) {
                    return res.status(503).json({ erro: 'Bot não está conectado' });
                }

                const chats = await this.client.getChats();
                const grupos = chats
                    .filter(chat => chat.isGroup)
                    .map(grupo => ({
                        nome: grupo.name,
                        id: grupo.id._serialized,
                        participantes: grupo.participants ? grupo.participants.length : 0
                    }));

                console.log(`📋 Listando ${grupos.length} grupos`);

                res.json({
                    sucesso: true,
                    total: grupos.length,
                    grupos: grupos
                });

            } catch (error) {
                console.error('❌ Erro ao listar grupos:', error);
                res.status(500).json({ 
                    erro: 'Falha ao listar grupos',
                    detalhes: error.message
                });
            }
        });

        // Página inicial
        app.get('/', (req, res) => {
            res.json({
                bot: 'WhatsApp Bot - Contatos e Grupos com Aprovação de Checklist',
                status: this.isReady ? 'Conectado ✅' : 'Desconectado ❌',
                horario: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                funcionalidades: {
                    'Envio de mensagens': 'POST /enviar',
                    'Grupos': 'POST /enviar-grupo',
                    'Aprovação de checklist': 'Escuta mensagens SIM/NÃO automaticamente',
                    'Webhook configurado': this.SYSTEM_WEBHOOK_URL ? 'Sim ✅' : 'Não ❌'
                },
                rotas: {
                    'GET /qrcode': 'Ver QR Code para conectar',
                    'POST /enviar': 'Enviar mensagem para contato privado',
                    'POST /enviar-grupo': 'Enviar mensagem para grupo',
                    'GET /grupos': 'Listar todos os grupos disponíveis'
                },
                exemplos: {
                    contato: {
                        url: '/enviar',
                        body: { 
                            numero: '11999999999', 
                            mensagem: 'Olá!',
                            checklistCodigo: 'CHK_123456' // Opcional
                        }
                    },
                    grupo: {
                        url: '/enviar-grupo',
                        body: { grupo: 'Trabalho', mensagem: 'Reunião às 14h!' }
                    }
                }
            });
        });

        app.listen(port, () => {
            console.log(`🚀 Bot rodando na porta ${port}`);
            console.log(`🔑 API Key: ${this.API_KEY}`);
            console.log(`🔗 System Webhook: ${this.SYSTEM_WEBHOOK_URL || 'Não configurado'}`);
            console.log(`📋 Funcionalidades:`);
            console.log(`   POST /enviar - Enviar para contato (com suporte a código de checklist)`);
            console.log(`   POST /enviar-grupo - Enviar para grupo`);
            console.log(`   GET  /grupos - Listar grupos`);
            console.log(`   🤖 Aprovação automática - Escuta respostas SIM/NÃO`);
        });
    }

    formatarNumero(numero) {
        let limpo = numero.replace(/\D/g, '');
        
        if (limpo.length === 11 && limpo.startsWith('9')) {
            limpo = '55' + limpo;
        } else if (limpo.length === 10) {
            limpo = '559' + limpo;
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
