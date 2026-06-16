# Regra: Leitura de Listas, Paginação e Refetch Escopado

## Princípio fundamental

O PostgREST/Supabase corta **toda** query em 1000 linhas, **SILENCIOSAMENTE** (`db.max-rows`).
Lista potencialmente >1000 lida sem paginação = total financeiro errado sem erro nenhum.

Bug real (2026-06-11): 4 corretores viam até 34% da própria comissão — `fetchMeusPagamentos`
do CorretorDashboard buscava `pagamentos_prosoluto` sem `.range()` (MATHEUS 2.930 parcelas,
CARLOS BRUNO 2.559, Corazza 1.812, Madona 1.114; cap em 1000).

E o próximo passo do roadmap é **RLS**: policies filtram linhas **sem errar** — o código deve
continuar correto quando linhas "sumirem" por permissão.

---

## Invariantes

1. **Toda leitura de lista potencialmente >1000 linhas usa `fetchAllPaginated`**
   ([src/utils/supabaseQuery.js](../../src/utils/supabaseQuery.js)). Término **SEMPRE** por
   página incompleta (`data.length < pageSize`) — **NUNCA** por count. Count só serve pra
   dimensionar paralelismo, não pra terminar loop.
2. **`buildQuery` é FACTORY** — `(from, to) => supabase.from(...)...range(from, to)` retorna
   builder **novo** a cada página (builders do supabase-js são mutáveis; reusar instância
   acumula estado).
3. **Filtro explícito indexado sempre** (`venda_id`, `corretor_id`) — mesmo quando uma policy
   RLS futura o tornar redundante. O filtro é o plano de query; a policy é backstop de
   segurança, não otimização.
4. **Ordenação determinística obrigatória** com tiebreaker `.order('id')` — `data_prevista`
   tem milhares de empates; sem tiebreaker, paginação por offset duplica/perde linha entre
   páginas (Postgres não garante ordem estável).
5. **Erro em página → throw.** Nunca `break` silencioso devolvendo lista parcial como completa.
6. **Mutação → refetch ESCOPADO + merge imutável no estado.** `fetchData()` completo
   (~26 queries, 19k linhas) só no mount/refresh manual explícito. Nunca montar estado a
   partir do payload local: triggers (017/020/026) podem rejeitar/ajustar o write —
   `update().select()` traz a verdade pós-trigger.
7. **Fetch-por-id que retorna 0 linhas lança erro explícito** ("verifique permissão/RLS") —
   sob RLS, ausência silenciosa é o modo de falha; erro visível durante o rollout vale ouro.
8. **Proibido mutar `pag.venda`** (objeto aninhado nos pagamentos do Admin) — é referência
   construída no enriquecimento; mutação corrompe consumidores.

---

## Padrão correto vs errado

```javascript
// CORRETO ✅ — paginação com factory + ordenação total
import { fetchAllPaginated } from '../utils/supabaseQuery'
const data = await fetchAllPaginated((from, to) =>
  supabase.from('pagamentos_prosoluto').select('*')
    .in('venda_id', vendaIds)
    .order('data_prevista', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to)
)

// ERRADO ❌ — corta em 1000 sem erro
const { data } = await supabase.from('pagamentos_prosoluto')
  .select('*').in('venda_id', vendaIds)

// ERRADO ❌ — break silencioso entrega parcial como completo
while (hasMore) { const { data, error } = await ...; if (error) break; ... }
```

```javascript
// CORRETO ✅ — mutação de 1 parcela: verdade pós-trigger + merge escopado
const { data: row, error } = await supabase.from('pagamentos_prosoluto')
  .update(updateData).eq('id', pag.id).select().single()
if (error) throw error
setPagamentos(prev => prev.map(p => p.id === row.id ? { ...p, ...row, venda: p.venda } : p))

// ERRADO ❌ — recarregar o banco inteiro pra atualizar 1 linha
await supabase.from('pagamentos_prosoluto').update(...).eq('id', pag.id)
fetchData()
```

---

## Quando paginar (tabela de decisão)

| Query | Pagina? |
|---|---|
| `pagamentos_prosoluto` por UMA venda (`.eq('venda_id', id)`) | Não (máx ~120 parcelas) |
| `pagamentos_prosoluto` por lista de vendas (`.in`) ou sem filtro | **SIM** |
| `clientes` sem filtro | **SIM** (cresce com a base) |
| Tabelas de domínio (cargos, empreendimentos, coordenadoras) | Não |

---

## Contexto

Formalizada em 2026-06-11 após auditoria de capacidade (49 corretores + 6 internos):
- Cap-1000 truncando comissão dos 4 maiores corretores (provável causa do "Ponto 1" da
  coleta spec-driven de 2026-06-09).
- `fetchData()` do AdminDashboard re-executado em 16 call sites — controladoria dava ~30
  baixas/tarde, cada uma recarregava ~9 MB em 20 round-trips sequenciais.
- O loop de paginação original do Admin paginava **sem ORDER BY** e com `break` silencioso
  em erro — dois bugs latentes corrigidos junto.

**Sequenciamento com RLS (crítico):** ligar RLS em `pagamentos_prosoluto` ANTES de eliminar
o fetch-all degrada a controladoria (policy avaliada em 19k linhas × 20 páginas × cada
refetch). Ordem obrigatória: refetch escopado primeiro, RLS depois.

Quem for criar leitura de lista ou handler de mutação: lê este arquivo primeiro.
