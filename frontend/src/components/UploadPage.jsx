import { useState, useRef, useCallback } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const DOC_TYPES = [
  { label: 'Utility Bill', icon: '⚡', hint: 'Electricity, water, gas' },
  { label: 'Phone Bill', icon: '📱', hint: 'Mobile or landline' },
  { label: 'Rental Receipt', icon: '🏠', hint: 'Lease or rent payment' },
  { label: 'Income Form', icon: '💰', hint: 'Self-reported income' },
]

export default function UploadPage({ onStartScoring }) {
  const [files, setFiles] = useState([])
  const [dragging, setDragging] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef()

  const addFiles = useCallback((incoming) => {
    const valid = Array.from(incoming).filter(f =>
      f.type.startsWith('image/') || f.type === 'application/pdf'
    )
    setFiles(prev => {
      const combined = [...prev, ...valid].slice(0, 4)
      return combined
    })
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  const onDragOver = (e) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)

  const removeFile = (i) => setFiles(prev => prev.filter((_, idx) => idx !== i))

  async function handleSubmit() {
    if (!files.length) return setError('Upload at least one document.')
    if (!name.trim()) return setError('Enter the applicant name.')
    setError('')
    setUploading(true)

    try {
      const form = new FormData()
      files.forEach(f => form.append('files', f))

      const res = await fetch(`${API}/upload`, { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      const { applicant_id } = await res.json()

      onStartScoring(applicant_id, { name, email, phone })
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoMark}>⬡</span>
          <span style={styles.logoText}>CreditBridge</span>
        </div>
        <span style={styles.tagline}>Alternative credit scoring for the unbanked</span>
      </header>

      <main style={styles.main}>
        {/* Hero */}
        <div style={styles.hero}>
          <h1 style={styles.h1}>
            Score any applicant<br />
            <em style={styles.italic}>in 60 seconds.</em>
          </h1>
          <p style={styles.sub}>
            Upload utility bills, phone bills, or rental receipts.
            Gemini Vision extracts financial signals. Claude writes the verdict.
          </p>
        </div>

        {/* Form card */}
        <div style={styles.card}>
          {/* Applicant info */}
          <div style={styles.section}>
            <label style={styles.sectionLabel}>Applicant details</label>
            <div style={styles.fields}>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>Full name *</label>
                <input
                  style={styles.input}
                  placeholder="Priya Sharma"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>Email (for report)</label>
                <input
                  style={styles.input}
                  placeholder="priya@example.com"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>WhatsApp number</label>
                <input
                  style={styles.input}
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Document types guide */}
          <div style={styles.section}>
            <label style={styles.sectionLabel}>Accepted documents</label>
            <div style={styles.docTypes}>
              {DOC_TYPES.map(d => (
                <div key={d.label} style={styles.docType}>
                  <span style={styles.docIcon}>{d.icon}</span>
                  <div>
                    <div style={styles.docLabel}>{d.label}</div>
                    <div style={styles.docHint}>{d.hint}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Drop zone */}
          <div style={styles.section}>
            <label style={styles.sectionLabel}>Upload documents (max 4)</label>
            <div
              style={{ ...styles.dropZone, ...(dragging ? styles.dropZoneActive : {}) }}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                style={{ display: 'none' }}
                onChange={e => addFiles(e.target.files)}
              />
              {files.length === 0 ? (
                <div style={styles.dropContent}>
                  <div style={styles.dropIcon}>↑</div>
                  <div style={styles.dropText}>Drop files here or click to browse</div>
                  <div style={styles.dropHint}>JPG, PNG, PDF — phone photos work fine</div>
                </div>
              ) : (
                <div style={styles.fileList}>
                  {files.map((f, i) => (
                    <div key={i} style={styles.fileItem}>
                      <div style={styles.fileThumb}>
                        {f.type.startsWith('image/') ? (
                          <img src={URL.createObjectURL(f)} style={styles.thumbImg} alt="" />
                        ) : (
                          <span style={styles.pdfIcon}>PDF</span>
                        )}
                      </div>
                      <div style={styles.fileName}>{f.name}</div>
                      <button
                        style={styles.removeBtn}
                        onClick={e => { e.stopPropagation(); removeFile(i) }}
                      >×</button>
                    </div>
                  ))}
                  {files.length < 4 && (
                    <div style={styles.addMore}>+ Add more</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button
            style={{ ...styles.submitBtn, ...(uploading ? styles.submitBtnDisabled : {}) }}
            onClick={handleSubmit}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : 'Analyse Applicant →'}
          </button>
        </div>

        {/* Footer stat */}
        <p style={styles.footerStat}>
          1.3 billion adults remain unbanked globally — CreditBridge helps lenders reach them.
        </p>
      </main>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0c0f0a',
    color: '#e8e4dc',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '24px 40px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  logo: { display: 'flex', alignItems: 'center', gap: 10 },
  logoMark: { fontSize: 22, color: '#b5e550' },
  logoText: { fontFamily: "'DM Serif Display', serif", fontSize: 20, color: '#e8e4dc' },
  tagline: { fontSize: 13, color: 'rgba(232,228,220,0.45)', fontFamily: "'DM Mono', monospace" },
  main: { maxWidth: 720, margin: '0 auto', padding: '60px 24px 80px' },
  hero: { textAlign: 'center', marginBottom: 52 },
  h1: {
    fontFamily: "'DM Serif Display', serif",
    fontSize: 52,
    fontWeight: 400,
    lineHeight: 1.12,
    color: '#e8e4dc',
    marginBottom: 20,
  },
  italic: { color: '#b5e550', fontStyle: 'italic' },
  sub: { fontSize: 17, color: 'rgba(232,228,220,0.6)', lineHeight: 1.7, maxWidth: 480, margin: '0 auto' },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: '40px 40px 36px',
  },
  section: { marginBottom: 36 },
  sectionLabel: {
    display: 'block',
    fontFamily: "'DM Mono', monospace",
    fontSize: 11,
    color: '#b5e550',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  fields: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontSize: 13, color: 'rgba(232,228,220,0.55)' },
  input: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 14,
    color: '#e8e4dc',
    outline: 'none',
    fontFamily: "'DM Sans', sans-serif",
    width: '100%',
  },
  docTypes: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  docType: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    padding: '12px 16px',
  },
  docIcon: { fontSize: 20 },
  docLabel: { fontSize: 13, fontWeight: 500, color: '#e8e4dc' },
  docHint: { fontSize: 11, color: 'rgba(232,228,220,0.4)', marginTop: 2 },
  dropZone: {
    border: '1.5px dashed rgba(255,255,255,0.2)',
    borderRadius: 12,
    padding: '36px 24px',
    cursor: 'pointer',
    transition: 'border-color 0.2s, background 0.2s',
    minHeight: 140,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropZoneActive: {
    borderColor: '#b5e550',
    background: 'rgba(181,229,80,0.05)',
  },
  dropContent: { textAlign: 'center' },
  dropIcon: { fontSize: 32, color: 'rgba(255,255,255,0.25)', marginBottom: 12 },
  dropText: { fontSize: 15, color: 'rgba(232,228,220,0.7)', marginBottom: 6 },
  dropHint: { fontSize: 12, color: 'rgba(232,228,220,0.35)' },
  fileList: { display: 'flex', flexWrap: 'wrap', gap: 12, width: '100%' },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: '8px 12px',
    flex: '1 1 200px',
  },
  fileThumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
    overflow: 'hidden',
    background: 'rgba(255,255,255,0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  pdfIcon: { fontSize: 10, fontFamily: "'DM Mono', monospace", color: '#b5e550' },
  fileName: { fontSize: 12, color: 'rgba(232,228,220,0.7)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(232,228,220,0.4)',
    cursor: 'pointer',
    fontSize: 18,
    lineHeight: 1,
    padding: '0 4px',
    flexShrink: 0,
  },
  addMore: { fontSize: 13, color: 'rgba(232,228,220,0.4)', padding: '10px 14px', cursor: 'pointer' },
  error: {
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8,
    padding: '12px 16px',
    fontSize: 13,
    color: '#fca5a5',
    marginBottom: 20,
  },
  submitBtn: {
    width: '100%',
    padding: '16px',
    background: '#b5e550',
    color: '#0c0f0a',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    letterSpacing: '0.01em',
    transition: 'opacity 0.2s',
  },
  submitBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  footerStat: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 13,
    color: 'rgba(232,228,220,0.3)',
    lineHeight: 1.6,
  },
}
