-- LOTE REVISAVEL — NAO EXECUTADO. Restaura 5 parcelas PENDENTES ao valor do Sienge (income 2026-11-09).
-- ver .claude/rules/sincronizacao-sienge.md · spec docs/specs/2026-11-10-spec-sync-merge-pagamentos.md
-- Causa: sync (mergePagamentos) gravou valor de outra serie. Comissao = valor x fator_comissao_aplicado (identidade).
-- Guardas: so altera se status=pendente E valor ainda = o atual errado. Rodar 2x = 0 linhas.
-- ⚠️ Rodar SO depois do deploy do conserto do sync, senao o cron reescreve.
begin;
-- 803 D · titulo 178 parc 17 (PM, venc 2027-01-10) · ANTES valor 1500 comissao 285.69 -> DEPOIS valor 2650 comissao 504.72
update pagamentos_prosoluto set valor = 2650, comissao_gerada = 504.72, updated_at = now()
 where id = '0bb0def8-81f1-416b-ac96-347215742736' and status = 'pendente' and valor = 1500 and comissao_gerada = 285.69;
-- 1805 A · titulo 293 parc 6 (B1, venc 2026-03-20) · ANTES valor 3780 comissao 1301.74 -> DEPOIS valor 1260 comissao 433.91
update pagamentos_prosoluto set valor = 1260, comissao_gerada = 433.91, updated_at = now()
 where id = '33e92c17-0970-4d4f-ab48-0f3abefea75f' and status = 'pendente' and valor = 3780 and comissao_gerada = 1301.74;
-- 803 D · titulo 178 parc 15 (PM, venc 2026-11-10) · ANTES valor 1500 comissao 285.69 -> DEPOIS valor 2650 comissao 504.72
update pagamentos_prosoluto set valor = 2650, comissao_gerada = 504.72, updated_at = now()
 where id = 'b393beed-bffb-43e4-a3ed-eddae9434a3a' and status = 'pendente' and valor = 1500 and comissao_gerada = 285.69;
-- 803 D · titulo 178 parc 20 (PM, venc 2027-04-10) · ANTES valor 1500 comissao 285.69 -> DEPOIS valor 2650 comissao 504.72
update pagamentos_prosoluto set valor = 2650, comissao_gerada = 504.72, updated_at = now()
 where id = 'd3e0b115-82ec-45ce-8611-282f9d9a063d' and status = 'pendente' and valor = 1500 and comissao_gerada = 285.69;
-- 1004 D · titulo 268 parc 22 (PM, venc 2027-04-20) · ANTES valor 1000 comissao 314.47 -> DEPOIS valor 1766.35 comissao 555.47
update pagamentos_prosoluto set valor = 1766.35, comissao_gerada = 555.47, updated_at = now()
 where id = 'f09503ea-2e76-4cf2-ab8a-5461b520975b' and status = 'pendente' and valor = 1000 and comissao_gerada = 314.47;
-- conferencia: deve devolver as 5 linhas com valor do Sienge
select id, valor, comissao_gerada, round(valor*fator_comissao_aplicado,2) identidade from pagamentos_prosoluto where id in ('0bb0def8-81f1-416b-ac96-347215742736','33e92c17-0970-4d4f-ab48-0f3abefea75f','b393beed-bffb-43e4-a3ed-eddae9434a3a','d3e0b115-82ec-45ce-8611-282f9d9a063d','f09503ea-2e76-4cf2-ab8a-5461b520975b');
-- commit;  -- so com ok do Jonas (rollback; se algo nao bater)
rollback;
