const express = require("express");
const https = require("https");
const forge = require("node-forge");

const app = express();
app.use(express.json({ limit: "10mb" }));

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error("FATAL: API_KEY environment variable is required");
  process.exit(1);
}

// Auth middleware
function authMiddleware(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Parse PFX buffer into key + cert PEM strings
function parsePfx(pfxBuffer, password) {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);

  let certPem = "";
  let keyPem = "";

  for (const safeContent of p12.safeContents) {
    for (const bag of safeContent.safeBags) {
      if (bag.type === forge.pki.oids.certBag) {
        certPem += forge.pki.certificateToPem(bag.cert);
      } else if (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag) {
        keyPem = forge.pki.privateKeyToPem(bag.key);
      }
    }
  }

  if (!certPem || !keyPem) {
    throw new Error("Não foi possível extrair chave/certificado do PFX");
  }

  return { certPem, keyPem };
}

// Make HTTPS request with mTLS
function mtlsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || "POST",
      headers: options.headers || {},
      key: options.key,
      cert: options.cert,
      rejectUnauthorized: true,
    };

    const req = https.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Build the Integra Contador request body
function buildConsultarBody(escritorio, company, fetch_type, periodo) {
  const cnpjContribuinte = company.cnpj.replace(/\D/g, "");
  const cnpjConvenio = (escritorio.cnpj_convenio || "").replace(/\D/g, "");
  const cpfResponsavel = (escritorio.cpf_responsavel || "").replace(/\D/g, "");

  const body = {
    contratante: {
      numero: cnpjConvenio,
      tipo: 2,
    },
    autorPedidoDados: {
      numero: cpfResponsavel,
      tipo: 1,
    },
    contribuinte: {
      numero: cnpjContribuinte,
      tipo: 2,
    },
    pedidoDados: {},
  };

  if (fetch_type === "pgdas") {
    // Determine if periodo is year (4 digits) or PA (6 digits)
    const p = (periodo || "").replace(/\D/g, "");
    let dados;
    if (p.length === 4) {
      dados = JSON.stringify({ anoCalendario: p });
    } else if (p.length === 6) {
      dados = JSON.stringify({ pa: p });
    } else {
      // Default to current year
      const year = new Date().getFullYear().toString();
      dados = JSON.stringify({ anoCalendario: year });
    }

    body.pedidoDados = {
      idSistema: "PGDASD",
      idServico: "CONSDECLARACAO13",
      versaoSistema: "1.0",
      dados: dados,
    };
  } else if (fetch_type === "situacao_fiscal") {
    body.pedidoDados = {
      idSistema: "SITFIS",
      idServico: "SOLICITARPROTOCOLO91",
      versaoSistema: "1.0",
      dados: "{}",
    };
  }

  return body;
}

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "serpro-proxy" });
});

