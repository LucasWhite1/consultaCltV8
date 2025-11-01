const express = require("express");
const axios = require("axios");
const qs = require("qs");

const app = express();
const cors = require("cors");

// Permitir qualquer origem
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"], allowedHeaders: ["Content-Type", "Authorization"] }));

app.use(express.json());

// ✅ Liberar CORS para qualquer origem
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

/** ==================== CONFIGURAÇÕES ==================== */
const PORT = process.env.PORT || 3050;
const TOKEN_UTILITARIOS = process.env.API_TOKEN_UTILITARIOS;
const V8_CREDENTIALS = {
    username: process.env.V8_USERNAME,
    password: process.env.V8_PASSWORD,
    client_id: "DHWogdaYmEI8n5bwwxPDzulMlSK7dwIn"
};
const V8_BASE = "https://bff.v8sistema.com";

/** ==================== CLIENTE UTILITÁRIOS ==================== */
function createClientUtilitarios(token) {
    return axios.create({
        baseURL: "https://servicos-utilitarios-novaera.ugztmp.easypanel.host",
        timeout: 20000,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    });
}

async function getPessoaByCPF(client, cpf) {
    try {
        const res = await client.get(`/api/pessoas/cpf/${cpf}`);
        if (!res.data?.data?.[0]) {
            console.log(`⚠️ CPF ${cpf} não encontrado na API de consulta`);
            return null;
        }
        return res.data.data[0];
    } catch (err) {
        console.error(`❌ Erro ao consultar CPF ${cpf}:`, err.response?.statusText || err.message);
        return null;
    }
}

function formatarCPF(cpf) {
    if (!cpf) return "";
    cpf = cpf.replace(/\D/g, "");
    return cpf.padStart(11, "0");
}

/** ==================== CLIENTE V8 ==================== */
let V8_TOKEN = null;

