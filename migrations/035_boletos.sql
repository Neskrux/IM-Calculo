-- 035: Tabela de boletos bancários (integração Sicoob Cobrança V3)
--
-- Camada PRÓPRIA de cobrança: o boleto tem ciclo de vida independente da
-- parcela (pagamentos_prosoluto). Decisão de negócio 2026-07-29: o pagamento
-- do boleto atualiza o BOLETO no nosso sistema (webhook do banco), sem
-- dependência do Sienge. A baixa da PARCELA continua pelo fluxo existente —
-- ver docs/contexto/2026-07-29-boletos-sicoob.md.
--
-- Regras:
--  * 1 boleto ATIVO por parcela (re-emissão só após cancelar/baixar/erro).
--  * payload/retorno/eventos ficam gravados (auditoria completa da conversa
--    com o banco — mesmo espírito do RAW do sync Sienge).
--  * status do boleto NUNCA mexe em pagamentos_prosoluto.status.

CREATE TABLE IF NOT EXISTS boletos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- vínculos internos
  pagamento_id UUID NOT NULL REFERENCES pagamentos_prosoluto(id),
  venda_id UUID NOT NULL REFERENCES vendas(id),
  cliente_id UUID REFERENCES clientes(id),

  -- identificação no banco
  banco TEXT NOT NULL DEFAULT 'sicoob',
  ambiente TEXT NOT NULL DEFAULT 'sandbox' CHECK (ambiente IN ('sandbox', 'producao')),
  nosso_numero TEXT,          -- devolvido pelo Sicoob na emissão
  seu_numero TEXT,            -- nosso identificador enviado ao banco
  linha_digitavel TEXT,
  codigo_barras TEXT,
  qrcode_pix TEXT,            -- EMV do QR híbrido (boleto V3)

  -- dados financeiros
  valor NUMERIC(12, 2) NOT NULL,
  data_emissao DATE NOT NULL DEFAULT CURRENT_DATE,
  data_vencimento DATE NOT NULL,
  data_pagamento DATE,
  valor_pago NUMERIC(12, 2),

  -- ciclo de vida
  status TEXT NOT NULL DEFAULT 'emitido'
    CHECK (status IN ('emitido', 'registrado', 'pago', 'vencido', 'baixado', 'cancelado', 'erro')),
  motivo_cancelamento TEXT,

  -- auditoria da integração
  payload_emissao JSONB,
  retorno_emissao JSONB,
  webhook_eventos JSONB NOT NULL DEFAULT '[]'::jsonb,
  criado_por UUID REFERENCES usuarios(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boletos_pagamento ON boletos(pagamento_id);
CREATE INDEX IF NOT EXISTS idx_boletos_venda ON boletos(venda_id);
CREATE INDEX IF NOT EXISTS idx_boletos_cliente ON boletos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_boletos_status ON boletos(status);
CREATE INDEX IF NOT EXISTS idx_boletos_vencimento ON boletos(data_vencimento);

-- nosso_numero é único por banco (quando existir)
CREATE UNIQUE INDEX IF NOT EXISTS uq_boletos_nosso_numero
  ON boletos(banco, nosso_numero) WHERE nosso_numero IS NOT NULL;

-- Um boleto vivo por parcela: emitido/registrado/vencido/pago bloqueiam
-- nova emissão; cancelado/baixado/erro liberam.
CREATE UNIQUE INDEX IF NOT EXISTS uq_boletos_parcela_ativa
  ON boletos(pagamento_id)
  WHERE status NOT IN ('cancelado', 'baixado', 'erro');

-- updated_at automático
CREATE OR REPLACE FUNCTION boletos_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_boletos_updated_at ON boletos;
CREATE TRIGGER trg_boletos_updated_at
  BEFORE UPDATE ON boletos
  FOR EACH ROW EXECUTE FUNCTION boletos_touch_updated_at();
