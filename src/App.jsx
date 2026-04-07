import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
  const [addProjectOpen, setAddProjectOpen] = useState(false)
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
    //if (mode === 'personal' && d.created_by !== 'Jake') return false
    if (mode === 'personal' && d.created_by !== session?.user?.email?.split('@')[0]) return false
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
      const { data, error } = await supabase.from('projects').update({
        case_name:      change.case_name,
        customer:       change.customer,
        category:       change.category,
        product_cat:    change.product_cat,
        country:        change.country,
        contract_month: change.contract_month,
        start_month:    change.start_month,
        end_month:      change.end_month,
        comment:        change.comment,
        book_amount:    change.book_amount,
        probability:    change.probability,
        quarter:        change.quarter,
        status:         change.status,
        created_by:     change.created_by,
        updated_at:     new Date().toISOString(),
      }).eq('id', id)
      if (error) console.error('커밋 에러:', error) 
        
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
  if (session === null) return <LoginScreen darkMode={darkMode} setDarkMode={setDarkMode} />

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
        {/* 좌: 로고만 */}
        
        <div style={styles.logo}>
          <div style={{
            width:22, height:22, borderRadius:6,
            background:'linear-gradient(135deg,#175BFF,#8A2BFF)',
            display:'flex', alignItems:'center', justifyContent:'center',
            flexShrink:0,
          }}>
            <span style={{ fontSize:10, fontWeight:700, color:'white', letterSpacing:'-0.5px' }}>BD</span>
          </div>
          <span>Sales<span style={styles.logoAccent}>Gear</span></span>
        </div>
        {/* 우: 모드탭 + 다크 + 로그아웃 + 유저 */}
        <div style={styles.navRight}>
          {/* 모드 탭 */}
          <div style={styles.modeTabs}>
            {[['personal','개인 뷰'],['admin','전체 뷰'],['sim','시뮬레이션']].map(([m, label]) => (
              <button key={m}
                style={{...styles.modeTab, ...(mode===m ? (m==='sim' ? styles.modeTabSimActive : styles.modeTabActive) : {})}}
                onClick={() => setMode(m)}>{label}</button>
            ))}
          </div>

          {/* 다크 토글 */}
          <button onClick={() => setDarkMode(d => !d)} style={{
            fontSize:12, padding:'0 10px', height:30, borderRadius:6,
            border:'1px solid ' + (darkMode ? '#2a2a2a' : '#d1d5db'),
            background:'transparent',
            color: darkMode ? '#fbbf24' : '#6b7280',
            cursor:'pointer', fontFamily:"'Geist', sans-serif",
            whiteSpace:'nowrap', boxSizing:'border-box'
          }}>{darkMode ? '☀️ 라이트' : '🌙 다크'}</button>

          {/* 로그아웃 */}
          <button onClick={() => supabase.auth.signOut()} style={{
            fontSize:12, padding:'0 10px', height:30, borderRadius:6,
            border:'1px solid ' + (darkMode ? '#2a2a2a' : '#d1d5db'),
            background:'transparent',
            color: darkMode ? '#9ca3af' : '#6b7280',
            cursor:'pointer', fontFamily:"'Geist', sans-serif",
            whiteSpace:'nowrap', boxSizing:'border-box'
          }}>로그아웃</button>

          {/* 유저 */}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={styles.avatar}>J</div>
            <span style={styles.userName}>{session?.user?.email?.split('@')[0] || 'Jake'}</span>
          </div>
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
            <button style={{...styles.btnDiff, background:'#fbbf24', border:'1px solid #fbbf24', color:'#000000'}} onClick={() => setDiffOpen(true)}>확정 리뷰 →</button>
          </div>
        </div>
      )}  

      {/* TOOLBAR: 분기 + 환율 + 검색 + 담당자 + 구분 + 상태 + 추가 */}
      <div style={styles.toolbar}>
        {/* 분기 범위 */}
        <QuarterRangePicker quarters={quarters} range={quarterRange} onChange={setQuarterRange} />

        {/* 환율 */}
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

        {/* 검색 */}
        <input style={styles.searchInput} placeholder="Case / 고객사 검색"
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />

        {/* 담당자 */}
        <select style={styles.ownerSel} value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
          <option value="all">전체 담당자</option>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        {/* 구분 */}
        <select style={styles.ownerSel} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="all">전체 구분</option>
          {productCats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* 상태 */}
        <select style={styles.ownerSel} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">전체 상태</option>
          <option value="won">계약</option>
          <option value="active">진행중</option>
          <option value="pending">대기</option>
          <option value="drop">드랍</option>
        </select>

        {/* 추가 버튼 */}
        <button style={styles.btnAddProject} onClick={() => setAddProjectOpen(true)}>
          + 프로젝트 추가
        </button>
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
            <span style={styles.tblTitle}>Gear 목록</span>
            {mode==='sim' && <span style={styles.simHint}>● 시뮬레이션 변경 사항</span>}
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={styles.tbl}>
              <colgroup>
                <col style={{ width:'20%' }} /> {/* Case/고객사 */}
                <col style={{ width:'11%' }} /> {/* 제품/국가 */}
                <col style={{ width:'7%'  }} /> {/* 분기 */}
                <col style={{ width:'7%'  }} /> {/* 상태 */}
                <col style={{ width:'8%'  }} /> {/* 담당자 */}
                <col style={{ width:'9%'  }} /> {/* 확도 */}
                <col style={{ width:'10%' }} /> {/* 계약금액 */}
                <col style={{ width:'10%' }} /> {/* 반영금액 */}
                <col style={{ width:'8%'  }} /> {/* 착수일 */}
                <col style={{ width:'8%'  }} /> {/* 종료일 */}
                <col style={{ width:'2%'  }} /> {/* 액션 */}
              </colgroup>
              <thead>
                <tr>
                  {[
                    ['Case / 고객사', 'left'],
                    ['제품 / 국가',   'left'],
                    ['분기',          'center'],
                    ['상태',          'center'],
                    ['담당자',        'center'],
                    ['확도',          'center'],
                    ['계약금액',      'right'],
                    ['반영금액',      'right'],
                    ['착수일',        'center'],
                    ['종료일',        'center'],
                    ['',              'center'],
                  ].map(([h, align], i) => (
                    <th key={i} style={{...styles.th, textAlign: align}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDeals.length === 0 ? (
                  <tr><td colSpan={11} style={{ padding:'32px', textAlign:'center', color:'#6b7280', fontSize:13 }}>데이터가 없습니다</td></tr>
                ) : filteredDeals.map(deal => {
                  const d = simChanges[deal.id] || deal
                  const isSim = !!simChanges[deal.id]
                  const isOpen = editingId === deal.id
                  return [
                    <DealRow key={deal.id} deal={d} orig={deal} isSim={isSim} isOpen={isOpen} mode={mode}
                      fmtK={fmtK} onToggle={() => setEditingId(isOpen ? null : deal.id)} />,
                    isOpen && mode==='sim' && (
                      <tr key={deal.id+'-edit'}>
                        <td colSpan={11} style={{ padding:0 }}>
                          <EditPanel deal={d} fmtK={fmtK} quarters={quarters} owners={owners} productCats={productCats}
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
                          <td colSpan={11} style={{ padding:0 }}>
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
              <span style={styles.diffTitle}>확정 리뷰 — 커밋할 변경 선택</span>
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
                      {changed.case_name !== orig.case_name && <DiffRow field="Case명" before={orig.case_name} after={changed.case_name} />}
                      {changed.customer !== orig.customer && <DiffRow field="고객사" before={orig.customer} after={changed.customer} />}
                      {changed.category !== orig.category && <DiffRow field="구분" before={orig.category} after={changed.category} />}
                      {changed.product_cat !== orig.product_cat && <DiffRow field="제품구분" before={orig.product_cat} after={changed.product_cat} />}
                      {changed.country !== orig.country && <DiffRow field="국가" before={orig.country} after={changed.country} />}
                      {changed.contract_month !== orig.contract_month && <DiffRow field="예상계약월" before={orig.contract_month} after={changed.contract_month} />}
                      {changed.start_month !== orig.start_month && <DiffRow field="착수월" before={orig.start_month} after={changed.start_month} />}
                      {changed.end_month !== orig.end_month && <DiffRow field="종료월" before={orig.end_month} after={changed.end_month} />}
                      {changed.comment !== orig.comment && <DiffRow field="코멘트" before={orig.comment} after={changed.comment} />}
                      {changed.book_amount !== orig.book_amount && <DiffRow field="금액" before={fmtK(orig.book_amount)} after={fmtK(changed.book_amount)} />}
                      {changed.probability !== orig.probability && <DiffRow field="확도" before={orig.probability+'%'} after={changed.probability+'%'} />}
                      {changed.quarter !== orig.quarter && <DiffRow field="분기" before={orig.quarter} after={changed.quarter} />}
                      {changed.status !== orig.status && <DiffRow field="상태" before={orig.status} after={changed.status} />}
                      {changed.created_by !== orig.created_by && <DiffRow field="담당자" before={orig.created_by} after={changed.created_by} />}
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

      {/* ADD PROJECT MODAL */}
      {addProjectOpen && (
        <AddProjectModal
          quarters={quarters}
          owners={owners}
          productCats={productCats}
          session={session}
          darkMode={darkMode}
          onClose={() => setAddProjectOpen(false)}
          onSaved={() => { setAddProjectOpen(false); loadDeals() }}
        />
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
      <td style={{..._styles.td, textAlign:'center'}}><span style={_styles.quarterChip}>{deal.quarter}</span></td>
      {/* 상태 */}
      <td style={{..._styles.td, textAlign:'center'}}>
        <span style={{..._styles.badge, background:st.bg, color:st.color}}>{st.label}</span>
      </td>
      {/* 담당자 */}
      <td style={{..._styles.td, textAlign:'center'}}>
        <span style={_styles.ownerChip}>{deal.created_by || '—'}</span>
      </td>
      {/* 확도 */}
      <td style={{..._styles.td, textAlign:'center'}}>
        <div style={{..._styles.confWrap, justifyContent:'center'}}>
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
      <td style={{..._styles.td, textAlign:'center'}}><span style={_styles.quarterChip}>{deal.start_month || '—'}</span></td>
      {/* 종료일 */}
      <td style={{..._styles.td, textAlign:'center'}}><span style={_styles.quarterChip}>{deal.end_month || '—'}</span></td>
      {/* 액션 */}
      <td style={{..._styles.td, textAlign:'center'}}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
          {mode==='sim' && <span style={{..._styles.chevron, transform: isOpen ? 'rotate(180deg)' : 'none'}}>▾</span>}
          {isSim && <span style={_styles.simDot} title="시뮬 변경">●</span>}
        </div>
      </td>
    </tr>
  )
}

// ── 인라인 편집 패널 ──────────────────────────────
function EditPanel({ deal, fmtK, quarters, owners, productCats, onApply, onCancel, onAddChild }) {
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
  const [createdBy, setCreatedBy] = useState(deal.created_by || '')
  const [children, setChildren] = useState([])

  const reflect = Math.round(amt * conf / 100)

  const STATUS_OPTS = [
    ['active','진행중','#60a5fa'],['won','계약','#4ade80'],
    ['drop','드랍','#f87171'],['pending','대기','#fbbf24']
  ]
  const CATEGORY_OPTS = ['Pick','New','Maintain','Drop']

  return (
    <div style={_styles.editPanel}>
      {/* Row 1: Case명 / 고객사 / 제품구분 / 국가 */}
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
          <label style={_styles.editLabel}>고객사 국가</label>
          <input style={_styles.editInput} value={country} onChange={e => setCountry(e.target.value)} />
        </div>        
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>제품구분</label>
          <select style={_styles.editSelect} value={productCat} onChange={e => setProductCat(e.target.value)}>
            {productCats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      {/* Row 2: 분기 / 예상계약월 / 확률 / 계약금액*/}
      <div style={{..._styles.editGrid, gridTemplateColumns:'repeat(4,minmax(0,1fr))', marginBottom:10}}>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>분기</label>
          <select style={_styles.editSelect} value={quarter} onChange={e => setQuarter(e.target.value)}>
            {quarters.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>예상 계약월</label>
          <input style={_styles.editInput} value={contractMonth} onChange={e => setContractMonth(e.target.value)} type="month" />
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>확률 (%)</label>
          <input style={_styles.editInput} type="number" value={conf} min={0} max={100}
            onChange={e => setConf(Number(e.target.value))} />
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>계약금액 (K KRW)</label>
          <input style={_styles.editInput} type="number" value={amt} step={1000}
            onChange={e => setAmt(Number(e.target.value))} />
          <span style={_styles.editHint}>반영: {fmtK(reflect)}</span>
        </div>
      </div>
      {/* Row 3: 착수월 / 종료월 / 담당자 / 상태 */}
      <div style={{..._styles.editGrid, gridTemplateColumns:'1fr 1fr 1fr 2fr', marginBottom:10}}>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>착수월</label>
          <input style={_styles.editInput} value={startMonth} onChange={e => setStartMonth(e.target.value)} type="month" />
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>종료월</label>
          <input style={_styles.editInput} value={endMonth} onChange={e => setEndMonth(e.target.value)} type="month" />
        </div>
        <div style={_styles.editField}>
          <label style={_styles.editLabel}>담당자</label>
          <select style={_styles.editSelect} value={createdBy} onChange={e => setCreatedBy(e.target.value)}>
            {owners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
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
          <button style={_styles.btnApply} onClick={() => { children.forEach(c => onAddChild(c)); onApply({case_name:caseName, customer, category, product_cat:productCat, country, contract_month:contractMonth, start_month:startMonth, end_month:endMonth, comment, book_amount:amt, probability:conf, quarter, status, created_by:createdBy}) }}>
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
      <td style={{..._styles.td, textAlign:'center'}}><span style={{..._styles.quarterChip, color:'#a78bfa'}}>{child.quarter}</span></td>
      {/* 상태 */}
      <td style={{..._styles.td, textAlign:'center'}}><span style={{..._styles.badge, background:'#1e1a35', color:'#a78bfa', fontSize:10}}>child</span></td>
      {/* 확도 */}
      <td style={{..._styles.td, textAlign:'center'}}><span style={{ fontSize:11, color:'#9ca3af' }}>{child.conf}%</span></td>
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
  const trackRef = useRef(null)
  const dragging = useRef(null) // 'start' | 'end' | null

  if (quarters.length === 0) return <span style={{ fontSize:12, color:'#6b7280' }}>분기 데이터 없음</span>

  const pct = i => quarters.length <= 1 ? 0 : (i / (quarters.length - 1)) * 100

  // 마우스/터치 위치 → 인덱스 변환
  const posToIdx = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(ratio * (quarters.length - 1))
  }

  const onMouseDown = (handle) => (e) => {
    e.preventDefault()
    dragging.current = handle
    const move = (ev) => {
      const x = ev.touches ? ev.touches[0].clientX : ev.clientX
      const idx = posToIdx(x)
      if (dragging.current === 'start') onChange({ start: Math.min(idx, range.end), end: range.end })
      else onChange({ start: range.start, end: Math.max(idx, range.start) })
    }
    const up = () => {
      dragging.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('touchmove', move)
    window.addEventListener('touchend', up)
  }

  // 분기 레이블: y25 q3 형태로 분리
  const fmtTop = (q) => {
  if (!q) return ''
  const [yr] = q.split('-')
  return yr.replace('20', 'y')
}
  const fmtBot = (q) => q.split('-')[1]?.toLowerCase() // "q3"

  // 연도가 바뀌는 지점 계산 (핸들 위 연도 표시용)
  const yearOf = (q) => q?.split('-')[0] || ''

  const dark = _styles === null ? true : undefined // fallback

  return (
    <div style={_styles.qrWrap}>
      <span style={_styles.qrLabel}>기간</span>
      <div style={{ display:'flex', flexDirection:'column', gap:0, minWidth:220 }}>

        {/* 핸들 위 연도 레이블 */}
        <div style={{ position:'relative', height:16 }}>
          {['start','end'].map(h => {
            const idx = h === 'start' ? range.start : range.end
            const q = quarters[idx]
            const left = pct(idx)
            return (
              <span key={h} style={{
                position:'absolute', fontSize:9, color:'#a78bfa', fontWeight:500,
                transform:'translateX(-50%)', left: left+'%',
                whiteSpace:'nowrap', pointerEvents:'none'
              }}>{fmtTop(q)}</span>
            )
          })}
        </div>

        {/* 트랙 */}
        <div ref={trackRef} style={{ position:'relative', height:4, background:_styles.qrTrack.background, borderRadius:2, margin:'2px 0', cursor:'pointer' }}
          onClick={e => {
            // 트랙 클릭 시 가까운 핸들로 이동
            const idx = posToIdx(e.clientX)
            const dStart = Math.abs(idx - range.start)
            const dEnd = Math.abs(idx - range.end)
            if (dStart <= dEnd) onChange({ start: Math.min(idx, range.end), end: range.end })
            else onChange({ start: range.start, end: Math.max(idx, range.start) })
          }}>
          {/* fill */}
          <div style={{
            position:'absolute', top:0, height:'100%',
            left: pct(range.start)+'%',
            width: (pct(range.end) - pct(range.start))+'%',
            background:'#7c3aed', borderRadius:2, pointerEvents:'none'
          }} />
          {/* start 핸들 */}
          <div onMouseDown={onMouseDown('start')} onTouchStart={onMouseDown('start')} style={{
            position:'absolute', top:'50%', left: pct(range.start)+'%',
            transform:'translate(-50%,-50%)',
            width:12, height:12, borderRadius:'50%',
            background:'#ffffff', border:'2px solid #7c3aed',
            cursor:'grab', zIndex:2, boxShadow:'0 1px 4px rgba(0,0,0,0.3)'
          }} />
          {/* end 핸들 */}
          <div onMouseDown={onMouseDown('end')} onTouchStart={onMouseDown('end')} style={{
            position:'absolute', top:'50%', left: pct(range.end)+'%',
            transform:'translate(-50%,-50%)',
            width:12, height:12, borderRadius:'50%',
            background:'#ffffff', border:'2px solid #7c3aed',
            cursor:'grab', zIndex:2, boxShadow:'0 1px 4px rgba(0,0,0,0.3)'
          }} />
        </div>

        {/* 분기 레이블 (아래) */}
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:3 }}>
          {quarters.map((q, i) => (
            <span key={q} style={{
              fontSize:9, fontWeight: i>=range.start&&i<=range.end ? 500 : 400,
              color: i>=range.start&&i<=range.end ? '#a78bfa' : _styles.qrQLbl.color,
              minWidth:0, textAlign:'center'
            }}>{fmtBot(q)}</span>
          ))}
        </div>
      </div>
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
    //logo: { fontSize:15, fontWeight:600, color:tx0, letterSpacing:'-0.02em' },
    logo: { fontSize:15, fontWeight:600, color:tx0, letterSpacing:'-0.02em', display:'flex', alignItems:'center', gap:8 },
    logoAccent: { color:'#7c3aed' },
    modeTabs: { display:'flex', alignItems:'center', background:bg2, borderRadius:8, padding:'2px 3px', gap:2, height:30, boxSizing:'border-box' },
    modeTab: { fontSize:12, padding:'0 14px', height:'100%', borderRadius:6, border:'none', background:'transparent', color:tx1, cursor:'pointer', fontFamily:"'Geist', sans-serif", transition:'all .15s' },
    modeTabActive: { background: dark ? '#222' : '#ffffff', color:tx0, fontWeight:500 },
    modeTabSimActive: { background: dark ? '#1e1635' : '#ede9fe', color: dark ? '#a78bfa' : '#5b21b6', fontWeight:500 },
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
    simBannerSub: { fontSize:11, color:'#fcd34d' },
    chgPill: { fontSize:11, background:'#3d2e00', color:'#fcd34d', padding:'2px 8px', borderRadius:20, fontWeight:500 },
    btnDiscard: { fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #fcd34d', background:'transparent', color:'#fcd34d', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
    btnDiff: { fontSize:11, padding:'4px 12px', borderRadius:6, border:'1px solid #fcd34d', background:'#7c3aed', color:'#f0f0f0', cursor:'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" },

    // toolbar — 단일 flex 줄
    toolbar: { display:'flex', alignItems:'center', padding:'8px 24px', background: dark ? '#0f0f0f' : '#fafafa', borderBottom:'1px solid '+br, gap:8, flexWrap:'wrap' },
    toolbarLeft: { display:'flex', alignItems:'center', gap:10 },
    ownerSel: { fontSize:12, padding:'5px 10px', borderRadius:6, border:'1px solid '+br2, background:bg2, color:tx0, fontFamily:"'Geist', sans-serif" },
    searchInput: { fontSize:12, padding:'5px 10px', borderRadius:6, border:'1px solid '+br2, background:bg2, color:tx0, fontFamily:"'Geist', sans-serif", outline:'none', width:148 },
    btnAddProject: { fontSize:12, padding:'5px 14px', borderRadius:6, border:'none', background:'#7c3aed', color:'#f0f0f0', cursor:'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif", whiteSpace:'nowrap', marginLeft:'auto' },
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
    th: { fontSize:11, fontWeight:500, color:tx3, padding:'7px 14px', borderBottom:'1px solid '+br, background:bg3, whiteSpace:'nowrap' },
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
    childBadge: { fontSize:10, padding:'1px 6px', borderRadius:4, background: dark ? '#1e1635' : '#ede9fe', color: dark ? '#a78bfa' : '#5b21b6', fontWeight:500 },
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
    diffHeader: { background: dark ? '#1e1635' : '#f5f3ff', padding:'13px 18px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:`1px solid ${dark ? '#2a1f5c' : '#e5e7eb'}` },
    diffTitle: { fontSize:13, fontWeight:500, color: dark ? '#c4b5fd' : '#5b21b6' },
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

// ── 로그인 화면 ── Sprint 1 ─────────────────────────
function LoginScreen({ darkMode, setDarkMode }) {
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
  }

  const dk = darkMode
  const bg        = dk ? '#0d0d0d' : '#f9fafb'
  const cardBg    = dk ? '#111111' : '#ffffff'
  const cardBdr   = dk ? '#1f1f1f' : '#e5e7eb'
  const logoClr   = dk ? '#f0f0f0' : '#111827'
  const accent    = dk ? '#a78bfa' : '#7c3aed'
  const subClr    = dk ? '#6b7280' : '#9ca3af'
  const lblClr    = '#6b7280'
  const inputBg   = dk ? '#1a1a1a' : '#f3f4f6'
  const inputBdr  = dk ? '#2a2a2a' : '#e5e7eb'
  const inputClr  = dk ? '#f0f0f0' : '#111827'
  const toggleBdr = dk ? '#2a2a2a' : '#e5e7eb'
  const toggleClr = dk ? '#9ca3af' : '#6b7280'

  return (
    <div style={{
      minHeight:'100vh', background: bg,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:"'Geist', sans-serif", transition:'background .25s',
    }}>
      <div style={{
        background: cardBg, border:`1px solid ${cardBdr}`, borderRadius:14,
        padding:'36px 32px', width:360,
        display:'flex', flexDirection:'column', gap:16,
        boxShadow: dk ? '0 20px 40px rgba(0,0,0,0.5)' : '0 8px 24px rgba(0,0,0,0.08)',
        transition:'all .25s',
      }}>
        {/* 다크/라이트 토글 */}
        <div style={{ display:'flex', justifyContent:'flex-end' }}>
          <button onClick={() => setDarkMode(d => !d)} style={{
            fontSize:11, padding:'3px 10px', borderRadius:5,
            border:`1px solid ${toggleBdr}`, background:'transparent',
            color: toggleClr, cursor:'pointer', fontFamily:"'Geist', sans-serif",
          }}>
            {dk ? '☀️ 라이트' : '🌙 다크'}
          </button>
        </div>

        {/* 로고 */}
        <div style={{ fontSize:20, fontWeight:600, color: logoClr, marginBottom:6, display:'flex', alignItems:'center', gap:8 }}>
          <div style={{
            width:26, height:26, borderRadius:7,
            background:'linear-gradient(135deg,#175BFF,#8A2BFF)',
            display:'flex', alignItems:'center', justifyContent:'center',
            flexShrink:0,
          }}>
            <span style={{ fontSize:11, fontWeight:700, color:'white', letterSpacing:'-0.5px' }}>BD</span>
          </div>
          Sales<span style={{ color: accent }}>Gear</span>
        </div>

        {/* 이미지 슬롯 — 원하는 이미지 src로 교체하세요 */}
        <img src="/logo.svg" alt="" style={{ width: 180, height: 180, display: 'block', margin: '0 auto 8px' }}/>
        
        {/* 이메일 */}
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <label style={{ fontSize:11, color: lblClr }}>이메일</label>
          <input
            type="email" value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="name@company.com"
            style={{
              fontSize:13, padding:'9px 11px', borderRadius:8,
              border:`1px solid ${inputBdr}`, background: inputBg,
              color: inputClr, outline:'none', fontFamily:"'Geist', sans-serif",
            }}
          />
        </div>

        {/* 비밀번호 */}
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <label style={{ fontSize:11, color: lblClr }}>비밀번호</label>
          <input
            type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="••••••••"
            style={{
              fontSize:13, padding:'9px 11px', borderRadius:8,
              border:`1px solid ${inputBdr}`, background: inputBg,
              color: inputClr, outline:'none', fontFamily:"'Geist', sans-serif",
            }}
          />
        </div>

        {/* 에러 */}
        {error && <div style={{ fontSize:12, color:'#f87171' }}>{error}</div>}

        {/* 로그인 버튼 */}
        <button
          onClick={handleLogin} disabled={loading}
          style={{
            fontSize:13, padding:'10px', borderRadius:8, border:'none',
            background: loading ? '#4c1d95' : '#7c3aed',
            color:'#ffffff', cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight:500, marginTop:4, fontFamily:"'Geist', sans-serif",
            transition:'background .15s',
          }}
        >
          {loading ? '로그인 중...' : '로그인'}
        </button>
      </div>
    </div>
  )
}

// ── 프로젝트 추가 모달 ── Sprint 2 ───────────────────
function AddProjectModal({ quarters, owners, productCats, session, darkMode, onClose, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const [caseName, setCaseName]         = useState('')
  const [customer, setCustomer]         = useState('')
  const [productCat, setProductCat]     = useState('')
  const [country, setCountry]           = useState('')
  const [quarter, setQuarter]           = useState('')
  const [status, setStatus]             = useState('active')
  const [amt, setAmt]                   = useState(0)
  const [conf, setConf]                 = useState(0)
  const [startMonth, setStartMonth]     = useState('')
  const [endMonth, setEndMonth]         = useState('')
  const [contractMonth, setContractMonth] = useState('')
  const [comment, setComment]           = useState('')
  const [createdBy, setCreatedBy]       = useState('')

  const reflect = Math.round(amt * conf / 100)

  const STATUS_OPTS = [
    ['active','진행중','#60a5fa'],['won','계약','#4ade80'],
    ['pending','대기','#fbbf24'],['drop','드랍','#f87171'],
  ]

  const handleSave = async () => {
    if (!caseName.trim()) { setError('Case명을 입력해주세요'); return }
    setSaving(true); setError(null)
    const { error } = await supabase.from('projects').insert({
      case_name: caseName,
      customer,
      product_cat: productCat,
      country,
      quarter,
      status,
      book_amount: amt,
      probability: conf,
      start_month: startMonth || null,
      end_month: endMonth || null,
      contract_month: contractMonth || null,
      comment,
      created_by: createdBy || getAlias(session),
      is_simulation: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved()
  }

  const dk = darkMode
  const modalBg   = dk ? '#111'     : '#ffffff'
  const modalBdr  = dk ? '#2a1f5c'  : '#e5e7eb'
  const headerBg  = dk ? '#1e1635'  : '#f5f3ff'
  const headerBdr = dk ? '#2a1f5c'  : '#e5e7eb'
  const titleClr  = dk ? '#c4b5fd'  : '#5b21b6'
  const footerBg  = dk ? '#0d0d0d'  : '#f9fafb'
  const footerBdr = dk ? '#1f1f1f'  : '#e5e7eb'
  const cancelBdr = dk ? '#2a2a2a'  : '#e5e7eb'
  const cancelClr = dk ? '#6b7280'  : '#6b7280'
  const inactiveBdr = dk ? '#2a2a2a': '#e5e7eb'

  const inp = {
    fontSize:12, padding:'7px 9px', borderRadius:6,
    border:`1px solid ${dk ? '#2a2a2a' : '#e5e7eb'}`,
    background: dk ? '#1a1a1a' : '#f9fafb',
    color: dk ? '#f0f0f0' : '#111827',
    fontFamily:"'Geist', sans-serif", outline:'none', width:'100%', boxSizing:'border-box'
  }
  const lbl   = { fontSize:11, color:'#6b7280', marginBottom:4, display:'block' }
  const field = { display:'flex', flexDirection:'column', gap:3 }
  const grid4 = { display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:12, marginBottom:14 }
  const grid2 = { display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:12, marginBottom:14 }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 }}>
      <div style={{ background: modalBg, border:`1px solid ${modalBdr}`, borderRadius:12, width:'100%', maxWidth:640, overflow:'hidden', fontFamily:"'Geist', sans-serif" }}>

        {/* 헤더 */}
        <div style={{ background: headerBg, padding:'13px 18px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:`1px solid ${headerBdr}` }}>
          <span style={{ fontSize:13, fontWeight:500, color: titleClr }}>+ 프로젝트 추가</span>
          <button onClick={onClose} style={{ fontSize:20, color:'#7c3aed', cursor:'pointer', background:'none', border:'none', lineHeight:1 }}>×</button>
        </div>

        {/* 폼 */}
        <div style={{ padding:'20px 20px 0' }}>
          {/* Row 1: Case명 / 고객사 / 고객사 국가 / 제품구분 */}
          <div style={grid4}>
            <div style={field}><label style={lbl}>Case명 *</label><input style={inp} value={caseName} onChange={e => setCaseName(e.target.value)} /></div>
            <div style={field}><label style={lbl}>고객사</label><input style={inp} value={customer} onChange={e => setCustomer(e.target.value)} /></div>
            <div style={field}><label style={lbl}>고객사 국가</label><input style={inp} value={country} onChange={e => setCountry(e.target.value)} /></div>
            <div style={field}>
              <label style={lbl}>제품구분</label>
              <select style={{...inp}} value={productCat} onChange={e => setProductCat(e.target.value)}>
                <option value="">선택</option>
                {(productCats||[]).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Row 2: 분기 / 예상계약월 / 확률 / 계약금액 / 반영금액 */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,minmax(0,1fr))', gap:12, marginBottom:14 }}>
            <div style={field}>
              <label style={lbl}>분기</label>
              <select style={{...inp}} value={quarter} onChange={e => setQuarter(e.target.value)}>
                {[...quarters, '2026-Q1','2026-Q2','2026-Q3','2026-Q4'].filter((v,i,a)=>a.indexOf(v)===i).map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
            <div style={field}><label style={lbl}>예상 계약월</label><input style={inp} type="month" value={contractMonth} onChange={e => setContractMonth(e.target.value)} /></div>
            <div style={field}><label style={lbl}>확률 (%)</label><input style={inp} type="number" min={0} max={100} value={conf} onChange={e => setConf(Number(e.target.value))} /></div>
            <div style={field}><label style={lbl}>계약금액 (K KRW)</label><input style={inp} type="number" step={1000} value={amt} onChange={e => setAmt(Number(e.target.value))} /></div>
            <div style={field}><label style={lbl}>반영금액 (자동)</label><input style={{...inp, color:'#6b7280'}} value={reflect.toLocaleString() + ' K'} readOnly /></div>
          </div>

          {/* Row 3: 착수월 / 종료월 / 담당자 / 상태 */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 2fr', gap:12, marginBottom:14 }}>
            <div style={field}><label style={lbl}>착수월</label><input style={inp} type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} /></div>
            <div style={field}><label style={lbl}>종료월</label><input style={inp} type="month" value={endMonth} onChange={e => setEndMonth(e.target.value)} /></div>
            <div style={field}>
              <label style={lbl}>담당자</label>
              <select style={{...inp}} value={createdBy} onChange={e => setCreatedBy(e.target.value)}>
                <option value="">선택</option>
                {(owners||[]).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div style={field}>
              <label style={lbl}>상태</label>
              <div style={{ display:'flex', gap:6 }}>
                {STATUS_OPTS.map(([val, label, color]) => (
                  <button key={val}
                    style={{ fontSize:11, padding:'4px 12px', borderRadius:5, border:`1px solid ${status===val ? color : inactiveBdr}`, background: status===val ? color+'18' : 'transparent', color: status===val ? color : '#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                    onClick={() => setStatus(val)}>{label}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 4: 코멘트 */}
          <div style={{ marginBottom:16 }}>
            <label style={lbl}>코멘트</label>
            <textarea style={{...inp, minHeight:56, resize:'vertical'}} value={comment} onChange={e => setComment(e.target.value)} />
          </div>

          {error && <div style={{ fontSize:12, color:'#f87171', marginBottom:12 }}>{error}</div>}
        </div>

        {/* 푸터 */}
        <div style={{ padding:'12px 20px', background: footerBg, display:'flex', justifyContent:'flex-end', gap:8, borderTop:`1px solid ${footerBdr}` }}>
          <button onClick={onClose} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:`1px solid ${cancelBdr}`, background:'transparent', color: cancelClr, cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>취소</button>
          <button onClick={handleSave} disabled={saving}
            style={{ fontSize:12, padding:'6px 16px', borderRadius:6, border:'none', background: saving ? '#4c1d95' : '#7c3aed', color:'#f0f0f0', cursor: saving ? 'not-allowed':'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" }}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
