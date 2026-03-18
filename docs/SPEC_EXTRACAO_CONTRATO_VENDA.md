# SPEC-DRIVEN — Extração automática de contrato para pré-preenchimento da venda

**Fonte absoluta de instruções.**  
O restante do documento (seções 1–21) é a especificação canônica. A partir da seção **"Alinhamento com o banco e o código"** há o cruzamento com dados reais do banco e do front, **decisões fechadas** (P1–P5), **ajustes explícitos** (sobrescrita, partial failure, confiança default) e **estrutura de pastas** (backend e frontend).

---

## 1. Objetivo

Permitir que a consultora anexe um contrato (PDF, DOC, DOCX, JPG, PNG) e o sistema:

- extraia automaticamente os dados relevantes
- preencha o formulário de venda
- sugira vínculos (cliente, corretor, empreendimento)
- permita revisão antes do salvamento

**O fluxo atual de salvar venda → gerar pagamentos permanece inalterado.**

---

## 2. Problema

Hoje o preenchimento da venda é manual, gerando:

- retrabalho
- erros de digitação
- inconsistência com o contrato
- impacto direto na aba de pagamentos

---

## 3. Escopo

**Inclui**

- Upload de contrato
- Extração de texto (PDF/OCR)
- Estruturação via LLM
- Normalização de dados
- Matching de entidades
- Preenchimento automático do formulário
- Revisão manual obrigatória

**Não inclui**

- Salvamento automático da venda
- Alteração na geração de pagamentos
- Substituição de validações existentes

---

## 4. Fluxo funcional

```
[Consultora anexa contrato]
        ↓
[Frontend envia arquivo]
        ↓
[Backend recebe]
        ↓
[Extrai texto (PDF ou OCR)]
        ↓
[LLM estrutura dados → JSON]
        ↓
[Normaliza + valida]
        ↓
[Resolve entidades (match)]
        ↓
[Retorna JSON]
        ↓
[Frontend preenche formulário]
        ↓
[Consultora revisa]
        ↓
[Salvar venda → fluxo atual]
```

---

## 5. Arquitetura

**Backend (Node recomendado)**  
Responsável por: parsing de PDF, OCR (fallback), chamada ao LLM, validação de schema, normalização, matching de entidades.

**Frontend (React)**  
Responsável por: upload do contrato, chamada ao endpoint, preenchimento do formulário, exibição de sugestões, revisão do usuário.

---

## 6. Endpoint

**POST** `/vendas/extrair-contrato`

**Request:** `multipart/form-data` — `file`: contrato

**Response:**

```json
{
  "success": true,
  "data": {
    "sale_form": {},
    "valor_pro_soluto_extraido": 50000,
    "entity_matches": {},
    "confidence": {},
    "warnings": [],
    "document_meta": {
      "hash": "",
      "source_type": "pdf_text|ocr"
    }
  }
}
```

- **valor_pro_soluto_extraido** (opcional): valor extraído do contrato **apenas como referência**. O frontend **recalcula sempre** o valor real (soma sinal + entrada + balões). Se divergir do extraído → exibir alerta para a consultora.

---

## 7. Extração de texto

**Estratégia**

1. **PDF com texto** → usar parser de PDF no backend  
2. **PDF escaneado / imagem** → usar OCR  

**Regra:** só usar OCR se não houver texto suficiente.

---

## 8. Uso de LLM

**Entrada:** texto extraído do contrato + instrução fixa + schema JSON  

**Saída:** JSON estruturado (sem texto livre)

---

## 9. Schema esperado (saída do LLM / entrada da normalização)

```json
{
  "sale": {
    "cliente_nome": "",
    "cliente_cpf": "",
    "corretor_nome": "",
    "empreendimento_nome": "",
    "unidade": "",
    "bloco": "",
    "andar": "",
    "valor_venda": 0,
    "data_venda": "",
    "status": "",
    "descricao": ""
  },
  "pro_soluto": {
    "teve_sinal": false,
    "valor_sinal": 0,
    "teve_entrada": false,
    "valor_entrada": 0,
    "parcelou_entrada": false,
    "grupos_parcelas_entrada": [],
    "teve_balao": false,
    "grupos_balao": [],
    "teve_permuta": false,
    "tipo_permuta": "",
    "valor_permuta": 0,
    "valor_pro_soluto": 0
  },
  "meta": {
    "confidence": {},
    "warnings": [],
    "source_type": ""
  }
}
```

