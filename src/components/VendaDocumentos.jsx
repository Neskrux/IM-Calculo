/**
 * Documentos da Venda (Admin)
 *
 * Upload e gestão dos documentos da compra do cliente: contrato assinado,
 * aditivos, distrato, termo de quitação. Arquivos no bucket 'documentos';
 * metadados em venda_documentos (migration 037). `visivel_cliente` controla
 * o que o cliente vê no portal (bloco "Dados do contrato" do Meu Imóvel).
 */

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Upload, X, Loader, FileText, Eye, EyeOff, Download } from 'lucide-react'
import './EmpreendimentoGaleria.css'

export const VENDA_DOC_CATEGORIA_LABELS = {
  contrato: 'Contrato de Compra e Venda',
  aditivo: 'Aditivo / Renegociação',
  distrato: 'Distrato',
  quitacao: 'Termo de Quitação',
  outros: 'Outros',
}

const formatarTamanho = (bytes) => {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const VendaDocumentos = ({ vendaId }) => {
  const [documentos, setDocumentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [categoriaSelecionada, setCategoriaSelecionada] = useState('contrato')

  const carregarDocumentos = async () => {
    if (!vendaId) return
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('venda_documentos')
        .select('*')
        .eq('venda_id', vendaId)
        .order('created_at', { ascending: true })
      if (error) throw error
      setDocumentos(data || [])
    } catch (error) {
      console.error('Erro ao carregar documentos da venda:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregarDocumentos()
  }, [vendaId])

  const handleUpload = async (event) => {
    const files = Array.from(event.target.files)
    event.target.value = ''
    if (files.length === 0) return

    setUploading(true)
    try {
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) {
          alert(`Arquivo ${file.name} é muito grande (máx 50MB)`)
          continue
        }

        const timestamp = Date.now()
        const nomeArquivo = `${timestamp}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
        const path = `venda-${vendaId}/${categoriaSelecionada}/${nomeArquivo}`

        const { error: uploadError } = await supabase.storage
          .from('documentos')
          .upload(path, file, { cacheControl: '3600', upsert: false })
        if (uploadError) {
          console.error('Erro no upload:', uploadError)
          alert(`Erro ao enviar ${file.name}: ${uploadError.message}`)
          continue
        }

        const { data: urlData } = supabase.storage
          .from('documentos')
          .getPublicUrl(path)

        const { error: dbError } = await supabase
          .from('venda_documentos')
          .insert({
            venda_id: vendaId,
            categoria: categoriaSelecionada,
            titulo: VENDA_DOC_CATEGORIA_LABELS[categoriaSelecionada] || file.name,
            url: urlData.publicUrl,
            path,
            nome_arquivo: file.name,
            tamanho: file.size,
            tipo_mime: file.type,
          })
        if (dbError) {
          console.error('Erro ao salvar documento:', dbError)
          await supabase.storage.from('documentos').remove([path])
        }
      }
      await carregarDocumentos()
    } catch (error) {
      console.error('Erro no upload:', error)
      alert('Erro ao fazer upload dos documentos')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (doc) => {
    if (!confirm(`Deseja realmente excluir "${doc.nome_arquivo || doc.titulo}"?`)) return
    try {
      if (doc.path) {
        await supabase.storage.from('documentos').remove([doc.path])
      }
      const { error } = await supabase
        .from('venda_documentos')
        .delete()
        .eq('id', doc.id)
      if (error) throw error
      await carregarDocumentos()
    } catch (error) {
      console.error('Erro ao excluir documento:', error)
      alert('Erro ao excluir documento')
    }
  }

  const handleToggleVisivel = async (doc) => {
    try {
      const { error } = await supabase
        .from('venda_documentos')
        .update({ visivel_cliente: !doc.visivel_cliente })
        .eq('id', doc.id)
      if (error) throw error
      await carregarDocumentos()
    } catch (error) {
      console.error('Erro ao alterar visibilidade:', error)
    }
  }

  if (loading) {
    return (
      <div className="galeria-loading">
        <Loader className="spinning" size={32} />
        <p>Carregando documentos...</p>
      </div>
    )
  }

  const docsPorCategoria = documentos.reduce((acc, doc) => {
    const cat = doc.categoria || 'outros'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(doc)
    return acc
  }, {})

  return (
    <div className="documentos-container">
      <div className="galeria-upload">
        <div className="upload-row">
          <div className="upload-categoria">
            <label>Tipo de documento:</label>
            <select
              value={categoriaSelecionada}
              onChange={(e) => setCategoriaSelecionada(e.target.value)}
              className="categoria-select"
            >
              {Object.entries(VENDA_DOC_CATEGORIA_LABELS).map(([nome, label]) => (
                <option key={nome} value={nome}>{label}</option>
              ))}
            </select>
          </div>
          <label className="upload-button">
            <Upload size={20} />
            {uploading ? 'Enviando...' : 'Adicionar Documentos'}
            <input
              type="file"
              multiple
              accept=".pdf,image/*"
              onChange={handleUpload}
              disabled={uploading}
              style={{ display: 'none' }}
            />
          </label>
        </div>
        <p className="upload-hint">
          PDF ou imagem, máx 50MB. Documentos com o olho aberto ficam visíveis pro cliente no portal.
        </p>
      </div>

      {documentos.length === 0 ? (
        <div className="galeria-empty">
          <FileText size={48} />
          <p>Nenhum documento desta venda</p>
          <p className="hint">Anexe o contrato assinado e demais documentos usando o botão acima</p>
        </div>
      ) : (
        Object.keys(docsPorCategoria).map(cat => (
          <div key={cat} className="documentos-grupo">
            <h4 className="documentos-grupo-titulo">{VENDA_DOC_CATEGORIA_LABELS[cat] || cat}</h4>
            <ul className="documentos-lista">
              {docsPorCategoria[cat].map(doc => (
                <li key={doc.id} className="documento-item">
                  <FileText size={18} className="documento-icone" />
                  <div className="documento-info">
                    <span className="documento-nome">{doc.nome_arquivo || doc.titulo}</span>
                    <span className="documento-meta">
                      {formatarTamanho(doc.tamanho)}
                      {!doc.visivel_cliente && ' · oculto do cliente'}
                    </span>
                  </div>
                  <div className="documento-acoes">
                    <a
                      className="btn-action"
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir documento"
                    >
                      <Download size={16} />
                    </a>
                    <button
                      className={`btn-action ${doc.visivel_cliente ? 'active' : ''}`}
                      onClick={() => handleToggleVisivel(doc)}
                      title={doc.visivel_cliente ? 'Visível no portal do cliente — clique pra ocultar' : 'Oculto do cliente — clique pra exibir'}
                    >
                      {doc.visivel_cliente ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                    <button
                      className="btn-action delete"
                      onClick={() => handleDelete(doc)}
                      title="Excluir documento"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}

export default VendaDocumentos
