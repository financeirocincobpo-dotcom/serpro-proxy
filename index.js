const express = require("express");
const https = require("https");
const http = require("http");
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
    // 3. API call based on fetch_type
    let apiUrl;
    const cnpj = company.cnpj.replace(/\D/g, "");
    if (fetch_type === "pgdas") {
      const pa = periodo || new Date().toISOString().slice(0, 7).replace("-", "");
      apiUrl = `https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/pgdasd/${cnpj}/${pa}`;
    } else if (fetch_type === "situacao_fiscal") {
      apiUrl = `https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/situacao-fiscal/${cnpj}`;
    } else {
      return res.status(400).json({ error: `fetch_type inválido: ${fetch_type}` });
    }
    let apiResponse;
    try {
      apiResponse = await mtlsRequest(
        apiUrl,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
          key: keyPem,
          cert: certPem,
        },
        null
      );
    } catch (e) {
      console.error("[SERPRO] Erro na consulta API:", e.message);
      return res.status(502).json({
        error: "Erro na conexão mTLS com SERPRO (consulta)",
        details: e.message,
      });
    }
    if (apiResponse.status !== 200) {
      console.error("[SERPRO] API retornou:", apiResponse.status, apiResponse.body);
      return res.status(502).json({
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
 let parsedDetails: any = null;
      try { parsedDetails = JSON.parse(errText); } catch {}
      
      if (proxyResponse.status === 404 || parsedDetails?.error?.includes("404")) {
      // Detect embedded 404 even when proxy returns 502 (proxy not redeployed yet)
      const detailsStr = typeof parsedDetails?.details === "string" ? parsedDetails.details : "";
      const errorStr = typeof parsedDetails?.error === "string" ? parsedDetails.error : "";
      const combined = `${errorStr} ${detailsStr}`;
      let effectiveStatus = proxyResponse.status;
      if (combined.includes("404")) {
        effectiveStatus = 404;
        userMessage = "Dados não encontrados no SERPRO. Verifique se a empresa é optante do Simples Nacional e se existe declaração PGDAS-D para o período selecionado.";
      } else if (proxyResponse.status === 401 || proxyResponse.status === 403) {
      } else if (combined.includes("401") || combined.includes("403") || proxyResponse.status === 401 || proxyResponse.status === 403) {
        effectiveStatus = 403;
        userMessage = "Acesso negado pelo SERPRO. Verifique se a procuração eletrônica está ativa para esta empresa.";
      }
      const returnStatus = effectiveStatus >= 400 && effectiveStatus < 500 ? effectiveStatus : 502;
      
      return new Response(
          error: userMessage,
          details: errText,
          not_found: returnStatus === 404,
        }),
        {
          status: proxyResponse.status >= 400 && proxyResponse.status < 500 ? proxyResponse.status : 502,
          status: returnStatus,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