**Normalização (backend):** `status` é sempre definido como `'pendente'` (decisão P1). `tipo_corretor` é definido como `'externo'` (decisão P2); não vem do LLM. O `sale_form` retornado ao front deve incluir `tipo_corretor: 'externo'` e `status: 'pendente'`.

---

## 10. Normalização obrigatória

- **Datas:** converter para ISO (YYYY-MM-DD).
- **Valores:** remover R$, converter vírgula → ponto, garantir número válido.
- **Booleanos:** “sim”, “há” → true; “não”, “sem” → false.
- **Parcelas:** transformar texto em estrutura (ver seção “Alinhamento” para formato exato no formulário).

---

## 11. Matching de entidades

**Entrada (LLM):** cliente_nome, cliente_cpf, corretor_nome, empreendimento_nome  

**Processo:** buscar no banco: cliente → CPF/nome; corretor → nome; empreendimento → nome  

**Saída:** por entidade: `{ "status": "single|multiple|none", "options": [] }`  

**Regras:** 1 match → auto preencher; múltiplos → usuário escolhe; nenhum → manual.

---

## 12. UX

**Botão:** “Extrair dados do contrato”  

**Estados:** loading, sucesso, erro  

**Após extração:** formulário preenchido; campos destacados por confiança; sugestões de vínculo (cliente/corretor/empreendimento). **Destacar o campo `tipo_corretor` como obrigatório revisar** (decisão P2).

---

## 13. Confiança

Exemplo: `{ "valor_venda": "alta", "cliente_nome": "alta", "grupos_balao": "media", "tipo_permuta": "baixa" }`  

**UI:** alta → normal; média → atenção; baixa → destaque.

**Regra:** Se o backend não enviar confiança para um campo → tratar como **"média"** (evitar assumir alta sem motivo).

**Regra:** Se o backend não enviar confiança para um campo → tratar como **"média"** (exibir com atenção).

---

## 14. Cache

**Estratégia:** gerar hash do arquivo.  
**Regra:** se já processado → reutilizar.

---

## 15. Tabela sugerida (persistência — Fase 2)

**contrato_extracoes**

- id  
- arquivo_hash  
- arquivo_nome  
- storage_path (opcional)  
- schema_extraido_json  
- matching_json  
- status  
- origem_texto  
- created_at  

**Não persistir:** `texto_extraido` (texto bruto do contrato). Motivos: LGPD, custo, segurança. Só hash + JSON estruturado + matching são salvos.

---

## 16. Regras de negócio

- **RN01** Formatos aceitos: PDF, DOC, DOCX, JPG, PNG  
- **RN02 (Regra de sobrescrita)**  
  - Se o campo no formulário estiver **vazio** → preencher com o valor extraído.  
  - Se o campo já estiver **preenchido** → sobrescrever com o valor extraído **e destacar** o campo (consultora vê que foi alterado).  
  - Nunca sobrescrever silenciosamente sem indicar na UI.  
- **RN03** Revisão humana obrigatória  
- **RN04** Pagamentos seguem fluxo atual  

---

## 17. Tratamento de erros

Cobrir: arquivo inválido, OCR falho, JSON inválido, sem match de entidade, múltiplos matches, dados incompletos.

**Partial failure (LLM falhou em parte):**  
Se o LLM falhar em alguns campos, **ainda retornar o que conseguiu** e informar em `warnings`. Ex.: `warnings: ["balão não identificado", "data_venda indefinida"]`. O front preenche o que vier e destaca campos faltantes para revisão.

---

## 18. Fases de implementação

**Fase 1 (MVP):** upload, extração texto, LLM, normalização, preenchimento, matching básico  

**Fase 2:** confiança por campo, cache por hash, persistência (tabela contrato_extracoes)

---

## 19. Critérios de aceite

- Contrato pode ser enviado  
- Dados são extraídos  
- Formulário é preenchido  
- Entidades são sugeridas  
- Revisão é possível  
- Venda salva normalmente  
- Pagamentos gerados corretamente  

---

## 20. Decisão arquitetural final

Implementar com: Backend Node, parser de PDF, OCR (fallback), LLM estruturado, matching no backend, revisão no frontend.

