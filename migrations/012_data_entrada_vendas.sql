-- Migration 012: Adiciona campo data_entrada na tabela vendas
-- data_entrada é a data base para cálculo de vencimentos de parcelas, sinal e balões

ALTER TABLE vendas
ADD COLUMN IF NOT EXISTS data_entrada DATE;

COMMENT ON COLUMN vendas.data_entrada IS 'Data da entrada (assinatura/ato), base para calcular vencimentos das parcelas pro-soluto';
