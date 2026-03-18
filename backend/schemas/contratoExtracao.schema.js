const { z } = require('zod')

const confidenceLevelSchema = z.enum(['alta', 'media', 'baixa']).or(z.string())

const saleSchema = z.object({
  cliente_nome: z.string().optional().nullable(),
  cliente_cpf: z.string().optional().nullable(),
  corretor_nome: z.string().optional().nullable(),
  empreendimento_nome: z.string().optional().nullable(),
  unidade: z.string().optional().nullable(),
  bloco: z.string().optional().nullable(),
  andar: z.string().optional().nullable(),
  valor_venda: z.union([z.number(), z.string()]).optional().nullable(),
  data_venda: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  descricao: z.string().optional().nullable()
}).default({})

const grupoSchema = z.object({
  quantidade: z.union([z.number(), z.string()]).optional().nullable(),
  qtd: z.union([z.number(), z.string()]).optional().nullable(),
  valor_parcela: z.union([z.number(), z.string()]).optional().nullable(),
  valor: z.union([z.number(), z.string()]).optional().nullable(),
  periodicidade: z.string().optional().nullable()
})

const proSolutoSchema = z.object({
  teve_sinal: z.union([z.boolean(), z.string()]).optional().nullable(),
  valor_sinal: z.union([z.number(), z.string()]).optional().nullable(),
  teve_entrada: z.union([z.boolean(), z.string()]).optional().nullable(),
  valor_entrada: z.union([z.number(), z.string()]).optional().nullable(),
  parcelou_entrada: z.union([z.boolean(), z.string()]).optional().nullable(),
  grupos_parcelas_entrada: z.array(grupoSchema).optional().nullable(),
  teve_balao: z.union([z.boolean(), z.string()]).optional().nullable(),
  grupos_balao: z.array(grupoSchema).optional().nullable(),
  teve_permuta: z.union([z.boolean(), z.string()]).optional().nullable(),
  tipo_permuta: z.string().optional().nullable(),
  valor_permuta: z.union([z.number(), z.string()]).optional().nullable(),
  valor_pro_soluto: z.union([z.number(), z.string()]).optional().nullable()
}).default({})

const metaSchema = z.object({
  confidence: z.record(confidenceLevelSchema).optional().default({}),
  warnings: z.array(z.string()).optional().default([]),
  source_type: z.string().optional().default('')
}).default({})

const contratoExtracaoSchema = z.object({
  sale: saleSchema,
  pro_soluto: proSolutoSchema,
  meta: metaSchema
})

module.exports = {
  contratoExtracaoSchema
}
