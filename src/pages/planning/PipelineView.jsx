import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../../supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import {
  FALLBACK_RATES, CCY_LABELS, STATUS_STYLE,
  OPP_STATUS_STYLE, OPP_STATUS_DB_TO_LABEL, OPP_STATUS_LABEL_TO_DB, OPP_STATUS_OPTIONS,
  getPriorityGroup, PRIORITY_LABEL,
  normalize, expandSearch, getAlias, fmtQuarter, fmtAmt, COUNTRY_OPTIONS,
} from './constants'
import { useDeals } from './useDeals'
import { useOpportunities } from './useOpportunities'
import DealDrawer, { StatusBadge, OppStatusBadge, PriorityBadge, ConfBar, ProductCatSelect } from './DealDrawer'
import ColumnFilter from './ColumnFilter'
import AddProjectModal from './AddProjectModal'

// ── 모듈 스코프 스타일 캐시 ──
let _styles = null

// ── 환율 훅 ──────────────────────────────────────────
function useCurrency() {
  const [ccy, setCcy] = useState('KRW')
  const [rates, setRates] = useState(FALLBACK_RATES)
  const [rateStatus, setRateStatus] = useState('loading')
  useEffect(() => {
    fetch('https://api.exchangerate-api.com/v4/latest/KRW')
      .then(r => r.json())
      .then(data => { setRates({ KRW: 1, USD: data.rates.USD, CNY: data.rates.CNY, JPY: data.rates.JPY, EUR: data.rates.EUR }); setRateStatus('live') })
      .catch(() => { setRates(FALLBACK_RATES); setRateStatus('fallback') })
  }, [])
  const fmtK = (man) => fmtAmt(man, rates, ccy)
  return { ccy, setCcy, rates, rateStatus, fmtK }
}

