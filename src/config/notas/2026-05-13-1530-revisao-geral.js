// Nota de atualizacao — formato:
//   id (opcional, vem do nome do arquivo se omitido)
//   data: '13 de maio de 2026'  (legivel pro humano)
//   titulo: 'Resumo curto'
//   itens: [ { tipo, texto } ]
//
// tipos disponiveis: 'novidade', 'melhoria', 'correcao', 'aviso'

export default {
  data: '13 de maio de 2026',
  titulo: 'Revisão geral e correções na rotina diária',
  itens: [
    {
      tipo: 'melhoria',
      texto: 'O login agora abre direto no painel sem aquela tela de "Carregando..." piscando duas vezes.',
    },
    {
      tipo: 'novidade',
      texto: 'Ao excluir uma venda, agora é obrigatório escrever um motivo (mín. 10 caracteres). Fica registrado quem excluiu e quando — evita perda silenciosa por engano.',
    },
    {
      tipo: 'correcao',
      texto: 'O relatório PDF de comissões estava puxando valores antigos da venda em vez da soma viva dos pagamentos. Agora reflete sempre o estado real.',
    },
    {
      tipo: 'correcao',
      texto: 'O cálculo da comissão do corretor no relatório estava subestimando o valor (aplicava o percentual direto na parcela em vez de usar o fator). Corrigido — segue a regra do projeto.',
    },
    {
      tipo: 'melhoria',
      texto: 'Quando alguém corrige manualmente o corretor ou cliente de uma venda, a próxima sincronização com o Sienge não desfaz mais a correção.',
    },
    {
      tipo: 'correcao',
      texto: '10 vendas que estavam atribuídas ao corretor errado foram reatribuídas (Carolina, Felipe Madona, Watson, Gabriel Luz Imóveis, Paulo Chaves Jr, Felicita Imobiliária).',
    },
    {
      tipo: 'correcao',
      texto: '5 corretores internos (Patrick, Eduardo, Alex, Lauricio, Édina) tinham as vendas marcadas como externo. Foi corrigido e o valor das comissões pendentes foi recalculado pelo percentual interno (6,5%). As comissões já pagas foram preservadas como histórico.',
    },
    {
      tipo: 'aviso',
      texto: 'O financeiro/controladoria precisa validar quem recebeu de fato as comissões das vendas reatribuídas — se houve diferença, é caso de estorno ou complemento.',
    },
  ],
}