---

## 21. Observações finais

- Tratar extração como sugestão, nunca verdade absoluta  
- Priorizar PDFs com texto  
- Evitar overengineering  
- Manter fluxo atual intacto  

---

# Alinhamento com o banco e o código

*(Validação contra o repositório e o schema real. Use esta seção como referência para implementação.)*

## Tabelas e fontes consultadas

- **vendas:** `supabase-schema.sql` + `migrations/003_vendas_campos_completos.sql` + `add_sienge_fields.sql`
- **Formulário de venda (front):** `src/pages/AdminDashboard.jsx` — estado `vendaForm` e payload `vendaData` no save
- **clientes:** `supabase-schema.sql` + migrations (clientes: `nome_completo`, `cpf`, `cnpj`, etc.)
- **usuarios (corretores):** `usuarios` com `tipo = 'corretor'`, `nome`, `sienge_broker_id`, etc.
- **empreendimentos:** `nome` (e `sienge_enterprise_id` para sync)
- **pagamentos_prosoluto:** gerados no save da venda a partir de `vendaForm`; não preenchidos pela extração

---

## Mapeamento: schema da SPEC → formulário e banco

### 9. Schema esperado vs `vendaForm` e `vendas`

| SPEC (LLM/normalização) | vendaForm (AdminDashboard) | Tabela `vendas` (payload vendaData) | Observação |
|-------------------------|----------------------------|--------------------------------------|------------|
| `sale.cliente_nome` / `sale.cliente_cpf` | — | — | Usados só para **matching** → preencher `cliente_id` (UUID). Não existem colunas `cliente_nome`/`cliente_cpf` na venda. |
| `sale.corretor_nome` | — | — | Matching → `corretor_id` (UUID). |
| `sale.empreendimento_nome` | — | — | Matching → `empreendimento_id` (UUID). |
| `sale.unidade` | `vendaForm.unidade` | `vendas.unidade` | Texto. **Decisão P5:** Fase 1 só preencher texto; não resolver `unidade_id`. |
| `sale.bloco` | `vendaForm.bloco` | `vendas.bloco` (uppercase no save) | No save: `bloco?.toUpperCase()`. |
| `sale.andar` | `vendaForm.andar` | `vendas.andar` | Texto. |
| `sale.valor_venda` | `vendaForm.valor_venda` | `vendas.valor_venda` | Numérico; no front pode ser string vazia `''`. |
| `sale.data_venda` | `vendaForm.data_venda` | `vendas.data_venda` | ISO date (YYYY-MM-DD). |
| `sale.status` | `vendaForm.status` | `vendas.status` | **Banco:** `CHECK (status IN ('pendente', 'pago'))`. Form usa `'pendente'` como padrão. Extração deve devolver apenas esses valores ou deixar default. |
| `sale.descricao` | `vendaForm.descricao` | `vendas.descricao` | Texto. |
| — | `vendaForm.tipo_corretor` | `vendas.tipo_corretor` | **Decisão P2:** default = `'externo'`; contrato não define isso; inferência seria frágil. UX: preencher como `'externo'` e **destacar o campo como obrigatório revisar**. |
| `pro_soluto.teve_sinal` | `vendaForm.teve_sinal` | `vendas.teve_sinal` | Boolean. |
| `pro_soluto.valor_sinal` | `vendaForm.valor_sinal` | `vendas.valor_sinal` | Numérico. |
| `pro_soluto.teve_entrada` | `vendaForm.teve_entrada` | `vendas.teve_entrada` | Boolean. |
| `pro_soluto.valor_entrada` | `vendaForm.valor_entrada` | `vendas.valor_entrada` | Numérico. |
| `pro_soluto.parcelou_entrada` | `vendaForm.parcelou_entrada` | `vendas.parcelou_entrada` | Boolean. |
| `pro_soluto.grupos_parcelas_entrada` | `vendaForm.grupos_parcelas_entrada` | — | Ver “Formato de grupos” abaixo. |
| `pro_soluto.teve_balao` | `vendaForm.teve_balao` | `vendas.teve_balao` | **Não é boolean.** Valores reais: `'nao'` \| `'sim'` \| `'pendente'`. Normalizar SPEC (true/false) → `'sim'`/`'nao'`. |
| `pro_soluto.grupos_balao` | `vendaForm.grupos_balao` | — | Ver “Formato de grupos” abaixo. |
| — | `vendaForm.qtd_parcelas_entrada` / `vendaForm.valor_parcela_entrada` | `vendas.qtd_parcelas_entrada`, `vendas.valor_parcela_entrada` | Preenchidos no save a partir do **primeiro grupo** de `grupos_parcelas_entrada` (se houver). Extração pode ignorar; o front usa os grupos. |
| — | `vendaForm.qtd_balao` / `vendaForm.valor_balao` | `vendas.qtd_balao`, `vendas.valor_balao` | Idem: derivados do primeiro grupo de `grupos_balao` no save. |
| `pro_soluto.teve_permuta` | `vendaForm.teve_permuta` | `vendas.teve_permuta` | Boolean. |
| `pro_soluto.tipo_permuta` | `vendaForm.tipo_permuta` | `vendas.tipo_permuta` | Texto. |
| `pro_soluto.valor_permuta` | `vendaForm.valor_permuta` | `vendas.valor_permuta` | Numérico. |
| `pro_soluto.valor_pro_soluto` | — | — | **Decisão P3:** backend **não** manda como verdade no `sale_form`. Envia **apenas** `valor_pro_soluto_extraido` na resposta como referência. Frontend recalcula sempre; se divergir → alerta (feature forte). |
| — | `vendaForm.contrato_url` / `vendaForm.contrato_nome` | `vendas.contrato_url`, `vendas.contrato_nome` | Preenchidos no fluxo atual pelo **upload** do contrato; não vêm do JSON de extração. |

