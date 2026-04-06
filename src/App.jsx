import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './supabase'

// ── 모듈 레벨 styles 참조 (하위 컴포넌트용) ──────
let _styles = null

// ── 환율 ──────────────────────────────────────────
const FALLBACK_RATES = { KRW: 1, USD: 1/1510, CNY: 1/217, JPY: 1/9.47, EUR: 1/1728 }
const CCY_SYMS = { KRW: '', USD: '$', CNY: '¥', JPY: '¥', EUR: '€' }
const CCY_LABELS = { KRW: '원화', USD: 'USD', CNY: 'CNY', JPY: 'JPY', EUR: 'EUR' }

// ── 상태 배지 색상 ─────────────────────────────────
// 다크/라이트 공용 배지 색상 (배경 투명도 방식)
const STATUS_STYLE = {
  won:     { bg: 'rgba(74,222,128,0.15)',  color: '#16a34a', label: '계약' },
  active:  { bg: 'rgba(96,165,250,0.15)',  color: '#2563eb', label: '진행중' },
  drop:    { bg: 'rgba(248,113,113,0.15)', color: '#dc2626', label: '드랍' },
  pending: { bg: 'rgba(251,191,36,0.15)',  color: '#d97706', label: '대기' },
}

const CATEGORY_STYLE = {
  Pick:     { bg: 'rgba(96,165,250,0.15)',  color: '#2563eb' },
  New:      { bg: 'rgba(74,222,128,0.15)',  color: '#16a34a' },
  Maintain: { bg: 'rgba(251,191,36,0.15)', color: '#d97706' },
  Drop:     { bg: 'rgba(248,113,113,0.15)', color: '#dc2626' },
}

