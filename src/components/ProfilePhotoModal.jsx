import { useState, useRef } from 'react'
import { Camera, X, Upload, Loader2, AlertCircle, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import './ProfilePhotoModal.css'

const MAX_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

/**
 * Modal de upload de foto de perfil.
 *
 * Props:
 *   open       — controla visibilidade
 *   required   — se true, esconde botão X (forçar primeiro acesso)
 *   onClose    — chamado ao fechar (só relevante quando required=false)
 *   onUploaded — chamado após upload com sucesso (recebe a nova URL)
 */
export default function ProfilePhotoModal({ open, required = false, onClose, onUploaded }) {
  const { user, userProfile, refreshProfile } = useAuth()
  const fileInputRef = useRef(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const pickFile = () => fileInputRef.current?.click()

  const handleFileChange = (e) => {
    setError('')
    const selected = e.target.files?.[0]
    if (!selected) return

    if (!ALLOWED_TYPES.includes(selected.type)) {
      setError('Formato inválido. Use JPG, PNG ou WEBP.')
      return
    }
    if (selected.size > MAX_BYTES) {
      setError('Imagem muito grande. Máximo 5MB.')
      return
    }

    setFile(selected)
    const url = URL.createObjectURL(selected)
    setPreviewUrl(url)
  }

  const handleSave = async () => {
    if (!file || !user) return
    setUploading(true)
    setError('')

    try {
      const ext = file.name.split('.').pop().toLowerCase()
      const path = `${user.id}/avatar.${ext}`

      // upsert=true permite trocar a foto existente
      const { error: upErr } = await supabase.storage
        .from('usuarios-fotos')
        .upload(path, file, {
          upsert: true,
          cacheControl: '0',
          contentType: file.type,
        })

      if (upErr) throw upErr

      const { data: pub } = supabase.storage
        .from('usuarios-fotos')
        .getPublicUrl(path)

      // Cache-buster pra forçar recarga depois de upsert
      const publicUrl = `${pub.publicUrl}?v=${Date.now()}`

      const { error: dbErr } = await supabase
        .from('usuarios')
        .update({ foto_url: publicUrl })
        .eq('id', user.id)

      if (dbErr) throw dbErr

      await refreshProfile()
      onUploaded?.(publicUrl)

      // Limpa estado e fecha (se não for forçado, fecha mesmo assim agora que tem foto)
      setFile(null)
      setPreviewUrl(null)
      onClose?.()
    } catch (err) {
      console.error('Erro upload foto perfil:', err)
      setError(err.message || 'Erro ao enviar foto. Tente novamente.')
    } finally {
      setUploading(false)
    }
  }

  const handleCancel = () => {
    if (uploading) return
    setFile(null)
    setPreviewUrl(null)
    setError('')
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    if (!required) onClose?.()
  }

  const currentFoto = previewUrl || userProfile?.foto_url || null

  return (
    <div className="profile-photo-modal-backdrop" onClick={required ? undefined : handleCancel}>
      <div className="profile-photo-modal" onClick={(e) => e.stopPropagation()}>
        {!required && (
          <button className="profile-photo-modal-close" onClick={handleCancel} aria-label="Fechar">
            <X size={20} />
          </button>
        )}

        <div className="profile-photo-modal-header">
          <h2>{required ? 'Adicione sua foto de perfil' : 'Trocar foto de perfil'}</h2>
          <p>
            {required
              ? 'Pra continuar usando o sistema, suba uma foto sua. Vai aparecer pra outros usuários.'
              : 'Selecione uma nova imagem (JPG, PNG ou WEBP, até 5MB).'}
          </p>
        </div>

        <div className="profile-photo-preview-wrap">
          <div className="profile-photo-preview">
            {currentFoto ? (
              <img src={currentFoto} alt="Pré-visualização" />
            ) : (
              <Camera size={48} />
            )}
          </div>
          {previewUrl && (
            <div className="profile-photo-badge">
              <Check size={14} /> Nova foto pronta
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

        {error && (
          <div className="profile-photo-error">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <div className="profile-photo-actions">
          <button
            type="button"
            className="profile-photo-btn-secondary"
            onClick={pickFile}
            disabled={uploading}
          >
            <Upload size={16} /> {previewUrl ? 'Escolher outra' : 'Selecionar foto'}
          </button>

          <button
            type="button"
            className="profile-photo-btn-primary"
            onClick={handleSave}
            disabled={!file || uploading}
          >
            {uploading ? (
              <>
                <Loader2 size={16} className="profile-photo-spin" /> Enviando...
              </>
            ) : (
              <>
                <Check size={16} /> Salvar foto
              </>
            )}
          </button>
        </div>

        {!required && file && (
          <button
            type="button"
            className="profile-photo-btn-text"
            onClick={handleCancel}
            disabled={uploading}
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  )
}
