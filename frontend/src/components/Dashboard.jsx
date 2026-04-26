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

  useEffect(() => {
    if (result) return

    const params = new URLSearchParams({
      email: applicantInfo.email || '',
      phone: applicantInfo.phone || '',
      name: applicantInfo.name || 'Applicant',
    })

    const es = new EventSource(`${API}/score/${applicantId}?${params}`)

    es.addEventListener('step', (e) => {
      const data = JSON.parse(e.data)
      setCurrentStep(data.step)
      setSteps(prev => ({ ...prev, [data.step]: data }))
    })

    es.addEventListener('result', (e) => {
      onResult(JSON.parse(e.data))
      es.close()
    })

    es.addEventListener('error', (e) => {
      try { setError(JSON.parse(e.data).message) }
      catch { if (es.readyState !== EventSource.CLOSED) setError('Connection error. Please try again.') }
      es.close()
    })

    return () => es.close()
  }, [applicantId])

  function toggleAudio() {
    if (!audioRef.current) return
    if (playing) { audioRef.current.pause(); setPlaying(false) }
    else { audioRef.current.play(); setPlaying(true) }
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
        {/* Applicant header */}
        <div style={styles.applicantRow}>
          <div>
            <div style={styles.applicantName}>{applicantInfo.name}</div>
            <div style={styles.applicantMeta}>
              {applicantInfo.email && <span>📧 {applicantInfo.email}</span>}
              {applicantInfo.phone && <span>💬 {applicantInfo.phone}</span>}
            </div>
          </div>
          {result && (
            <div style={{ ...styles.gradePill, borderColor: gradeColor, color: gradeColor }}>
              {grade}
            </div>
          )}
        </div>

        {/* Pipeline stepper */}
        {!result && (
          <div style={styles.stepperCard}>
            <div style={styles.stepperTitle}>Analysis in progress</div>
            <div style={styles.stepsGrid}>
              {STEPS.map(s => {
                const stepData = steps[s.id]
                const isDone = stepData?.done
                const isActive = currentStep === s.id && !isDone
                return (
                  <div key={s.id} style={styles.step}>
                    <div style={{
                      ...styles.stepDot,
                      background: isDone ? '#b5e550' : isActive ? 'rgba(181,229,80,0.25)' : 'rgba(255,255,255,0.08)',
                      border: isActive ? '2px solid #b5e550' : '2px solid transparent',
                      color: isDone ? '#0c0f0a' : isActive ? '#b5e550' : 'rgba(232,228,220,0.3)',
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

        {error && <div style={styles.errorCard}><strong>Error:</strong> {error}</div>}

        {/* Results */}
        {result && (
          <div style={styles.resultsGrid}>

            {/* COL 1 — score */}
            <div style={styles.scoreCard}>
              <div style={styles.scoreRing}>
                <svg width="220" height="220" viewBox="0 0 220 220">
                  <circle cx="110" cy="110" r="94" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="13"/>
                  <circle
                    cx="110" cy="110" r="94"
                    fill="none" stroke={gradeColor} strokeWidth="13"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 94}`}
                    strokeDashoffset={`${2 * Math.PI * 94 * (1 - (score - 300) / 550)}`}
                    transform="rotate(-90 110 110)"
                    style={{ transition: 'stroke-dashoffset 1.4s ease' }}
                  />
                </svg>
                <div style={styles.scoreInner}>
                  <div style={{ ...styles.scoreNumber, color: gradeColor }}>{score}</div>
                  <div style={styles.scoreOutOf}>out of 850</div>
                  <div style={{ ...styles.scoreGrade, color: gradeColor }}>{grade}</div>
                </div>
              </div>

              <div style={styles.recommendation}>{result.score?.recommendation}</div>

              {result.audio_url && (
                <div style={styles.audioSection}>
                  <audio ref={audioRef} src={`${API}${result.audio_url}`} onEnded={() => setPlaying(false)} />
                  <button style={styles.audioBtn} onClick={toggleAudio}>
                    <span style={styles.audioBtnIcon}>{playing ? '⏸' : '▶'}</span>
                    <div>
                      <div style={{ fontSize: 15 }}>{playing ? 'Pause narration' : 'Hear the verdict'}</div>
                      <div style={styles.audioBadgeInline}>♿ Accessibility feature</div>
                    </div>
                  </button>
                </div>
              )}

              <div style={styles.notifRow}>
                {applicantInfo.email && <span style={styles.notifBadge}>📧 Email sent</span>}
                {applicantInfo.phone && <span style={styles.notifBadge}>💬 WhatsApp sent</span>}
              </div>
            </div>

            {/* COL 2 — signals */}
            <div style={styles.signalsCard}>
              <div style={styles.cardTitle}>Signal breakdown</div>
              {Object.entries(SIGNAL_LABELS).map(([key, label]) => {
                const raw = signalScores[key] ?? 0
                const sig = signals[key] || {}
                const barColor = raw >= 70 ? '#b5e550' : raw >= 50 ? '#eab308' : '#ef4444'
                return (
                  <div key={key} style={styles.signalRow}>
                    <div style={styles.signalMeta}>
                      <span style={styles.signalLabel}>{label}</span>
                      <div style={styles.signalRight}>
                        <span style={{ ...styles.signalScore, color: barColor }}>{raw}</span>
                        <span style={styles.signalWeight}>{SIGNAL_WEIGHTS[key]}%</span>
                      </div>
                    </div>
                    <div style={styles.barTrack}>
                      <div style={{ ...styles.barFill, width: `${raw}%`, background: barColor }} />
                    </div>
                    {sig.evidence && <div style={styles.signalEvidence}>{sig.evidence}</div>}
                  </div>
                )
              })}
            </div>

            {/* COL 3 — narrative */}
            <div style={styles.narrativeCard}>
              <div style={styles.cardTitle}>Credit narrative</div>
              <p style={styles.narrativeText}>{result.narrative}</p>
              <div style={styles.narrativeDivider} />
              <div style={styles.narrativeFooter}>
                <span style={styles.narrativeBadge}>Generated by Claude</span>
                <span style={styles.narrativeId}>ID: {result.applicant_id}</span>
              </div>
            </div>

          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
      `}</style>
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
  resetBtn: {
    background: 'none', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 8, padding: '10px 22px', color: 'rgba(232,228,220,0.6)',
    cursor: 'pointer', fontSize: 15, fontFamily: "'DM Sans', sans-serif",
  },

  main: { maxWidth: 1440, margin: '0 auto', padding: '44px 56px 90px' },

  applicantRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 36,
  },
  applicantName: { fontFamily: "'DM Serif Display', serif", fontSize: 40, marginBottom: 10 },
  applicantMeta: { display: 'flex', gap: 24, fontSize: 15, color: 'rgba(232,228,220,0.4)' },
  gradePill: {
    border: '1.5px solid', borderRadius: 30,
    padding: '10px 28px', fontSize: 16, fontWeight: 600, letterSpacing: '0.08em',
  },

  stepperCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 18, padding: '40px 48px',
    animation: 'fadeIn 0.4s ease',
  },
  stepperTitle: {
    fontFamily: "'DM Mono', monospace", fontSize: 13, color: '#b5e550',
    letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 32,
  },
  stepsGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 },
  step: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' },
  stepDot: {
    width: 44, height: 44, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 15, fontWeight: 600, flexShrink: 0, transition: 'all 0.3s',
  },
  stepContent: {},
  stepLabel: { fontSize: 14, fontWeight: 500, marginBottom: 5, transition: 'color 0.3s' },
  stepDesc: { fontSize: 12, color: 'rgba(232,228,220,0.3)', lineHeight: 1.45 },
  spinner: {
    width: 18, height: 18, borderRadius: '50%',
    border: '2px solid rgba(181,229,80,0.2)',
    borderTopColor: '#b5e550',
    animation: 'spin 0.7s linear infinite',
  },

  errorCard: {
    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 10, padding: '18px 22px', fontSize: 15, color: '#fca5a5', marginTop: 24,
  },

  resultsGrid: {
    display: 'grid', gridTemplateColumns: '300px 1fr 1fr', gap: 24,
    animation: 'fadeIn 0.5s ease',
  },

  scoreCard: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 18, padding: '36px 28px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
  },
  scoreRing: { position: 'relative', width: 220, height: 220 },
  scoreInner: {
    position: 'absolute', inset: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  },
  scoreNumber: { fontFamily: "'DM Serif Display', serif", fontSize: 60, lineHeight: 1 },
  scoreOutOf: { fontSize: 14, color: 'rgba(232,228,220,0.35)', marginTop: 5 },
  scoreGrade: { fontSize: 17, fontWeight: 600, marginTop: 10, letterSpacing: '0.06em' },
  recommendation: {
    fontSize: 15, color: 'rgba(232,228,220,0.55)', textAlign: 'center',
    lineHeight: 1.7, padding: '0 4px',
  },

  audioSection: { width: '100%' },
  audioBtn: {
    width: '100%', display: 'flex', alignItems: 'center',
    gap: 14, padding: '16px 18px',
    background: 'rgba(181,229,80,0.08)', border: '1px solid rgba(181,229,80,0.25)',
    borderRadius: 12, color: '#b5e550', cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif", textAlign: 'left',
  },
  audioBtnIcon: { fontSize: 24, flexShrink: 0 },
  audioBadgeInline: { fontSize: 12, color: 'rgba(181,229,80,0.5)', marginTop: 3 },

  notifRow: { display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  notifBadge: {
    fontSize: 13, background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '6px 14px', borderRadius: 20, color: 'rgba(232,228,220,0.45)',
  },

  signalsCard: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 18, padding: '36px 36px',
  },
  cardTitle: {
    fontFamily: "'DM Mono', monospace", fontSize: 13, color: '#b5e550',
    letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 30,
  },
  signalRow: { marginBottom: 26 },
  signalMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  signalLabel: { fontSize: 15, color: 'rgba(232,228,220,0.8)' },
  signalRight: { display: 'flex', alignItems: 'center', gap: 12 },
  signalScore: { fontFamily: "'DM Mono', monospace", fontSize: 16, fontWeight: 500 },
  signalWeight: { fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'rgba(232,228,220,0.25)' },
  barTrack: {
    height: 8, background: 'rgba(255,255,255,0.07)', borderRadius: 4,
    overflow: 'hidden', marginBottom: 8,
  },
  barFill: { height: '100%', borderRadius: 4, transition: 'width 1.1s ease' },
  signalEvidence: {
    fontSize: 13, color: 'rgba(232,228,220,0.35)', lineHeight: 1.6, fontStyle: 'italic',
  },

  narrativeCard: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 18, padding: '36px 36px',
    display: 'flex', flexDirection: 'column',
  },
  narrativeText: {
    fontSize: 18, lineHeight: 1.9, color: 'rgba(232,228,220,0.82)',
    fontFamily: "'DM Serif Display', serif", fontStyle: 'italic', flex: 1,
  },
  narrativeDivider: { height: '1px', background: 'rgba(255,255,255,0.07)', margin: '28px 0' },
  narrativeFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  narrativeBadge: {
    fontSize: 13, background: 'rgba(181,229,80,0.08)',
    border: '1px solid rgba(181,229,80,0.2)',
    padding: '5px 14px', borderRadius: 20, color: 'rgba(181,229,80,0.65)',
  },
  narrativeId: {
    fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'rgba(232,228,220,0.2)',
  },
}
