-- Anonimizacao de PII em HOMOLOGACAO. NUNCA rodar em producao.
--
-- O que MASCARA: dados pessoais de CLIENTE (nome, CPF, RG, email, telefone,
-- endereco, URLs de documento) e de complementadores de renda.
--
-- O que PRESERVA de proposito: nome de CORRETOR e de COORDENADORA. A usuaria
-- precisa reconhecer os casos pelo nome (Matheus Pires, Jessica, Carol) — sao
-- colegas de trabalho, nao terceiros. Preserva tambem TODO valor financeiro,
-- data, unidade, fator e vinculo: e o que ela vai conferir.

begin;

-- Guarda: so roda onde a marca de homologacao existe. A marca e criada pelo
-- clonar-para-homologacao.sh APOS o restore, contra a HOMOLOG_DB_URL. Producao
-- nunca tem essa tabela, entao este script aborta la. Nao usar contagem de
-- linhas como guarda: prod e homolog tem o mesmo volume (o homolog e copia).
do $$
begin
  if to_regclass('public._homolog_marker') is null then
    raise exception 'Sem _homolog_marker — este banco NAO e homologacao. Abortado.';
  end if;
end $$;

update clientes set
  nome_completo = 'CLIENTE TESTE ' || upper(left(md5(id::text), 6)),
  cpf           = case when cpf is null then null else lpad((abs(hashtext(id::text)) % 100000000000)::text, 11, '0') end,
  cnpj          = case when cnpj is null then null else lpad((abs(hashtext(id::text)) % 100000000000000)::text, 14, '0') end,
  rg            = case when rg is null then null else 'RG' || (abs(hashtext(id::text)) % 1000000)::text end,
  email         = case when email is null then null else 'cliente+' || left(md5(id::text), 8) || '@homolog.local' end,
  telefone      = case when telefone is null then null else '(48) 9' || lpad((abs(hashtext(id::text)) % 10000000)::text, 8, '0') end,
  endereco      = case when endereco is null then null else 'Rua de Teste, ' || (abs(hashtext(id::text)) % 999) end,
  cep           = case when cep is null then null else '88000-000' end,
  nome_pai      = case when nome_pai is null then null else 'PAI TESTE' end,
  nome_mae      = case when nome_mae is null then null else 'MAE TESTE' end,
  rg_frente_url = null, rg_verso_url = null, cpf_url = null,
  comprovante_residencia_url = null, comprovante_renda_url = null,
  certidao_casamento_url = null;

-- vendas guardam uma copia do nome do cliente
update vendas v set nome_cliente = c.nome_completo
  from clientes c where c.id = v.cliente_id and v.nome_cliente is not null;

update complementadores_renda set
  nome  = 'COMPLEMENTADOR TESTE ' || upper(left(md5(id::text), 4)),
  cpf   = case when cpf is null then null else lpad((abs(hashtext(id::text)) % 100000000000)::text, 11, '0') end,
  rg    = null,
  email = case when email is null then null else 'compl+' || left(md5(id::text), 6) || '@homolog.local' end,
  telefone = case when telefone is null then null else '(48) 90000-0000' end;

-- dados bancarios de corretor: numero nao vai pra homologacao
update usuarios set banco = null, agencia = null, conta = null,
  tipo_conta = null, chave_pix = null, tipo_chave_pix = null;

-- leads e clientes de funil tambem carregam PII
update leads set
  nome     = 'LEAD TESTE ' || upper(left(md5(id::text), 4)),
  email    = case when email is null then null else 'lead+' || left(md5(id::text), 6) || '@homolog.local' end,
  telefone = case when telefone is null then null else '(48) 90000-0000' end;

-- nada de email real saindo de homologacao
truncate table email_eventos;

commit;
