# SERPRO Proxy — mTLS para Integra Contador
Servidor intermediário que faz a conexão mTLS com a API SERPRO, necessária porque o ambiente Lovable Cloud (Deno) não suporta mTLS nativamente.
## Deploy no Railway (gratuito)
### Passo 1 — Criar conta
1. Acesse [railway.app](https://railway.app) e crie uma conta (pode usar GitHub)
### Passo 2 — Criar projeto
1. Clique em **"New Project"**
2. Selecione **"Deploy from GitHub repo"** (se subiu o código) ou **"Empty Project"**
3. Se escolheu Empty Project:
   - Clique em **"Add Service" → "GitHub Repo"** ou **"Docker Image"**
   - Ou use o CLI: `railway init` e `railway up`
### Passo 3 — Subir o código
**Opção A — Via GitHub:**
1. Crie um repositório no GitHub com os 3 arquivos desta pasta (`index.js`, `package.json`, `README.md`)
2. Conecte o repo no Railway
**Opção B — Via CLI:**
```bash
npm install -g @railway/cli
railway login
cd serpro-proxy
railway init
railway up
```
### Passo 4 — Configurar variável de ambiente
1. No painel do Railway, vá em **Variables**
2. Adicione: `API_KEY` = uma senha forte que você escolher (ex: `minha-chave-secreta-123`)
### Passo 5 — Gerar URL pública
1. Vá em **Settings → Networking → Generate Domain**
2. Copie a URL gerada (ex: `https://serpro-proxy-production.up.railway.app`)
### Passo 6 — Configurar no Lovable Cloud
No Lovable, configure dois segredos:
- **`SERPRO_PROXY_URL`** = a URL do passo 5 (ex: `https://serpro-proxy-production.up.railway.app`)
- **`SERPRO_PROXY_API_KEY`** = a mesma senha do passo 4
---
## Deploy no Render (alternativa gratuita)
1. Acesse [render.com](https://render.com) e crie uma conta
2. Clique em **"New" → "Web Service"**
3. Conecte seu repositório GitHub ou suba o código
4. Configure:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Em **Environment**, adicione: `API_KEY` = sua senha
6. Copie a URL gerada e configure no Lovable Cloud como acima
---
## Teste local
```bash
cd serpro-proxy
npm install
API_KEY=teste node index.js
```
```bash
curl http://localhost:3000/ 
# Deve retornar: {"status":"ok","service":"serpro-proxy"}
```
## Endpoint
### `POST /serpro/consultar`
**Headers:**
- `Content-Type: application/json`
- `X-API-Key: <sua-api-key>`
**Body:**
```json
{
  "company": { "cnpj": "12345678000190", "razao_social": "Empresa Teste" },
  "fetch_type": "pgdas",
  "periodo": "202401",
  "certificado": {
    "pfx_base64": "<base64 do arquivo .pfx>",
    "senha": "senha-do-certificado"
  },
  "serpro_credentials": {
    "consumer_key": "...",
    "consumer_secret": "..."
  },
  "escritorio": {
    "cnpj_convenio": "...",
    "cpf_responsavel": "...",
    "nome_responsavel": "..."
  }
}
```