/**
 * Componente de Galeria de Fotos do Empreendimento
 * 
 * Funcionalidades:
 * - Upload de múltiplas fotos com seleção de categoria
 * - Visualização em grid organizada por categoria
 * - Lightbox para ver em tamanho real
 * - Marcar como destaque
 * - Deletar fotos
 * - Filtrar por categoria
 */

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Upload, X, Eye, Star, StarOff, Image as ImageIcon, Loader, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import './EmpreendimentoGaleria.css'

const EmpreendimentoGaleria = ({ empreendimentoId, onClose }) => {
  const [fotos, setFotos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [fotoSelecionada, setFotoSelecionada] = useState(null)
  const [categoriaFiltro, setCategoriaFiltro] = useState('todas')
  const [categoriaSelecionada, setCategoriaSelecionada] = useState('logo')
  const [lightboxIndex, setLightboxIndex] = useState(0)

  // Carregar categorias
  const carregarCategorias = async () => {
    try {
      const { data, error } = await supabase
        .from('foto_categorias')
        .select('*')
        .eq('ativo', true)
        .order('ordem', { ascending: true })

      if (error) throw error
      setCategorias(data || [])
      if (data && data.length > 0) {
        setCategoriaSelecionada(data[0].nome)
      }
    } catch (error) {
      console.error('Erro ao carregar categorias:', error)
      // Fallback para categorias padrão se a tabela não existir
      setCategorias([
        { id: '0', nome: 'logo', label: 'Logo', cor: '#c9a962' },
        { id: '1', nome: 'fachada', label: 'Fachada', cor: '#3b82f6' },
        { id: '2', nome: 'interior', label: 'Áreas Internas', cor: '#10b981' },
        { id: '3', nome: 'apartamento', label: 'Apartamento Modelo', cor: '#8b5cf6' },
        { id: '4', nome: 'planta', label: 'Planta Baixa', cor: '#f59e0b' },
        { id: '5', nome: 'area_lazer', label: 'Área de Lazer', cor: '#ec4899' },
        { id: '6', nome: 'area_comum', label: 'Áreas Comuns', cor: '#06b6d4' },
        { id: '7', nome: 'perspectiva', label: 'Perspectiva 3D', cor: '#84cc16' },
        { id: '8', nome: 'obra', label: 'Andamento da Obra', cor: '#ef4444' },
        { id: '9', nome: 'outros', label: 'Outros', cor: '#64748b' }
      ])
    }
  }

  // Carregar fotos
  const carregarFotos = async () => {
    if (!empreendimentoId) return

    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('empreendimento_fotos')
        .select('*')
        .eq('empreendimento_id', empreendimentoId)
        .order('categoria', { ascending: true })
        .order('ordem', { ascending: true })

      if (error) throw error
      setFotos(data || [])
    } catch (error) {
      console.error('Erro ao carregar fotos:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregarCategorias()
  }, [])

  useEffect(() => {
    carregarFotos()
  }, [empreendimentoId])

  // Upload de fotos
  const handleUpload = async (event) => {
    const files = Array.from(event.target.files)
    if (files.length === 0) return

    setUploading(true)

    try {
      for (const file of files) {
        // Validar tipo
        if (!file.type.startsWith('image/')) {
          alert(`Arquivo ${file.name} não é uma imagem válida`)
          continue
        }

        // Validar tamanho (máx 500MB)
        if (file.size > 500 * 1024 * 1024) {
          alert(`Arquivo ${file.name} é muito grande (máx 500MB)`)
          continue
        }

        // Gerar caminho único
        const timestamp = Date.now()
        const nomeArquivo = `${timestamp}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
        const path = `empreendimento-${empreendimentoId}/${categoriaSelecionada}/${nomeArquivo}`

        // Upload para Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('empreendimentos-fotos')
          .upload(path, file, {
            cacheControl: '3600',
            upsert: false
          })

        if (uploadError) {
          console.error('Erro no upload:', uploadError)
          continue
        }

        // Obter URL pública
        const { data: urlData } = supabase.storage
          .from('empreendimentos-fotos')
          .getPublicUrl(path)

        // Encontrar ID da categoria
        const categoriaObj = categorias.find(c => c.nome === categoriaSelecionada)

        // Calcular próxima ordem
        const fotosCategoria = fotos.filter(f => f.categoria === categoriaSelecionada)
        const proximaOrdem = fotosCategoria.length > 0 
          ? Math.max(...fotosCategoria.map(f => f.ordem || 0)) + 1 
          : 0

        // Salvar no banco
        const { error: dbError } = await supabase
          .from('empreendimento_fotos')
          .insert({
            empreendimento_id: empreendimentoId,
            url: urlData.publicUrl,
            path: path,
            nome_arquivo: file.name,
            tamanho: file.size,
            tipo_mime: file.type,
            ordem: proximaOrdem,
            categoria: categoriaSelecionada,
            categoria_id: categoriaObj?.id || null
          })

        if (dbError) {
          console.error('Erro ao salvar foto no banco:', dbError)
          // Deletar do storage se falhou no banco
          await supabase.storage
            .from('empreendimentos-fotos')
            .remove([path])
        }
      }

      // Recarregar fotos
      await carregarFotos()
    } catch (error) {
      console.error('Erro no upload:', error)
      alert('Erro ao fazer upload das fotos')
    } finally {
      setUploading(false)
    }
  }

  // Deletar foto
  const handleDelete = async (foto) => {
    if (!confirm('Deseja realmente deletar esta foto?')) return

    try {
      // Deletar do storage
      await supabase.storage
        .from('empreendimentos-fotos')
        .remove([foto.path])

      // Deletar do banco
      const { error } = await supabase
        .from('empreendimento_fotos')
        .delete()
        .eq('id', foto.id)

      if (error) throw error

      // Recarregar fotos
      await carregarFotos()
    } catch (error) {
      console.error('Erro ao deletar foto:', error)
      alert('Erro ao deletar foto')
    }
  }

  // Toggle destaque
  const handleToggleDestaque = async (foto) => {
    try {
      const { error } = await supabase
        .from('empreendimento_fotos')
        .update({ destaque: !foto.destaque })
        .eq('id', foto.id)

      if (error) throw error

      // Recarregar fotos
      await carregarFotos()
    } catch (error) {
      console.error('Erro ao atualizar destaque:', error)
    }
  }

  // Abrir lightbox
  const openLightbox = (foto, index) => {
    setFotoSelecionada(foto)
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  // Navegação do lightbox
  const navigateLightbox = (direction) => {
    const fotosVisiveis = fotosFiltradas
    const newIndex = lightboxIndex + direction
    if (newIndex >= 0 && newIndex < fotosVisiveis.length) {
      setLightboxIndex(newIndex)
      setFotoSelecionada(fotosVisiveis[newIndex])
    }
  }

  // Fotos filtradas por categoria
  const fotosFiltradas = categoriaFiltro === 'todas' 
    ? fotos 
    : fotos.filter(f => f.categoria === categoriaFiltro)

  // Agrupar fotos por categoria
  const fotosPorCategoria = fotos.reduce((acc, foto) => {
    const cat = foto.categoria || 'outros'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(foto)
    return acc
  }, {})

  // Obter label da categoria
  const getCategoriaLabel = (nome) => {
    const cat = categorias.find(c => c.nome === nome)
    return cat?.label || nome.charAt(0).toUpperCase() + nome.slice(1).replace('_', ' ')
  }

  // Obter cor da categoria
  const getCategoriaCor = (nome) => {
    const cat = categorias.find(c => c.nome === nome)
    return cat?.cor || '#64748b'
  }

  if (loading) {
    return (
      <div className="galeria-loading">
        <Loader className="spinning" size={32} />
        <p>Carregando fotos...</p>
      </div>
    )
  }

  return (
    <div className="galeria-container">
      <div className="galeria-header">
        <h3>Galeria de Fotos</h3>
        <button className="btn-close" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      {/* Upload com seleção de categoria */}
      <div className="galeria-upload">
        <div className="upload-row">
          <div className="upload-categoria">
            <label>Categoria:</label>
            <select 
              value={categoriaSelecionada} 
              onChange={(e) => setCategoriaSelecionada(e.target.value)}
              className="categoria-select"
            >
              {categorias.map(cat => (
                <option key={cat.id} value={cat.nome}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
          <label className="upload-button">
            <Upload size={20} />
            {uploading ? 'Enviando...' : 'Adicionar Fotos'}
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleUpload}
              disabled={uploading}
              style={{ display: 'none' }}
            />
          </label>
        </div>
        <p className="upload-hint">Máximo 500MB por foto. Formatos: JPG, PNG, WEBP</p>
      </div>

      {/* Filtro por categoria */}
      {fotos.length > 0 && (
        <div className="galeria-filtros">
          <div className="filtro-label">
            <Filter size={16} />
            <span>Filtrar:</span>
          </div>
          <div className="filtro-chips">
            <button
              className={`chip ${categoriaFiltro === 'todas' ? 'active' : ''}`}
              onClick={() => setCategoriaFiltro('todas')}
            >
              Todas ({fotos.length})
            </button>
            {Object.keys(fotosPorCategoria).map(cat => (
              <button
                key={cat}
                className={`chip ${categoriaFiltro === cat ? 'active' : ''}`}
                onClick={() => setCategoriaFiltro(cat)}
                style={{ 
                  '--chip-color': getCategoriaCor(cat),
                  borderColor: categoriaFiltro === cat ? getCategoriaCor(cat) : undefined
                }}
              >
                {getCategoriaLabel(cat)} ({fotosPorCategoria[cat].length})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grid de Fotos */}
      {fotos.length === 0 ? (
        <div className="galeria-empty">
          <ImageIcon size={48} />
          <p>Nenhuma foto cadastrada</p>
          <p className="hint">Selecione uma categoria e adicione fotos usando o botão acima</p>
        </div>
      ) : fotosFiltradas.length === 0 ? (
        <div className="galeria-empty">
          <ImageIcon size={48} />
          <p>Nenhuma foto nesta categoria</p>
          <p className="hint">Selecione outra categoria ou adicione novas fotos</p>
        </div>
      ) : (
        <div className="galeria-grid">
          {fotosFiltradas.map((foto, index) => (
            <div key={foto.id} className="galeria-item">
              <div className="galeria-item-image" onClick={() => openLightbox(foto, index)}>
                <img src={foto.url} alt={foto.descricao || `Foto ${index + 1}`} loading="lazy" />
                <div className="galeria-item-overlay">
                  <Eye size={20} />
                </div>
              </div>
              <div className="galeria-item-categoria" style={{ background: getCategoriaCor(foto.categoria) }}>
                {getCategoriaLabel(foto.categoria)}
              </div>
              <div className="galeria-item-actions">
                <button
                  className={`btn-action ${foto.destaque ? 'active' : ''}`}
                  onClick={() => handleToggleDestaque(foto)}
                  title={foto.destaque ? 'Remover destaque' : 'Marcar como destaque'}
                >
                  {foto.destaque ? <Star size={16} fill="currentColor" /> : <StarOff size={16} />}
                </button>
                <button
                  className="btn-action delete"
                  onClick={() => handleDelete(foto)}
                  title="Deletar foto"
                >
                  <X size={16} />
                </button>
              </div>
              {foto.destaque && (
                <div className="galeria-item-badge">Destaque</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox com navegação */}
      {lightboxOpen && fotoSelecionada && (
        <div className="lightbox" onClick={() => setLightboxOpen(false)}>
          <button className="lightbox-close" onClick={() => setLightboxOpen(false)}>
            <X size={24} />
          </button>
          
          {lightboxIndex > 0 && (
            <button 
              className="lightbox-nav lightbox-prev"
              onClick={(e) => { e.stopPropagation(); navigateLightbox(-1); }}
            >
              <ChevronLeft size={32} />
            </button>
          )}
          
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={fotoSelecionada.url} alt={fotoSelecionada.descricao || 'Foto'} />
            <div className="lightbox-info">
              <span 
                className="lightbox-categoria" 
                style={{ background: getCategoriaCor(fotoSelecionada.categoria) }}
              >
                {getCategoriaLabel(fotoSelecionada.categoria)}
              </span>
              <span className="lightbox-counter">
                {lightboxIndex + 1} / {fotosFiltradas.length}
              </span>
            </div>
          </div>
          
          {lightboxIndex < fotosFiltradas.length - 1 && (
            <button 
              className="lightbox-nav lightbox-next"
              onClick={(e) => { e.stopPropagation(); navigateLightbox(1); }}
            >
              <ChevronRight size={32} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default EmpreendimentoGaleria