async function autenticarV8() {
    if (V8_TOKEN) return V8_TOKEN; // reutiliza token
    const url = "https://auth.v8sistema.com/oauth/token";
    const data = {
        grant_type: "password",
        username: V8_CREDENTIALS.username,
        password: V8_CREDENTIALS.password,
        audience: V8_BASE,
        scope: "offline_access",
        client_id: V8_CREDENTIALS.client_id
    };
    const response = await axios.post(url, qs.stringify(data), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    V8_TOKEN = response.data.access_token;
    console.log("✅ Token V8 obtido!");
    return V8_TOKEN;
}

function EmailComNumeroAleatorio(pessoa) {
    var numeroAleatorio = Math.floor(Math.random() * 100000);
    return (pessoa.nome.split(' ')[0] + numeroAleatorio + "@gmail.com").toLowerCase();
}

async function gerarTermo(accessToken, pessoa) {
    const url = `${V8_BASE}/private-consignment/consult`;
    var emailValido = pessoa.email && pessoa.email.includes("@") ? pessoa.email : EmailComNumeroAleatorio(pessoa);

    var sexoVerificado = pessoa.sexo == "F" ? "female" : "male";
    var numeroSemDDD = pessoa.celular1 ? pessoa.celular1.replace(/\D/g, '').slice(-9) : '999999999';
    var apenasDDD = pessoa.celular1 ? pessoa.celular1.replace(/\D/g, '').slice(0, -9) : '71';
    var dataNascimentoFormatadaAnoMesDia = pessoa.dtNascimento.split('/').reverse().join('-');

    const body = {
        borrowerDocumentNumber: pessoa.cpf,
        gender: sexoVerificado,
        birthDate: dataNascimentoFormatadaAnoMesDia,
        signerName: pessoa.nome || "NOME DESCONHECIDO",
        signerEmail: emailValido || "sememail@gmail.com",
        signerPhone: { phoneNumber: numeroSemDDD, countryCode: "55", areaCode: apenasDDD },
        provider: "QI"
    };
    console.log("🧭 Enviando dados do termo:", body);
    const res = await axios.post(url, body, { headers: { Authorization: `Bearer ${accessToken}` } });
    console.log(`✅ Termo gerado: ${res.data.id}`);
    return res.data.id;
}

async function autorizarTermo(accessToken, consultId) {
    const url = `${V8_BASE}/private-consignment/consult/${consultId}/authorize`;
    await axios.post(url, {}, { headers: { Authorization: `Bearer ${accessToken}` } });
    console.log("✅ Termo autorizado");
}

// Busca a margem para um consultId específico (ou retorna null se não encontrar)
async function obterMargemPorId(accessToken, cpf, consultId) {
    const url = `${V8_BASE}/private-consignment/consult`;
    const agora = new Date();
    const params = {
        startDate: new Date(agora.setHours(0, 0, 0, 0)).toISOString(),
        endDate: new Date(agora.setHours(23, 59, 59, 999)).toISOString(),
        limit: 50,
        page: 1,
        search: cpf,
        provider: "QI"
    };

    const res = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` }, params });
    const termos = res.data.data || [];
    console.log(`🔎 Termos retornados na busca (contagem=${termos.length})`);
    termos.forEach((t, idx) => {
        console.log(`  [${idx}] id=${t.id}, availableMarginValue=${t.availableMarginValue}, status=${t.status}`);
    });

    const termo = termos.find(t => t.id === consultId);

    if (!termo) {
        console.log(`⚠️ Termo com consultId ${consultId} não encontrado na lista`);
        return null;
    }

    return {
        termId: termo.id,
        margem: parseFloat(termo.availableMarginValue),
        status: termo.status // se a API retornar status
    };
}

async function consultarTaxas(accessToken) {
    const url = `${V8_BASE}/private-consignment/simulation/configs`;
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    console.log(res.data)
    return res.data.configs?.[0];
}

async function criarSimulacao(accessToken, consultId, config, margemDisponivel) {
  const url = `${V8_BASE}/private-consignment/simulation`;

  // Pega as opções de parcelas disponíveis e ordena do maior para o menor
  const parcelasOptions = (config.number_of_installments || [])
    .map(n => parseInt(n, 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => b - a); // ← maior para menor

  const VALOR_MAXIMO = 25000;
  const MIN_DISBURSE = 800; // desembolso mínimo permitido pela API (conforme seu log)

  for (let i = 0; i < parcelasOptions.length; i++) {
    const parcelas = parcelasOptions[i];

    // O valor por parcela não pode exceder a margem disponível
    // e o total desembolado não pode exceder o teto.
    const perInstallment = Math.min(margemDisponivel, VALOR_MAXIMO / parcelas);
    const totalDisbursed = perInstallment * parcelas;

    // Se o desembolso total for menor que o mínimo, pula para a próxima opção
    if (totalDisbursed < MIN_DISBURSE) {
      console.log(`🛑 Desembolso total ${totalDisbursed.toFixed(2)} abaixo do mínimo (${MIN_DISBURSE}) para ${parcelas} parcelas. Pulando...`);
      continue;
    }

    const body = {
      consult_id: consultId,
      config_id: config.id,
      installment_face_value: perInstallment,
      number_of_installments: parcelas
      // provider: "QI" // opcional, adicione se o seu endpoint exigir
    };

    console.log(`🔎 Tentando simulação com parcelas=${parcelas}, installment_face_value=${perInstallment.toFixed(2)}`);
    try {
      const res = await axios.post(url, body, { headers: { Authorization: `Bearer ${accessToken}` } });
      console.log("✅ Simulação criada com sucesso:", res.data);
      return {
        valor_solicitado: totalDisbursed,
        numero_parcelas: parcelas,
        valor_parcela: res.data.installment_value,
        valor_cliente_recebe: res.data.disbursed_issue_amount,
        cet: res.data.disbursement_option?.cet,
        detalhes: res.data
      };
    } catch (err) {
      const titulo = (err.response?.data?.title || "").toLowerCase();
      // Se for erro relacionado à parcela/margem, tenta a próxima opção
      if (titulo.includes("installment") || titulo.includes("margin") || titulo.includes("above") ||
          titulo.includes("minimum") || titulo.includes("under")) {
        console.log(`⚠️ Erro com parcelas=${parcelas}, tentando próxima opção...`);
        continue;
      } else {
        console.error("❌ Erro não esperado ao criar simulação:", err.response?.data || err.message);
        return null;
      }
    }
  }

  console.error("❌ Todas as opções de parcelas falharam na simulação.");
  return null;
}


async function aguardarMargem(token, cpfFormatado, consultId) {
  const maxTentativas = 20; // ajuste conforme necessidade
  const intervaloMs = 4000;
  const prontoStatuses = ["SUCCESS", "CONSENT_APPROVED"];

  for (let i = 0; i < maxTentativas; i++) {
    const margemData = await obterMargemPorId(token, cpfFormatado, consultId);
    if (margemData) {
      console.log(`Status atual do termo: ${margemData.status}, margem=${margemData.margem}`);
      if (margemData.margem > 0 && prontoStatuses.includes(margemData.status)) {
        console.log(`✅ Margem disponível e status ${margemData.status} aceito para prosseguir: ${margemData.margem}`);
        return margemData;
      } else if (margemData.status === "REJECTED") {
        console.error("❌ Termo foi rejeitado. Encerrando polling.");
        return null;
      } else {
        console.log(`⚠️ Status ${margemData.status} não é considerado pronto. Continuando a esperar...`);
      }
    } else {
      console.log("⏳ Sem margem ainda (termo não encontrado).");
    }
    console.log(`⏳ Esperando margem pronta... (${i + 1}/${maxTentativas})`);
    await new Promise(r => setTimeout(r, intervaloMs));
  }
  return null;
}

/** ==================== ROTA POST ==================== */
app.post("/simular", async (req, res) => {
    const { cpf } = req.body;
    if (!cpf) return res.status(400).json({ erro: "CPF não fornecido" });

    const cpfFormatado = formatarCPF(cpf);
    const clientUtilitarios = createClientUtilitarios(TOKEN_UTILITARIOS);

    const pessoa = await getPessoaByCPF(clientUtilitarios, cpfFormatado);
    if (!pessoa) return res.status(404).json({ erro: `CPF ${cpfFormatado} não encontrado` });

    const tokenV8 = await autenticarV8();

    try {
        console.log("🔔 Iniciando fluxo de simulação CLT para CPF:", cpfFormatado);

        // 1) Gerar termo
        const termoId = await gerarTermo(tokenV8, pessoa);
        console.log("✅ Termo gerado:", termoId);

        // 2) Autorizar termo
        await autorizarTermo(tokenV8, termoId);
        console.log("✅ Termo autorizado");

        // 3) Polling da margem usando o consultId do termo criado
        console.log("🏁 Iniciando polling de margem com consultId:", termoId);
        const margemData = await aguardarMargem(tokenV8, cpfFormatado, termoId);
        if (!margemData) {
            console.error("❌ Margem não ficou disponível dentro do tempo esperado.");
            return res.status(504).json({ erro: "Margem não disponível após polling" });
        }

        console.log("margemData:", margemData);

        // Agora pode buscar as taxas e criar a simulação
        const config = await consultarTaxas(tokenV8);
        console.log("💠 Config obtido:", config);

        // Tenta criar a simulação com várias parcelas até funcionar
        const simulacao = await criarSimulacao(tokenV8, margemData.termId, config, margemData.margem);

        if (!simulacao) {
            console.error("❌ Falha ao criar a simulação com todas as parcelas disponíveis.");
            return res.status(500).json({ erro: "Falha ao criar a simulação" });
        }

        // 6) Retornar o valor que entra na conta
        console.log("🏁 Fluxo concluído. Retornando dados da simulação.");
        return res.json({
            valor_que_cliente_recebera_na_conta: simulacao?.valor_cliente_recebe,
            valor_parcela: simulacao?.valor_parcela,
            numero_parcelas: simulacao?.numero_parcelas,
            cet: simulacao?.cet
        });
    } catch (err) {
        console.error("❌ Erro geral na operação:", err);
        return res.status(500).json({ erro: err.message });
    }
});


/** ==================== INICIAR SERVER ==================== */
app.listen(PORT, () => console.log(`🚀 Server rodando`));
