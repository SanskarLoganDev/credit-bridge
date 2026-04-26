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
    setFiles(prev => [...prev, ...valid].slice(0, 4))
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
      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoMark}>⬡</span>
          <span style={styles.logoText}>CreditBridge</span>
        </div>
        <span style={styles.tagline}>Alternative credit scoring for the unbanked</span>
      </header>

      <main style={styles.main}>
        <div style={styles.hero}>
          <h1 style={styles.h1}>
            Score any applicant <em style={styles.italic}>in 60 seconds.</em>
          </h1>
          <p style={styles.sub}>
            Upload utility bills, phone bills, or rental receipts.
            Gemini Vision extracts financial signals. Claude writes the verdict.
          </p>
        </div>

        <div style={styles.twoCol}>
          {/* LEFT */}
          <div style={styles.card}>
            <div style={styles.section}>
              <label style={styles.sectionLabel}>Applicant details</label>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>Full name *</label>
                <input style={styles.input} placeholder="Priya Sharma" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>Email (for report)</label>
                <input style={styles.input} placeholder="priya@example.com" type="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>WhatsApp / phone</label>
                <input style={styles.input} placeholder="+91 98765 43210" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
            </div>

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

            {error && <div style={styles.error}>{error}</div>}

            <button
              style={{ ...styles.submitBtn, ...(uploading ? styles.submitBtnDisabled : {}) }}
              onClick={handleSubmit}
              disabled={uploading}
            >
              {uploading ? 'Uploading...' : 'Analyse Applicant →'}
            </button>
          </div>

          {/* RIGHT */}
          <div style={styles.card}>
            <label style={styles.sectionLabel}>Upload documents (max 4)</label>
            <div
              style={{ ...styles.dropZone, ...(dragging ? styles.dropZoneActive : {}) }}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onClick={() => inputRef.current?.click()}
            >
              <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
              {files.length === 0 ? (
                <div style={styles.dropContent}>
                  <div style={styles.dropIcon}>↑</div>
                  <div style={styles.dropText}>Drop files here or click to browse</div>
                  <div style={styles.dropHint}>JPG, PNG, PDF — phone photos work fine</div>
                </div>
              ) : (
                <div style={styles.fileGrid}>
                  {files.map((f, i) => (
                    <div key={i} style={styles.fileCard}>
                      <div style={styles.fileThumb}>
                        {f.type.startsWith('image/') ? (
                          <img src={URL.createObjectURL(f)} style={styles.thumbImg} alt="" />
                        ) : (
                          <span style={styles.pdfIcon}>PDF</span>
                        )}
                      </div>
                      <div style={styles.fileName}>{f.name}</div>
                      <button style={styles.removeBtn} onClick={e => { e.stopPropagation(); removeFile(i) }}>×</button>
                    </div>
                  ))}
                  {files.length < 4 && (
                    <div style={styles.addMoreCard}>
                      <div style={styles.addMoreIcon}>+</div>
                      <div style={styles.addMoreText}>Add more</div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={styles.dropMeta}>{files.length} / 4 documents · JPG, PNG, PDF accepted</div>
          </div>
        </div>

        <p style={styles.footerStat}>
          1.3 billion adults remain unbanked globally — CreditBridge helps lenders reach them. (World Bank Global Findex, 2025)
        </p>
      </main>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#0c0f0a', color: '#e8e4dc' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '28px 56px', borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  logo: { display: 'flex', alignItems: 'center', gap: 12 },
  logoMark: { fontSize: 28, color: '#b5e550' },
  logoText: { fontFamily: "'DM Serif Display', serif", fontSize: 26, color: '#e8e4dc' },
  tagline: { fontSize: 15, color: 'rgba(232,228,220,0.45)', fontFamily: "'DM Mono', monospace" },

  main: { maxWidth: 1320, margin: '0 auto', padding: '56px 56px 90px' },

  hero: { textAlign: 'center', marginBottom: 52 },
  h1: {
    fontFamily: "'DM Serif Display', serif",
    fontSize: 64, fontWeight: 400, lineHeight: 1.1,
    color: '#e8e4dc', marginBottom: 20,
  },
  italic: { color: '#b5e550', fontStyle: 'italic' },
  sub: { fontSize: 20, color: 'rgba(232,228,220,0.55)', lineHeight: 1.7, maxWidth: 600, margin: '0 auto' },

  twoCol: {
    display: 'grid', gridTemplateColumns: '460px 1fr',
    gap: 28, alignItems: 'start',
  },

  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 18, padding: '40px 40px 36px',
  },

  section: { marginBottom: 36 },
  sectionLabel: {
    display: 'block',
    fontFamily: "'DM Mono', monospace", fontSize: 13, color: '#b5e550',
    letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 18,
  },

  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 },
  fieldLabel: { fontSize: 15, color: 'rgba(232,228,220,0.6)' },
  input: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10, padding: '14px 16px',
    fontSize: 16, color: '#e8e4dc', outline: 'none',
    fontFamily: "'DM Sans', sans-serif", width: '100%',
  },

  docTypes: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  docType: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10, padding: '14px 16px',
  },
  docIcon: { fontSize: 22 },
  docLabel: { fontSize: 15, fontWeight: 500, color: '#e8e4dc' },
  docHint: { fontSize: 13, color: 'rgba(232,228,220,0.4)', marginTop: 3 },

  dropZone: {
    border: '1.5px dashed rgba(255,255,255,0.15)',
    borderRadius: 14, padding: '36px 28px',
    cursor: 'pointer',
    transition: 'border-color 0.2s, background 0.2s',
    minHeight: 360,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  dropZoneActive: { borderColor: '#b5e550', background: 'rgba(181,229,80,0.04)' },
  dropContent: { textAlign: 'center' },
  dropIcon: { fontSize: 44, color: 'rgba(255,255,255,0.2)', marginBottom: 16 },
  dropText: { fontSize: 18, color: 'rgba(232,228,220,0.65)', marginBottom: 8 },
  dropHint: { fontSize: 14, color: 'rgba(232,228,220,0.3)' },
  dropMeta: { fontSize: 13, color: 'rgba(232,228,220,0.3)', fontFamily: "'DM Mono', monospace" },

  fileGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, width: '100%' },
  fileCard: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10, overflow: 'hidden',
    display: 'flex', flexDirection: 'column', position: 'relative',
  },
  fileThumb: {
    width: '100%', height: 140,
    background: 'rgba(255,255,255,0.06)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  pdfIcon: { fontSize: 14, fontFamily: "'DM Mono', monospace", color: '#b5e550' },
  fileName: {
    fontSize: 13, color: 'rgba(232,228,220,0.6)',
    padding: '10px 12px', overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  removeBtn: {
    position: 'absolute', top: 8, right: 8,
    background: 'rgba(0,0,0,0.65)', border: 'none',
    color: '#e8e4dc', cursor: 'pointer', fontSize: 16, lineHeight: 1,
    width: 26, height: 26, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  addMoreCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1.5px dashed rgba(255,255,255,0.1)',
    borderRadius: 10, height: 170,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  addMoreIcon: { fontSize: 28, color: 'rgba(255,255,255,0.2)' },
  addMoreText: { fontSize: 14, color: 'rgba(232,228,220,0.3)' },

  error: {
    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 10, padding: '14px 18px',
    fontSize: 15, color: '#fca5a5', marginBottom: 22,
  },
  submitBtn: {
    width: '100%', padding: '18px',
    background: '#b5e550', color: '#0c0f0a',
    border: 'none', borderRadius: 12,
    fontSize: 17, fontWeight: 600, cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.01em',
    transition: 'opacity 0.2s',
  },
  submitBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },

  footerStat: {
    textAlign: 'center', marginTop: 48,
    fontSize: 14, color: 'rgba(232,228,220,0.25)', lineHeight: 1.6,
  },
}
