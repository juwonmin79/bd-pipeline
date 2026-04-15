import { useState, useEffect } from 'react'
import OwnPipeline    from './planning/OwnPipeline'
import TeamOverview   from './planning/TeamOverview'
import ScenarioEditor from './planning/ScenarioEditor'

// ── 탭 → 뷰 매핑 ──────────────────────────────────────
// App.jsx에서 넘겨주는 tab prop 값:
//   'my'       → Own Pipeline
//   'team'     → Team Overview
//   'simulate' → Scenario Editor

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

  if (tab === 'simulate') {
    return (
      <ScenarioEditor
        darkMode={darkMode}
        session={session}
        lastSeen={lastSeen}
      />
    )
  }

  return (
    <TeamOverview
      tab={tab}
      darkMode={darkMode}
      session={session}
      lastSeen={lastSeen}
    />
  )
}