// ── 메인 컴포넌트 ─────────────────────────────────────
export default function PipelineView({ darkMode, session, lastSeen, initialSimMode = false }) {
  const s = useMemo(() => getStyles(darkMode), [darkMode])
  _styles = s
  const { ccy, setCcy, rates, rateStatus, fmtK } = useCurrency()

  // ── UI 상태 ──
  const [innerTab, setInnerTab]         = useState('deals')
  const [simMode, setSimMode]           = useState(initialSimMode)
  const [searchQuery, setSearchQuery]   = useState('')
  const [quarterRange, setQuarterRange] = useState({ start: 0, end: 3 })
  const [drawerItem, setDrawerItem]     = useState(null)
  const [toast, setToast]               = useState(null)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [chartCollapsed, setChartCollapsed] = useState(false)

  // ── 현재 분기 계산 ──
  const now = new Date()
  const currentQ = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`

  // ── 시뮬 상태 ──
  const [simChanges, setSimChanges]     = useState({})
  const [simChildren, setSimChildren]   = useState({})
  const [editingId, setEditingId]       = useState(null)
  const [editingChild, setEditingChild] = useState(null)
  const [diffOpen, setDiffOpen]         = useState(false)
  const [commitMsg, setCommitMsg]       = useState('')
  const [diffChecked, setDiffChecked]   = useState({})

  // ── 테이블 ColumnFilter 상태 (deals) ──
  const [dealCf, setDealCf]     = useState({ caseName: [], customer: [], quarter: [], status: [], owner: [] })
  const [dealSortKey, setDealSortKey] = useState(null)
  const [dealSortDir, setDealSortDir] = useState(null)
  const setDealFilter  = (key, val) => setDealCf(prev => ({ ...prev, [key]: val }))
  const handleDealSort = (key, dir) => { setDealSortKey(dir ? key : null); setDealSortDir(dir) }

  // ── 테이블 ColumnFilter 상태 (opps) ──
  const [oppCf, setOppCf]       = useState({ title: [], customer: [], owner: [], status: [] })
  const [oppSortKey, setOppSortKey] = useState(null)
  const [oppSortDir, setOppSortDir] = useState(null)
  const setOppFilter  = (key, val) => setOppCf(prev => ({ ...prev, [key]: val }))
  const handleOppSort = (key, dir) => { setOppSortKey(dir ? key : null); setOppSortDir(dir) }

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500) }

  // ── 데이터 훅 ──
  const {
    deals: rawDeals, filteredDeals: hookDeals, quarters, loading: dealsLoading,
    loadDeals, wonAmount, activeAmount, targetAmount, gap, achieveRate, productCats,
  } = useDeals({ session, mode: 'all' })

  const {
    filteredOpportunities, loading: oppLoading,
    loadOpportunities, updatePriority, promoteOpportunity, dropOpportunity,
  } = useOpportunities({ session })

  const loading = dealsLoading || oppLoading

  // ── quartersKey로 범위 초기화 (이전 1 + 현재 + 다음 1) ──
  const quartersKey = quarters.join(',')
  useEffect(() => {
    if (quarters.length === 0) return
    const currentIdx = quarters.indexOf(currentQ)
    if (currentIdx !== -1) {
      const startIdx = Math.max(0, currentIdx - 1)
      const endIdx   = Math.min(currentIdx + 1, quarters.length - 1)
      setQuarterRange({ start: startIdx, end: endIdx })
    } else {
      const end = quarters.length - 1
      setQuarterRange({ start: Math.max(0, end - 2), end })
    }
  }, [quartersKey])

  // ── owners ──
  const [owners, setOwners] = useState([])
  useEffect(() => {
    supabase.from('users').select('alias').then(({ data }) => {
      setOwners((data || []).map(u => u.alias).filter(Boolean))
    })
  }, [])

  // ── 딜 1차 필터 (검색 + 분기 범위) ──
  const filteredDeals = hookDeals.filter(d => {
    const qi = quarters.indexOf(d.quarter)
    if (quarters.length > 0 && (qi < quarterRange.start || qi > quarterRange.end)) return false
    if (searchQuery.trim()) {
      const terms = expandSearch(searchQuery)
      const match = str => terms.some(t => normalize(str).includes(t))
      if (!match(d.case_name) && !match(d.customer)) return false
    }
    return true
  })

  // ── 딜 2차 필터 + 정렬 (ColumnFilter) ──
  const statusLabelMap = Object.fromEntries(Object.entries(STATUS_STYLE).map(([k, v]) => [k, v.label]))
  const dealCfOpts = {
    caseName: [...new Set(filteredDeals.map(d => d.case_name).filter(Boolean))].sort(),
    customer: [...new Set(filteredDeals.map(d => d.customer).filter(Boolean))].sort(),
    quarter:  [...new Set(filteredDeals.map(d => d.quarter).filter(Boolean))].sort().map(q => fmtQuarter(q)),
    status:   [...new Set(filteredDeals.map(d => d.status).filter(Boolean))].map(k => statusLabelMap[k] || k).sort(),
    owner:    [...new Set(filteredDeals.map(d => d.created_by).filter(Boolean))].sort(),
  }
  const tableDeals = filteredDeals.filter(d => {
    if (dealCf.caseName.length > 0 && !dealCf.caseName.includes(d.case_name)) return false
    if (dealCf.customer.length > 0 && !dealCf.customer.includes(d.customer)) return false
    if (dealCf.quarter.length  > 0 && !dealCf.quarter.includes(fmtQuarter(d.quarter))) return false
    if (dealCf.status.length   > 0 && !dealCf.status.includes(statusLabelMap[d.status] || d.status)) return false
    if (dealCf.owner.length    > 0 && !dealCf.owner.includes(d.created_by)) return false
    return true
  }).sort((a, b) => {
    if (!dealSortKey || !dealSortDir) return 0
    const mul = dealSortDir === 'asc' ? 1 : -1
    if (dealSortKey === 'book_amount') return ((a.book_amount || 0) - (b.book_amount || 0)) * mul
    if (dealSortKey === 'reflect')     return ((a.book_amount * a.probability / 100) - (b.book_amount * b.probability / 100)) * mul
    if (dealSortKey === 'probability') return ((a.probability || 0) - (b.probability || 0)) * mul
    if (dealSortKey === 'start_month') return String(a.start_month || '').localeCompare(String(b.start_month || '')) * mul
    if (dealSortKey === 'end_month')   return String(a.end_month || '').localeCompare(String(b.end_month || '')) * mul
    return 0
  })

  // ── 기회 필터 (검색) ──
  const filteredOpps = filteredOpportunities.filter(o => {
    if (searchQuery.trim()) {
      const terms = expandSearch(searchQuery)
      const match = str => terms.some(t => normalize(str).includes(t))
      if (!match(o.title) && !match(o.customer)) return false
    }
    return true
  })

  // ── 기회 2차 필터 + 정렬 (ColumnFilter) ──
  const oppCfOpts = {
    title:    [...new Set(filteredOpps.map(o => o.title).filter(Boolean))].sort(),
    customer: [...new Set(filteredOpps.map(o => o.customer).filter(Boolean))].sort(),
    owner:    [...new Set(filteredOpps.map(o => o.owner).filter(Boolean))].sort(),
    status:   ['기획 중', '포캐스트', '드랍'],
  }
  const tableOpps = filteredOpps.filter(o => {
    if (oppCf.title.length    > 0 && !oppCf.title.includes(o.title)) return false
    if (oppCf.customer.length > 0 && !oppCf.customer.includes(o.customer)) return false
    if (oppCf.owner.length    > 0 && !oppCf.owner.includes(o.owner)) return false
    if (oppCf.status.length   > 0) {
      const label = OPP_STATUS_DB_TO_LABEL[o.status] || o.status
      if (!oppCf.status.includes(label)) return false
    }
    return true
  }).sort((a, b) => {
    if (!oppSortKey || !oppSortDir) return 0
    const mul = oppSortDir === 'asc' ? 1 : -1
    if (oppSortKey === 'amount')        return ((a.amount || 0) - (b.amount || 0)) * mul
    if (oppSortKey === 'expected_date') return String(a.expected_date || '').localeCompare(String(b.expected_date || '')) * mul
    if (oppSortKey === 'confidence')    return ((a.confidence || 0) - (b.confidence || 0)) * mul
    return 0
  })

  // ── 시뮬 KPI ──
  const simDealMap = { ...Object.fromEntries(filteredDeals.map(d => [d.id, d])), ...simChanges }
  const activeForecast = Object.values(simDealMap)
    .filter(d => d.status === 'active')
    .reduce((sum, d) => sum + Math.round((d.book_amount * d.probability) / 100), 0)
  const hasSimChanges = Object.keys(simChanges).length > 0
  const simForecast   = hasSimChanges ? activeForecast : null

  // ── filteredDeals 기준 KPI (슬라이더 범위 연동) ──
  const kpiWonAmount    = filteredDeals.filter(d => d.status === 'won').reduce((s, d) => s + (d.book_amount || 0), 0)
  const kpiActiveAmount = filteredDeals.filter(d => d.status === 'active').reduce((s, d) => s + Math.round((d.book_amount * d.probability) / 100), 0)
  const kpiTargetAmount = filteredDeals.reduce((s, d) => s + (d.target_amount || 0), 0)
  const kpiAchieveRate  = kpiTargetAmount > 0 ? Math.round(((simMode ? activeForecast : kpiActiveAmount) / kpiTargetAmount) * 100) : 0

  // ── 분기 범위 텍스트 ──
  const qStart  = quarters[quarterRange.start]
  const qEnd    = quarters[quarterRange.end]
  const qRangeLabel = qStart && qEnd ? (qStart === qEnd ? fmtQuarter(qStart) : `${fmtQuarter(qStart)}~${fmtQuarter(qEnd)}`) : ''

  // ── 사업기회 H/M/L 집계 ──
  const activeOpps = filteredOpportunities.filter(o => o.status !== 'Dropped')
  const oppSummary = {
    high: { count: activeOpps.filter(o => getPriorityGroup(o.priority) === 'high').length, amount: activeOpps.filter(o => getPriorityGroup(o.priority) === 'high').reduce((s, o) => s + (o.amount || 0), 0) },
    mid:  { count: activeOpps.filter(o => getPriorityGroup(o.priority) === 'mid').length,  amount: activeOpps.filter(o => getPriorityGroup(o.priority) === 'mid').reduce((s, o)  => s + (o.amount || 0), 0) },
    low:  { count: activeOpps.filter(o => getPriorityGroup(o.priority) === 'low').length,  amount: activeOpps.filter(o => getPriorityGroup(o.priority) === 'low').reduce((s, o)  => s + (o.amount || 0), 0) },
  }
  // rawGap: 부족이면 양수, 초과면 음수
  const rawGap = kpiTargetAmount - (simMode ? activeForecast : kpiActiveAmount)

  // ── 시뮬 편집 적용 ──
  const applySimEdit = (id, updates) => {
    setSimChanges(prev => ({ ...prev, [id]: { ...rawDeals.find(d => d.id === id), ...prev[id], ...updates } }))
    setDiffChecked(prev => ({ ...prev, [id]: true }))
    setEditingId(null)
  }

  // ── 커밋 ──
  const doCommit = async () => {
    const toCommit = Object.keys(diffChecked).filter(id => diffChecked[id])
    for (const id of toCommit) {
      const change = simChanges[id]
      if (!change) continue
      await supabase.from('projects').update({
        case_name: change.case_name, customer: change.customer,
        category: change.category, product_cat: change.product_cat,
        country: change.country, contract_month: change.contract_month,
        start_month: change.start_month, end_month: change.end_month,
        comment: change.comment, book_amount: change.book_amount,
        probability: change.probability, quarter: change.quarter,
        status: change.status, created_by: change.created_by,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
    }
    setSimChanges({}); setSimChildren({}); setDiffChecked({})
    setDiffOpen(false); setCommitMsg('')
    loadDeals()
    showToast('커밋 완료!', 'info')
  }

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#7E48C5' }} />
      <span style={{ fontSize: 13, color: '#6b7280' }}>로딩 중...</span>
    </div>
  )

  const dk = darkMode
  const br = dk ? '#1f1f1f' : '#e2e2e2'

  return (
    <div style={s.wrap}>

      {/* ── 툴바 ── */}
      <div style={s.toolbar}>
        {/* 내부 탭 */}
        <div style={s.innerTabs}>
          <button style={{ ...s.innerTab, ...(innerTab === 'deals' ? s.innerTabOn : {}) }} onClick={() => setInnerTab('deals')}>
            계약 건 <span style={s.tabCount}>{filteredDeals.length}</span>
          </button>
          <button style={{ ...s.innerTab, ...(innerTab === 'opps' ? s.innerTabOn : {}) }} onClick={() => setInnerTab('opps')}>
            사업 기회 <span style={s.tabCount}>{filteredOpps.length}</span>
          </button>
        </div>

        {/* 우측 컨트롤 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {innerTab === 'deals' && (
            <button
              style={{ fontSize: 11, padding: '0 12px', height: 30, borderRadius: 6, border: `1px solid ${simMode ? '#7E48C5' : (dk ? '#2a2a2a' : '#e5e7eb')}`, background: simMode ? (dk ? '#1e1635' : '#ede9fe') : 'transparent', color: simMode ? '#7E48C5' : (dk ? '#9ca3af' : '#6b7280'), cursor: 'pointer', fontFamily: "'Geist', sans-serif", fontWeight: simMode ? 500 : 400, whiteSpace: 'nowrap' }}
              onClick={() => { setSimMode(v => !v); if (simMode) { setSimChanges({}); setSimChildren({}) } }}>
              {simMode ? '● 시나리오 모드' : '시나리오 모드'}
            </button>
          )}
          <input style={s.searchInput} placeholder="프로젝트 / 고객사 검색" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          <div style={{ width: 1, height: 20, background: dk ? '#2a2a2a' : '#e5e7eb' }} />
          <div style={s.ccyWrap}>
            <span style={s.ccyLabel}>단위</span>
            <select style={s.ccySel} value={ccy} onChange={e => setCcy(e.target.value)}>
              {['KRW', 'USD', 'CNY', 'JPY', 'EUR'].map(c => <option key={c} value={c}>{CCY_LABELS[c]}</option>)}
            </select>
            <div style={{ ...s.rateDot, background: rateStatus === 'live' ? '#4ade80' : '#fbbf24' }} />
          </div>
        </div>
      </div>

      {/* ── KPI (계약건 탭만) ── */}
      {innerTab === 'deals' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.6fr', gap: 10, padding: '12px 20px', background: dk ? '#0a0a0a' : '#f5f5f7', borderBottom: `1px solid ${br}` }}>
          <KpiCard dot="#D05C9F" label="계약건 확정"  value={fmtK(kpiWonAmount)}    sub={`계약 ${filteredDeals.filter(d => d.status === 'won').length}건`} darkMode={dk} />
          <KpiCard dot="#7E48C5" label="포캐스트"      value={fmtK(simMode ? activeForecast : kpiActiveAmount)} sub={`확도 반영 합산`} darkMode={dk}
            sim={simMode && hasSimChanges ? { value: fmtK(simForecast) } : null} fmtK={fmtK} />
          <KpiCard dot="#3572E5" label="사업계획"      value={fmtK(kpiTargetAmount)} sub={`연간 합산`} darkMode={dk} />
          <GapKpiCard gap={rawGap} achieveRate={kpiAchieveRate} fmtK={fmtK} oppSummary={oppSummary} darkMode={dk} qRangeLabel={qRangeLabel} />
        </div>
      )}

      {/* ── 바디 ── */}
      <div style={s.body}>

        {innerTab === 'deals' ? (
          <>
            {/* 차트 + 슬라이더 */}
            {!chartCollapsed && (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 12 }}>
              {/* 목표 vs 실적 vs 포캐스트 */}
              <div style={{ background: dk ? '#111' : '#fff', border: `1px solid ${br}`, borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: dk ? '#e5e7eb' : '#111827', marginBottom: 3 }}>분기별 목표 | 실적 | 포캐스트</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 14 }}>확정 + 확률 반영 합산</div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={quarters.slice(quarterRange.start, quarterRange.end + 1).map((q, i) => {
                    const qd = filteredDeals.filter(d => d.quarter === q)
                    return {
                      q: fmtQuarter(q),
                      rawQ: q,
                      target:   qd.reduce((s, d) => s + (d.target_amount || 0), 0),
                      won:      qd.filter(d => d.status === 'won').reduce((s, d) => s + (d.book_amount || 0), 0),
                      forecast: qd.filter(d => d.status === 'active').reduce((s, d) => s + Math.round((d.book_amount * d.probability) / 100), 0),
                    }
                  })} barGap={2} barCategoryGap="28%">
                    <CartesianGrid strokeDasharray="3 3" stroke={dk ? '#1f1f1f' : '#f0f0f0'} vertical={false} />
                    <XAxis dataKey="q" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} tickFormatter={v => v > 0 ? parseFloat((v / 10000).toFixed(1)) + '억' : '0'} width={36} />
                    <Tooltip
                      contentStyle={{ background: dk ? '#111' : '#fff', border: `1px solid ${dk ? '#2a2a2a' : '#e5e7eb'}`, borderRadius: 8, fontSize: 11, fontFamily: "'Geist', sans-serif" }}
                      labelStyle={{ color: '#7E48C5', fontWeight: 500, marginBottom: 4 }}
                      itemStyle={{ color: dk ? '#d1d5db' : '#374151' }}
                      formatter={(v, name) => [parseFloat((v / 10000).toFixed(1)) + '억', name]}
                    />
                    <Bar dataKey="target" name="목표" radius={[3, 3, 0, 0]} maxBarSize={16}>
                      {quarters.slice(quarterRange.start, quarterRange.end + 1).map((q, i) => (
                        <Cell key={`t-${i}`} fill={q < currentQ ? (dk ? '#1e2a3a' : '#b8cce8') : '#3572E5'} opacity={0.85} />
                      ))}
                    </Bar>
                    <Bar dataKey="won" name="확정" radius={[3, 3, 0, 0]} maxBarSize={16}>
                      {quarters.slice(quarterRange.start, quarterRange.end + 1).map((q, i) => (
                        <Cell key={`w-${i}`} fill={q < currentQ ? (dk ? '#2a1a24' : '#e8b8d4') : '#D05C9F'} />
                      ))}
                    </Bar>
                    <Bar dataKey="forecast" name="포캐스트" radius={[3, 3, 0, 0]} maxBarSize={16}>
                      {quarters.slice(quarterRange.start, quarterRange.end + 1).map((q, i) => (
                        <Cell key={`f-${i}`} fill={q < currentQ ? (dk ? '#1e1830' : '#c9b8e8') : '#7E48C5'} opacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
                  {[['목표', '#3572E5'], ['확정', '#D05C9F'], ['포캐스트', '#7E48C5']].map(([label, color]) => (
                    <span key={label} style={{ fontSize: 10, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />{label}
                    </span>
                  ))}
                </div>
              </div>

              {/* GAP 차트 */}
              <div style={{ background: dk ? '#111' : '#fff', border: `1px solid ${br}`, borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: dk ? '#e5e7eb' : '#111827', marginBottom: 3 }}>분기별 GAP</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 14 }}>목표 대비 부족 / 초과</div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={quarters.slice(quarterRange.start, quarterRange.end + 1).map(q => {
                    const qd = filteredDeals.filter(d => d.quarter === q)
                    const target = qd.reduce((s, d) => s + (d.target_amount || 0), 0)
                    const actual = qd.filter(d => d.status === 'won').reduce((s, d) => s + (d.book_amount || 0), 0)
                      + qd.filter(d => d.status === 'active').reduce((s, d) => s + Math.round((d.book_amount * d.probability) / 100), 0)
                    return { q: fmtQuarter(q), gap: actual - target }
                  })} barCategoryGap="35%">
                    <CartesianGrid strokeDasharray="3 3" stroke={dk ? '#1f1f1f' : '#f0f0f0'} vertical={false} />
                    <XAxis dataKey="q" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} tickFormatter={v => v > 0 ? '+' + parseFloat((v / 10000).toFixed(1)) + '억' : parseFloat((v / 10000).toFixed(1)) + '억'} width={42} />
                    <Tooltip
                      contentStyle={{ background: dk ? '#111' : '#fff', border: `1px solid ${dk ? '#2a2a2a' : '#e5e7eb'}`, borderRadius: 8, fontSize: 11, fontFamily: "'Geist', sans-serif" }}
                      labelStyle={{ color: '#7E48C5', fontWeight: 500, marginBottom: 4 }}
                      formatter={(v) => [(v >= 0 ? '+' : '') + parseFloat((v / 10000).toFixed(1)) + '억', 'GAP']}
                      itemStyle={{ color: dk ? '#f0f0f0' : '#111827' }}
                    />
                    <ReferenceLine y={0} stroke={dk ? '#2a2a2a' : '#e5e7eb'} strokeWidth={1} />
                    <Bar dataKey="gap" name="GAP" radius={[3, 3, 0, 0]} maxBarSize={22}>
                      {quarters.slice(quarterRange.start, quarterRange.end + 1).map((q, i) => {
                        const qd = filteredDeals.filter(d => d.quarter === q)
                        const target = qd.reduce((sum, d) => sum + (d.target_amount || 0), 0)
                        const actual = qd.filter(d => d.status === 'won').reduce((sum, d) => sum + (d.book_amount || 0), 0)
                          + qd.filter(d => d.status === 'active').reduce((sum, d) => sum + Math.round((d.book_amount * d.probability) / 100), 0)
                        const isPast = q < currentQ
                        const isPos  = (actual - target) >= 0
                        const fill   = isPast
                          ? (isPos ? (dk ? '#0f2e1a' : '#a7d4b8') : (dk ? '#2e1010' : '#e8b8b8'))
                          : (isPos ? '#16a34a' : '#dc2626')
                        return <Cell key={`gap-${i}`} fill={fill} opacity={0.85} />
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
                  {[['초과', '#16a34a'], ['부족', '#dc2626']].map(([label, color]) => (
                    <span key={label} style={{ fontSize: 10, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />{label}
                    </span>
                  ))}
                </div>
              </div>

              {/* 세로 분기 슬라이더 */}
              <div style={{ background: dk ? '#111' : '#fff', border: `1px solid ${br}`, borderRadius: 10, padding: '16px 10px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', minWidth: 72 }}>
                <VerticalRangePicker quarters={quarters} range={quarterRange} onChange={setQuarterRange} darkMode={dk} currentQ={currentQ} />
              </div>
            </div>
            )}

            {/* 차트 접기/펼치기 구분선 */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ flex: 1, height: '1px', background: dk ? '#1f1f1f' : '#e2e2e2' }} />
              <button
                onClick={() => setChartCollapsed(v => !v)}
                style={{ width: 22, height: 22, borderRadius: '50%', border: `1px solid ${dk ? '#2a2a2a' : '#e2e2e2'}`, background: dk ? '#1a1a1a' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, margin: '0 8px', padding: 0 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  {chartCollapsed
                    ? <polyline points="2,3.5 5,6.5 8,3.5" stroke={dk ? '#6b7280' : '#9ca3af'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    : <polyline points="2,6.5 5,3.5 8,6.5" stroke={dk ? '#6b7280' : '#9ca3af'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  }
                </svg>
              </button>
              <div style={{ flex: 1, height: '1px', background: dk ? '#1f1f1f' : '#e2e2e2' }} />
            </div>

            {/* 딜 테이블 */}
            <div style={s.tableCard}>
              <div style={s.tblTop}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={s.tblTitle}>{simMode ? '시나리오 모드' : '계약 건'}</span>
                  {simMode && (
                    <span style={{ fontSize: 11, color: dk ? '#6b7280' : '#6b7280', background: dk ? '#1a1a1a' : '#f0f0f0', padding: '2px 8px', borderRadius: 99 }}>
                      {Object.keys(simChanges).length}건 변경
                    </span>
                  )}
                </div>
                {simMode && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, border: `1px solid ${dk ? '#2a2a2a' : '#e5e7eb'}`, background: 'transparent', color: dk ? '#9ca3af' : '#6b7280', cursor: 'pointer', fontFamily: "'Geist', sans-serif" }}
                      onClick={() => { setSimChanges({}); setSimChildren({}) }}>폐기</button>
                    <button
                      style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, border: `1px solid ${dk ? '#2a2a2a' : '#e5e7eb'}`, background: dk ? '#1e1635' : '#ede9fe', color: '#7E48C5', cursor: 'pointer', fontFamily: "'Geist', sans-serif" }}
                      onClick={() => setDiffOpen(true)}>확정 리뷰</button>
                  </div>
                )}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={s.tbl}>
                  <colgroup>
                    <col style={{ width: '22%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} />
                    <col style={{ width: '9%' }} /><col style={{ width: '10%' }} /><col style={{ width: '11%' }} />
                    <col style={{ width: '11%' }} /><col style={{ width: '9%' }} /><col style={{ width: '9%' }} />
                    <col style={{ width: '3%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <ColumnFilter label="프로젝트 / 고객사" align="left"   options={dealCfOpts.caseName} value={dealCf.caseName} onChange={v => setDealFilter('caseName', v)} thStyle={s.th} darkMode={dk} withSearch sortable={false} />
                      <ColumnFilter label="분기"     align="center" options={dealCfOpts.quarter}  value={dealCf.quarter}  onChange={v => setDealFilter('quarter', v)}  thStyle={s.th} darkMode={dk} />
                      <ColumnFilter label="상태"     align="center" options={dealCfOpts.status}   value={dealCf.status}   onChange={v => setDealFilter('status', v)}   thStyle={s.th} darkMode={dk} />
                      <ColumnFilter label="담당자"   align="center" options={dealCfOpts.owner}    value={dealCf.owner}    onChange={v => setDealFilter('owner', v)}    thStyle={s.th} darkMode={dk} />
                      <ColumnFilter label="확도"     align="center" options={[]} value={[]} onChange={() => {}} onSort={dir => handleDealSort('probability', dir)} sortDir={dealSortKey === 'probability' ? dealSortDir : null} thStyle={s.th} darkMode={dk} sortable filterable={false} />
                      <ColumnFilter label="계약금액" align="right"  options={[]} value={[]} onChange={() => {}} onSort={dir => handleDealSort('book_amount', dir)}  sortDir={dealSortKey === 'book_amount' ? dealSortDir : null}  thStyle={s.th} darkMode={dk} sortable filterable={false} />
                      <ColumnFilter label="반영금액" align="right"  options={[]} value={[]} onChange={() => {}} onSort={dir => handleDealSort('reflect', dir)}       sortDir={dealSortKey === 'reflect' ? dealSortDir : null}       thStyle={s.th} darkMode={dk} sortable filterable={false} />
                      <ColumnFilter label="착수"     align="center" options={[]} value={[]} onChange={() => {}} onSort={dir => handleDealSort('start_month', dir)}   sortDir={dealSortKey === 'start_month' ? dealSortDir : null}   thStyle={s.th} darkMode={dk} sortable filterable={false} />
                      <ColumnFilter label="종료"     align="center" options={[]} value={[]} onChange={() => {}} onSort={dir => handleDealSort('end_month', dir)}     sortDir={dealSortKey === 'end_month' ? dealSortDir : null}     thStyle={s.th} darkMode={dk} sortable filterable={false} />
                      <th style={{ ...s.th, textAlign: 'center' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableDeals.length === 0 ? (
                      <tr><td colSpan={10} style={{ padding: '32px', textAlign: 'center', color: '#6b7280', fontSize: 13 }}>데이터가 없습니다</td></tr>
                    ) : tableDeals.map(deal => {
                      const d = simChanges[deal.id] || deal
                      const isSim = !!simChanges[deal.id]
                      const isOpen = simMode && editingId === deal.id
                      return [
                        <DealRow key={deal.id} deal={d} orig={deal} isSim={isSim} isOpen={isOpen}
                          simMode={simMode} fmtK={fmtK} lastSeen={lastSeen}
                          onToggle={() => simMode ? setEditingId(isOpen ? null : deal.id) : setDrawerItem({ type: 'deal', data: deal })} />,
                        isOpen && (
                          <tr key={deal.id + '-edit'}>
                            <td colSpan={10} style={{ padding: 0 }}>
                              <EditPanel deal={d} fmtK={fmtK} quarters={quarters} owners={owners} productCats={productCats}
                                onApply={updates => applySimEdit(deal.id, updates)}
                                onCancel={() => setEditingId(null)}
                                onAddChild={child => setSimChildren(prev => ({ ...prev, [deal.id]: [...(prev[deal.id] || []), child] }))} />
                            </td>
                          </tr>
                        ),
                        ...(simChildren[deal.id] || []).map((c, ci) => [
                          <ChildRow key={deal.id + '-child-' + ci} child={c} deal={d} fmtK={fmtK}
                            onEdit={() => setEditingChild({ dealId: deal.id, ci })}
                            onDelete={() => setSimChildren(prev => ({ ...prev, [deal.id]: prev[deal.id].filter((_, j) => j !== ci) }))} />,
                          editingChild?.dealId === deal.id && editingChild?.ci === ci && (
                            <tr key={deal.id + '-child-edit-' + ci}>
                              <td colSpan={10} style={{ padding: 0 }}>
                                <ChildEditPanel child={c} quarters={quarters} fmtK={fmtK}
                                  onApply={updated => { setSimChildren(prev => ({ ...prev, [deal.id]: prev[deal.id].map((x, j) => j === ci ? { ...x, ...updated } : x) })); setEditingChild(null) }}
                                  onCancel={() => setEditingChild(null)} />
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
          </>
        ) : (
          /* ── 사업 기회 테이블 ── */
          <OppsTable opps={tableOpps} darkMode={dk} fmtK={fmtK} lastSeen={lastSeen} s={s}
            oppCfOpts={oppCfOpts} oppCf={oppCf} setOppFilter={setOppFilter}
            oppSortKey={oppSortKey} oppSortDir={oppSortDir} handleOppSort={handleOppSort}
            onRowClick={opp => setDrawerItem({ type: 'opp', data: opp })} />
        )}
      </div>

      {/* ── DIFF 모달 ── */}
      {diffOpen && (
        <div style={s.overlay}>
          <div style={s.diffModal}>
            <div style={s.diffHeader}>
              <span style={s.diffTitle}>확정 리뷰 — 커밋할 변경 선택</span>
              <button style={s.diffClose} onClick={() => setDiffOpen(false)}>×</button>
            </div>
            {Object.entries(simChanges).map(([id, changed]) => {
              const orig = rawDeals.find(d => d.id === id)
              if (!orig) return null
              return (
                <div key={id} style={s.diffItem}>
                  <div style={{ ...s.diffChk, ...(diffChecked[id] ? s.diffChkOn : {}) }}
                    onClick={() => setDiffChecked(prev => ({ ...prev, [id]: !prev[id] }))}>
                    {diffChecked[id] && '✓'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={s.diffName}>{orig.case_name} <span style={s.diffCo}>{orig.customer}</span></div>
                    <div style={s.diffRows}>
                      {changed.case_name !== orig.case_name && <DiffRow field="프로젝트명" before={orig.case_name} after={changed.case_name} />}
                      {changed.book_amount !== orig.book_amount && <DiffRow field="금액" before={fmtK(orig.book_amount)} after={fmtK(changed.book_amount)} />}
                      {changed.probability !== orig.probability && <DiffRow field="확도" before={orig.probability + '%'} after={changed.probability + '%'} />}
                      {changed.quarter !== orig.quarter && <DiffRow field="분기" before={fmtQuarter(orig.quarter)} after={fmtQuarter(changed.quarter)} />}
                      {changed.status !== orig.status && <DiffRow field="상태" before={STATUS_STYLE[orig.status]?.label || orig.status} after={STATUS_STYLE[changed.status]?.label || changed.status} />}
                    </div>
                  </div>
                </div>
              )
            })}
            <div style={s.diffFoot}>
              <input style={s.commitInp} value={commitMsg} onChange={e => setCommitMsg(e.target.value)} placeholder="커밋 메시지" />
              <button style={s.btnCommit} onClick={doCommit}>커밋 적용</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD PROJECT MODAL ── */}
      {addProjectOpen && (
        <AddProjectModal quarters={quarters} owners={owners} productCats={productCats}
          session={session} darkMode={dk}
          onClose={() => setAddProjectOpen(false)}
          onSaved={() => { setAddProjectOpen(false); loadDeals() }} />
      )}

      {/* ── 드로어 ── */}
      {drawerItem && (
        <DealDrawer
          item={drawerItem}
          darkMode={dk}
          session={session}
          fmtK={fmtK}
          showDrop={false}
          productCats={productCats}
          quarters={quarters}
          onClose={() => setDrawerItem(null)}
          onPromote={async oppId => {
            const { error } = await promoteOpportunity(oppId, null)
            if (!error) { showToast('계약건으로 승격했어요 🎉'); loadOpportunities(); loadDeals() }
          }}
          onPriorityChange={async (oppId, p) => { await updatePriority(oppId, p); loadOpportunities() }}
          onRefreshDeals={loadDeals}
          onRefreshOpps={loadOpportunities}
        />
      )}

      {/* ── 토스트 ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: toast.type === 'info' ? (dk ? '#0f2010' : '#f0fdf4') : (dk ? '#1e1635' : '#ede9fe'),
          border: `1px solid ${toast.type === 'info' ? '#4ade80' : '#7E48C5'}`,
          color: toast.type === 'info' ? (dk ? '#4ade80' : '#16a34a') : (dk ? '#c4b5fd' : '#5b21b6'),
          padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: "'Geist', sans-serif",
        }}>{toast.msg}</div>
      )}
    </div>
  )
}

// ── 사업 기회 테이블 ──────────────────────────────────
function OppsTable({ opps, darkMode, fmtK, lastSeen, s, oppCfOpts, oppCf, setOppFilter, oppSortKey, oppSortDir, handleOppSort, onRowClick }) {
  const grouped = {
    high:  opps.filter(o => getPriorityGroup(o.priority) === 'high'),
    mid:   opps.filter(o => getPriorityGroup(o.priority) === 'mid'),
    low:   opps.filter(o => getPriorityGroup(o.priority) === 'low'),
    dummy: opps.filter(o => getPriorityGroup(o.priority) === 'dummy'),
  }
  const OppHeader = () => (
    <tr>
      <ColumnFilter label="프로젝트" align="left"   options={oppCfOpts.title}    value={oppCf.title}    onChange={v => setOppFilter('title', v)}    thStyle={s.th} darkMode={darkMode} withSearch sortable={false} />
      <ColumnFilter label="고객사"   align="left"   options={oppCfOpts.customer} value={oppCf.customer} onChange={v => setOppFilter('customer', v)} thStyle={s.th} darkMode={darkMode} />
      <ColumnFilter label="상태"     align="center" options={oppCfOpts.status}   value={oppCf.status}   onChange={v => setOppFilter('status', v)}   thStyle={s.th} darkMode={darkMode} />
      <ColumnFilter label="담당자"   align="center" options={oppCfOpts.owner}    value={oppCf.owner}    onChange={v => setOppFilter('owner', v)}    thStyle={s.th} darkMode={darkMode} />
      <ColumnFilter label="예상금액" align="right"  options={[]} value={[]} onChange={() => {}} onSort={dir => handleOppSort('amount', dir)}        sortDir={oppSortKey === 'amount' ? oppSortDir : null}        thStyle={s.th} darkMode={darkMode} sortable filterable={false} />
      <ColumnFilter label="예상월"   align="center" options={[]} value={[]} onChange={() => {}} onSort={dir => handleOppSort('expected_date', dir)} sortDir={oppSortKey === 'expected_date' ? oppSortDir : null} thStyle={s.th} darkMode={darkMode} sortable filterable={false} />
      <ColumnFilter label="확도"     align="center" options={[]} value={[]} onChange={() => {}} onSort={dir => handleOppSort('confidence', dir)}    sortDir={oppSortKey === 'confidence' ? oppSortDir : null}    thStyle={s.th} darkMode={darkMode} sortable filterable={false} />
      <th style={{ ...s.th, textAlign: 'center' }}>중요도</th>
    </tr>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {['high', 'mid', 'low', 'dummy'].map(group => {
        const items = grouped[group]
        if (items.length === 0) return null
        const { label, color, bg } = PRIORITY_LABEL[group]
        return (
          <div key={group}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 500, background: bg, color, padding: '2px 10px', borderRadius: 99 }}>{label}</span>
              <span style={{ fontSize: 11, color: '#6b7280', background: darkMode ? '#1a1a1a' : '#f0f0f0', padding: '2px 8px', borderRadius: 99 }}>{items.length}건</span>
              <div style={{ flex: 1, height: '0.5px', background: darkMode ? '#1f1f1f' : '#e2e2e2' }} />
            </div>
            <div style={s.tableCard}>
              <table style={s.tbl}>
                <colgroup>
                  <col style={{ width: '26%' }} /><col style={{ width: '11%' }} /><col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} /><col style={{ width: '13%' }} /><col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} /><col style={{ width: '9%' }} />
                </colgroup>
                <thead><OppHeader /></thead>
                <tbody>
                  {items.map(opp => {
                    const isNew = lastSeen && opp.created_at && new Date(opp.created_at) > new Date(lastSeen)
                    return (
                      <tr key={opp.id}
                        style={{ ...s.tr, boxShadow: isNew ? 'inset 3px 0 0 #D05C9F' : 'none' }}
                        onClick={() => onRowClick(opp)}
                        onMouseEnter={e => e.currentTarget.style.background = darkMode ? '#1a1a1a' : '#f5f3ff'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={s.td}><div style={s.caseName}>{opp.title}</div><div style={s.caseSub}>{opp.product}</div></td>
                        <td style={s.td}><span style={s.chip}>{opp.customer}</span></td>
                        <td style={{ ...s.td, textAlign: 'center' }}><OppStatusBadge status={opp.status} /></td>
                        <td style={{ ...s.td, textAlign: 'center' }}><span style={s.chip}>{opp.owner || '—'}</span></td>
                        <td style={{ ...s.td, textAlign: 'right' }}>{fmtK(opp.amount)}</td>
                        <td style={{ ...s.td, textAlign: 'center' }}><span style={s.chip}>{opp.expected_date || '—'}</span></td>
                        <td style={{ ...s.td, textAlign: 'center' }}><ConfBar pct={opp.confidence || 0} /></td>
                        <td style={{ ...s.td, textAlign: 'center' }}><PriorityBadge priority={opp.priority} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      {opps.length === 0 && <div style={{ padding: '28px', textAlign: 'center', color: '#6b7280', fontSize: 13 }}>사업 기회가 없습니다</div>}
    </div>
  )
}

// ── 갭 KPI 카드 ──────────────────────────────────────
function GapKpiCard({ gap, achieveRate, fmtK, oppSummary, darkMode, qRangeLabel }) {
  const dark = darkMode
  const bg1 = dark ? '#111' : '#fff', br = dark ? '#1f1f1f' : '#e2e2e2'
  const tx1 = dark ? '#6b7280' : '#6b7280', tx3 = dark ? '#4b5563' : '#9ca3af'
  const br2 = dark ? '#2a2a2a' : '#e5e7eb'
  // gap > 0 = 부족, gap <= 0 = 초과
  const isShort    = gap > 0
  const gapColor   = !isShort ? '#4ade80' : achieveRate >= 70 ? '#fbbf24' : '#E24B4A'
  const gapLabel   = !isShort ? '갭 (초과)' : achieveRate >= 70 ? '갭 (주의)' : '갭 (부족)'
  const displayAmt = Math.abs(gap)
  const prefix     = !isShort ? '+' : '-'
  const tiers = [
    { key: 'high', badge: 'H', bg: '#FAECE7', color: '#993C1D' },
    { key: 'mid',  badge: 'M', bg: '#FAEEDA', color: '#854F0B' },
    { key: 'low',  badge: 'L', bg: '#EAF3DE', color: '#3B6D11' },
  ]
  return (
    <div style={{ background: bg1, border: `1px solid ${br}`, borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'stretch', gap: 0 }}>
      {/* 왼쪽: 갭 라벨 + 금액 + 달성률 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingRight: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: gapColor, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: tx1 }}>{gapLabel}</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.2, color: gapColor }}>{prefix}{fmtK(displayAmt)}</div>
        <div style={{ fontSize: 11, color: tx3, marginTop: 3 }}>달성률 {achieveRate}% · {qRangeLabel}</div>
      </div>
      {/* 구분선 */}
      <div style={{ width: 1, background: br2, alignSelf: 'stretch', flexShrink: 0 }} />
      {/* 오른쪽: H M L */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, justifyContent: 'center', paddingLeft: 12 }}>
        {tiers.map(({ key, badge, bg, color }) => {
          const info = oppSummary[key]
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 9, fontWeight: 500, padding: '1px 5px', borderRadius: 3, background: bg, color, flexShrink: 0, minWidth: 16, textAlign: 'center' }}>{badge}</span>
              <span style={{ fontSize: 10, color: tx3, flexShrink: 0 }}>{info.count}건</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: dark ? '#e5e7eb' : '#111827', marginLeft: 'auto' }}>{fmtK(info.amount)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── KPI 카드 ──────────────────────────────────────────
function KpiCard({ dot, label, value, sub, darkMode, isGap, achieveRate, sim, fmtK }) {
  const dark = darkMode
  const bg1 = dark ? '#111' : '#fff', br = dark ? '#1f1f1f' : '#e2e2e2'
  const tx0 = dark ? '#f0f0f0' : '#111', tx1 = dark ? '#6b7280' : '#6b7280', tx3 = dark ? '#4b5563' : '#9ca3af'
  const br2 = dark ? '#2a2a2a' : '#d1d5db'
  const gapColor = isGap ? (achieveRate >= 90 ? '#4ade80' : achieveRate >= 70 ? '#fbbf24' : '#f87171') : null
  return (
    <div style={{ background: bg1, border: `1px solid ${br}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: gapColor || dot }} />
        <span style={{ fontSize: 11, color: tx1 }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.2, color: gapColor || tx0 }}>{value}</div>
      <div style={{ fontSize: 11, color: tx3, marginTop: 3 }}>{sub}</div>
      {sim && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${br2}` }}>
          <span style={{ fontSize: 10, background: dark ? '#1e1635' : '#ede9fe', color: dark ? '#c4b5fd' : '#7E48C5', padding: '1px 5px', borderRadius: 3, fontWeight: 500 }}>시나리오</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: dark ? '#c4b5fd' : '#7E48C5' }}>{sim.value}</span>
        </div>
      )}
    </div>
  )
}

// ── 딜 행 ─────────────────────────────────────────────
function ChgInline({ before, after }) {
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
      <span style={{ fontSize:11, textDecoration:'line-through', color:'#9ca3af', whiteSpace:'nowrap' }}>{before}</span>
      <span style={{ fontSize:11, fontWeight:500, color:'#4ade80', whiteSpace:'nowrap' }}>{after}</span>
    </span>
  )
}

function DealRow({ deal, orig, isSim, isOpen, simMode, fmtK, onToggle, lastSeen }) {
  const st     = STATUS_STYLE[deal.status] || STATUS_STYLE.active
  const origSt = STATUS_STYLE[orig.status] || STATUS_STYLE.active

  const amtChanged      = isSim && deal.book_amount !== orig.book_amount
  const confChanged     = isSim && deal.probability !== orig.probability
  const nameChanged     = isSim && deal.case_name !== orig.case_name
  const customerChanged = isSim && deal.customer !== orig.customer
  const quarterChanged  = isSim && deal.quarter !== orig.quarter
  const statusChanged   = isSim && deal.status !== orig.status
  const ownerChanged    = isSim && deal.created_by !== orig.created_by
  const startChanged    = isSim && deal.start_month !== orig.start_month
  const endChanged      = isSim && deal.end_month !== orig.end_month

  const origReflect    = Math.round((orig.book_amount * orig.probability) / 100)
  const newReflect     = Math.round((deal.book_amount * deal.probability) / 100)
  const reflectChanged = isSim && (amtChanged || confChanged)
  const confPct        = deal.probability || 0
  const confColor      = confPct >= 100 ? '#4ade80' : confPct >= 60 ? '#60a5fa' : confPct >= 30 ? '#fbbf24' : '#4b5563'
  const isNew          = lastSeen && deal.created_at && new Date(deal.created_at) > new Date(lastSeen)
  const s = _styles

  return (
    <tr style={{ ...s.tr, ...(isOpen ? s.trOpen : {}), boxShadow: isNew ? 'inset 3px 0 0 #D05C9F' : 'none' }}
      onClick={onToggle}
      onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = s.trHover.background }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>

      <td style={s.td}>
        <div style={s.caseName}>{nameChanged ? <ChgInline before={orig.case_name} after={deal.case_name} /> : deal.case_name}</div>
        <div style={s.caseSub}>{customerChanged ? <ChgInline before={orig.customer} after={deal.customer} /> : deal.customer}</div>
      </td>
      <td style={{ ...s.td, textAlign:'center' }}>
        {quarterChanged ? <ChgInline before={fmtQuarter(orig.quarter)} after={fmtQuarter(deal.quarter)} /> : <span style={s.quarterChip}>{fmtQuarter(deal.quarter)}</span>}
      </td>
      <td style={{ ...s.td, textAlign:'center' }}>
        {statusChanged ? <ChgInline before={origSt.label} after={st.label} /> : <span style={{ ...s.badge, background:st.bg, color:st.color }}>{st.label}</span>}
      </td>
      <td style={{ ...s.td, textAlign:'center' }}>
        {ownerChanged ? <ChgInline before={orig.created_by||'—'} after={deal.created_by||'—'} /> : <span style={s.ownerChip}>{deal.created_by || '—'}</span>}
      </td>
      <td style={{ ...s.td, textAlign:'center' }}>
        {confChanged
          ? <ChgInline before={orig.probability+'%'} after={deal.probability+'%'} />
          : <div style={{ ...s.confWrap, justifyContent:'center' }}>
              <div style={s.confBg}><div style={{ ...s.confFill, width:confPct+'%', background:confColor }} /></div>
              <span style={{ fontSize:11, color:'#9ca3af' }}>{confPct}%</span>
            </div>}
      </td>
      <td style={{ ...s.td, textAlign:'right' }}>
        {amtChanged ? <><span style={s.amtStrike}>{fmtK(orig.book_amount)}</span><span style={s.amtNew}>{fmtK(deal.book_amount)}</span></> : <span style={s.amtNormal}>{fmtK(deal.book_amount)}</span>}
      </td>
      <td style={{ ...s.td, textAlign:'right' }}>
        {deal.status === 'drop' ? <span style={{ ...s.amtNormal, color:'#9ca3af' }}>—</span>
          : reflectChanged ? <><span style={s.amtStrike}>{fmtK(origReflect)}</span><span style={s.amtNew}>{fmtK(newReflect)}</span></>
            : <span style={s.amtNormal}>{fmtK(deal.reflected_amount || newReflect)}</span>}
      </td>
      <td style={{ ...s.td, textAlign:'center' }}>
        {startChanged ? <ChgInline before={orig.start_month||'—'} after={deal.start_month||'—'} /> : <span style={s.quarterChip}>{deal.start_month || '—'}</span>}
      </td>
      <td style={{ ...s.td, textAlign:'center' }}>
        {endChanged ? <ChgInline before={orig.end_month||'—'} after={deal.end_month||'—'} /> : <span style={s.quarterChip}>{deal.end_month || '—'}</span>}
      </td>
      <td style={{ ...s.td, textAlign:'center' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
          {simMode
            ? <span style={{ ...s.chevron, transform:isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
            : <span style={{ fontSize:11, color:'#9ca3af' }}>↗</span>}
        </div>
      </td>
    </tr>
  )
}

// ── 인라인 편집 패널 ──────────────────────────────────
function EditPanel({ deal, fmtK, quarters, owners, productCats, onApply, onCancel, onAddChild }) {
  const [caseName, setCaseName]           = useState(deal.case_name || '')
  const [customer, setCustomer]           = useState(deal.customer || '')
  const [category, setCategory]           = useState(deal.category || 'Pick')
  const [productCat, setProductCat]       = useState(deal.product_cat || '')
  const [country, setCountry]             = useState(deal.country || 'KR')
  const [contractMonth, setContractMonth] = useState(deal.contract_month || '')
  const [startMonth, setStartMonth]       = useState(deal.start_month || '')
  const [endMonth, setEndMonth]           = useState(deal.end_month || '')
  const [comment, setComment]             = useState(deal.comment || '')
  const [amt, setAmt]                     = useState(deal.book_amount || 0)
  const [conf, setConf]                   = useState(deal.probability || 0)
  const [quarter, setQuarter]             = useState(deal.quarter || '')
  const [status, setStatus]               = useState(deal.status || 'active')
  const [createdBy, setCreatedBy]         = useState(deal.created_by || '')
  const [children, setChildren]           = useState([])
  const reflect = Math.round(amt * conf / 100)
  const s = _styles
  const STATUS_OPTS = [['active', '진행중', '#60a5fa'], ['won', '계약', '#4ade80'], ['drop', '드랍', '#f87171'], ['pending', '대기', '#fbbf24']]
  return (
    <div style={s.editPanel}>
      <div style={{ ...s.editGrid, gridTemplateColumns: 'repeat(4,minmax(0,1fr))', marginBottom: 10 }}>
        <div style={s.editField}><label style={s.editLabel}>프로젝트명</label><input style={s.editInput} value={caseName} onChange={e => setCaseName(e.target.value)} /></div>
        <div style={s.editField}><label style={s.editLabel}>고객사</label><input style={s.editInput} value={customer} onChange={e => setCustomer(e.target.value)} /></div>
        <div style={s.editField}><label style={s.editLabel}>고객사 국가</label>
          <select style={s.editSelect} value={country} onChange={e => setCountry(e.target.value)}>
            <option value="">선택</option>
            {COUNTRY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>
        <div style={s.editField}><label style={s.editLabel}>제품구분</label>
          <select style={s.editSelect} value={productCats.includes(productCat) ? productCat : '__other__'} onChange={e => setProductCat(e.target.value === '__other__' ? '' : e.target.value)}>
            <option value="">선택</option>
            {productCats.map(c => <option key={c} value={c}>{c}</option>)}
            <option value="__other__">기타 (직접 입력)</option>
          </select>
          {!productCats.includes(productCat) && <input style={{ ...s.editInput, marginTop: 4 }} value={productCat} onChange={e => setProductCat(e.target.value)} placeholder="제품구분 입력" autoFocus />}
        </div>
      </div>
      <div style={{ ...s.editGrid, gridTemplateColumns: 'repeat(4,minmax(0,1fr))', marginBottom: 10 }}>
        <div style={s.editField}><label style={s.editLabel}>분기</label>
          <select style={s.editSelect} value={quarter} onChange={e => setQuarter(e.target.value)}>
            {quarters.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div style={s.editField}><label style={s.editLabel}>예상 계약월</label><input style={s.editInput} value={contractMonth} onChange={e => setContractMonth(e.target.value)} type="month" /></div>
        <div style={s.editField}><label style={s.editLabel}>확률 (%)</label><input style={s.editInput} type="number" value={conf} min={0} max={100} onChange={e => setConf(Number(e.target.value))} /></div>
        <div style={s.editField}><label style={s.editLabel}>계약금액 (만원)</label><input style={s.editInput} type="number" value={amt} step={1000} onChange={e => setAmt(Number(e.target.value))} /><span style={s.editHint}>반영: {fmtK(reflect)}</span></div>
      </div>
      <div style={{ ...s.editGrid, gridTemplateColumns: '1fr 1fr 1fr 2fr', marginBottom: 10 }}>
        <div style={s.editField}><label style={s.editLabel}>착수월</label><input style={s.editInput} value={startMonth} onChange={e => setStartMonth(e.target.value)} type="month" /></div>
        <div style={s.editField}><label style={s.editLabel}>종료월</label><input style={s.editInput} value={endMonth} onChange={e => setEndMonth(e.target.value)} type="month" /></div>
        <div style={s.editField}><label style={s.editLabel}>담당자</label>
          <select style={s.editSelect} value={createdBy} onChange={e => setCreatedBy(e.target.value)}>
            {owners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div style={s.editField}><label style={s.editLabel}>상태</label>
          <div style={s.statusRow}>
            {STATUS_OPTS.map(([val, label, color]) => (
              <button key={val} style={{ ...s.statusBtn, ...(status === val ? { borderColor: color, color, background: color + '18' } : {}) }} onClick={() => setStatus(val)}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={s.editLabel}>코멘트</label>
        <textarea style={{ ...s.editInput, width: '100%', minHeight: 60, resize: 'vertical', marginTop: 4, boxSizing: 'border-box' }} value={comment} onChange={e => setComment(e.target.value)} />
      </div>
      <button style={s.deriveBtn} onClick={() => setChildren(prev => [...prev, { amt: 0, conf: 40, quarter: quarters[0] || '2025-Q1' }])}>+ child case 추가</button>
      {children.map((c, i) => (
        <div key={i} style={s.childCard}>
          <div style={s.childHeader}><span style={s.childBadge}>child case {i + 1}</span><button style={s.btnRm} onClick={() => setChildren(prev => prev.filter((_, j) => j !== i))}>삭제</button></div>
          <div style={s.childGrid}>
            <div style={s.editField}><label style={s.editLabel}>금액 (만원)</label><input style={s.editInput} type="number" value={c.amt} onChange={e => setChildren(prev => prev.map((x, j) => j === i ? { ...x, amt: Number(e.target.value) } : x))} /></div>
            <div style={s.editField}><label style={s.editLabel}>분기</label>
              <select style={s.editSelect} value={c.quarter} onChange={e => setChildren(prev => prev.map((x, j) => j === i ? { ...x, quarter: e.target.value } : x))}>
                {quarters.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
            <div style={s.editField}><label style={s.editLabel}>확도 (%)</label><input style={s.editInput} type="number" value={c.conf} min={0} max={100} onChange={e => setChildren(prev => prev.map((x, j) => j === i ? { ...x, conf: Number(e.target.value) } : x))} /></div>
          </div>
        </div>
      ))}
      <div style={s.editFoot}>
        <span style={{ fontSize: 11, color: '#6b7280' }}>커밋 전까지 실제 DB 불변</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={s.btnCancel} onClick={onCancel}>취소</button>
          <button style={s.btnApply} onClick={() => { children.forEach(c => onAddChild(c)); onApply({ case_name: caseName, customer, category, product_cat: productCat, country, contract_month: contractMonth, start_month: startMonth, end_month: endMonth, comment, book_amount: amt, probability: conf, quarter, status, created_by: createdBy }) }}>저장</button>
        </div>
      </div>
    </div>
  )
}

// ── Child 편집 패널 ───────────────────────────────────
function ChildEditPanel({ child, quarters, fmtK, onApply, onCancel }) {
  const [amt, setAmt]         = useState(child.amt || 0)
  const [conf, setConf]       = useState(child.conf || 40)
  const [quarter, setQuarter] = useState(child.quarter || '')
  const reflect = Math.round(amt * conf / 100)
  const s = _styles
  return (
    <div style={{ ...s.editPanel, borderTop: '1px solid #2a1f5c', borderLeft: '4px solid #7E48C5' }}>
      <div style={{ fontSize: 11, color: '#a78bfa', marginBottom: 10, fontWeight: 500 }}>↳ Child 딜 수정</div>
      <div style={s.editGrid}>
        <div style={s.editField}><label style={s.editLabel}>금액 (만원)</label><input style={s.editInput} type="number" value={amt} onChange={e => setAmt(Number(e.target.value))} /><span style={s.editHint}>반영: {fmtK(reflect)}</span></div>
        <div style={s.editField}><label style={s.editLabel}>확도 (%)</label><input style={s.editInput} type="number" value={conf} min={0} max={100} onChange={e => setConf(Number(e.target.value))} /></div>
        <div style={s.editField}><label style={s.editLabel}>분기</label>
          <select style={s.editSelect} value={quarter} onChange={e => setQuarter(e.target.value)}>
            {quarters.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
      </div>
      <div style={s.editFoot}>
        <span style={{ fontSize: 11, color: '#6b7280' }}>Child 딜 수정</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={s.btnCancel} onClick={onCancel}>취소</button>
          <button style={s.btnApply} onClick={() => onApply({ amt, conf, quarter })}>반영</button>
        </div>
      </div>
    </div>
  )
}

// ── Child 행 ──────────────────────────────────────────
function ChildRow({ child, deal, fmtK, onEdit, onDelete }) {
  const s = _styles
  return (
    <tr style={s.childRowBg}>
      <td style={s.td}><div style={{ paddingLeft: 12 }}><span style={{ fontSize: 11, color: '#a78bfa', marginRight: 4 }}>↳</span><span style={{ ...s.caseName, display: 'inline' }}>{deal.case_name}</span><div style={{ ...s.caseSub, color: '#7c6db0' }}>잔여분</div></div></td>
      <td style={{ ...s.td, textAlign: 'center' }}><span style={{ ...s.quarterChip, color: '#a78bfa' }}>{fmtQuarter(child.quarter)}</span></td>
      <td style={{ ...s.td, textAlign: 'center' }}><span style={{ ...s.badge, background: 'rgba(167,139,250,0.15)', color: '#7E48C5', fontSize: 10 }}>child</span></td>
      <td style={{ ...s.td, textAlign: 'center' }} />
      <td style={{ ...s.td, textAlign: 'center' }}><span style={{ fontSize: 11, color: '#9ca3af' }}>{child.conf}%</span></td>
      <td style={{ ...s.td, textAlign: 'right', color: '#a78bfa', fontWeight: 500 }}>{fmtK(child.amt)}</td>
      <td style={{ ...s.td, textAlign: 'right', color: '#a78bfa' }}>{fmtK(Math.round(child.amt * child.conf / 100))}</td>
      <td style={s.td} /><td style={s.td} />
      <td style={s.td}>
        <div style={{ display: 'flex', gap: 4 }}>
          {onEdit && <button style={s.childEditBtn} onClick={onEdit}>수정</button>}
          {onDelete && <button style={s.childDelBtn} onClick={onDelete}>삭제</button>}
        </div>
      </td>
    </tr>
  )
}

// ── Diff Row ──────────────────────────────────────────
function DiffRow({ field, before, after }) {
  const s = _styles
  return (
    <div style={s.diffRow}>
      <span style={s.diffField}>{field}</span>
      <span style={s.diffBefore}>{before}</span>
      <span style={{ color: '#4b5563', fontSize: 11 }}>→</span>
      <span style={s.diffAfter}>{after}</span>
    </div>
  )
}

// ── 세로 분기 슬라이더 ────────────────────────────────
function VerticalRangePicker({ quarters, range, onChange, darkMode, currentQ }) {
  const trackRef = useRef(null)
  const dragging = useRef(null)
  if (quarters.length === 0) return null

  const pct    = i => quarters.length <= 1 ? 0 : (i / (quarters.length - 1)) * 100
  const topPct = i => 100 - pct(i)

  const posToIdx = clientY => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    return Math.round((1 - ratio) * (quarters.length - 1))
  }

  const onMouseDown = handle => e => {
    e.preventDefault(); dragging.current = handle
    const move = ev => {
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY
      const idx = posToIdx(y)
      if (dragging.current === 'start') onChange({ start: Math.min(idx, range.end), end: range.end })
      else onChange({ start: range.start, end: Math.max(idx, range.start) })
    }
    const up = () => { dragging.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    window.addEventListener('touchmove', move); window.addEventListener('touchend', up)
  }

  const fmtLabel = q => q ? q.split('-')[0].replace('20', 'y') : ''
  const br = darkMode ? '#2a2a2a' : '#e2e2e2'
  // 이전 분기 톤다운 색상
  const activeColor     = '#7E48C5'
  const activePastColor = darkMode ? '#3a2a5a' : '#c9b8e8'
  const qLabelActive     = '#a78bfa'
  const qLabelActivePast = darkMode ? '#5a4a7a' : '#c4b0e0'
  const qLabelInactive   = darkMode ? '#4b5563' : '#9ca3af'

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'stretch', width: '100%' }}>
      {/* 분기 레이블 — 왼쪽 */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 140 }}>
        {[...quarters].reverse().map((q, i) => {
          const origIdx = quarters.length - 1 - i
          const active  = origIdx >= range.start && origIdx <= range.end
          const isPast  = currentQ && q < currentQ
          const color   = active ? (isPast ? qLabelActivePast : qLabelActive) : qLabelInactive
          const weight  = active ? 500 : 400
          return <span key={q} style={{ fontSize: 9, color, fontWeight: weight, textAlign: 'right', lineHeight: 1 }}>{q.split('-')[1]?.toLowerCase()}</span>
        })}
      </div>
      {/* 트랙 + 핸들 */}
      <div style={{ position: 'relative', flex: 1 }}>
        <div ref={trackRef}
          style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', width: 2, top: 0, bottom: 0, background: br, borderRadius: 2, cursor: 'pointer' }}
          onClick={e => { const idx = posToIdx(e.clientY); if (Math.abs(idx - range.end) <= Math.abs(idx - range.start)) onChange({ start: range.start, end: Math.max(idx, range.start) }); else onChange({ start: Math.min(idx, range.end), end: range.end }) }}>
          <div style={{ position: 'absolute', left: 0, width: '100%', top: topPct(range.end) + '%', height: (topPct(range.start) - topPct(range.end)) + '%', background: activeColor, borderRadius: 2, pointerEvents: 'none' }} />
        </div>
        {['end', 'start'].map(h => {
          const idx    = h === 'start' ? range.start : range.end
          const isPast = currentQ && quarters[idx] < currentQ
          const bgColor = isPast ? activePastColor : activeColor
          return (
            <div key={h} onMouseDown={onMouseDown(h)} onTouchStart={onMouseDown(h)}
              style={{ position: 'absolute', left: '50%', top: topPct(idx) + '%', transform: 'translate(-50%,-50%)', height: 18, minWidth: 32, paddingInline: 6, borderRadius: 9, background: bgColor, cursor: 'grab', zIndex: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 9, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{fmtLabel(quarters[idx])}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 스타일 ────────────────────────────────────────────
function getStyles(dark) {
  const bg1 = dark ? '#111111' : '#ffffff', bg2 = dark ? '#1a1a1a' : '#f0f0f0', bg3 = dark ? '#0d0d0d' : '#e8e8e8'
  const br  = dark ? '#1f1f1f' : '#e2e2e2', br2 = dark ? '#2a2a2a' : '#d1d5db'
  const tx0 = dark ? '#f0f0f0' : '#111111', tx1 = dark ? '#6b7280' : '#6b7280'
  const tx2 = dark ? '#d1d5db' : '#374151', tx3 = dark ? '#4b5563' : '#9ca3af', tx4 = dark ? '#9ca3af' : '#6b7280'
  return {
    wrap:         { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: dark ? '#0a0a0a' : '#f5f5f7', fontFamily: "'Geist', sans-serif" },
    toolbar:      { display: 'flex', alignItems: 'center', padding: '8px 16px', background: dark ? '#0f0f0f' : '#fafafa', borderBottom: '1px solid ' + br, gap: 6, flexWrap: 'wrap' },
    innerTabs:    { display: 'flex', gap: 2 },
    innerTab:     { fontSize: 12, padding: '5px 14px', borderRadius: 6, border: `1px solid ${br2}`, background: 'transparent', color: tx1, cursor: 'pointer', fontFamily: "'Geist', sans-serif", transition: 'all .1s' },
    innerTabOn:   { background: bg2, color: tx0, fontWeight: 500, borderColor: br },
    tabCount:     { fontSize: 11, background: dark ? '#2a2a2a' : '#e5e7eb', color: tx1, padding: '1px 6px', borderRadius: 99, marginLeft: 4 },
    searchInput:  { fontSize: 12, padding: '0 10px', height: 30, borderRadius: 6, border: '1px solid ' + br2, background: bg2, color: tx0, fontFamily: "'Geist', sans-serif", outline: 'none', width: 160 },
    btnAdd:       { fontSize: 12, padding: '0 14px', height: 30, borderRadius: 6, border: 'none', background: 'linear-gradient(135deg, #D05C9F, #7E48C5, #3572E5)', color: '#f0f0f0', cursor: 'pointer', fontWeight: 500, fontFamily: "'Geist', sans-serif", whiteSpace: 'nowrap' },
    ccyWrap:      { display: 'flex', alignItems: 'center', gap: 6, height: 30, background: bg2, border: '1px solid ' + br2, borderRadius: 8, padding: '0 10px' },
    ccyLabel:     { fontSize: 11, color: tx1 },
    ccySel:       { fontSize: 12, fontWeight: 500, color: tx0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: "'Geist', sans-serif" },
    rateDot:      { width: 6, height: 6, borderRadius: '50%' },
    body:         { flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 },
    tableCard:    { background: bg1, border: '1px solid ' + br, borderRadius: 10, overflow: 'visible' },
    tblTop:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '1px solid ' + br },
    tblTitle:     { fontSize: 13, fontWeight: 500, color: tx0 },
    tbl:          { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' },
    th:           { fontSize: 11, fontWeight: 500, color: tx3, padding: '7px 14px', borderBottom: '1px solid ' + br, background: bg3, whiteSpace: 'nowrap' },
    td:           { fontSize: 12, color: tx2, padding: '9px 14px', borderBottom: '1px solid ' + (dark ? '#161616' : '#f0f0f0'), verticalAlign: 'middle' },
    tr:           { cursor: 'pointer', transition: 'background .1s' },
    trHover:      { background: dark ? '#1a1a1a' : '#f0f0f0' },
    trSim:        { background: dark ? '#161820' : '#f0f4ff' },
    trOpen:       { background: dark ? '#161820' : '#f0f4ff' },
    simDot:       { fontSize: 8, color: '#fbbf24' },
    badge:        { display: 'inline-block', fontSize: 11, padding: '2px 7px', borderRadius: 4, fontWeight: 500 },
    caseName:     { fontSize: 12, fontWeight: 500, color: dark ? '#e5e7eb' : '#111827', marginBottom: 2 },
    caseSub:      { fontSize: 11, color: tx1 },
    chip:         { fontSize: 11, color: tx1, background: bg2, padding: '2px 7px', borderRadius: 4 },
    amtNormal:    { fontSize: 12, color: tx2 },
    amtStrike:    { fontSize: 10, textDecoration: 'line-through', color: tx3, display: 'block', textAlign: 'right' },
    amtNew:       { fontSize: 12, fontWeight: 500, color: '#4ade80', display: 'block', textAlign: 'right' },
    confWrap:     { display: 'flex', alignItems: 'center', gap: 6 },
    confBg:       { width: 44, height: 3, background: br2, borderRadius: 2, overflow: 'hidden' },
    confFill:     { height: '100%', borderRadius: 2, transition: 'width .3s' },
    ownerChip:    { fontSize: 11, padding: '2px 7px', borderRadius: 4, background: bg2, color: tx4 },
    quarterChip:  { fontSize: 11, color: tx1 },
    chevron:      { fontSize: 12, color: tx3, transition: 'transform .2s', display: 'inline-block' },
    childRowBg:   { background: dark ? '#111318' : '#f5f3ff' },
    editPanel:    { background: dark ? '#0d0d12' : '#f8f7ff', borderTop: '1px solid #2a1f5c', padding: '16px 20px' },
    editGrid:     { display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12, marginBottom: 12 },
    editField:    { display: 'flex', flexDirection: 'column', gap: 4 },
    editLabel:    { fontSize: 11, color: tx1 },
    editInput:    { fontSize: 12, padding: '7px 9px', borderRadius: 6, border: '1px solid ' + br2, background: bg1, color: tx0, fontFamily: "'Geist', sans-serif", outline: 'none' },
    editSelect:   { fontSize: 12, padding: '7px 9px', borderRadius: 6, border: '1px solid ' + br2, background: bg1, color: tx0, fontFamily: "'Geist', sans-serif" },
    editHint:     { fontSize: 11, color: tx1 },
    statusRow:    { display: 'flex', gap: 5, flexWrap: 'wrap' },
    statusBtn:    { fontSize: 11, padding: '3px 9px', borderRadius: 5, border: '1px solid ' + br2, background: 'transparent', color: tx1, cursor: 'pointer', fontFamily: "'Geist', sans-serif", transition: 'all .1s' },
    deriveBtn:    { fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px dashed #2a1f5c', background: 'transparent', color: '#7E48C5', cursor: 'pointer', fontFamily: "'Geist', sans-serif", marginBottom: 10 },
    childEditBtn: { fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid #7E48C5', background: 'transparent', color: '#7E48C5', cursor: 'pointer', fontFamily: "'Geist', sans-serif" },
    childDelBtn:  { fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid #f87171', background: 'transparent', color: '#f87171', cursor: 'pointer', fontFamily: "'Geist', sans-serif" },
    childCard:    { background: dark ? '#0a0a14' : '#f0eeff', border: '1px solid #2a1f5c', borderRadius: 7, padding: '10px 12px', marginBottom: 8 },
    childHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    childBadge:   { fontSize: 10, padding: '1px 6px', borderRadius: 4, background: dark ? '#1e1635' : '#ede9fe', color: dark ? '#D05C9F' : '#7E48C5', fontWeight: 500 },
    childGrid:    { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 },
    btnRm:        { fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid ' + br2, background: 'transparent', color: tx1, cursor: 'pointer', fontFamily: "'Geist', sans-serif" },
    editFoot:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
    btnCancel:    { fontSize: 12, padding: '5px 14px', borderRadius: 6, border: '1px solid ' + br2, background: 'transparent', color: tx1, cursor: 'pointer', fontFamily: "'Geist', sans-serif" },
    btnApply:     { fontSize: 12, padding: '5px 16px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg, #D05C9F, #7E48C5, #3572E5)', color: '#f0f0f0', cursor: 'pointer', fontWeight: 500, fontFamily: "'Geist', sans-serif" },
    overlay:      { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
    diffModal:    { background: bg1, border: '1px solid #2a1f5c', borderRadius: 12, width: '100%', maxWidth: 540, overflow: 'hidden' },
    diffHeader:   { background: dark ? '#1e1635' : '#f5f3ff', padding: '13px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${dark ? '#2a1f5c' : '#e5e7eb'}` },
    diffTitle:    { fontSize: 13, fontWeight: 500, color: dark ? '#c4b5fd' : '#5b21b6' },
    diffClose:    { fontSize: 20, color: '#D05C9F', cursor: 'pointer', background: 'none', border: 'none', lineHeight: 1, fontFamily: "'Geist', sans-serif" },
    diffItem:     { padding: '13px 18px', borderBottom: '1px solid ' + br, display: 'flex', gap: 10, alignItems: 'flex-start' },
    diffChk:      { width: 16, height: 16, borderRadius: 4, border: '1px solid ' + br2, background: bg1, flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 10, color: tx0 },
    diffChkOn:    { background: '#7E48C5', borderColor: '#7E48C5' },
    diffName:     { fontSize: 12, fontWeight: 500, color: dark ? '#e5e7eb' : '#111827', marginBottom: 5 },
    diffCo:       { fontSize: 11, background: bg2, color: tx1, padding: '1px 6px', borderRadius: 3, marginLeft: 5 },
    diffRows:     { display: 'flex', flexDirection: 'column', gap: 3 },
    diffRow:      { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 },
    diffField:    { color: tx1, width: 44, flexShrink: 0 },
    diffBefore:   { color: '#f87171', textDecoration: 'line-through' },
    diffAfter:    { color: '#4ade80', fontWeight: 500 },
    diffFoot:     { padding: '12px 18px', background: bg3, display: 'flex', gap: 8, alignItems: 'center' },
    commitInp:    { flex: 1, fontSize: 12, padding: '7px 10px', borderRadius: 6, border: '1px solid ' + br2, background: bg1, color: tx0, fontFamily: "'Geist', sans-serif" },
    btnCommit:    { fontSize: 12, padding: '7px 16px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg, #D05C9F, #7E48C5, #3572E5)', color: '#f0f0f0', cursor: 'pointer', fontWeight: 500, fontFamily: "'Geist', sans-serif", whiteSpace: 'nowrap' },
  }
}