**Campos que o backend NÃO deve preencher a partir da extração (calculados no save):**

- `vendas.comissao_total`, `vendas.comissao_corretor`, `vendas.fator_comissao`  
- São definidos no `AdminDashboard` ao salvar (comissões dinâmicas por empreendimento/cargo). Não incluir no `sale_form` de retorno.

---

## Formato de grupos (parcelas e balões)

No código, o formulário usa:

- **grupos_parcelas_entrada:** array de `{ qtd: string | number, valor: string | number }`  
  Ex.: `[{ qtd: '4', valor: '500' }, { qtd: '5', valor: '1000' }]`
- **grupos_balao:** mesmo formato: `[{ qtd: '2', valor: '10000' }, { qtd: '1', valor: '5000' }]`

A SPEC (item 10) sugere algo como:

```json
[
  { "quantidade": 3, "valor_parcela": 5000, "periodicidade": "mensal" }
]
```

**Alinhamento:** a normalização no backend deve converter a saída do LLM para o formato do front:

- `quantidade` → `qtd` (número ou string)
- `valor_parcela` → `valor` (número ou string)
- `periodicidade` pode ser ignorada para o preenchimento (o fluxo atual não usa no formulário).

Ou seja: **schema de saída da normalização para o front:**  
`grupos_parcelas_entrada` e `grupos_balao` como array de `{ qtd, valor }`.

---

## Matching: tabelas e colunas reais

- **Cliente:**  
  - Tabela: `clientes`  
  - Busca: `nome_completo` (nome do cliente), `cpf` (normalizado, sem máscara para comparação).  
  - Coluna de nome: `nome_completo` (não `nome`).

- **Corretor:**  
  - Tabela: `usuarios`  
  - Filtro: `tipo = 'corretor'`  
  - Busca: `nome`.  
  - Retorno: `id` (UUID) para preencher `vendaForm.corretor_id`.

- **Empreendimento:**  
  - Tabela: `empreendimentos`  
  - Busca: `nome`.  
  - Retorno: `id` (UUID) para preencher `vendaForm.empreendimento_id`.

**Sugestão de resposta do endpoint** para `entity_matches` (alinhada ao que o front precisa):

```json
{
  "entity_matches": {
    "cliente": {
      "status": "single",
      "options": [{ "id": "uuid", "nome_completo": "...", "cpf": "..." }]
    },
    "corretor": {
      "status": "multiple",
      "options": [{ "id": "uuid", "nome": "..." }, ...]
    },
    "empreendimento": {
      "status": "none",
      "options": []
    }
  }
}
```

O front, ao preencher o formulário, usa `options[0].id` quando `status === 'single'`; quando `multiple`, exibe seletor; quando `none`, deixa em branco ou “A definir”.