// Main endpoint
app.post("/serpro/consultar", authMiddleware, async (req, res) => {
  try {
    const { company, fetch_type, periodo, certificado, serpro_credentials, escritorio } = req.body;

    if (!certificado?.pfx_base64 || !certificado?.senha) {
      return res.status(400).json({ error: "Certificado (pfx_base64 + senha) é obrigatório" });
    }
    if (!serpro_credentials?.consumer_key || !serpro_credentials?.consumer_secret) {
      return res.status(400).json({ error: "Credenciais SERPRO (consumer_key + consumer_secret) são obrigatórias" });
    }
    if (!company?.cnpj) {
      return res.status(400).json({ error: "CNPJ da empresa é obrigatório" });
    }
    if (!escritorio?.cnpj_convenio || !escritorio?.cpf_responsavel) {
      return res.status(400).json({ error: "Dados do escritório (cnpj_convenio + cpf_responsavel) são obrigatórios" });
    }

    console.log(`[SERPRO] Consulta ${fetch_type} para CNPJ ${company.cnpj}`);

    // 1. Parse PFX certificate
    const pfxBuffer = Buffer.from(certificado.pfx_base64, "base64");
    let certPem, keyPem;
    try {
      const parsed = parsePfx(pfxBuffer, certificado.senha);
      certPem = parsed.certPem;
      keyPem = parsed.keyPem;
    } catch (e) {
      console.error("[SERPRO] Erro ao parsear PFX:", e.message);
      return res.status(400).json({ error: "Erro ao processar certificado: " + e.message });
    }

    // 2. OAuth2 token with mTLS
    const authString = Buffer.from(
      `${serpro_credentials.consumer_key}:${serpro_credentials.consumer_secret}`
    ).toString("base64");

    const tokenBody = "grant_type=client_credentials";

    let tokenResponse;
    try {
      tokenResponse = await mtlsRequest(
        "https://autenticacao.sapi.serpro.gov.br/authenticate",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${authString}`,
            "Content-Length": Buffer.byteLength(tokenBody),
            "Role-Type": "TERCEIROS",
          },
          key: keyPem,
          cert: certPem,
        },
        tokenBody
      );
    } catch (e) {
      console.error("[SERPRO] Erro na conexão mTLS para autenticação:", e.message);
      return res.status(502).json({
        error: "Erro na conexão mTLS com SERPRO (autenticação)",
        details: e.message,
      });
    }

    if (tokenResponse.status !== 200) {
      console.error("[SERPRO] Auth falhou:", tokenResponse.status, tokenResponse.body);
      return res.status(502).json({
        error: `Erro na autenticação SERPRO: ${tokenResponse.status}`,
        details: tokenResponse.body,
      });
    }

    let tokenData;
    try {
      tokenData = JSON.parse(tokenResponse.body);
    } catch {
      return res.status(502).json({
        error: "Resposta inválida do SERPRO na autenticação",
        details: tokenResponse.body,
      });
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.status(502).json({
        error: "Token não recebido do SERPRO",
        details: tokenResponse.body,
      });
    }

    console.log("[SERPRO] Token obtido com sucesso");

    // 3. Build request body and call the correct endpoint
    const consultarBody = buildConsultarBody(escritorio, company, fetch_type, periodo);

    // Determine the endpoint based on fetch_type
    let apiUrl;
    if (fetch_type === "pgdas") {
      apiUrl = "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Consultar";
    } else if (fetch_type === "situacao_fiscal") {
      // Step 1: Request protocol via /Apoiar
      apiUrl = "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Apoiar";
    } else {
      return res.status(400).json({ error: `fetch_type inválido: ${fetch_type}` });
    }

    const requestBodyStr = JSON.stringify(consultarBody);
    console.log(`[SERPRO] POST ${apiUrl}`);
    console.log(`[SERPRO] Body: ${requestBodyStr}`);

    let apiResponse;
    try {
      apiResponse = await mtlsRequest(
        apiUrl,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "Content-Length": Buffer.byteLength(requestBodyStr),
          },
          key: keyPem,
          cert: certPem,
        },
        requestBodyStr
      );
    } catch (e) {
      console.error("[SERPRO] Erro na consulta API:", e.message);
      return res.status(502).json({
        error: "Erro na conexão mTLS com SERPRO (consulta)",
        details: e.message,
      });
    }

    console.log(`[SERPRO] Response status: ${apiResponse.status}`);
    console.log(`[SERPRO] Response body: ${apiResponse.body.substring(0, 500)}`);

    if (apiResponse.status !== 200) {
      console.error("[SERPRO] API retornou:", apiResponse.status, apiResponse.body);

      const statusCode = apiResponse.status >= 400 && apiResponse.status < 500
        ? apiResponse.status
        : 502;

      return res.status(statusCode).json({
        error: `SERPRO API retornou ${apiResponse.status}`,
        details: apiResponse.body,
      });
    }

    let apiData;
    try {
      apiData = JSON.parse(apiResponse.body);
    } catch {
      apiData = apiResponse.body;
    }

    // For situacao_fiscal, if step 1 succeeded we might need step 2
    // But first let's return step 1 result to validate the connection works
    if (fetch_type === "situacao_fiscal" && apiData) {
      console.log("[SERPRO] SITFIS step 1 (Apoiar) response received");
      // If the response contains a protocol, we could do step 2 (/Emitir)
      // For now, return the protocol/result from step 1
    }

    console.log("[SERPRO] Consulta realizada com sucesso");

    return res.json({
      status: "success",
      data: apiData,
    });
  } catch (error) {
    console.error("[SERPRO] Erro inesperado:", error);
    return res.status(500).json({ error: "Erro interno do proxy", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SERPRO Proxy rodando na porta ${PORT}`);
});
