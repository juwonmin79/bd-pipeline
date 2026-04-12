import { useState, useEffect } from 'react'
import PersonalView from './planning/PersonalView'
import TeamView     from './planning/TeamView'
import SimulationView from './planning/SimulationView'

// ── 탭 → 뷰 매핑 ──────────────────────────────────────
// App.jsx에서 넘겨주는 tab prop 값:
//   'my'       → 개인 뷰
//   'team'     → 전체 뷰
//   'simulate' → 시뮬레이션
//   'target'   → 전체 뷰 (목표 관리, team과 동일 뷰)

export default function Planning({ tab, darkMode, session }) {
  // 공통 상태 — 하위 뷰들이 공유할 것만 여기서 관리
  // (환율, 토스트는 각 뷰에서 독립 관리)

  if (tab === 'my') {
    return (
      <PersonalView
        darkMode={darkMode}
        session={session}
      />
    )
  }

  if (tab === 'simulate') {
    return (
      <SimulationView
        darkMode={darkMode}
        session={session}
      />
    )
  }

  // 'team' | 'target' → 전체 뷰
  return (
    <TeamView
      tab={tab}
      darkMode={darkMode}
      session={session}
    />
  )
}