---

## Status da venda (decisão P1)

**SEMPRE `'pendente'`.**  
Contrato não garante pagamento; evitar erro financeiro; regra simples = menos bug. O backend **nunca** envia outro status na extração. Normalização: `status = 'pendente'`.

---

## Campo `teve_balao`

No banco e no formulário, `teve_balao` é **texto**: `'nao'` | `'sim'` | `'pendente'` (não boolean).  
A SPEC usa `teve_balao: false`. Na normalização, converter:

- `false` ou “não” → `'nao'`
- `true` ou “sim” → `'sim'`
- Dúvida/indefinido → `'pendente'` (ou `'nao'` por default, conforme regra de negócio).

---

## Tabela `contrato_extracoes` (decisão P4)

**SIM persistir na Fase 2, MAS SEM texto bruto.**

| Coluna | Tipo sugerido | Observação |
|--------|----------------|------------|
| id | UUID PK | |
| arquivo_hash | TEXT | Hash do arquivo para cache |
| arquivo_nome | TEXT | Nome original |
| storage_path | TEXT | Opcional; caminho no bucket se o arquivo for guardado |
| schema_extraido_json | JSONB | JSON estruturado pós-LLM (sale + pro_soluto) |
| matching_json | JSONB | Resultado do matching (entity_matches) |
| status | TEXT | ex.: 'ok', 'erro', 'parcial' |
| origem_texto | TEXT | 'pdf_text' \| 'ocr' |
| created_at | TIMESTAMPTZ | |

**NÃO salvar:** `texto_extraido` (texto completo do contrato). Motivos: LGPD, custo, segurança. Resolve LGPD/custo/segurança mantendo só hash + JSON estruturado + matching.

---

## Unidade / unidade_id (decisão P5)

**Fase 1:** **NÃO** resolver `unidade_id`.  
**Só preencher:** `vendaForm.unidade` (texto livre).

Matching de unidade é muito complexo, depende de padronização e tem alto risco de erro. Fase 2 pode evoluir para sugerir `unidade_id` se houver critério claro.

---

## Decisões fechadas (P1–P5)

| # | Tema | Decisão |
|---|------|--------|
| **P1** | Status | Sempre `'pendente'`. Contrato não garante pagamento; evitar erro financeiro; regra simples. |
| **P2** | tipo_corretor | Default `'externo'` + **obrigatório revisar**. Preencher como externo e destacar o campo na UI. |
| **P3** | valor_pro_soluto | Backend **não** manda como verdade no form. Manda `valor_pro_soluto_extraido` como referência; front recalcula sempre; se divergir → alerta. |
| **P4** | Persistência (LGPD) | **SIM** persistir, **SEM** texto bruto. Salvar: hash, JSON estruturado, matching. Não salvar: texto completo do contrato. |
| **P5** | unidade_id | Fase 1: **não** resolver. Só preencher `vendaForm.unidade` (texto). Fase 2 pode evoluir. |

---

## Ajustes importantes (explícitos na SPEC)

1. **Regra de sobrescrita (RN02)**  
   - Campo **vazio** → preencher.  
   - Campo **já preenchido** → sobrescrever **e destacar** (consultora vê que foi alterado).  
   - Nunca sobrescrever silenciosamente.

2. **Partial failure**  
   - Se o LLM falhar em parte: **ainda retornar o que conseguiu** e preencher `warnings`. Ex.: `warnings: ["balão não identificado"]`. Front preenche o que vier e destaca faltantes.

3. **Confiança default**  
   - Se o backend não enviar confiança para um campo → tratar como **"média"**.

---

## Estrutura de pastas — Backend

Encapsula controllers, routes, services e repositórios da extração de contrato.

```
backend/
├── controllers/
│   └── contratos.controller.js
├── routes/
│   └── contratos.routes.js
├── services/
│   └── contratoExtracao/
│       ├── extrairContrato.service.js
│       ├── processarDocumento.service.js
│       ├── extrairTextoPdf.service.js
│       ├── ocr.service.js
│       ├── llmExtracao.service.js
│       ├── normalizacao.service.js
│       ├── matching.service.js
│       └── cache.service.js
├── utils/
│   └── contrato/
│       ├── formatters.js
│       ├── parsers.js
│       ├── validators.js
│       └── hash.js
├── schemas/
│   └── contratoExtracao.schema.js
├── repositories/
│   └── contratoExtracao.repository.js
└── config/
    └── llm.config.js
```

