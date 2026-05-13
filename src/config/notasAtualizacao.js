// Notas de atualizacao mostradas no modal admin.
// Pra publicar uma versao nova: incremente NOTAS_VERSAO e atualize NOTAS_LISTA.
// Cada admin vera o modal uma vez por versao (controle via localStorage).
//
// Convencao: NOTAS_VERSAO = 'AAAA-MM-DD' da publicacao.

export const NOTAS_VERSAO = '2026-05-13'

export const NOTAS_LISTA = [
  {
    titulo: 'Login mais rápido',
    itens: [
      'Removido reload duplo no fluxo de login — antes o sistema piscava entre cortina e tela de "Carregando..." e agora vai direto pro dashboard.',
    ],
  },
  {
    titulo: 'Exclusão de venda com motivo obrigatório',
    itens: [
      'Toda exclusão de venda agora pede um motivo (mín. 10 caracteres). Fica registrado quem excluiu e quando.',
      'Evita perda silenciosa de vendas — caso a exclusão tenha sido por engano, dá pra justificar e revisar depois.',
    ],
  },
  {
    titulo: 'Relatórios e cálculo de comissão',
    itens: [
      'PDF de comissões agora usa sempre a soma viva dos pagamentos. Tirado o snapshot antigo da venda que estava divergente em 89% dos casos.',
      'Cálculo de comissão do corretor no relatório agora usa fator (regra canônica do projeto) — antes aplicava percentual direto na parcela, subestimando o valor.',
      'Modal de "Visualizar Venda" também passa a usar soma viva.',
    ],
  },
  {
    titulo: 'Sincronização com Sienge',
    itens: [
      'Sync passa a respeitar correções manuais de corretor e cliente — antes sobrescrevia tudo a cada sincronização.',
      'Brokers do Sienge sem cadastro local agora geram log na sincronização — fica fácil identificar quem cadastrar.',
    ],
  },
  {
    titulo: 'Correções aplicadas nos dados',
    itens: [
      'Reatribuição de 10 vendas que estavam com corretor errado ou ausente (Carolina, Felipe Madona, Watson, Gabriel Luz, Paulo Chaves, Felicita).',
      'Cadastros novos: GABRIEL LUZ IMOVEIS, PAULO SERGIO CHAVES JR, FELICITA IMOBILIARIA.',
      'Matheus Pires vinculado ao broker 118 do Sienge — duplicata confirmada por CNPJ.',
      'Reclassificação de 5 corretores internos (Patrick, Eduardo, Alex, Lauricio, Édina) — vendas atualizadas pra refletir o percentual interno.',
    ],
  },
  {
    titulo: 'Outras melhorias',
    itens: [
      'Pendências de financeiro/controladoria: precisamos validar quem recebeu de fato as comissões das vendas reatribuídas. Ver doc de revisão (docs/revisao-geral-2026-05-13.md).',
      'Defesa adicional contra exclusão acidental de pagamentos pagos no banco.',
    ],
  },
]