export default function App() {
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('admin') // personal | admin | sim
  const [ccy, setCcy] = useState('KRW')
  const [rates, setRates] = useState(FALLBACK_RATES)
  const [rateStatus, setRateStatus] = useState('loading') // loading | live | fallback
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [quarterRange, setQuarterRange] = useState({ start: 0, end: 3 })
  const [simChanges, setSimChanges] = useState({}) // id → changed deal
  const [simChildren, setSimChildren] = useState({}) // id → [child deals]
  const [editingId, setEditingId] = useState(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [diffChecked, setDiffChecked] = useState({})
  const [editingChild, setEditingChild] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [darkMode, setDarkMode] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  // ── 인증 세션 ────────────────────────────────────
  const [session, setSession] = useState(undefined) // undefined = 초기화 중
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s ?? null))
    return () => subscription.unsubscribe()
  }, [])

  // ── 데이터 로드 ──────────────────────────────────
  const loadDeals = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('is_simulation', false)
      .order('created_at', { ascending: true })
    if (error) { setError(error.message); setLoading(false); return }
    setDeals(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadDeals() }, [loadDeals])

  // ── 환율 로드 ────────────────────────────────────
  useEffect(() => {
    fetch('https://api.exchangerate-api.com/v4/latest/KRW')
      .then(r => r.json())
      .then(data => {
        setRates({ KRW: 1, USD: data.rates.USD, CNY: data.rates.CNY, JPY: data.rates.JPY, EUR: data.rates.EUR })
        setRateStatus('live')
      })
      .catch(() => { setRates(FALLBACK_RATES); setRateStatus('fallback') })
  }, [])

  // ── 분기 목록 (DB 기반) ─────────────────────────
  const quarters = [...new Set(deals.map(d => d.quarter).filter(Boolean))].sort()

  // 분기 범위 — 데이터 로드 시 전체 범위로 자동 설정
  const quartersKey = quarters.join(',')
  useEffect(() => {
    if (quarters.length > 0) {
      setQuarterRange({ start: 0, end: quarters.length - 1 })
    }
  }, [quartersKey])

  // ── 필터된 딜 ───────────────────────────────────
  const filteredDeals = deals.filter(d => {
    if (mode === 'personal' && d.created_by !== 'Jake') return false
    if (ownerFilter !== 'all' && d.created_by !== ownerFilter) return false
    const qi = quarters.indexOf(d.quarter)
    if (quarters.length > 0 && (qi < quarterRange.start || qi > quarterRange.end)) return false
    if (categoryFilter !== 'all' && d.product_cat !== categoryFilter) return false
    if (statusFilter !== 'all' && d.status !== statusFilter) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      if (!(d.case_name||'').toLowerCase().includes(q) && !(d.customer||'').toLowerCase().includes(q)) return false
    }
    return true
  })

  // ── 금액 변환 ────────────────────────────────────
  const cvt = (krw) => krw * rates[ccy]
  const fmtK = (krw) => {
    if (!krw) return '—'
    const v = cvt(krw)
    const s = CCY_SYMS[ccy]
    if (ccy === 'KRW') return s + Math.round(v).toLocaleString() + 'K'
    if (ccy === 'JPY') return s + Math.round(v / 10).toLocaleString() + '万'
    return s + v.toFixed(1) + 'K'
  }

  // ── KPI 계산 ─────────────────────────────────────
  // 계약(won): 확정 매출에만 반영 (book_amount 풀 금액)
  // 진행중(active): 예측 매출에만 반영 (계약금액 × 확률%)
  // 대기(pending): 어디도 반영 안 함
  // 드랍(drop): 어디도 반영 안 함
  const simDealMap = { ...Object.fromEntries(filteredDeals.map(d => [d.id, d])), ...simChanges }
  const activeForecast = Object.values(simDealMap)
    .filter(d => d.status === 'active')
    .reduce((s, d) => s + Math.round((d.book_amount * d.probability) / 100), 0)
  const wonAmount = filteredDeals
    .filter(d => d.status === 'won')
    .reduce((s, d) => s + (d.book_amount || 0), 0)
  const targetAmount = filteredDeals.reduce((s, d) => s + (d.target_amount || 0), 0)
  const gap = Math.max(0, targetAmount - activeForecast)
  const achieveRate = targetAmount > 0 ? Math.round((activeForecast / targetAmount) * 100) : 0

  // 시뮬 KPI
  const hasSimChanges = Object.keys(simChanges).length > 0
  const simForecast = hasSimChanges ? activeForecast : null

  // 담당자 목록
  const owners = [...new Set(deals.map(d => d.created_by).filter(Boolean))]

  // 제품 구분 목록 (DB 실제값 기반)
  const productCats = [...new Set(deals.map(d => d.product_cat).filter(Boolean))].sort()

  // ── 다크/라이트 스타일 ───────────────────────────
  const styles = useMemo(() => getStyles(darkMode), [darkMode])
  _styles = styles

  // ── 시뮬 편집 적용 ───────────────────────────────
  const applySimEdit = (id, updates) => {
    setSimChanges(prev => ({ ...prev, [id]: { ...deals.find(d => d.id === id), ...prev[id], ...updates } }))
    setDiffChecked(prev => ({ ...prev, [id]: true }))
    setEditingId(null)
  }

  // ── 커밋 ─────────────────────────────────────────
  const doCommit = async () => {
    const toCommit = Object.keys(diffChecked).filter(id => diffChecked[id])
    for (const id of toCommit) {
      const change = simChanges[id]
      if (!change) continue
      await supabase.from('projects').update({
        book_amount: change.book_amount,
        probability: change.probability,
        quarter: change.quarter,
        status: change.status,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
    }
    setSimChanges({})
    setSimChildren({})
    setDiffChecked({})
    setDiffOpen(false)
    setCommitMsg('')
    setMode('admin')
    loadDeals()
  }

  if (session === undefined) return (
    <div style={{ minHeight:'100vh', background:'#0a0a0a', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:8, height:8, borderRadius:'50%', background:'#7c3aed' }} />
    </div>
  )
  if (session === null) return <LoginScreen />

  if (loading) return (
    <div style={styles.loadWrap}>
      <div style={styles.loadDot} />
      <span style={styles.loadTxt}>BD Pipeline 로딩 중...</span>
    </div>
  )

  if (error) return (
    <div style={styles.loadWrap}>
      <span style={{ color: '#f87171', fontSize: 14 }}>연결 오류: {error}</span>
    </div>
  )

  return (
    <div style={styles.root}>
      {/* NAV */}
      <nav style={styles.nav}>
        <div style={styles.navLeft}>
          <div style={styles.logo}>BD <span style={styles.logoAccent}>Pipeline</span></div>
          <div style={styles.modeTabs}>
            {[['personal','개인 뷰'],['admin','관리자 뷰'],['sim','시뮬레이션']].map(([m, label]) => (
              <button key={m} style={{...styles.modeTab, ...(mode===m ? (m==='sim' ? styles.modeTabSimActive : styles.modeTabActive) : {})}}
                onClick={() => setMode(m)}>{label}</button>
            ))}
          </div>
        </div>
        <div style={styles.navRight}>
          {/* 환율 선택 */}
          <div style={styles.ccyWrap}>
            <span style={styles.ccyLabel}>단위</span>
            <select style={styles.ccySel} value={ccy} onChange={e => setCcy(e.target.value)}>
              {['KRW','USD','CNY','JPY','EUR'].map(c => (
                <option key={c} value={c}>{CCY_LABELS[c]}</option>
              ))}
            </select>
            <div style={{...styles.rateDot, background: rateStatus==='live' ? '#4ade80' : rateStatus==='loading' ? '#fbbf24' : '#6b7280'}} />
            <span style={styles.rateLabel}>{rateStatus==='live' ? '실시간' : rateStatus==='loading' ? '...' : '기준값'}</span>
          </div>
          <button
            onClick={() => setDarkMode(d => !d)}
            style={{
              fontSize:12, padding:'4px 10px', borderRadius:6,
              border:'1px solid ' + (darkMode ? '#2a2a2a' : '#d1d5db'),
              background:'transparent',
              color: darkMode ? '#fbbf24' : '#6b7280',
              cursor:'pointer', fontFamily:"'Geist', sans-serif"
            }}
          >
            {darkMode ? '☀️ 라이트' : '🌙 다크'}
          </button>
          <div style={styles.avatar}>J</div>
          <span style={styles.userName}>Jake</span>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{
              fontSize:11, padding:'4px 10px', borderRadius:6,
              border:'1px solid ' + (darkMode ? '#2a2a2a' : '#d1d5db'),
              background:'transparent',
              color: darkMode ? '#9ca3af' : '#6b7280',
              cursor:'pointer', fontFamily:"'Geist', sans-serif"
            }}
          >로그아웃</button>
        </div>
      </nav>

      {/* SIM BANNER */}
      {mode === 'sim' && (
        <div style={styles.simBanner}>
          <div style={styles.simBannerLeft}>
            <div style={styles.simPulse} />
            <div>
              <div style={styles.simBannerTitle}>시뮬레이션 모드</div>
              <div style={styles.simBannerSub}>실제 DB 불변 — 커밋 전까지 샌드박스</div>
            </div>
            <span style={styles.chgPill}>{Object.keys(simChanges).length}건 변경</span>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={styles.btnDiscard} onClick={() => { setSimChanges({}); setSimChildren({}); setMode('admin') }}>폐기</button>
            <button style={styles.btnDiff} onClick={() => setDiffOpen(true)}>Diff 리뷰 →</button>
          </div>
        </div>
      )}

      {/* TOOLBAR */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          {/* 분기 범위 */}
          <QuarterRangePicker quarters={quarters} range={quarterRange} onChange={setQuarterRange} />
          {/* 담당자 필터 */}
          <select style={styles.ownerSel} value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
            <option value="all">전체 담당자</option>
            {owners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {/* 우측: 검색 + 구분/상태 필터 + 추가 버튼 */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <input
            style={styles.searchInput}
            placeholder="Case / 고객사 검색"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <select style={styles.ownerSel} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="all">전체 구분</option>
            {productCats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select style={styles.ownerSel} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">전체 상태</option>
            <option value="won">계약</option>
            <option value="active">진행중</option>
            <option value="pending">대기</option>
            <option value="drop">드랍</option>
          </select>
          {mode !== 'sim' && (
            <button style={styles.btnAddProject} onClick={() => alert('프로젝트 추가 기능 준비 중')}>
              + 프로젝트 추가
            </button>
          )}
        </div>
      </div>

      {/* BODY */}
      <div style={styles.body}>

        {/* KPI */}
        <div style={styles.kpiRow}>
          <KpiCard dot="#4ade80" label="확정 매출" value={fmtK(wonAmount)} sub={`계약 ${filteredDeals.filter(d=>d.status==='won').length}건`} />
          <KpiCard dot="#60a5fa" label="예측 매출" value={fmtK(activeForecast)} sub="확도 반영 합산"
            sim={hasSimChanges && mode==='sim' ? { value: fmtK(simForecast), delta: activeForecast - (deals.reduce((s,d)=>s+(d.reflected_amount||0),0)) } : null} fmtK={fmtK} />
          <KpiCard dot="#fbbf24" label="사업계획 목표" value={fmtK(targetAmount)} sub="연간 합산" />
          <KpiCard dot="#f87171" label="갭 (부족)" value={fmtK(gap)} sub={`달성률 ${achieveRate}%`} isGap achieveRate={achieveRate} />
        </div>

        {/* DEAL TABLE */}
        <div style={styles.tblCard}>
          <div style={styles.tblTop}>
            <span style={styles.tblTitle}>딜 목록</span>
            {mode==='sim' && <span style={styles.simHint}>● 시뮬레이션 변경 사항</span>}
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={styles.tbl}>
              <thead>
                <tr>
                  {['Case / 고객사','제품 / 국가','분기','상태','확도','계약금액','반영금액','착수일','종료일',''].map((h,i) => (
                    <th key={i} style={{...styles.th, textAlign: i>=5&&i<=6 ? 'right' : 'left'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDeals.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding:'32px', textAlign:'center', color:'#6b7280', fontSize:13 }}>데이터가 없습니다</td></tr>
                ) : filteredDeals.map(deal => {
                  const d = simChanges[deal.id] || deal
                  const isSim = !!simChanges[deal.id]
                  const isOpen = editingId === deal.id
                  return [
                    <DealRow key={deal.id} deal={d} orig={deal} isSim={isSim} isOpen={isOpen} mode={mode}
                      fmtK={fmtK} onToggle={() => setEditingId(isOpen ? null : deal.id)} />,
                    isOpen && mode==='sim' && (
                      <tr key={deal.id+'-edit'}>
                        <td colSpan={10} style={{ padding:0 }}>
                          <EditPanel deal={d} fmtK={fmtK} quarters={quarters} owners={owners}
                            onApply={(updates) => applySimEdit(deal.id, updates)}
                            onCancel={() => setEditingId(null)}
                            onAddChild={(child) => setSimChildren(prev => ({ ...prev, [deal.id]: [...(prev[deal.id]||[]), child] }))} />
                        </td>
                      </tr>
                    ),
                    ...(simChildren[deal.id]||[]).map((c,ci) => [
                      <ChildRow key={deal.id+'-child-'+ci} child={c} deal={d} fmtK={fmtK}
                        onEdit={() => setEditingChild({ dealId: deal.id, ci })}
                        onDelete={() => setSimChildren(prev => ({
                          ...prev,
                          [deal.id]: prev[deal.id].filter((_,j) => j !== ci)
                        }))}
                      />,
                      editingChild?.dealId === deal.id && editingChild?.ci === ci && (
                        <tr key={deal.id+'-child-edit-'+ci}>
                          <td colSpan={10} style={{ padding:0 }}>
                            <ChildEditPanel
                              child={c}
                              quarters={quarters}
                              fmtK={fmtK}
                              onApply={(updated) => {
                                setSimChildren(prev => ({
                                  ...prev,
                                  [deal.id]: prev[deal.id].map((x,j) => j===ci ? {...x, ...updated} : x)
                                }))
                                setEditingChild(null)
                              }}
                              onCancel={() => setEditingChild(null)}
                            />
                          </td>
                        </tr>
                      )
                    ])
                  ]
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* DIFF MODAL */}
      {diffOpen && (
        <div style={styles.overlay}>
          <div style={styles.diffModal}>
            <div style={styles.diffHeader}>
              <span style={styles.diffTitle}>Diff 리뷰 — 커밋할 변경 선택</span>
              <button style={styles.diffClose} onClick={() => setDiffOpen(false)}>×</button>
            </div>
            {Object.keys(simChanges).length === 0 ? (
              <div style={{ padding:'24px 20px', color:'#6b7280', fontSize:13, textAlign:'center' }}>변경된 딜이 없습니다</div>
            ) : Object.entries(simChanges).map(([id, changed]) => {
              const orig = deals.find(d => d.id === id)
              if (!orig) return null
              return (
                <div key={id} style={styles.diffItem}>
                  <div style={{...styles.diffChk, ...(diffChecked[id] ? styles.diffChkOn : {})}}
                    onClick={() => setDiffChecked(prev => ({...prev, [id]: !prev[id]}))}>
                    {diffChecked[id] && '✓'}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={styles.diffName}>{orig.case_name} <span style={styles.diffCo}>{orig.customer}</span></div>
                    <div style={styles.diffRows}>
                      {changed.book_amount !== orig.book_amount && <DiffRow field="금액" before={fmtK(orig.book_amount)} after={fmtK(changed.book_amount)} />}
                      {changed.probability !== orig.probability && <DiffRow field="확도" before={orig.probability+'%'} after={changed.probability+'%'} />}
                      {changed.quarter !== orig.quarter && <DiffRow field="분기" before={orig.quarter} after={changed.quarter} />}
                      {changed.status !== orig.status && <DiffRow field="상태" before={orig.status} after={changed.status} />}
                      {(simChildren[id]||[]).length > 0 && <DiffRow field="파생딜" before="없음" after={`${simChildren[id].length}건 child`} />}
                    </div>
                  </div>
                </div>
              )
            })}
            <div style={styles.diffFoot}>
              <input style={styles.commitInp} value={commitMsg} onChange={e => setCommitMsg(e.target.value)}
                placeholder="커밋 메시지 (예: 주간회의 반영 — 25Q1 조정)" />
              <button style={styles.btnCommit} onClick={doCommit}>커밋 적용</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── KPI 카드 ──────────────────────────────────────
function KpiCard({ dot, label, value, sub, sim, fmtK, isGap, achieveRate }) {
  const gapColor = isGap ? (achieveRate >= 90 ? '#4ade80' : achieveRate >= 70 ? '#fbbf24' : '#f87171') : null
  return (
    <div style={_styles.kpi}>
      <div style={_styles.kpiTop}>
        <div style={{..._styles.kpiDot, background: gapColor || dot}} />
        <span style={_styles.kpiLabel}>{label}</span>
      </div>
      <div style={{..._styles.kpiVal, ...(gapColor ? {color: gapColor} : {})}}>{value}</div>
      <div style={_styles.kpiSub}>{sub}</div>
      {sim && (
        <div style={_styles.kpiSim}>
          <span style={_styles.simBadge}>시뮬</span>
          <span style={_styles.simVal}>{sim.value}</span>
        </div>
      )}
    </div>
  )
}

// ── 딜 행 ─────────────────────────────────────────
function DealRow({ deal, orig, isSim, isOpen, mode, fmtK, onToggle }) {
  const st = STATUS_STYLE[deal.status] || STATUS_STYLE.active
  const ct = CATEGORY_STYLE[deal.category] || CATEGORY_STYLE.Pick
  const amtChanged = isSim && deal.book_amount !== orig.book_amount
  const confChanged = isSim && deal.probability !== orig.probability
  const origReflect = Math.round((orig.book_amount * orig.probability) / 100)
  const newReflect = Math.round((deal.book_amount * deal.probability) / 100)
  const reflectChanged = isSim && (amtChanged || confChanged)
  const confPct = deal.probability || 0
  const confColor = confPct >= 100 ? '#4ade80' : confPct >= 60 ? '#60a5fa' : confPct >= 30 ? '#fbbf24' : '#4b5563'
  return (
    <tr style={{..._styles.tr, ...(isSim ? _styles.trSim : {}), ...(isOpen ? _styles.trOpen : {})}}
      onClick={mode==='sim' ? onToggle : undefined}
      onMouseEnter={e => { if(!isOpen) e.currentTarget.style.background = _styles.trHover.background }}
      onMouseLeave={e => { e.currentTarget.style.background = isSim ? _styles.trSim.background : 'transparent' }}>
      {/* Case / 고객사 (2라인) */}
      <td style={_styles.td}>
        <div style={_styles.caseName}>{deal.case_name}</div>
        <div style={_styles.caseSub}>{deal.customer}</div>
      </td>
      {/* 제품 / 국가 (2라인) */}
      <td style={_styles.td}>
        <div style={_styles.caseName}>{deal.product_cat}</div>
        <div style={_styles.caseSub}>{deal.country}</div>
      </td>
      {/* 분기 */}
      <td style={_styles.td}><span style={_styles.quarterChip}>{deal.quarter}</span></td>
      {/* 상태 */}
      <td style={_styles.td}>
        <span style={{..._styles.badge, background:st.bg, color:st.color}}>{st.label}</span>
      </td>
      {/* 확도 */}
      <td style={_styles.td}>
        <div style={_styles.confWrap}>
          <div style={_styles.confBg}><div style={{..._styles.confFill, width:confPct+'%', background:confColor}} /></div>
          <span style={{fontSize:11, color:'#9ca3af'}}>{confPct}%</span>
        </div>
      </td>
      {/* 계약금액 */}
      <td style={{..._styles.td, textAlign:'right'}}>
        {amtChanged ? <>
          <span style={_styles.amtStrike}>{fmtK(orig.book_amount)}</span>
          <span style={_styles.amtNew}>{fmtK(deal.book_amount)}</span>
        </> : <span style={_styles.amtNormal}>{fmtK(deal.book_amount)}</span>}
      </td>
      {/* 반영금액 — 드랍은 '—' */}
      <td style={{..._styles.td, textAlign:'right'}}>
        {deal.status === 'drop' ? (
          <span style={{..._styles.amtNormal, color:'#9ca3af'}}>—</span>
        ) : reflectChanged ? <>
          <span style={_styles.amtStrike}>{fmtK(origReflect)}</span>
          <span style={_styles.amtNew}>{fmtK(newReflect)}</span>
        </> : <span style={_styles.amtNormal}>{fmtK(deal.reflected_amount || newReflect)}</span>}
      </td>
      {/* 착수일 */}
      <td style={_styles.td}><span style={_styles.quarterChip}>{deal.start_month || '—'}</span></td>
      {/* 종료일 */}
      <td style={_styles.td}><span style={_styles.quarterChip}>{deal.end_month || '—'}</span></td>
      {/* 액션 */}
      <td style={_styles.td}>
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          {mode==='sim' && <span style={{..._styles.chevron, transform: isOpen ? 'rotate(180deg)' : 'none'}}>▾</span>}
          {isSim && <span style={_styles.simDot} title="시뮬 변경">●</span>}
        </div>
      </td>
    </tr>
  )
}

// ── 인라인 편집 패널 ──────────────────────────────
function EditPanel({ deal, fmtK, quarters, owners, onApply, onCancel, onAddChild }) {
  const [caseName, setCaseName] = useState(deal.case_name || '')
  const [customer, setCustomer] = useState(deal.customer || '')
  const [category, setCategory] = useState(deal.category || 'Pick')
  const [productCat, setProductCat] = useState(deal.product_cat || '')
  const [country, setCountry] = useState(deal.country || 'KR')
  const [contractMonth, setContractMonth] = useState(deal.contract_month || '')
  const [startMonth, setStartMonth] = useState(deal.start_month || '')
  const [endMonth, setEndMonth] = useState(deal.end_month || '')
  const [comment, setComment] = useState(deal.comment || '')
  const [amt, setAmt] = useState(deal.book_amount || 0)
  const [conf, setConf] = useState(deal.probability || 0)
  const [quarter, setQuarter] = useState(deal.quarter || '')
  const [status, setStatus] = useState(deal.status || 'active')
  const [children, setChildren] = useState([])

  const reflect = Math.round(amt * conf / 100)

  const STATUS_OPTS = [
    ['active','진행중','#60a5fa'],['won','계약','#4ade80'],
    ['drop','드랍','#f87171'],['pending','대기','#fbbf24']
  ]
  const CATEGORY_OPTS = ['Pick','New','Maintain','Drop']

  return (
    <div style={_styles.editPanel}>
      {/* Row 1: Case명 / 고객사 / 구분 / 분기 */}
      <div style={{..._styles.editGrid, gridTemplateColumns:'repeat(4,minmax(0,1fr))', marginBottom:10}}>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>Case명</label>
          <input style={_styles.editInput} value={caseName} onChange={e => setCaseName(e.target.value)} />
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>고객사</label>
          <input style={_styles.editInput} value={customer} onChange={e => setCustomer(e.target.value)} />
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>구분</label>
          <select style={_styles.editSelect} value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORY_OPTS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>분기</label>
          <select style={_styles.editSelect} value={quarter} onChange={e => setQuarter(e.target.value)}>
            {quarters.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
      </div>
      {/* Row 2: 국가 / 제품구분 / 예상계약월 / 확률 */}
      <div style={{..._styles.editGrid, gridTemplateColumns:'repeat(4,minmax(0,1fr))', marginBottom:10}}>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>고객사 국가</label>
          <input style={_styles.editInput} value={country} onChange={e => setCountry(e.target.value)} />
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>제품구분</label>
          <input style={_styles.editInput} value={productCat} onChange={e => setProductCat(e.target.value)} />
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>예상 계약월</label>
          <input style={_styles.editInput} value={contractMonth} onChange={e => setContractMonth(e.target.value)} placeholder="2025-03" />
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>확률 (%)</label>
          <input style={_styles.editInput} type="number" value={conf} min={0} max={100}
            onChange={e => setConf(Number(e.target.value))} />
        </div>
      </div>
      {/* Row 3: 계약금액 / 상태 / 착수월 / 종료월 */}
      <div style={{..._styles.editGrid, gridTemplateColumns:'repeat(4,minmax(0,1fr))', marginBottom:10}}>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>계약금액 (K KRW)</label>
          <input style={_styles.editInput} type="number" value={amt} step={1000}
            onChange={e => setAmt(Number(e.target.value))} />
          <span style={_styles.editHint}>반영: {fmtK(reflect)}</span>
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>상태</label>
          <div style={_styles.statusRow}>
            {STATUS_OPTS.map(([val,label,color]) => (
              <button key={val} style={{..._styles.statusBtn, ...(status===val ? {borderColor:color, color:color, background:color+'18'} : {})}}
                onClick={() => setStatus(val)}>{label}</button>
            ))}
          </div>
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>착수월</label>
          <input style={_styles.editInput} value={startMonth} onChange={e => setStartMonth(e.target.value)} placeholder="2025-03" />
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>종료월</label>
          <input style={_styles.editInput} value={endMonth} onChange={e => setEndMonth(e.target.value)} placeholder="2026-02" />
        </div>
      </div>
      {/* Row 4: 코멘트 */}
      <div style={{ marginBottom:12 }}>
        <label style={_styles.editLabel}>코멘트</label>
        <textarea style={{..._styles.editInput, width:'100%', minHeight:60, resize:'vertical', marginTop:4, boxSizing:'border-box'}}
          value={comment} onChange={e => setComment(e.target.value)} />
      </div>
      {/* 파생 딜 */}
      <button style={_styles.deriveBtn} onClick={() => setChildren(prev => [...prev, {amt:0, conf:40, quarter:quarters[0]||'2025-Q1'}])}>
        + 파생 딜 추가 (child)
      </button>
      {children.map((c, i) => (
        <div key={i} style={_styles.childCard}>
          <div style={_styles.childHeader}>
            <span style={_styles.childBadge}>child {i+1}</span>
            <button style={_styles.btnRm} onClick={() => setChildren(prev => prev.filter((_,j)=>j!==i))}>삭제</button>
          </div>
          <div style={_styles.childGrid}>
            <div style={_styles.editField}>
              <label style={_styles.editLabel}>금액 (K)</label>
              <input style={_styles.editInput} type="number" value={c.amt}
                onChange={e => setChildren(prev => prev.map((x,j) => j===i ? {...x,amt:Number(e.target.value)} : x))} />
            </div>
            <div style={_styles.editField}>
              <label style={_styles.editLabel}>분기</label>
              <select style={_styles.editSelect} value={c.quarter}
                onChange={e => setChildren(prev => prev.map((x,j) => j===i ? {...x,quarter:e.target.value} : x))}>
                {[...quarters,'2026-Q3','2026-Q4','2027-Q1'].map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
            <div style={_styles.editField}>
              <label style={_styles.editLabel}>확도 (%)</label>
              <input style={_styles.editInput} type="number" value={c.conf} min={0} max={100}
                onChange={e => setChildren(prev => prev.map((x,j) => j===i ? {...x,conf:Number(e.target.value)} : x))} />
            </div>
          </div>
        </div>
      ))}
      {children.length > 0 && (() => {
        const childSum = children.reduce((s,c) => s+c.amt, 0)
        const total = amt + childSum
        const orig = deal.book_amount || 0
        const ok = Math.abs(total - orig) < 1
        return (
          <div style={_styles.splitCheck}>
            <span style={{ color:'#9ca3af', fontSize:12 }}>parent {(amt||0).toLocaleString()} + child {childSum.toLocaleString()} = {total.toLocaleString()}</span>
            <span style={{ color: ok ? '#4ade80' : '#f87171', fontWeight:500, fontSize:12 }}>{ok ? '✓ 원본 일치' : `✗ 원본 ${orig.toLocaleString()} 불일치`}</span>
          </div>
        )
      })()}

      <div style={_styles.editFoot}>
        <span style={{ fontSize:11, color:'#6b7280' }}>커밋 전까지 실제 DB 불변</span>
        <div style={{ display:'flex', gap:8 }}>
          <button style={_styles.btnCancel} onClick={onCancel}>취소</button>
          <button style={_styles.btnApply} onClick={() => { children.forEach(c => onAddChild(c)); onApply({case_name:caseName, customer, category, product_cat:productCat, country, contract_month:contractMonth, start_month:startMonth, end_month:endMonth, comment, book_amount:amt, probability:conf, quarter, status}) }}>
            시뮬에 반영
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Child 행 ──────────────────────────────────────
function ChildEditPanel({ child, quarters, fmtK, onApply, onCancel }) {
  const [amt, setAmt] = useState(child.amt || 0)
  const [conf, setConf] = useState(child.conf || 40)
  const [quarter, setQuarter] = useState(child.quarter || '')
  const reflect = Math.round(amt * conf / 100)
  return (
    <div style={{..._styles.editPanel, borderTop:'1px solid #2a1f5c', borderLeft:'4px solid #7c3aed'}}>
      <div style={{ fontSize:11, color:'#a78bfa', marginBottom:10, fontWeight:500 }}>↳ Child 딜 수정</div>
      <div style={_styles.editGrid}>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>금액 (K)</label>
          <input style={_styles.editInput} type="number" value={amt}
            onChange={e => setAmt(Number(e.target.value))} />
          <span style={_styles.editHint}>반영: {fmtK(reflect)}</span>
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>확도 (%)</label>
          <input style={_styles.editInput} type="number" value={conf} min={0} max={100}
            onChange={e => setConf(Number(e.target.value))} />
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>분기</label>
          <select style={_styles.editSelect} value={quarter} onChange={e => setQuarter(e.target.value)}>
            {[...quarters,'2026-Q3','2026-Q4','2027-Q1'].map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
      </div>
      <div style={_styles.editFoot}>
        <span style={{ fontSize:11, color:'#6b7280' }}>Child 딜 수정</span>
        <div style={{ display:'flex', gap:8 }}>
          <button style={_styles.btnCancel} onClick={onCancel}>취소</button>
          <button style={_styles.btnApply} onClick={() => onApply({ amt, conf, quarter })}>반영</button>
        </div>
      </div>
    </div>
  )
}

function ChildRow({ child, deal, fmtK, onEdit, onDelete }) {
  return (
    <tr style={_styles.childRowBg}>
      {/* Case / 고객사 */}
      <td style={_styles.td}>
        <div style={{ paddingLeft:12 }}>
          <span style={{ fontSize:11, color:'#a78bfa', marginRight:4 }}>↳</span>
          <span style={{..._styles.caseName, display:'inline'}}>{deal.case_name}</span>
          <div style={{..._styles.caseSub, color:'#7c6db0'}}>잔여분</div>
        </div>
      </td>
      {/* 제품 / 국가 */}
      <td style={_styles.td} />
      {/* 분기 */}
      <td style={_styles.td}><span style={{..._styles.quarterChip, color:'#a78bfa'}}>{child.quarter}</span></td>
      {/* 상태 */}
      <td style={_styles.td}><span style={{..._styles.badge, background:'#1e1a35', color:'#a78bfa', fontSize:10}}>child</span></td>
      {/* 확도 */}
      <td style={_styles.td}><span style={{ fontSize:11, color:'#9ca3af' }}>{child.conf}%</span></td>
      {/* 계약금액 */}
      <td style={{..._styles.td, textAlign:'right', color:'#a78bfa', fontWeight:500}}>{fmtK(child.amt)}</td>
      {/* 반영금액 */}
      <td style={{..._styles.td, textAlign:'right', color:'#a78bfa'}}>{fmtK(Math.round(child.amt*child.conf/100))}</td>
      {/* 착수일 */}
      <td style={_styles.td} />
      {/* 종료일 */}
      <td style={_styles.td} />
      {/* 액션 */}
      <td style={_styles.td}>
        <div style={{ display:'flex', gap:4 }}>
          {onEdit && <button style={_styles.childEditBtn} onClick={onEdit}>수정</button>}
          {onDelete && <button style={_styles.childDelBtn} onClick={onDelete}>삭제</button>}
        </div>
      </td>
    </tr>
  )
}

// ── 분기 범위 선택기 ──────────────────────────────
function QuarterRangePicker({ quarters, range, onChange }) {
  if (quarters.length === 0) return <span style={{ fontSize:12, color:'#6b7280' }}>분기 데이터 없음</span>
  const pct = i => quarters.length <= 1 ? 0 : (i / (quarters.length - 1)) * 100
  return (
    <div style={_styles.qrWrap}>
      <span style={_styles.qrLabel}>기간</span>
      <div style={_styles.qrTrackWrap}>
        <div style={_styles.qrTrack}>
          <div style={{..._styles.qrFill, left:pct(range.start)+'%', width:(pct(range.end)-pct(range.start))+'%'}} />
          {[range.start, range.end].map((idx, ti) => (
            <input key={ti} type="range" min={0} max={quarters.length-1} value={idx} step={1}
              style={_styles.qrThumb}
              onChange={e => {
                const v = Number(e.target.value)
                if (ti===0) onChange({ start: Math.min(v, range.end), end: range.end })
                else onChange({ start: range.start, end: Math.max(v, range.start) })
              }} />
          ))}
        </div>
        <div style={_styles.qrLabels}>
          {quarters.map((q, i) => (
            <span key={q} style={{..._styles.qrQLbl, ...(i>=range.start&&i<=range.end ? _styles.qrQLblOn : {})}}>
              {q.replace('20','')}
            </span>
          ))}
        </div>
      </div>
      <span style={_styles.qrResult}>{quarters[range.start]} – {quarters[range.end]}</span>
    </div>
  )
}

// ── Diff 유틸 ─────────────────────────────────────
function DiffRow({ field, before, after }) {
  return (
    <div style={_styles.diffRow}>
      <span style={_styles.diffField}>{field}</span>
      <span style={_styles.diffBefore}>{before}</span>
      <span style={{ color:'#4b5563', fontSize:11 }}>→</span>
      <span style={_styles.diffAfter}>{after}</span>
    </div>
  )
}

// ── 스타일 ────────────────────────────────────────
function getStyles(dark) {
  const bg0  = dark ? '#0a0a0a' : '#f5f5f7'
  const bg1  = dark ? '#111111' : '#ffffff'
  const bg2  = dark ? '#1a1a1a' : '#f0f0f0'
  const bg3  = dark ? '#0d0d0d' : '#e8e8e8'
  const br   = dark ? '#1f1f1f' : '#e2e2e2'
  const br2  = dark ? '#2a2a2a' : '#d1d5db'
  const tx0  = dark ? '#f0f0f0' : '#111111'
  const tx1  = dark ? '#6b7280' : '#6b7280'
  const tx2  = dark ? '#d1d5db' : '#374151'
  const tx3  = dark ? '#4b5563' : '#9ca3af'
  const tx4  = dark ? '#9ca3af' : '#6b7280'

  return {
    root: { minHeight:'100vh', background:bg0, color:tx0, fontFamily:"'Geist', sans-serif" },
    loadWrap: { minHeight:'100vh', background:bg0, display:'flex', alignItems:'center', justifyContent:'center', gap:12, flexDirection:'column' },
    loadDot: { width:8, height:8, borderRadius:'50%', background:'#7c3aed', animation:'pulse 1s infinite' },
    loadTxt: { fontSize:14, color:tx1 },

    // nav
    nav: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', height:52, background:bg1, borderBottom:'1px solid '+br },
    navLeft: { display:'flex', alignItems:'center', gap:20 },
    logo: { fontSize:15, fontWeight:600, color:tx0, letterSpacing:'-0.02em' },
    logoAccent: { color:'#7c3aed' },
    modeTabs: { display:'flex', background:bg2, borderRadius:8, padding:3, gap:2 },
    modeTab: { fontSize:12, padding:'4px 14px', borderRadius:6, border:'none', background:'transparent', color:tx1, cursor:'pointer', fontFamily:"'Geist', sans-serif", transition:'all .15s' },
    modeTabActive: { background: dark ? '#222' : '#ffffff', color:tx0, fontWeight:500 },
    modeTabSimActive: { background:'#1e1635', color:'#a78bfa', fontWeight:500 },
    navRight: { display:'flex', alignItems:'center', gap:10 },

    // ccy
    ccyWrap: { display:'flex', alignItems:'center', gap:6, background:bg2, border:'1px solid '+br2, borderRadius:8, padding:'4px 10px' },
    ccyLabel: { fontSize:11, color:tx1 },
    ccySel: { fontSize:12, fontWeight:500, color:tx0, border:'none', background:'transparent', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
    rateDot: { width:6, height:6, borderRadius:'50%' },
    rateLabel: { fontSize:10, color:tx1 },
    avatar: { width:28, height:28, borderRadius:'50%', background:'#1e1635', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:500, color:'#a78bfa' },
    userName: { fontSize:12, color:tx1 },

    // sim banner
    simBanner: { background:'#1c1400', borderBottom:'1px solid #3d2e00', padding:'9px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 },
    simBannerLeft: { display:'flex', alignItems:'center', gap:10 },
    simPulse: { width:7, height:7, borderRadius:'50%', background:'#fbbf24' },
    simBannerTitle: { fontSize:12, fontWeight:500, color:'#fcd34d' },
    simBannerSub: { fontSize:11, color:'#92740a' },
    chgPill: { fontSize:11, background:'#3d2e00', color:'#fbbf24', padding:'2px 8px', borderRadius:20, fontWeight:500 },
    btnDiscard: { fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #3d2e00', background:'transparent', color:'#92740a', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
    btnDiff: { fontSize:11, padding:'4px 12px', borderRadius:6, border:'none', background:'#7c3aed', color:'#f0f0f0', cursor:'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" },

    // toolbar
    toolbar: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 24px', background: dark ? '#0f0f0f' : '#fafafa', borderBottom:'1px solid '+br, gap:12, flexWrap:'wrap' },
    toolbarLeft: { display:'flex', alignItems:'center', gap:10 },
    ownerSel: { fontSize:12, padding:'5px 10px', borderRadius:6, border:'1px solid '+br2, background:bg2, color:tx0, fontFamily:"'Geist', sans-serif" },
    searchInput: { fontSize:12, padding:'5px 10px', borderRadius:6, border:'1px solid '+br2, background:bg2, color:tx0, fontFamily:"'Geist', sans-serif", outline:'none', width:160, '::placeholder': { color:tx3 } },
    btnAddProject: { fontSize:12, padding:'5px 14px', borderRadius:6, border:'none', background:'#7c3aed', color:'#f0f0f0', cursor:'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif", whiteSpace:'nowrap' },
    modeLabel: { fontSize:11, color:tx1 },

    // body
    body: { padding:'16px 24px', display:'flex', flexDirection:'column', gap:12 },

    // kpi
    kpiRow: { display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:10 },
    kpi: { background:bg1, border:'1px solid '+br, borderRadius:10, padding:'14px 16px' },
    kpiTop: { display:'flex', alignItems:'center', gap:6, marginBottom:5 },
    kpiDot: { width:6, height:6, borderRadius:'50%' },
    kpiLabel: { fontSize:11, color:tx1 },
    kpiVal: { fontSize:22, fontWeight:500, lineHeight:1.2, color:tx0 },
    kpiSub: { fontSize:11, color:tx3, marginTop:3 },
    kpiSim: { display:'flex', alignItems:'center', gap:6, marginTop:6, paddingTop:6, borderTop:'1px dashed '+br2 },
    simBadge: { fontSize:10, background:'#2e1a1a', color:'#f87171', padding:'1px 5px', borderRadius:3, fontWeight:500 },
    simVal: { fontSize:13, fontWeight:500, color:'#f87171' },

    // table
    tblCard: { background:bg1, border:'1px solid '+br, borderRadius:10, overflow:'hidden' },
    tblTop: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 16px', borderBottom:'1px solid '+br },
    tblTitle: { fontSize:13, fontWeight:500, color:tx0 },
    simHint: { fontSize:11, color:'#fbbf24', display:'flex', alignItems:'center', gap:4 },
    tbl: { width:'100%', borderCollapse:'collapse', tableLayout:'fixed' },
    th: { fontSize:11, fontWeight:500, color:tx3, padding:'7px 14px', borderBottom:'1px solid '+br, background:bg3, textAlign:'left', whiteSpace:'nowrap' },
    td: { fontSize:12, color:tx2, padding:'10px 14px', borderBottom:'1px solid '+(dark ? '#161616' : '#f0f0f0'), verticalAlign:'middle' },
    tr: { transition:'background .1s', cursor:'default' },
    trHover: { background: dark ? '#1a1a1a' : '#f0f0f0' },
    simDot: { fontSize:8, color:'#fbbf24' },
    trSim: { background: dark ? '#161820' : '#f0f4ff' },
    trOpen: { background: dark ? '#161820' : '#f0f4ff' },
    badge: { display:'inline-block', fontSize:11, padding:'2px 7px', borderRadius:4, fontWeight:500 },
    caseName: { fontSize:12, fontWeight:500, color: dark ? '#e5e7eb' : '#111827', marginBottom:2 },
    caseSub: { fontSize:11, color:tx1 },
    tagSmall: { fontSize:10, padding:'1px 6px', borderRadius:3, background:bg2, color:tx4, border:'1px solid '+br2 },
    amtNormal: { fontSize:12, color:tx2 },
    amtStrike: { fontSize:10, textDecoration:'line-through', color:tx3, display:'block', textAlign:'right' },
    amtNew: { fontSize:12, fontWeight:500, color:'#4ade80', display:'block', textAlign:'right' },
    confWrap: { display:'flex', alignItems:'center', gap:6 },
    confBg: { width:44, height:3, background:br2, borderRadius:2, overflow:'hidden' },
    confFill: { height:'100%', borderRadius:2, transition:'width .3s' },
    ownerChip: { fontSize:11, padding:'2px 7px', borderRadius:4, background:bg2, color:tx4 },
    quarterChip: { fontSize:11, color:tx1 },
    chevron: { fontSize:12, color:tx3, transition:'transform .2s', display:'inline-block' },
    simTag: { fontSize:9, background:'#3d2e00', color:'#fbbf24', padding:'1px 4px', borderRadius:3, marginLeft:4 },

    // edit panel
    editPanel: { background: dark ? '#0d0d12' : '#f8f7ff', borderTop:'1px solid #2a1f5c', padding:'16px 20px' },
    editGrid: { display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:12, marginBottom:12 },
    editField: { display:'flex', flexDirection:'column', gap:4 },
    editLabel: { fontSize:11, color:tx1 },
    editInput: { fontSize:12, padding:'7px 9px', borderRadius:6, border:'1px solid '+br2, background:bg1, color:tx0, fontFamily:"'Geist', sans-serif", outline:'none' },
    editSelect: { fontSize:12, padding:'7px 9px', borderRadius:6, border:'1px solid '+br2, background:bg1, color:tx0, fontFamily:"'Geist', sans-serif" },
    editHint: { fontSize:11, color:tx1 },
    statusRow: { display:'flex', gap:5, flexWrap:'wrap' },
    statusBtn: { fontSize:11, padding:'3px 9px', borderRadius:5, border:'1px solid '+br2, background:'transparent', color:tx1, cursor:'pointer', fontFamily:"'Geist', sans-serif", transition:'all .1s' },
    deriveBtn: { fontSize:11, padding:'5px 12px', borderRadius:6, border:'1px dashed #2a1f5c', background:'transparent', color:'#7c3aed', cursor:'pointer', fontFamily:"'Geist', sans-serif", marginBottom:10 },
    childRowBg: { background: dark ? '#111318' : '#f5f3ff' },
    childEditBtn: { fontSize:10, padding:'2px 7px', borderRadius:4, border:'1px solid #7c3aed', background:'transparent', color:'#7c3aed', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
    childDelBtn: { fontSize:10, padding:'2px 7px', borderRadius:4, border:'1px solid #f87171', background:'transparent', color:'#f87171', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
    childCard: { background: dark ? '#0a0a14' : '#f0eeff', border:'1px solid #2a1f5c', borderRadius:7, padding:'10px 12px', marginBottom:8 },
    childHeader: { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 },
    childBadge: { fontSize:10, padding:'1px 6px', borderRadius:4, background:'#1e1635', color:'#a78bfa', fontWeight:500 },
    childGrid: { display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:8 },
    btnRm: { fontSize:10, padding:'2px 7px', borderRadius:4, border:'1px solid '+br2, background:'transparent', color:tx1, cursor:'pointer', fontFamily:"'Geist', sans-serif" },
    splitCheck: { display:'flex', alignItems:'center', justifyContent:'space-between', background:bg1, border:'1px solid '+br, borderRadius:6, padding:'7px 12px', marginBottom:10, fontSize:12 },
    editFoot: { display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:12 },
    btnCancel: { fontSize:12, padding:'5px 14px', borderRadius:6, border:'1px solid '+br2, background:'transparent', color:tx1, cursor:'pointer', fontFamily:"'Geist', sans-serif" },
    btnApply: { fontSize:12, padding:'5px 16px', borderRadius:6, border:'none', background:'#7c3aed', color:'#f0f0f0', cursor:'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" },

    // quarter picker
    qrWrap: { display:'flex', alignItems:'center', gap:10, background:bg2, border:'1px solid '+br2, borderRadius:8, padding:'6px 12px' },
    qrLabel: { fontSize:11, color:tx1, whiteSpace:'nowrap' },
    qrTrackWrap: { display:'flex', flexDirection:'column', gap:4, minWidth:180 },
    qrTrack: { position:'relative', height:4, background:br2, borderRadius:2 },
    qrFill: { position:'absolute', height:'100%', background:'#7c3aed', borderRadius:2, top:0, pointerEvents:'none' },
    qrThumb: { position:'absolute', width:'100%', height:'100%', top:0, left:0, opacity:0, cursor:'pointer', margin:0 },
    qrLabels: { display:'flex', justifyContent:'space-between' },
    qrQLbl: { fontSize:9, color:tx3 },
    qrQLblOn: { color:'#a78bfa', fontWeight:500 },
    qrResult: { fontSize:12, fontWeight:500, color:tx2, whiteSpace:'nowrap' },

    // diff modal
    overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 },
    diffModal: { background:bg1, border:'1px solid #2a1f5c', borderRadius:12, width:'100%', maxWidth:540, overflow:'hidden' },
    diffHeader: { background:'#1e1635', padding:'13px 18px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #2a1f5c' },
    diffTitle: { fontSize:13, fontWeight:500, color:'#c4b5fd' },
    diffClose: { fontSize:20, color:'#7c3aed', cursor:'pointer', background:'none', border:'none', lineHeight:1, fontFamily:"'Geist', sans-serif" },
    diffItem: { padding:'13px 18px', borderBottom:'1px solid '+br, display:'flex', gap:10, alignItems:'flex-start' },
    diffChk: { width:16, height:16, borderRadius:4, border:'1px solid '+br2, background:bg1, flexShrink:0, marginTop:1, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:10, color:tx0 },
    diffChkOn: { background:'#7c3aed', borderColor:'#7c3aed' },
    diffName: { fontSize:12, fontWeight:500, color: dark ? '#e5e7eb' : '#111827', marginBottom:5 },
    diffCo: { fontSize:11, background:bg2, color:tx1, padding:'1px 6px', borderRadius:3, marginLeft:5 },
    diffRows: { display:'flex', flexDirection:'column', gap:3 },
    diffRow: { display:'flex', alignItems:'center', gap:6, fontSize:11 },
    diffField: { color:tx1, width:44, flexShrink:0 },
    diffBefore: { color:'#f87171', textDecoration:'line-through' },
    diffAfter: { color:'#4ade80', fontWeight:500 },
    diffFoot: { padding:'12px 18px', background:bg3, display:'flex', gap:8, alignItems:'center' },
    commitInp: { flex:1, fontSize:12, padding:'7px 10px', borderRadius:6, border:'1px solid '+br2, background:bg1, color:tx0, fontFamily:"'Geist', sans-serif" },
    btnCommit: { fontSize:12, padding:'7px 16px', borderRadius:6, border:'none', background:'#7c3aed', color:'#f0f0f0', cursor:'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif", whiteSpace:'nowrap' },
  }
}

// ── 로그인 화면 ───────────────────────────────────
function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleLogin = async () => {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
    // 성공 시 onAuthStateChange가 session 감지 → App이 자동으로 메인 화면 렌더
  }

  return (
    <div style={{
      minHeight:'100vh', background:'#0a0a0a',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:"'Geist', sans-serif"
    }}>
      <div style={{
        background:'#111', border:'1px solid #1f1f1f', borderRadius:12,
        padding:'36px 32px', width:340, display:'flex', flexDirection:'column', gap:16
      }}>
        {/* 로고 */}
        <div style={{ fontSize:18, fontWeight:600, color:'#f0f0f0', marginBottom:4 }}>
          BD <span style={{ color:'#7c3aed' }}>Pipeline</span>
        </div>
        <div style={{ fontSize:12, color:'#6b7280', marginBottom:8 }}>로그인하여 계속하세요</div>

        {/* 이메일 */}
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <label style={{ fontSize:11, color:'#6b7280' }}>이메일</label>
          <input
            type="email" value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="name@company.com"
            style={{
              fontSize:13, padding:'9px 11px', borderRadius:7,
              border:'1px solid #2a2a2a', background:'#1a1a1a',
              color:'#f0f0f0', outline:'none'
            }}
          />
        </div>

        {/* 비밀번호 */}
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <label style={{ fontSize:11, color:'#6b7280' }}>비밀번호</label>
          <input
            type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="••••••••"
            style={{
              fontSize:13, padding:'9px 11px', borderRadius:7,
              border:'1px solid #2a2a2a', background:'#1a1a1a',
              color:'#f0f0f0', outline:'none'
            }}
          />
        </div>

        {/* 에러 */}
        {error && <div style={{ fontSize:12, color:'#f87171' }}>{error}</div>}

        {/* 로그인 버튼 */}
        <button
          onClick={handleLogin} disabled={loading}
          style={{
            fontSize:13, padding:'10px', borderRadius:7, border:'none',
            background: loading ? '#4c1d95' : '#7c3aed',
            color:'#f0f0f0', cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight:500, marginTop:4
          }}
        >
          {loading ? '로그인 중...' : '로그인'}
        </button>
      </div>
    </div>
  )
}
