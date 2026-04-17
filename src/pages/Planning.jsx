import { useState, useEffect } from 'react'
import OwnPipeline   from './planning/OwnPipeline'
import PipelineView  from './planning/PipelineView'

// ── 탭 → 뷰 매핑 ──────────────────────────────────────
// App.jsx에서 넘겨주는 tab prop 값:
//   'team'     → Pipeline View (팀 전체)
//   'simulate' → Pipeline View (시나리오 모드)

export default function Planning({ tab, darkMode, session, lastSeen }) {

  if (tab === 'my') {
    return (
      <OwnPipeline
        darkMode={darkMode}
        session={session}
        lastSeen={lastSeen}
      />
    )
  }

  return (
    <PipelineView
      darkMode={darkMode}
      session={session}
      lastSeen={lastSeen}
      initialSimMode={tab === 'simulate'}
    />
  )
}
