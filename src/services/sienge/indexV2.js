/**
 * Exportações do módulo Sienge V2
 * 
 * Arquitetura RAW-first + Sync sem Auth
 */

// Ingestão RAW
export {
  ingestCreditors,
  ingestCustomers,
  ingestSalesContracts,
  ingestEnterprises,
  ingestAll,
  getRawObjects,
  countRawObjects
} from './rawIngestion'

// Sync Empreendimentos
export {
  ingestEmpreendimentos,
  syncEmpreendimentosFromRaw
} from './syncEmpreendimentosV2'

// Sync Corretores (SEM Auth)
export {
  syncCorretoresFromRaw,
  getOrCreateCorretorPlaceholder,
  findCorretorBySiengeId
} from './syncCorretoresV2'

// Sync Clientes (com cônjuges)
export {
  syncClientesFromRaw,
  findClienteBySiengeId,
  getOrCreateClientePlaceholder
} from './syncClientesV2'

// Sync Vendas + Pagamentos Pro-Soluto + Comissões
export {
  syncVendasFromRaw,
  findVendaBySiengeId,
  reprocessarPagamentosVenda,
  mapearPaymentConditions
} from './syncVendasV2'

// Sync Unidades
export {
  ingestUnidades,
  syncUnidadesFromRaw
} from './syncUnidadesV2'

// Orquestrador
export {
  syncCompleto,
  apenasIngestaoRaw,
  apenasSyncCore,
  getEstatisticas,
  getVendasNaoSincronizadas,
  getLastSyncDate,
  setLastSyncDate
} from './syncOrchestrator'

// Backfills
export {
  backfillConjuges
} from './backfillConjuges'

export {
  backfillUnidades
} from './backfillUnidades'

// Cliente Sienge (funções de baixo nível)
export {
  getCustomers,
  getCustomer,
  getSalesContracts,
  getCreditors,
  getCreditor,
  getEnterprise,
  getEnterprises,
  getUnit,
  getUnits
} from './siengeClient'
 