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
  ingestAll,
  getRawObjects,
  countRawObjects
} from './rawIngestion'

// Sync Corretores (SEM Auth)
export {
  syncCorretoresFromRaw,
  getOrCreateCorretorPlaceholder,
  findCorretorBySiengeId
} from './syncCorretoresV2'

// Sync Clientes
export {
  syncClientesFromRaw,
  findClienteBySiengeId,
  getOrCreateClientePlaceholder
} from './syncClientesV2'

// Sync Vendas + Pagamentos Pro-Soluto
export {
  syncVendasFromRaw,
  findVendaBySiengeId,
  reprocessarPagamentosVenda,
  mapearPaymentConditions
} from './syncVendasV2'

// Orquestrador
export {
  syncCompleto,
  apenasIngestaoRaw,
  apenasSyncCore,
  getEstatisticas,
  getVendasNaoSincronizadas
} from './syncOrchestrator'

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
