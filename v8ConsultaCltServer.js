const express = require("express");
const axios = require("axios");
const qs = require("qs");

const app = express();
app.use(express.json());

/** ==================== CONFIGURAÇÕES ==================== */
const PORT = process.env.PORT || 3000;
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

async function gerarTermo(accessToken, pessoa) {
    const url = `${V8_BASE}/private-consignment/consult`;
    const body = {
        borrowerDocumentNumber: pessoa.cpf,
        gender: pessoa.gender || "male",
        birthDate: pessoa.birthDate || "1991-01-01",
        signerName: pessoa.name || "NOME DESCONHECIDO",
        signerEmail: pessoa.email || "email@teste.com",
        signerPhone: { phoneNumber: pessoa.phone || "999999999", countryCode: "55", areaCode: pessoa.areaCode || "71" },
        provider: "QI"
    };
    const res = await axios.post(url, body, { headers: { Authorization: `Bearer ${accessToken}` } });
    console.log(`✅ Termo gerado: ${res.data.id}`);
    return res.data.id;
}

async function autorizarTermo(accessToken, consultId) {
    const url = `${V8_BASE}/private-consignment/consult/${consultId}/authorize`;
    await axios.post(url, {}, { headers: { Authorization: `Bearer ${accessToken}` } });
    console.log("✅ Termo autorizado");
}

async function obterMargem(accessToken, cpf) {
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
    const termo = res.data.data?.[0];
    if (!termo) {
        console.log(`⚠️ Nenhum termo encontrado para CPF ${cpf}`);
        return null;
    }
    return { termId: termo.id, margem: parseFloat(termo.availableMarginValue) };
}

async function consultarTaxas(accessToken) {
    const url = `${V8_BASE}/private-consignment/simulation/configs`;
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    return res.data.configs?.[0];
}

async function criarSimulacao(accessToken, consultId, config, margemDisponivel) {
    const url = `${V8_BASE}/private-consignment/simulation`;

    const parcelas = Math.max(...config.number_of_installments.map(n => parseInt(n, 10)));

    // respeitar o limite máximo de operação da API
    const VALOR_MAXIMO = 25000;
    const valorEmprestimo = Math.min(margemDisponivel * parcelas, VALOR_MAXIMO);


    console.log(`⏳ Valor liberado de R$${valorEmprestimo} em ${parcelas}x`);

    var resultado = {
        margem_disponivel: margemDisponivel,
        numero_parcelas: parcelas
    }
    return resultado;


    //   const body = {
    //     consult_id: consultId,
    //     config_id: config.id,
    //     disbursed_amount: valorEmprestimo,
    //     number_of_installments: parcelas,
    //     provider: "QI"
    //   };

    //   console.log("📌 Body enviado para a simulação:", body);

    //   try {
    //     const res = await axios.post(url, body, { headers: { Authorization: `Bearer ${accessToken}` } });
    //     console.log("✅ Simulação criada:", res.data);
    //     return res.data;
    //   } catch (err) {
    //     console.error("❌ Erro ao criar simulação:", err.response?.data || err.message);
    //     return null;
    //   }
}

/** ==================== ROTA POST ==================== */
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
        const termoId = await gerarTermo(tokenV8, pessoa);
        await autorizarTermo(tokenV8, termoId);

        // espera processamento
        await new Promise(r => setTimeout(r, 10000));

        const margemData = await obterMargem(tokenV8, cpfFormatado);
        if (!margemData) return res.status(404).json({ erro: "Margem não encontrada" });

        const config = await consultarTaxas(tokenV8);

        const simulacao = await criarSimulacao(tokenV8, margemData.termId, config, margemData.margem);

        // Retorna apenas o valor liberado
        return res.json({
            resultado: simulacao || margemData.margem // se simulacao não existir, retorna a margem
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ erro: err.message });
    }
});


/** ==================== INICIAR SERVER ==================== */
app.listen(PORT, () => console.log(`🚀 Server rodando`));