**Controller** (`contratos.controller.js`): recebe o request, chama o service principal, devolve response; sem regra de negócio.

**Route** (`contratos.routes.js`): `router.post('/vendas/extrair-contrato', upload.single('file'), extrairContrato)`.

**Service principal** (`extrairContrato.service.js`): orquestrador — gera hash, verifica cache, extrai texto, chama LLM, normaliza, matching, monta resposta.

**processarDocumento.service.js**: decide se PDF tem texto → extrairTextoPdf; senão → OCR.

**extrairTextoPdf.service.js**: lê PDF com texto; retorna string.

**ocr.service.js**: fallback para imagem/PDF escaneado; retorna texto.

**llmExtracao.service.js**: monta prompt, envia texto, recebe JSON estruturado (coração da IA).

**normalizacao.service.js**: datas → ISO; valores → number; boolean → padrão sistema; grupos → `{ qtd, valor }`; teve_balao → `'sim'` \| `'nao'`.

**matching.service.js**: busca cliente, corretor, empreendimento; retorna entity_matches.

**cache.service.js**: busca por hash; salva extração (sem texto bruto).

**Utils** (`formatters.js`, `parsers.js`, `validators.js`, `hash.js`): moeda, datas, regex, validação de schema, hash do arquivo.

**Schema** (`contratoExtracao.schema.js`): define formato esperado do JSON (ex.: zod, yup ou validação manual).

**Repository** (`contratoExtracao.repository.js`): salvar extração, buscar por hash (Fase 2).

**Config** (`llm.config.js`): modelo, temperatura, limites.

**Fluxo:** controller → extrairContrato.service → cache? → processarDocumento → llmExtracao → normalizacao → matching → cache.save → response.

---

## Estrutura de pastas — Frontend (React)

```
frontend/
├── services/
│   └── contrato.service.js
├── hooks/
│   └── useContratoExtracao.js
├── components/
│   └── contrato/
│       ├── BotaoExtrairContrato.jsx
│       ├── StatusExtracao.jsx
│       ├── SugestoesMatch.jsx
│       └── CamposConfianca.jsx
└── utils/
    └── contrato/
        ├── mapExtracaoToForm.js
        └── highlightChanges.js
```

**Service** (`contrato.service.js`): `extrairContrato(file)` — FormData com `file`, POST `/vendas/extrair-contrato`.

**Hook** (`useContratoExtracao.js`): estado loading, erro, resposta.

**Componentes:** botão “Extrair dados do contrato”, status (loading/sucesso/erro), sugestões de match (cliente/corretor/empreendimento), campos por confiança.

**Mapper** (`mapExtracaoToForm.js`): transforma `sale_form` + entity_matches em objeto aplicável ao `vendaForm`. **Ponto crítico:** não jogar o JSON direto no form; usar merge controlado:

```js
setVendaForm(prev => ({
  ...prev,
  ...mapExtracaoToForm(data)
}))
```

**highlightChanges.js**: marcar campos alterados (sobrescrita) e divergência de `valor_pro_soluto_extraido` vs calculado.

---

## Organização mental

- **Backend = inteligência:** IA, parsing, normalização, matching.  
- **Frontend = experiência:** UI, revisão, seleção (match único/múltiplo/nenhum).

---

## Resumo para implementação

- **SPEC (seções 1–21)** = fonte absoluta de instruções.  
- **Alinhamento** = mapeamento para banco e `AdminDashboard`.  
- **Decisões P1–P5** = status sempre pendente; tipo_corretor default externo + destacar; valor_pro_soluto só referência + alerta se divergir; persistir sem texto bruto; unidade só texto na Fase 1.  
- **Ajustes:** regra de sobrescrita (destacar), partial failure (warnings), confiança default média.  
- **Formato de grupos:** `{ qtd, valor }`. **teve_balao:** `'nao'` \| `'sim'` \| `'pendente'`.  
- **Matching:** clientes (nome_completo/cpf), usuarios (nome, tipo corretor), empreendimentos (nome).  
- **Não preencher** comissões/fator; front recalcula valor_pro_soluto e compara com `valor_pro_soluto_extraido`.
