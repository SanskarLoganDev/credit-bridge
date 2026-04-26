import { useState } from 'react'
import UploadPage from './components/UploadPage.jsx'
import Dashboard from './components/Dashboard.jsx'

export default function App() {
  const [view, setView] = useState('upload') // 'upload' | 'scoring' | 'result'
  const [applicantId, setApplicantId] = useState(null)
  const [result, setResult] = useState(null)
  const [applicantInfo, setApplicantInfo] = useState({})

  function handleStartScoring(id, info) {
    setApplicantId(id)
    setApplicantInfo(info)
    setView('scoring')
  }

  function handleResult(data) {
    setResult(data)
    setView('result')
  }

  function handleReset() {
    setView('upload')
    setApplicantId(null)
    setResult(null)
    setApplicantInfo({})
  }

  return (
    <>
      {view === 'upload' && (
        <UploadPage onStartScoring={handleStartScoring} />
      )}
      {(view === 'scoring' || view === 'result') && (
        <Dashboard
          applicantId={applicantId}
          applicantInfo={applicantInfo}
          result={result}
          onResult={handleResult}
          onReset={handleReset}
        />
      )}
    </>
  )
}
