import { useEffect, useState, useRef } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const STEPS = [
  { id: 1, label: 'Extracting documents', desc: 'Gemini Vision reading your files' },
  { id: 2, label: 'Calculating score', desc: 'Applying weighted rubric' },
  { id: 3, label: 'Writing narrative', desc: 'Claude crafting the assessment' },
  { id: 4, label: 'Generating voice', desc: 'ElevenLabs voicing the verdict' },
  { id: 5, label: 'Saving & notifying', desc: 'Firestore + email + WhatsApp' },
]

const SIGNAL_LABELS = {
  payment_consistency: 'Payment Consistency',
  bill_regularity: 'Bill Regularity',
  income_stability: 'Income Stability',
  rental_tenure: 'Rental Tenure',
  data_completeness: 'Data Completeness',
}

const SIGNAL_WEIGHTS = {
  payment_consistency: 30,
  bill_regularity: 20,
  income_stability: 15,
  rental_tenure: 25,
  data_completeness: 10,
}

export default function Dashboard({ applicantId, applicantInfo, result, onResult, onReset }) {
  const [steps, setSteps] = useState({})
  const [currentStep, setCurrentStep] = useState(1)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef(null)
  const eventSourceRef = useRef(null)

  useEffect(() => {
    if (result) return // already have result, no need to stream

    const params = new URLSearchParams({
      email: applicantInfo.email || '',
      phone: applicantInfo.phone || '',
      name: applicantInfo.name || 'Applicant',
    })

    const es = new EventSource(`${API}/score/${applicantId}?${params}`)
    eventSourceRef.current = es

    es.addEventListener('step', (e) => {
      const data = JSON.parse(e.data)
      setCurrentStep(data.step)
      setSteps(prev => ({ ...prev, [data.step]: data }))
    })

    es.addEventListener('result', (e) => {
      const data = JSON.parse(e.data)
      onResult(data)
      es.close()
    })

    es.addEventListener('error', (e) => {
      try {
        const data = JSON.parse(e.data)
        setError(data.message)
      } catch {
        if (es.readyState === EventSource.CLOSED) return
        setError('Connection error. Please try again.')
      }
      es.close()
    })

    return () => es.close()
  }, [applicantId])

  function toggleAudio() {
    if (!audioRef.current) return
    if (playing) {
      audioRef.current.pause()
      setPlaying(false)
    } else {
      audioRef.current.play()
      setPlaying(true)
    }
  }

  const score = result?.score?.final_score
  const grade = result?.score?.grade
  const gradeColor = result?.score?.grade_color || '#b5e550'
  const signals = result?.signals || {}
  const signalScores = result?.score?.signal_scores || {}

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoMark}>⬡</span>
          <span style={styles.logoText}>CreditBridge</span>
        </div>
        <button style={styles.resetBtn} onClick={onReset}>← New assessment</button>
      </header>

      <main style={styles.main}>
        <div style={styles.applicantRow}>
          <div style={styles.applicantName}>{applicantInfo.name}</div>
          <div style={styles.applicantMeta}>
            {applicantInfo.email && <span>📧 {applicantInfo.email}</span>}
            {applicantInfo.phone && <span>💬 {applicantInfo.phone}</span>}
          </div>
        </div>

        {/* Pipeline stepper */}
        {!result && (
          <div style={styles.stepperCard}>
            <div style={styles.stepperTitle}>Analysis in progress</div>
            <div style={styles.steps}>
              {STEPS.map(s => {
                const stepData = steps[s.id]
                const isDone = stepData?.done
                const isActive = currentStep === s.id && !isDone
                return (
                  <div key={s.id} style={styles.step}>
                    <div style={{
                      ...styles.stepDot,
                      background: isDone ? '#b5e550' : isActive ? 'rgba(181,229,80,0.3)' : 'rgba(255,255,255,0.1)',
                      border: isActive ? '2px solid #b5e550' : '2px solid transparent',
                    }}>
                      {isDone ? '✓' : s.id}
                    </div>
                    <div style={styles.stepContent}>
                      <div style={{
                        ...styles.stepLabel,
                        color: isDone ? '#b5e550' : isActive ? '#e8e4dc' : 'rgba(232,228,220,0.35)',
                      }}>{s.label}</div>
                      <div style={styles.stepDesc}>{s.desc}</div>
                    </div>
                    {isActive && <div style={styles.spinner} />}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {error && (
          <div style={styles.errorCard}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div style={styles.resultsGrid}>
            {/* Score card */}
            <div style={styles.scoreCard}>
              <div style={styles.scoreRing}>
                <svg width="180" height="180" viewBox="0 0 180 180">
                  <circle cx="90" cy="90" r="76" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10"/>
                  <circle
                    cx="90" cy="90" r="76"
                    fill="none"
                    stroke={gradeColor}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 76}`}
                    strokeDashoffset={`${2 * Math.PI * 76 * (1 - (score - 300) / 550)}`}
                    transform="rotate(-90 90 90)"
                    style={{ transition: 'stroke-dashoffset 1.2s ease' }}
                  />
                </svg>
                <div style={styles.scoreInner}>
                  <div style={{ ...styles.scoreNumber, color: gradeColor }}>{score}</div>
                  <div style={styles.scoreOutOf}>/ 850</div>
                  <div style={{ ...styles.scoreGrade, color: gradeColor }}>{grade}</div>
                </div>
              </div>
              <div style={styles.recommendation}>
                {result.score?.recommendation}
              </div>

              {/* Voice button */}
              {result.audio_url && (
                <div style={styles.audioSection}>
                  <audio
                    ref={audioRef}
                    src={`${API}${result.audio_url}`}
                    onEnded={() => setPlaying(false)}
                  />
                  <button style={styles.audioBtn} onClick={toggleAudio}>
                    <span style={styles.audioBtnIcon}>{playing ? '⏸' : '▶'}</span>
                    <span>{playing ? 'Pause' : 'Hear the verdict'}</span>
                    <span style={styles.audioBadge}>♿ Accessibility</span>
                  </button>
                </div>
              )}
            </div>

            {/* Signals + narrative */}
            <div style={styles.rightColumn}>
              {/* Signal bars */}
              <div style={styles.signalsCard}>
                <div style={styles.cardTitle}>Signal breakdown</div>
                {Object.entries(SIGNAL_LABELS).map(([key, label]) => {
                  const raw = signalScores[key] ?? 0
                  const sig = signals[key] || {}
                  return (
                    <div key={key} style={styles.signalRow}>
                      <div style={styles.signalMeta}>
                        <span style={styles.signalLabel}>{label}</span>
                        <span style={styles.signalWeight}>{SIGNAL_WEIGHTS[key]}%</span>
                      </div>
                      <div style={styles.barTrack}>
                        <div style={{
                          ...styles.barFill,
                          width: `${raw}%`,
                          background: raw >= 70 ? '#b5e550' : raw >= 50 ? '#eab308' : '#ef4444',
                        }} />
                      </div>
                      <div style={styles.signalScore}>{raw}</div>
                      {sig.evidence && (
                        <div style={styles.signalEvidence}>{sig.evidence}</div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Narrative */}
              <div style={styles.narrativeCard}>
                <div style={styles.cardTitle}>Credit narrative</div>
                <p style={styles.narrativeText}>{result.narrative}</p>
                <div style={styles.narrativeFooter}>
                  <span style={styles.narrativeBadge}>Generated by Claude</span>
                  {applicantInfo.email && (
                    <span style={styles.notifBadge}>📧 Report sent</span>
                  )}
                  {applicantInfo.phone && (
                    <span style={styles.notifBadge}>💬 WhatsApp sent</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#0c0f0a', color: '#e8e4dc' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '24px 40px', borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  logo: { display: 'flex', alignItems: 'center', gap: 10 },
  logoMark: { fontSize: 22, color: '#b5e550' },
  logoText: { fontFamily: "'DM Serif Display', serif", fontSize: 20, color: '#e8e4dc' },
  resetBtn: {
    background: 'none', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 8, padding: '8px 16px', color: 'rgba(232,228,220,0.6)',
    cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans', sans-serif",
  },
  main: { maxWidth: 960, margin: '0 auto', padding: '40px 24px 80px' },
  applicantRow: { marginBottom: 32 },
  applicantName: { fontFamily: "'DM Serif Display', serif", fontSize: 32, marginBottom: 8 },
  applicantMeta: { display: 'flex', gap: 20, fontSize: 13, color: 'rgba(232,228,220,0.45)' },

  stepperCard: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 16, padding: '32px 36px',
    animation: 'fadeIn 0.4s ease',
  },
  stepperTitle: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#b5e550', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 28 },
  steps: { display: 'flex', flexDirection: 'column', gap: 20 },
  step: { display: 'flex', alignItems: 'flex-start', gap: 16 },
  stepDot: {
    width: 32, height: 32, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 600, color: '#0c0f0a', flexShrink: 0,
    transition: 'all 0.3s',
  },
  stepContent: { flex: 1, paddingTop: 4 },
  stepLabel: { fontSize: 14, fontWeight: 500, marginBottom: 2, transition: 'color 0.3s' },
  stepDesc: { fontSize: 12, color: 'rgba(232,228,220,0.35)' },
  spinner: {
    width: 18, height: 18, borderRadius: '50%',
    border: '2px solid rgba(181,229,80,0.2)',
    borderTopColor: '#b5e550',
    animation: 'spin 0.7s linear infinite',
    marginTop: 6,
  },

  errorCard: {
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8, padding: '16px 20px',
    fontSize: 14, color: '#fca5a5', marginTop: 20,
  },

  resultsGrid: {
    display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24,
    animation: 'fadeIn 0.5s ease',
  },

  scoreCard: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 16, padding: '32px 24px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
  },
  scoreRing: { position: 'relative', width: 180, height: 180 },
  scoreInner: {
    position: 'absolute', inset: 0,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
  },
  scoreNumber: { fontFamily: "'DM Serif Display', serif", fontSize: 48, lineHeight: 1 },
  scoreOutOf: { fontSize: 13, color: 'rgba(232,228,220,0.4)', marginTop: 2 },
  scoreGrade: { fontSize: 14, fontWeight: 600, marginTop: 6, letterSpacing: '0.05em' },
  recommendation: {
    fontSize: 13, color: 'rgba(232,228,220,0.6)', textAlign: 'center', lineHeight: 1.6,
    padding: '0 8px',
  },
  audioSection: { width: '100%' },
  audioBtn: {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: '12px', background: 'rgba(181,229,80,0.1)',
    border: '1px solid rgba(181,229,80,0.3)', borderRadius: 10,
    color: '#b5e550', cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans', sans-serif",
  },
  audioBtnIcon: { fontSize: 16 },
  audioBadge: {
    fontSize: 10, background: 'rgba(181,229,80,0.15)',
    padding: '2px 6px', borderRadius: 4, color: 'rgba(181,229,80,0.7)',
  },

  rightColumn: { display: 'flex', flexDirection: 'column', gap: 20 },
  signalsCard: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 16, padding: '28px 32px',
  },
  cardTitle: {
    fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#b5e550',
    letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 24,
  },
  signalRow: { marginBottom: 20 },
  signalMeta: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 },
  signalLabel: { fontSize: 13, color: 'rgba(232,228,220,0.8)' },
  signalWeight: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'rgba(232,228,220,0.35)' },
  barTrack: {
    height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3,
    overflow: 'hidden', marginBottom: 4,
  },
  barFill: { height: '100%', borderRadius: 3, transition: 'width 1s ease' },
  signalScore: {
    fontFamily: "'DM Mono', monospace", fontSize: 11,
    color: 'rgba(232,228,220,0.4)', textAlign: 'right',
  },
  signalEvidence: {
    fontSize: 11, color: 'rgba(232,228,220,0.35)', lineHeight: 1.5,
    marginTop: 4, fontStyle: 'italic',
  },

  narrativeCard: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 16, padding: '28px 32px',
  },
  narrativeText: {
    fontSize: 16, lineHeight: 1.8, color: 'rgba(232,228,220,0.85)',
    fontFamily: "'DM Serif Display', serif", fontStyle: 'italic',
  },
  narrativeFooter: { display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' },
  narrativeBadge: {
    fontSize: 11, background: 'rgba(181,229,80,0.1)',
    border: '1px solid rgba(181,229,80,0.2)',
    padding: '4px 10px', borderRadius: 20, color: 'rgba(181,229,80,0.7)',
  },
  notifBadge: {
    fontSize: 11, background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '4px 10px', borderRadius: 20, color: 'rgba(232,228,220,0.5)',
  },
}
