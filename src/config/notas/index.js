// Indice das notas de atualizacao. Usa import.meta.glob do Vite pra carregar
// automaticamente todos os arquivos .js da pasta — voce nao precisa editar
// esta lista.
//
// Convencao: cada nota fica em um arquivo separado nomeado
// AAAA-MM-DD-HHMM-slug.js. Mais de uma nota no mesmo dia? Use HHMM diferente.
// As notas sao ordenadas pelo id (que vem do nome do arquivo) — formato
// AAAA-MM-DD-HHMM faz ordem cronologica natural.

const modulos = import.meta.glob('./20*.js', { eager: true })

export const NOTAS = Object.entries(modulos)
  // path -> 'modulo'. O id vem do nome do arquivo sem .js
  .map(([path, mod]) => {
    const arquivoBase = path.replace(/^\.\//, '').replace(/\.js$/, '')
    const nota = mod.default || mod
    return { ...nota, id: nota.id || arquivoBase }
  })
  // mais recente primeiro
  .sort((a, b) => (b.id || '').localeCompare(a.id || ''))
