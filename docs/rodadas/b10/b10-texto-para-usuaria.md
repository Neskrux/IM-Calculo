# Rodada b10 — pro_soluto local ≠ Sienge (2026-06-01)

Gerado de `docs/reconciliacao-geral-2026-06-01-dryrun.json`. **28 vendas** onde a soma do income do Sienge diverge do
`valor_pro_soluto` gravado no banco. Isso afeta o **fator de comissão** (fator = comissão / pro_soluto).

> Regra: se a venda **já tem parcela paga**, o `pro_soluto` é **imutável** (mexer recalcularia comissão
> de histórico financeiro). Esses casos viram **decisão de negócio** (Grupo B). Só os sem parcela paga
> (Grupo A) podem ser auto-corrigidos pro valor do Sienge.


## Grupo B — Escala negócio (tem parcela paga → pro_soluto imutável)

Mexer afeta comissão de histórico. Decisão sua: manter, ou autorizar correção excepcional.

### 1. Contrato 191 · Unidade 903 B
- Cliente: **(sem cliente)** · Corretor: **Luiz Corazza** (4732483369)
- pro_soluto local: **R$ 300.000,00** · soma income Sienge: **R$ 175.000,00** · diferença: **R$ -125.000,00** (-41.7%)
- Parcelas pagas: **11** · fator 0.07 → 0.12 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 2. Contrato 305 · Unidade 1407 D
- Cliente: **(sem cliente)** · Corretor: **Luiz Corazza** (4732483369)
- pro_soluto local: **R$ 67.923,00** · soma income Sienge: **R$ 81.507,60** · diferença: **R$ 13.584,60** (20%)
- Parcelas pagas: **16** · fator 0.346908 → 0.28909 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 3. Contrato 332 · Unidade 1206 B
- Cliente: **(sem cliente)** · Corretor: **MY HOUSE NEGOCIOS IMOBILIARIOS LTDA** (4791170880)
- pro_soluto local: **R$ 67.695,43** · soma income Sienge: **R$ 58.695,43** · diferença: **R$ -9.000,00** (-13.3%)
- Parcelas pagas: **7** · fator 0.437391 → 0.504458 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 4. Contrato 228 · Unidade 903 C
- Cliente: **(sem cliente)** · Corretor: **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS** ((48) 99994-0606)
- pro_soluto local: **R$ 82.712,06** · soma income Sienge: **R$ 91.268,48** · diferença: **R$ 8.556,42** (10.3%)
- Parcelas pagas: **3** · fator 0.307272 → 0.278465 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 5. Contrato 312 · Unidade 712 A
- Cliente: **(sem cliente)** · Corretor: **CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA** (4797071735)
- pro_soluto local: **R$ 47.396,80** · soma income Sienge: **R$ 55.383,04** · diferença: **R$ 7.986,24** (16.8%)
- Parcelas pagas: **12** · fator 0.350149 → 0.299657 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 6. Contrato 12 · Unidade 509 A
- Cliente: **(sem cliente)** · Corretor: **Édina mea de Oliveira**
- pro_soluto local: **R$ 62.735,00** · soma income Sienge: **R$ 69.006,00** · diferença: **R$ 6.271,00** (10%)
- Parcelas pagas: **11** · fator 0.324867 → 0.295344 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 7. Contrato 422 · Unidade 1603 C
- Cliente: **(sem cliente)** · Corretor: **Carolina de Oliveira dos Santos Rita**
- pro_soluto local: **R$ 93.403,23** · soma income Sienge: **R$ 87.403,23** · diferença: **R$ -6.000,00** (-6.4%)
- Parcelas pagas: **3** · fator 0.35 → 0.374027 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 8. Contrato 411 · Unidade 603 B
- Cliente: **(sem cliente)** · Corretor: **FELICITA IMOBILIARIA LTDA**
- pro_soluto local: **R$ 196.136,89** · soma income Sienge: **R$ 202.071,67** · diferença: **R$ 5.934,78** (3%)
- Parcelas pagas: **2** · fator 0.152358 → 0.147883 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 9. Contrato 165 · Unidade 1606 A
- Cliente: **(sem cliente)** · Corretor: **Luiz Corazza** (4732483369)
- pro_soluto local: **R$ 83.839,80** · soma income Sienge: **R$ 89.429,12** · diferença: **R$ 5.589,32** (6.7%)
- Parcelas pagas: **9** · fator 0.349999 → 0.328124 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 10. Contrato 206 · Unidade 1303 B
- Cliente: **(sem cliente)** · Corretor: **Betina De Camargo Marcos** (47999227227)
- pro_soluto local: **R$ 85.444,35** · soma income Sienge: **R$ 80.444,35** · diferença: **R$ -5.000,00** (-5.9%)
- Parcelas pagas: **8** · fator 0.349999 → 0.371753 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 11. Contrato 277 · Unidade 810 D
- Cliente: **(sem cliente)** · Corretor: **LAURICIO FESTA**
- pro_soluto local: **R$ 70.592,40** · soma income Sienge: **R$ 75.298,56** · diferença: **R$ 4.706,16** (6.7%)
- Parcelas pagas: **11** · fator 0.297455 → 0.278864 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 12. Contrato 150 · Unidade 1306 A
- Cliente: **(sem cliente)** · Corretor: **GUILHERME GONCALVES SALSBRUM** (4792097047)
- pro_soluto local: **R$ 68.249,97** · soma income Sienge: **R$ 72.809,29** · diferença: **R$ 4.559,32** (6.7%)
- Parcelas pagas: **9** · fator 0.344874 → 0.323278 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 13. Contrato 351 · Unidade 506 A
- Cliente: **(sem cliente)** · Corretor: **CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA** (4797071735)
- pro_soluto local: **R$ 46.482,63** · soma income Sienge: **R$ 50.076,84** · diferença: **R$ 3.594,21** (7.7%)
- Parcelas pagas: **9** · fator 0.35 → 0.324879 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 14. Contrato 334 · Unidade 1702 A
- Cliente: **(sem cliente)** · Corretor: **Rodrigo Fernando Viapiana Parada** (4732483369)
- pro_soluto local: **R$ 88.913,12** · soma income Sienge: **R$ 92.187,68** · diferença: **R$ 3.274,56** (3.7%)
- Parcelas pagas: **3** · fator 0.350002 → 0.33757 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 15. Contrato 230 · Unidade 906 C
- Cliente: **(sem cliente)** · Corretor: **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS** (1192003475)
- pro_soluto local: **R$ 78.199,66** · soma income Sienge: **R$ 80.741,01** · diferença: **R$ 2.541,35** (3.2%)
- Parcelas pagas: **8** · fator 0.350002 → 0.338986 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 16. Contrato 299 · Unidade 1305 D
- Cliente: **(sem cliente)** · Corretor: **Luiz Corazza** (4732483369)
- pro_soluto local: **R$ 91.420,75** · soma income Sienge: **R$ 93.820,75** · diferença: **R$ 2.400,00** (2.6%)
- Parcelas pagas: **8** · fator 0.35 → 0.341047 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 17. Contrato 63 · Unidade 710 A
- Cliente: **(sem cliente)** · Corretor: **CARLOS BRUNO NEGOCIOS IMOBILIARIOS LTDA** (4797071735)
- pro_soluto local: **R$ 70.366,00** · soma income Sienge: **R$ 72.711,54** · diferença: **R$ 2.345,54** (3.3%)
- Parcelas pagas: **8** · fator 0.350004 → 0.338714 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 18. Contrato 267 · Unidade 603 D
- Cliente: **(sem cliente)** · Corretor: **Josemeiri Dal Aqua Bittencourt**
- pro_soluto local: **R$ 61.336,40** · soma income Sienge: **R$ 59.336,40** · diferença: **R$ -2.000,00** (-3.3%)
- Parcelas pagas: **10** · fator 0.361412 → 0.373594 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 19. Contrato 195 · Unidade 904 B
- Cliente: **(sem cliente)** · Corretor: **Felipe Madona** (47991881880)
- pro_soluto local: **R$ 87.853,76** · soma income Sienge: **R$ 89.368,48** · diferença: **R$ 1.514,72** (1.7%)
- Parcelas pagas: **9** · fator 0.349999 → 0.344067 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 20. Contrato 175 · Unidade 1807 A
- Cliente: **(sem cliente)** · Corretor: **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS** ((48) 99994-0606)
- pro_soluto local: **R$ 71.858,87** · soma income Sienge: **R$ 70.680,86** · diferença: **R$ -1.178,01** (-1.6%)
- Parcelas pagas: **13** · fator 0.319672 → 0.325 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 21. Contrato 200 · Unidade 1005 B
- Cliente: **(sem cliente)** · Corretor: **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS** ((48) 99994-0606)
- pro_soluto local: **R$ 70.946,67** · soma income Sienge: **R$ 69.800,00** · diferença: **R$ -1.146,67** (-1.6%)
- Parcelas pagas: **15** · fator 0.319922 → 0.325178 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 22. Contrato 220 · Unidade 709 C
- Cliente: **(sem cliente)** · Corretor: **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS** ((48) 99994-0606)
- pro_soluto local: **R$ 64.863,33** · soma income Sienge: **R$ 63.800,00** · diferença: **R$ -1.063,33** (-1.6%)
- Parcelas pagas: **13** · fator 0.320523 → 0.325865 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 23. Contrato 217 · Unidade 604 C
- Cliente: **(sem cliente)** · Corretor: **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS** ((48) 99994-0606)
- pro_soluto local: **R$ 65.253,33** · soma income Sienge: **R$ 64.200,00** · diferença: **R$ -1.053,33** (-1.6%)
- Parcelas pagas: **15** · fator 0.315452 → 0.320628 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 24. Contrato 261 · Unidade 410 D
- Cliente: **(sem cliente)** · Corretor: **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS** ((48) 99994-0606)
- pro_soluto local: **R$ 63.033,33** · soma income Sienge: **R$ 62.000,00** · diferença: **R$ -1.033,33** (-1.6%)
- Parcelas pagas: **12** · fator 0.320128 → 0.325463 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 25. Contrato 22 · Unidade 504 A
- Cliente: **(sem cliente)** · Corretor: **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS** ((48) 99994-0606)
- pro_soluto local: **R$ 63.737,69** · soma income Sienge: **R$ 62.709,20** · diferença: **R$ -1.028,49** (-1.6%)
- Parcelas pagas: **15** · fator 0.319756 → 0.325 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 26. Contrato 9 · Unidade 409 A
- Cliente: **(sem cliente)** · Corretor: **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS** ((48) 99994-0606)
- pro_soluto local: **R$ 63.016,67** · soma income Sienge: **R$ 62.000,00** · diferença: **R$ -1.016,67** (-1.6%)
- Parcelas pagas: **15** · fator 0.320213 → 0.325464 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 27. Contrato 64 · Unidade 802 A
- Cliente: **(sem cliente)** · Corretor: **ENZO TORMES** ((51) 98536-1147)
- pro_soluto local: **R$ 48.670,48** · soma income Sienge: **R$ 47.889,00** · diferença: **R$ -781,48** (-1.6%)
- Parcelas pagas: **16** · fator 0.319796 → 0.325015 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar

### 28. Contrato 69 · Unidade 805 A
- Cliente: **(sem cliente)** · Corretor: **MATHEUS DE S. PIRES NEGOCIOS IMOBILIARIOS** ((48) 99994-0606)
- pro_soluto local: **R$ 48.096,67** · soma income Sienge: **R$ 47.800,00** · diferença: **R$ -296,67** (-0.6%)
- Parcelas pagas: **16** · fator 0.323611 → 0.325619 se corrigir
- **Decisão:** (1) Manter pro_soluto local · (2) Usar valor do Sienge · (3) Investigar


## O que fazer agora

Responda por caso (ex.: "Grupo B, contrato 411 → opção 1"). O operador transcreve em
`docs/rodadas/b10/b10-respostas.json` e roda `aplicar-rodada-b.mjs --rodada b10`.
