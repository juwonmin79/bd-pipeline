import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../../supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import {
  FALLBACK_RATES, CCY_SYMS, CCY_LABELS,
  STATUS_STYLE, CATEGORY_STYLE,
  normalize, expandSearch, getAlias, fmtQuarter, COUNTRY_OPTIONS,
} from './constants'
import DealDrawer from './DealDrawer'
import ColumnFilter from './ColumnFilter'

// ── 모듈 스코프 스타일 캐시 (하위 컴포넌트 공유용) ──
let _styles = null

export default function ScenarioEditor({ darkMode, session, lastSeen }) {
  const [deals, setDeals]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [ccy, setCcy]                   = useState('KRW')
  const [rates, setRates]               = useState(FALLBACK_RATES)
  const [rateStatus, setRateStatus]     = useState('loading')
  const [ownerFilter, setOwnerFilter]   = useState('all')
  const [quarterRange, setQuarterRange] = useState({ start: 0, end: 3 })
  const [simChanges, setSimChanges]     = useState({})
  const [simChildren, setSimChildren]   = useState({})
  const [editingId, setEditingId]       = useState(null)
  const [diffOpen, setDiffOpen]         = useState(false)
  const [commitMsg, setCommitMsg]       = useState('')
  const [diffChecked, setDiffChecked]   = useState({})
  const [editingChild, setEditingChild] = useState(null)
  const [searchQuery, setSearchQuery]   = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter]     = useState('all')
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [toast, setToast]               = useState(null)
  const [owners, setOwners]             = useState([])
  const [drawerItem, setDrawerItem]     = useState(null)

  // ── 테이블 ColumnFilter 상태 ──
  const [cf, setCf]           = useState({ caseName:[], customer:[], quarter:[], status:[], owner:[] })
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState(null)
  const setFilter  = (key, val) => setCf(prev => ({ ...prev, [key]: val }))
  const handleSort = (key, dir) => { setSortKey(dir ? key : null); setSortDir(dir) }

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  const loadDeals = useCallback(async () => {
    setLoading(true)
    const [{ data, error }, { data: userData }] = await Promise.all([
      supabase.from('projects').select('*').eq('is_simulation', false).order('created_at', { ascending: true }),
      supabase.from('users').select('alias')
    ])
    if (error) { setError(error.message); setLoading(false); return }
    setDeals(data || [])
    setOwners((userData || []).map(u => u.alias).filter(Boolean))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (session !== undefined) loadDeals()
  }, [session, loadDeals])

  useEffect(() => {
    fetch('https://api.exchangerate-api.com/v4/latest/KRW')
      .then(r => r.json())
      .then(data => {
        setRates({ KRW: 1, USD: data.rates.USD, CNY: data.rates.CNY, JPY: data.rates.JPY, EUR: data.rates.EUR })
        setRateStatus('live')
      })
      .catch(() => { setRates(FALLBACK_RATES); setRateStatus('fallback') })
  }, [])

  const quarters = [...new Set(deals.map(d => d.quarter).filter(Boolean))].sort()
  const quartersKey = quarters.join(',')
  useEffect(() => {
    if (quarters.length > 0) setQuarterRange({ start: 0, end: quarters.length - 1 })
  }, [quartersKey])

  const filteredDeals = deals.filter(d => {
    if (ownerFilter !== 'all' && d.created_by !== ownerFilter) return false
    const qi = quarters.indexOf(d.quarter)
    if (quarters.length > 0 && (qi < quarterRange.start || qi > quarterRange.end)) return false
    if (categoryFilter !== 'all' && d.product_cat !== categoryFilter) return false
    if (statusFilter !== 'all' && d.status !== statusFilter) return false
    if (searchQuery.trim()) {
      const terms = expandSearch(searchQuery)
      const match = (s) => terms.some(t => normalize(s).includes(t))
      if (!match(d.case_name) && !match(d.customer)) return false
    }
    return true
  })

  const cvt   = (krw) => krw * rates[ccy]
  const fmtK  = (krw) => {
    if (!krw) return '—'
    const v = cvt(krw)
    const s = CCY_SYMS[ccy]
    if (ccy === 'KRW') return s + Math.round(v).toLocaleString() + 'K'
    if (ccy === 'JPY') return s + Math.round(v / 10).toLocaleString() + '万'
    return s + v.toFixed(1) + 'K'
  }

  // ── ColumnFilter opts + 2차 필터 + 정렬 ──
  const statusLabelMap = Object.fromEntries(Object.entries(STATUS_STYLE).map(([k,v]) => [k, v.label]))
  const cfOpts = {
    caseName: [...new Set(filteredDeals.map(d => d.case_name).filter(Boolean))].sort(),
    customer: [...new Set(filteredDeals.map(d => d.customer).filter(Boolean))].sort(),
    quarter:  [...new Set(filteredDeals.map(d => d.quarter).filter(Boolean))].sort().map(q => fmtQuarter(q)),
    status:   [...new Set(filteredDeals.map(d => d.status).filter(Boolean))].map(s => statusLabelMap[s] || s).sort(),
    owner:    [...new Set(filteredDeals.map(d => d.created_by).filter(Boolean))].sort(),
  }
  const tableDeals = filteredDeals.filter(d => {
    if (cf.caseName.length > 0 && !cf.caseName.includes(d.case_name)) return false
    if (cf.customer.length > 0 && !cf.customer.includes(d.customer)) return false
    if (cf.quarter.length  > 0 && !cf.quarter.includes(fmtQuarter(d.quarter))) return false
    if (cf.status.length   > 0 && !cf.status.includes(statusLabelMap[d.status] || d.status)) return false
    if (cf.owner.length    > 0 && !cf.owner.includes(d.created_by)) return false
    return true
  }).sort((a, b) => {
    if (!sortKey || !sortDir) return 0
    const mul = sortDir === 'asc' ? 1 : -1
    if (sortKey === 'book_amount') return ((a.book_amount||0) - (b.book_amount||0)) * mul
    if (sortKey === 'reflect')     return ((a.book_amount*a.probability/100) - (b.book_amount*b.probability/100)) * mul
    if (sortKey === 'probability') return ((a.probability||0) - (b.probability||0)) * mul
    if (sortKey === 'start_month') return String(a.start_month||'').localeCompare(String(b.start_month||'')) * mul
    if (sortKey === 'end_month')   return String(a.end_month||'').localeCompare(String(b.end_month||'')) * mul
    return 0
  })

  const simDealMap    = { ...Object.fromEntries(filteredDeals.map(d => [d.id, d])), ...simChanges }
  const activeForecast = Object.values(simDealMap)
    .filter(d => d.status === 'active')
    .reduce((s, d) => s + Math.round((d.book_amount * d.probability) / 100), 0)
  const wonAmount     = filteredDeals.filter(d => d.status === 'won').reduce((s, d) => s + (d.book_amount || 0), 0)
  const targetAmount  = filteredDeals.reduce((s, d) => s + (d.target_amount || 0), 0)
  const gap           = Math.max(0, targetAmount - activeForecast)
  const achieveRate   = targetAmount > 0 ? Math.round((activeForecast / targetAmount) * 100) : 0
  const hasSimChanges = Object.keys(simChanges).length > 0
  const simForecast   = hasSimChanges ? activeForecast : null
  const productCats   = [...new Set(deals.map(d => d.product_cat).filter(Boolean))].sort()

  const styles = useMemo(() => getStyles(darkMode), [darkMode])
  _styles = styles

  const applySimEdit = (id, updates) => {
    setSimChanges(prev => ({ ...prev, [id]: { ...deals.find(d => d.id === id), ...prev[id], ...updates } }))
    setDiffChecked(prev => ({ ...prev, [id]: true }))
    setEditingId(null)
  }

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
  }

  if (loading) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
      <div style={{ width:8, height:8, borderRadius:'50%', background:'#7c3aed' }} />
      <span style={{ fontSize:13, color:'#6b7280' }}>로딩 중...</span>
    </div>
  )

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background: darkMode ? '#0a0a0a' : '#f5f5f7', fontFamily:"'Geist', sans-serif" }}>

      {/* TOOLBAR */}
      <div style={styles.toolbar}>
        <button style={{ ...styles.btnAddProject, marginLeft:'auto' }} onClick={() => setAddProjectOpen(true)}>+ 프로젝트 추가</button>
        <input style={styles.searchInput} placeholder="프로젝트 / 고객사 검색" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        <div style={styles.ccyWrap}>
          <span style={styles.ccyLabel}>단위</span>
          <select style={styles.ccySel} value={ccy} onChange={e => setCcy(e.target.value)}>
            {['KRW','USD','CNY','JPY','EUR'].map(c => <option key={c} value={c}>{CCY_LABELS[c]}</option>)}
          </select>
          <div style={{ ...styles.rateDot, background: rateStatus==='live' ? '#4ade80' : rateStatus==='loading' ? '#fbbf24' : '#6b7280' }} />
          <span style={styles.rateLabel}>{rateStatus==='live' ? '실시간' : rateStatus==='loading' ? '...' : '기준값'}</span>
        </div>
      </div>

      {/* BODY */}
      <div style={styles.body}>
        {/* KPI */}
        <div style={styles.kpiRow}>
          <KpiCard dot="#4ade80" label="확정 매출" value={fmtK(wonAmount)} sub={`계약 ${filteredDeals.filter(d=>d.status==='won').length}건`} />
          <KpiCard dot="#60a5fa" label="예측 매출" value={fmtK(activeForecast)} sub="확도 반영 합산"
            sim={hasSimChanges ? { value: fmtK(simForecast) } : null} fmtK={fmtK} />
          <KpiCard dot="#fbbf24" label="사업계획 목표" value={fmtK(targetAmount)} sub="연간 합산" />
          <KpiCard dot="#f87171" label="갭 (부족)" value={fmtK(gap)} sub={`달성률 ${achieveRate}%`} isGap achieveRate={achieveRate} />
        </div>

        {/* CHART ROW */}
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr auto', gap:12 }}>
          {/* 목표 vs 실적 vs 포캐스트 */}
          <div style={{ background: darkMode?'#111':'#fff', border:`1px solid ${darkMode?'#1f1f1f':'#e2e2e2'}`, borderRadius:10, padding:'16px 18px' }}>
            <div style={{ fontSize:12, fontWeight:500, color: darkMode?'#e5e7eb':'#111827', marginBottom:3 }}>분기별 목표 vs 실적 vs 포캐스트</div>
            <div style={{ fontSize:11, color:'#6b7280', marginBottom:14 }}>확정 + 확률 반영 합산</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={quarters.slice(quarterRange.start, quarterRange.end+1).map(q => {
                const qDeals = filteredDeals.filter(d => d.quarter === q)
                return {
                  q: fmtQuarter(q),
                  target:   qDeals.reduce((s,d) => s+(d.target_amount||0), 0),
                  won:      qDeals.filter(d=>d.status==='won').reduce((s,d) => s+(d.book_amount||0), 0),
                  forecast: qDeals.filter(d=>d.status==='active').reduce((s,d) => s+Math.round((d.book_amount*d.probability)/100), 0),
                }
              })} barGap={2} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode?'#1f1f1f':'#f0f0f0'} vertical={false} />
                <XAxis dataKey="q" tick={{ fontSize:10, fill:'#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize:10, fill:'#6b7280' }} axisLine={false} tickLine={false} tickFormatter={v => v > 0 ? Math.round(v/1000)+'B' : '0'} width={32} />
                <Tooltip
                  contentStyle={{ background: darkMode?'#111':'#fff', border:`1px solid ${darkMode?'#2a2a2a':'#e5e7eb'}`, borderRadius:8, fontSize:11, fontFamily:"'Geist', sans-serif" }}
                  labelStyle={{ color:'#a78bfa', fontWeight:500, marginBottom:4 }}
                  itemStyle={{ color: darkMode?'#d1d5db':'#374151' }}
                  formatter={(v, name) => [v.toLocaleString()+'K', name]}
                />
                <Bar dataKey="target"   name="목표"    fill={darkMode?'#2a2a2a':'#d1d5db'} radius={[3,3,0,0]} maxBarSize={16} />
                <Bar dataKey="won"      name="확정"    fill="#7c3aed" radius={[3,3,0,0]} maxBarSize={16} />
                <Bar dataKey="forecast" name="포캐스트" fill="#a78bfa" radius={[3,3,0,0]} maxBarSize={16} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display:'flex', gap:14, marginTop:4 }}>
              {[['목표', darkMode?'#2a2a2a':'#d1d5db'],['확정','#7c3aed'],['포캐스트','#a78bfa']].map(([label,color]) => (
                <span key={label} style={{ fontSize:10, color:'#6b7280', display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ width:8, height:8, borderRadius:2, background:color, display:'inline-block' }} />{label}
                </span>
              ))}
            </div>
          </div>

          {/* GAP 차트 */}
          <div style={{ background: darkMode?'#111':'#fff', border:`1px solid ${darkMode?'#1f1f1f':'#e2e2e2'}`, borderRadius:10, padding:'16px 18px' }}>
            <div style={{ fontSize:12, fontWeight:500, color: darkMode?'#e5e7eb':'#111827', marginBottom:3 }}>분기별 GAP</div>
            <div style={{ fontSize:11, color:'#6b7280', marginBottom:14 }}>목표 대비 부족 / 초과</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={quarters.slice(quarterRange.start, quarterRange.end+1).map(q => {
                const qDeals = filteredDeals.filter(d => d.quarter === q)
                const target  = qDeals.reduce((s,d) => s+(d.target_amount||0), 0)
                const actual  = qDeals.filter(d=>d.status==='won').reduce((s,d) => s+(d.book_amount||0), 0)
                              + qDeals.filter(d=>d.status==='active').reduce((s,d) => s+Math.round((d.book_amount*d.probability)/100), 0)
                return { q: fmtQuarter(q), gap: actual - target }
              })} barCategoryGap="35%">
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode?'#1f1f1f':'#f0f0f0'} vertical={false} />
                <XAxis dataKey="q" tick={{ fontSize:10, fill:'#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize:10, fill:'#6b7280' }} axisLine={false} tickLine={false} tickFormatter={v => v > 0 ? '+'+Math.round(v/1000)+'B' : Math.round(v/1000)+'B'} width={38} />
                <Tooltip
                  contentStyle={{ background: darkMode?'#111':'#fff', border:`1px solid ${darkMode?'#2a2a2a':'#e5e7eb'}`, borderRadius:8, fontSize:11, fontFamily:"'Geist', sans-serif" }}
                  labelStyle={{ color:'#a78bfa', fontWeight:500, marginBottom:4 }}
                  formatter={(v) => [(v >= 0 ? '+' : '') + v.toLocaleString() + 'K', 'GAP']}
                  itemStyle={{ color: '#f0f0f0' }}
                />
                <ReferenceLine y={0} stroke={darkMode?'#2a2a2a':'#e5e7eb'} strokeWidth={1} />
                <Bar dataKey="gap" name="GAP" radius={[3,3,0,0]} maxBarSize={22}>
                  {quarters.slice(quarterRange.start, quarterRange.end+1).map((q, i) => {
                    const qDeals = filteredDeals.filter(d => d.quarter === q)
                    const target = qDeals.reduce((s,d) => s+(d.target_amount||0), 0)
                    const actual = qDeals.filter(d=>d.status==='won').reduce((s,d) => s+(d.book_amount||0), 0)
                                 + qDeals.filter(d=>d.status==='active').reduce((s,d) => s+Math.round((d.book_amount*d.probability)/100), 0)
                    return <Cell key={`gap-${i}`} fill={(actual-target) >= 0 ? '#16a34a' : '#dc2626'} opacity={0.85} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display:'flex', gap:14, marginTop:4 }}>
              {[['초과','#16a34a'],['부족','#dc2626']].map(([label,color]) => (
                <span key={label} style={{ fontSize:10, color:'#6b7280', display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ width:8, height:8, borderRadius:2, background:color, display:'inline-block' }} />{label}
                </span>
              ))}
            </div>
          </div>

          {/* 세로 분기 슬라이더 */}
          <div style={{ background: darkMode?'#111':'#fff', border:`1px solid ${darkMode?'#1f1f1f':'#e2e2e2'}`, borderRadius:10, padding:'16px 10px', display:'flex', flexDirection:'column', alignItems:'stretch', justifyContent:'center', minWidth:72 }}>
            <VerticalRangePicker quarters={quarters} range={quarterRange} onChange={setQuarterRange} darkMode={darkMode} />
          </div>
        </div>

        {/* DEAL TABLE */}
        <div style={styles.tblCard}>
          <div style={styles.tblTop}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={styles.tblTitle}>시나리오 모드</span>
              <span style={{ fontSize:11, color: darkMode?'#6b7280':'#6b7280', background: darkMode?'#1a1a1a':'#f0f0f0', padding:'2px 8px', borderRadius:99 }}>{Object.keys(simChanges).length}건 변경</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <button
                style={{ fontSize:11, padding:'1px 8px', borderRadius:4, border:`1px solid ${darkMode?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#f87171', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                onClick={() => { setSimChanges({}); setSimChildren({}) }}>
                폐기
              </button>
              <button
                style={{ fontSize:11, padding:'1px 8px', borderRadius:4, border:`1px solid ${darkMode?'#2a2a2a':'#e5e7eb'}`, background: darkMode?'#1e1635':'#ede9fe', color:'#7c3aed', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                onClick={() => setDiffOpen(true)}>
                확정 리뷰 →
              </button>
            </div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={styles.tbl}>
              <colgroup>
                <col style={{ width:'22%' }} /><col style={{ width:'8%' }} /><col style={{ width:'8%' }} />
                <col style={{ width:'9%' }} /><col style={{ width:'10%' }} /><col style={{ width:'11%' }} />
                <col style={{ width:'11%' }} /><col style={{ width:'9%' }} /><col style={{ width:'9%' }} />
                <col style={{ width:'3%' }} />
              </colgroup>
              <thead>
                <tr>
                  <ColumnFilter label="프로젝트 / 고객사" align="left"   options={cfOpts.caseName} value={cf.caseName} onChange={v => setFilter('caseName',v)} thStyle={styles.th} darkMode={darkMode} withSearch sortable={false} />
                  <ColumnFilter label="분기"     align="center" options={cfOpts.quarter}  value={cf.quarter}  onChange={v => setFilter('quarter',v)}  thStyle={styles.th} darkMode={darkMode} />
                  <ColumnFilter label="상태"     align="center" options={cfOpts.status}   value={cf.status}   onChange={v => setFilter('status',v)}   thStyle={styles.th} darkMode={darkMode} />
                  <ColumnFilter label="담당자"   align="center" options={cfOpts.owner}    value={cf.owner}    onChange={v => setFilter('owner',v)}    thStyle={styles.th} darkMode={darkMode} />
                  <ColumnFilter label="확도"     align="center" options={[]} value={[]} onChange={()=>{}} onSort={dir => handleSort('probability',dir)} sortDir={sortKey==='probability'?sortDir:null} thStyle={styles.th} darkMode={darkMode} sortable filterable={false} />
                  <ColumnFilter label="계약금액" align="right"  options={[]} value={[]} onChange={()=>{}} onSort={dir => handleSort('book_amount',dir)}  sortDir={sortKey==='book_amount'?sortDir:null}  thStyle={styles.th} darkMode={darkMode} sortable filterable={false} />
                  <ColumnFilter label="반영금액" align="right"  options={[]} value={[]} onChange={()=>{}} onSort={dir => handleSort('reflect',dir)}       sortDir={sortKey==='reflect'?sortDir:null}       thStyle={styles.th} darkMode={darkMode} sortable filterable={false} />
                  <ColumnFilter label="착수"     align="center" options={[]} value={[]} onChange={()=>{}} onSort={dir => handleSort('start_month',dir)}   sortDir={sortKey==='start_month'?sortDir:null}   thStyle={styles.th} darkMode={darkMode} sortable filterable={false} />
                  <ColumnFilter label="종료"     align="center" options={[]} value={[]} onChange={()=>{}} onSort={dir => handleSort('end_month',dir)}     sortDir={sortKey==='end_month'?sortDir:null}     thStyle={styles.th} darkMode={darkMode} sortable filterable={false} />
                  <th style={{ ...styles.th, textAlign:'center' }}></th>
                </tr>
              </thead>
              <tbody>
                {tableDeals.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding:'32px', textAlign:'center', color:'#6b7280', fontSize:13 }}>데이터가 없습니다</td></tr>
                ) : tableDeals.map(deal => {
                  const d = simChanges[deal.id] || deal
                  const isSim = !!simChanges[deal.id]
                  const isOpen = editingId === deal.id
                  return [
                    <DealRow key={deal.id} deal={d} orig={deal} isSim={isSim} isOpen={isOpen} mode="sim"
                      fmtK={fmtK} lastSeen={lastSeen}
                      onToggle={() => setEditingId(isOpen ? null : deal.id)} />,
                    isOpen && (
                      <tr key={deal.id+'-edit'}>
                        <td colSpan={10} style={{ padding:0 }}>
                          <EditPanel deal={d} fmtK={fmtK} quarters={quarters} owners={owners} productCats={productCats}
                            onApply={(updates) => applySimEdit(deal.id, updates)}
                            onCancel={() => setEditingId(null)}
                            onAddChild={(child) => setSimChildren(prev => ({ ...prev, [deal.id]: [...(prev[deal.id]||[]), child] }))} />
                        </td>
                      </tr>
                    ),
                    ...(simChildren[deal.id]||[]).map((c, ci) => [
                      <ChildRow key={deal.id+'-child-'+ci} child={c} deal={d} fmtK={fmtK}
                        onEdit={() => setEditingChild({ dealId: deal.id, ci })}
                        onDelete={() => setSimChildren(prev => ({ ...prev, [deal.id]: prev[deal.id].filter((_,j) => j !== ci) }))} />,
                      editingChild?.dealId === deal.id && editingChild?.ci === ci && (
                        <tr key={deal.id+'-child-edit-'+ci}>
                          <td colSpan={10} style={{ padding:0 }}>
                            <ChildEditPanel child={c} quarters={quarters} fmtK={fmtK}
                              onApply={(updated) => {
                                setSimChildren(prev => ({ ...prev, [deal.id]: prev[deal.id].map((x,j) => j===ci ? {...x,...updated} : x) }))
                                setEditingChild(null)
                              }}
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
      </div>

      {/* DIFF MODAL */}
      {diffOpen && (
        <div style={styles.overlay}>
          <div style={styles.diffModal}>
            <div style={styles.diffHeader}>
              <span style={styles.diffTitle}>확정 리뷰 — 커밋할 변경 선택</span>
              <button style={styles.diffClose} onClick={() => setDiffOpen(false)}>×</button>
            </div>
            {Object.entries(simChanges).map(([id, changed]) => {
              const orig = deals.find(d => d.id === id)
              if (!orig) return null
              return (
                <div key={id} style={styles.diffItem}>
                  <div style={{ ...styles.diffChk, ...(diffChecked[id] ? styles.diffChkOn : {}) }}
                    onClick={() => setDiffChecked(prev => ({ ...prev, [id]: !prev[id] }))}>
                    {diffChecked[id] && '✓'}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={styles.diffName}>{orig.case_name} <span style={styles.diffCo}>{orig.customer}</span></div>
                    <div style={styles.diffRows}>
                      {changed.case_name !== orig.case_name && <DiffRow field="프로젝트명" before={orig.case_name} after={changed.case_name} />}
                      {changed.book_amount !== orig.book_amount && <DiffRow field="금액" before={fmtK(orig.book_amount)} after={fmtK(changed.book_amount)} />}
                      {changed.probability !== orig.probability && <DiffRow field="확도" before={orig.probability+'%'} after={changed.probability+'%'} />}
                      {changed.quarter !== orig.quarter && <DiffRow field="분기" before={fmtQuarter(orig.quarter)} after={fmtQuarter(changed.quarter)} />}
                      {changed.status !== orig.status && <DiffRow field="상태" before={STATUS_STYLE[orig.status]?.label || orig.status} after={STATUS_STYLE[changed.status]?.label || changed.status} />}
                    </div>
                  </div>
                </div>
              )
            })}
            <div style={styles.diffFoot}>
              <input style={styles.commitInp} value={commitMsg} onChange={e => setCommitMsg(e.target.value)} placeholder="커밋 메시지" />
              <button style={styles.btnCommit} onClick={doCommit}>커밋 적용</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD PROJECT MODAL */}
      {addProjectOpen && (
        <AddProjectModal quarters={quarters} owners={owners} productCats={productCats}
          session={session} darkMode={darkMode}
          onClose={() => setAddProjectOpen(false)}
          onSaved={() => { setAddProjectOpen(false); loadDeals() }} />
      )}

      {/* DRAWER */}
      {drawerItem && (
        <DealDrawer
          item={drawerItem}
          darkMode={darkMode}
          session={session}
          fmtK={fmtK}
          showDrop={false}
          productCats={productCats}
          quarters={quarters}
          onClose={() => setDrawerItem(null)}
          onRefreshDeals={loadDeals}
        />
      )}

      {/* 토스트 */}
      {toast && (
        <div style={{
          position:'fixed', bottom:24, right:24, zIndex:9999,
          background: toast.type==='info' ? (darkMode ? '#0f2010' : '#f0fdf4') : (darkMode ? '#1e1635' : '#ede9fe'),
          border: `1px solid ${toast.type==='info' ? '#4ade80' : '#7c3aed'}`,
          color: toast.type==='info' ? (darkMode ? '#4ade80' : '#16a34a') : (darkMode ? '#c4b5fd' : '#5b21b6'),
          padding:'10px 18px', borderRadius:8, fontSize:13, fontWeight:500, fontFamily:"'Geist', sans-serif",
        }}>{toast.msg}</div>
      )}
    </div>
  )
}

// ── KPI 카드 ──────────────────────────────────────────
function KpiCard({ dot, label, value, sub, sim, fmtK, isGap, achieveRate }) {
  const gapColor = isGap ? (achieveRate >= 90 ? '#4ade80' : achieveRate >= 70 ? '#fbbf24' : '#f87171') : null
  return (
    <div style={_styles.kpi}>
      <div style={_styles.kpiTop}>
        <div style={{ ..._styles.kpiDot, background: gapColor || dot }} />
        <span style={_styles.kpiLabel}>{label}</span>
      </div>
      <div style={{ ..._styles.kpiVal, ...(gapColor ? { color: gapColor } : {}) }}>{value}</div>
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

// ── 딜 행 ─────────────────────────────────────────────
function DealRow({ deal, orig, isSim, isOpen, mode, fmtK, onToggle, lastSeen }) {
  const st = STATUS_STYLE[deal.status] || STATUS_STYLE.active
  const amtChanged      = isSim && deal.book_amount !== orig.book_amount
  const confChanged     = isSim && deal.probability !== orig.probability
  const origReflect     = Math.round((orig.book_amount * orig.probability) / 100)
  const newReflect      = Math.round((deal.book_amount * deal.probability) / 100)
  const reflectChanged  = isSim && (amtChanged || confChanged)
  const confPct         = deal.probability || 0
  const confColor       = confPct >= 100 ? '#4ade80' : confPct >= 60 ? '#60a5fa' : confPct >= 30 ? '#fbbf24' : '#4b5563'
  const isNew           = lastSeen && deal.created_at && new Date(deal.created_at) > new Date(lastSeen)
  return (
    <tr style={{ ..._styles.tr, ...(isSim ? _styles.trSim : {}), ...(isOpen ? _styles.trOpen : {}), boxShadow: isNew ? 'inset 3px 0 0 #7c3aed' : 'none' }}
      onClick={onToggle}
      onMouseEnter={e => { if(!isOpen) e.currentTarget.style.background = _styles.trHover.background }}
      onMouseLeave={e => { e.currentTarget.style.background = isSim ? _styles.trSim.background : 'transparent' }}>
      <td style={_styles.td}><div style={_styles.caseName}>{deal.case_name}</div><div style={_styles.caseSub}>{deal.customer}</div></td>
      <td style={{ ..._styles.td, textAlign:'center' }}><span style={_styles.quarterChip}>{fmtQuarter(deal.quarter)}</span></td>
      <td style={{ ..._styles.td, textAlign:'center' }}><span style={{ ..._styles.badge, background:st.bg, color:st.color }}>{st.label}</span></td>
      <td style={{ ..._styles.td, textAlign:'center' }}><span style={_styles.ownerChip}>{deal.created_by || '—'}</span></td>
      <td style={{ ..._styles.td, textAlign:'center' }}>
        <div style={{ ..._styles.confWrap, justifyContent:'center' }}>
          <div style={_styles.confBg}><div style={{ ..._styles.confFill, width:confPct+'%', background:confColor }} /></div>
          <span style={{ fontSize:11, color:'#9ca3af' }}>{confPct}%</span>
        </div>
      </td>
      <td style={{ ..._styles.td, textAlign:'right' }}>
        {amtChanged ? <><span style={_styles.amtStrike}>{fmtK(orig.book_amount)}</span><span style={_styles.amtNew}>{fmtK(deal.book_amount)}</span></> : <span style={_styles.amtNormal}>{fmtK(deal.book_amount)}</span>}
      </td>
      <td style={{ ..._styles.td, textAlign:'right' }}>
        {deal.status === 'drop' ? <span style={{ ..._styles.amtNormal, color:'#9ca3af' }}>—</span>
          : reflectChanged ? <><span style={_styles.amtStrike}>{fmtK(origReflect)}</span><span style={_styles.amtNew}>{fmtK(newReflect)}</span></>
          : <span style={_styles.amtNormal}>{fmtK(deal.reflected_amount || newReflect)}</span>}
      </td>
      <td style={{ ..._styles.td, textAlign:'center' }}><span style={_styles.quarterChip}>{deal.start_month || '—'}</span></td>
      <td style={{ ..._styles.td, textAlign:'center' }}><span style={_styles.quarterChip}>{deal.end_month || '—'}</span></td>
      <td style={{ ..._styles.td, textAlign:'center' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
          <span style={{ ..._styles.chevron, transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
          {isSim && <span style={_styles.simDot} title="시뮬 변경">●</span>}
        </div>
      </td>
    </tr>
  )
}

// ── 인라인 편집 패널 ──────────────────────────────────
function EditPanel({ deal, fmtK, quarters, owners, productCats, onApply, onCancel, onAddChild }) {
  const [caseName, setCaseName]         = useState(deal.case_name || '')
  const [customer, setCustomer]         = useState(deal.customer || '')
  const [category, setCategory]         = useState(deal.category || 'Pick')
  const [productCat, setProductCat]     = useState(deal.product_cat || '')
  const [country, setCountry]           = useState(deal.country || 'KR')
  const [contractMonth, setContractMonth] = useState(deal.contract_month || '')
  const [startMonth, setStartMonth]     = useState(deal.start_month || '')
  const [endMonth, setEndMonth]         = useState(deal.end_month || '')
  const [comment, setComment]           = useState(deal.comment || '')
  const [amt, setAmt]                   = useState(deal.book_amount || 0)
  const [conf, setConf]                 = useState(deal.probability || 0)
  const [quarter, setQuarter]           = useState(deal.quarter || '')
  const [status, setStatus]             = useState(deal.status || 'active')
  const [createdBy, setCreatedBy]       = useState(deal.created_by || '')
  const [children, setChildren]         = useState([])
  const reflect = Math.round(amt * conf / 100)
  const STATUS_OPTS = [['active','진행중','#60a5fa'],['won','계약','#4ade80'],['drop','드랍','#f87171'],['pending','대기','#fbbf24']]
  return (
    <div style={_styles.editPanel}>
      <div style={{ ..._styles.editGrid, gridTemplateColumns:'repeat(4,minmax(0,1fr))', marginBottom:10 }}>
        <div style={_styles.editField}><label style={_styles.editLabel}>프로젝트명</label><input style={_styles.editInput} value={caseName} onChange={e => setCaseName(e.target.value)} /></div>
        <div style={_styles.editField}><label style={_styles.editLabel}>고객사</label><input style={_styles.editInput} value={customer} onChange={e => setCustomer(e.target.value)} /></div>
        <div style={_styles.editField}><label style={_styles.editLabel}>고객사 국가</label><select style={_styles.editSelect} value={country} onChange={e => setCountry(e.target.value)}><option value="">선택</option>{COUNTRY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select></div>
        <div style={_styles.editField}><label style={_styles.editLabel}>제품구분</label>
          <select style={_styles.editSelect}
            value={productCats.includes(productCat) ? productCat : '__other__'}
            onChange={e => setProductCat(e.target.value === '__other__' ? '' : e.target.value)}>
            <option value="">선택</option>
            {productCats.map(c => <option key={c} value={c}>{c}</option>)}
            <option value="__other__">기타 (직접 입력)</option>
          </select>
          {!productCats.includes(productCat) && (
            <input style={{ ..._styles.editInput, marginTop:4 }} value={productCat} onChange={e => setProductCat(e.target.value)} placeholder="제품구분 입력" autoFocus />
          )}
        </div>
      </div>
      <div style={{ ..._styles.editGrid, gridTemplateColumns:'repeat(4,minmax(0,1fr))', marginBottom:10 }}>
        <div style={_styles.editField}><label style={_styles.editLabel}>분기</label>
          <select style={_styles.editSelect} value={quarter} onChange={e => setQuarter(e.target.value)}>
            {quarters.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div style={_styles.editField}><label style={_styles.editLabel}>예상 계약월</label><input style={_styles.editInput} value={contractMonth} onChange={e => setContractMonth(e.target.value)} type="month" /></div>
        <div style={_styles.editField}><label style={_styles.editLabel}>확률 (%)</label><input style={_styles.editInput} type="number" value={conf} min={0} max={100} onChange={e => setConf(Number(e.target.value))} /></div>
        <div style={_styles.editField}><label style={_styles.editLabel}>계약금액 (K KRW)</label><input style={_styles.editInput} type="number" value={amt} step={1000} onChange={e => setAmt(Number(e.target.value))} /><span style={_styles.editHint}>반영: {fmtK(reflect)}</span></div>
      </div>
      <div style={{ ..._styles.editGrid, gridTemplateColumns:'1fr 1fr 1fr 2fr', marginBottom:10 }}>
        <div style={_styles.editField}><label style={_styles.editLabel}>착수월</label><input style={_styles.editInput} value={startMonth} onChange={e => setStartMonth(e.target.value)} type="month" /></div>
        <div style={_styles.editField}><label style={_styles.editLabel}>종료월</label><input style={_styles.editInput} value={endMonth} onChange={e => setEndMonth(e.target.value)} type="month" /></div>
        <div style={_styles.editField}><label style={_styles.editLabel}>담당자</label>
          <select style={_styles.editSelect} value={createdBy} onChange={e => setCreatedBy(e.target.value)}>
            {owners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div style={_styles.editField}><label style={_styles.editLabel}>상태</label>
          <div style={_styles.statusRow}>
            {STATUS_OPTS.map(([val,label,color]) => (
              <button key={val} style={{ ..._styles.statusBtn, ...(status===val ? {borderColor:color,color:color,background:color+'18'} : {}) }} onClick={() => setStatus(val)}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginBottom:12 }}>
        <label style={_styles.editLabel}>코멘트</label>
        <textarea style={{ ..._styles.editInput, width:'100%', minHeight:60, resize:'vertical', marginTop:4, boxSizing:'border-box' }} value={comment} onChange={e => setComment(e.target.value)} />
      </div>
      <button style={_styles.deriveBtn} onClick={() => setChildren(prev => [...prev, { amt:0, conf:40, quarter:quarters[0]||'2025-Q1' }])}>+ child case 추가</button>
      {children.map((c, i) => (
        <div key={i} style={_styles.childCard}>
          <div style={_styles.childHeader}><span style={_styles.childBadge}>child case {i+1}</span><button style={_styles.btnRm} onClick={() => setChildren(prev => prev.filter((_,j)=>j!==i))}>삭제</button></div>
          <div style={_styles.childGrid}>
            <div style={_styles.editField}><label style={_styles.editLabel}>금액 (K)</label><input style={_styles.editInput} type="number" value={c.amt} onChange={e => setChildren(prev => prev.map((x,j) => j===i ? {...x,amt:Number(e.target.value)} : x))} /></div>
            <div style={_styles.editField}><label style={_styles.editLabel}>분기</label>
              <select style={_styles.editSelect} value={c.quarter} onChange={e => setChildren(prev => prev.map((x,j) => j===i ? {...x,quarter:e.target.value} : x))}>
                {[...quarters,'2026-Q3','2026-Q4','2027-Q1'].map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
            <div style={_styles.editField}><label style={_styles.editLabel}>확도 (%)</label><input style={_styles.editInput} type="number" value={c.conf} min={0} max={100} onChange={e => setChildren(prev => prev.map((x,j) => j===i ? {...x,conf:Number(e.target.value)} : x))} /></div>
          </div>
        </div>
      ))}
      <div style={_styles.editFoot}>
        <span style={{ fontSize:11, color:'#6b7280' }}>커밋 전까지 실제 DB 불변</span>
        <div style={{ display:'flex', gap:8 }}>
          <button style={_styles.btnCancel} onClick={onCancel}>취소</button>
          <button style={_styles.btnApply} onClick={() => { children.forEach(c => onAddChild(c)); onApply({ case_name:caseName, customer, category, product_cat:productCat, country, contract_month:contractMonth, start_month:startMonth, end_month:endMonth, comment, book_amount:amt, probability:conf, quarter, status, created_by:createdBy }) }}>시뮬에 반영</button>
        </div>
      </div>
    </div>
  )
}

// ── Child 편집 패널 ───────────────────────────────────
function ChildEditPanel({ child, quarters, fmtK, onApply, onCancel }) {
  const [amt, setAmt]       = useState(child.amt || 0)
  const [conf, setConf]     = useState(child.conf || 40)
  const [quarter, setQuarter] = useState(child.quarter || '')
  const reflect = Math.round(amt * conf / 100)
  return (
    <div style={{ ..._styles.editPanel, borderTop:'1px solid #2a1f5c', borderLeft:'4px solid #7c3aed' }}>
      <div style={{ fontSize:11, color:'#a78bfa', marginBottom:10, fontWeight:500 }}>↳ Child 딜 수정</div>
      <div style={_styles.editGrid}>
        <div style={_styles.editField}><label style={_styles.editLabel}>금액 (K)</label><input style={_styles.editInput} type="number" value={amt} onChange={e => setAmt(Number(e.target.value))} /><span style={_styles.editHint}>반영: {fmtK(reflect)}</span></div>
        <div style={_styles.editField}><label style={_styles.editLabel}>확도 (%)</label><input style={_styles.editInput} type="number" value={conf} min={0} max={100} onChange={e => setConf(Number(e.target.value))} /></div>
        <div style={_styles.editField}><label style={_styles.editLabel}>분기</label>
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

// ── Child 행 ──────────────────────────────────────────
function ChildRow({ child, deal, fmtK, onEdit, onDelete }) {
  return (
    <tr style={_styles.childRowBg}>
      <td style={_styles.td}><div style={{ paddingLeft:12 }}><span style={{ fontSize:11, color:'#a78bfa', marginRight:4 }}>↳</span><span style={{ ..._styles.caseName, display:'inline' }}>{deal.case_name}</span><div style={{ ..._styles.caseSub, color:'#7c6db0' }}>잔여분</div></div></td>
      <td style={{ ..._styles.td, textAlign:'center' }}><span style={{ ..._styles.quarterChip, color:'#a78bfa' }}>{fmtQuarter(child.quarter)}</span></td>
      <td style={{ ..._styles.td, textAlign:'center' }}><span style={{ ..._styles.badge, background:'rgba(167,139,250,0.15)', color:'#7c3aed', fontSize:10 }}>child</span></td>
      <td style={{ ..._styles.td, textAlign:'center' }} /><td style={{ ..._styles.td, textAlign:'center' }}><span style={{ fontSize:11, color:'#9ca3af' }}>{child.conf}%</span></td>
      <td style={{ ..._styles.td, textAlign:'right', color:'#a78bfa', fontWeight:500 }}>{fmtK(child.amt)}</td>
      <td style={{ ..._styles.td, textAlign:'right', color:'#a78bfa' }}>{fmtK(Math.round(child.amt*child.conf/100))}</td>
      <td style={_styles.td} /><td style={_styles.td} />
      <td style={_styles.td}>
        <div style={{ display:'flex', gap:4 }}>
          {onEdit && <button style={_styles.childEditBtn} onClick={onEdit}>수정</button>}
          {onDelete && <button style={_styles.childDelBtn} onClick={onDelete}>삭제</button>}
        </div>
      </td>
    </tr>
  )
}

// ── Diff Row ──────────────────────────────────────────
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

// ── 세로 분기 슬라이더 ────────────────────────────────
function VerticalRangePicker({ quarters, range, onChange, darkMode }) {
  const trackRef = useRef(null)
  const dragging = useRef(null)
  if (quarters.length === 0) return null

  const pct = i => quarters.length <= 1 ? 0 : (i / (quarters.length - 1)) * 100
  // 세로: 위=end(최신/26년), 아래=start(과거/25년) — top%는 반전
  const topPct = i => 100 - pct(i)

  const posToIdx = (clientY) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    // 위가 end(최신)이므로 반전
    return Math.round((1 - ratio) * (quarters.length - 1))
  }

  const onMouseDown = (handle) => (e) => {
    e.preventDefault(); dragging.current = handle
    const move = (ev) => {
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY
      const idx = posToIdx(y)
      if (dragging.current === 'start') onChange({ start: Math.min(idx, range.end), end: range.end })
      else onChange({ start: range.start, end: Math.max(idx, range.start) })
    }
    const up = () => { dragging.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    window.addEventListener('touchmove', move); window.addEventListener('touchend', up)
  }

  const fmtLabel = (q) => q ? q.split('-')[0].replace('20','y') : ''
  const br = darkMode ? '#2a2a2a' : '#e2e2e2'
  const qLabelColor = darkMode ? '#4b5563' : '#9ca3af'

  return (
    <div style={{ display:'flex', gap:6, alignItems:'stretch', width:'100%' }}>
      {/* 분기 레이블 — 왼쪽 */}
      <div style={{ display:'flex', flexDirection:'column', justifyContent:'space-between', minHeight:140 }}>
        {[...quarters].reverse().map((q, i) => {
          const origIdx = quarters.length - 1 - i
          const active = origIdx >= range.start && origIdx <= range.end
          return (
            <span key={q} style={{ fontSize:9, color: active ? '#a78bfa' : qLabelColor, fontWeight: active ? 500 : 400, textAlign:'right', lineHeight:1 }}>
              {q.split('-')[1]?.toLowerCase()}
            </span>
          )
        })}
      </div>
      {/* 트랙 + 핸들 */}
      <div style={{ position:'relative', flex:1 }}>
        <div ref={trackRef}
          style={{ position:'absolute', left:'50%', transform:'translateX(-50%)', width:2, top:0, bottom:0, background:br, borderRadius:2, cursor:'pointer' }}
          onClick={e => { const idx = posToIdx(e.clientY); if (Math.abs(idx-range.end) <= Math.abs(idx-range.start)) onChange({ start: range.start, end: Math.max(idx, range.start) }); else onChange({ start: Math.min(idx, range.end), end: range.end }) }}>
          {/* 선택 구간 */}
          <div style={{ position:'absolute', left:0, width:'100%', top: topPct(range.end)+'%', height: (topPct(range.start) - topPct(range.end))+'%', background:'#7c3aed', borderRadius:2, pointerEvents:'none' }} />
        </div>
        {/* 핸들 — 트랙 위에 absolute, 카드 너비 안에서 중앙 정렬 */}
        {['end','start'].map(h => {
          const idx = h === 'start' ? range.start : range.end
          return (
            <div key={h} onMouseDown={onMouseDown(h)} onTouchStart={onMouseDown(h)}
              style={{ position:'absolute', left:'50%', top: topPct(idx)+'%', transform:'translate(-50%,-50%)', height:18, minWidth:32, paddingInline:6, borderRadius:9, background:'#7c3aed', cursor:'grab', zIndex:2, boxShadow:'0 1px 4px rgba(0,0,0,0.25)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <span style={{ fontSize:9, fontWeight:600, color:'#fff', whiteSpace:'nowrap', pointerEvents:'none' }}>{fmtLabel(quarters[idx])}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── QuarterRangePicker ────────────────────────────────
function QuarterRangePicker({ quarters, range, onChange }) {
  const trackRef = useRef(null)
  const dragging = useRef(null)
  if (quarters.length === 0) return <span style={{ fontSize:12, color:'#6b7280' }}>분기 데이터 없음</span>
  const pct = i => quarters.length <= 1 ? 0 : (i / (quarters.length - 1)) * 100
  const posToIdx = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(ratio * (quarters.length - 1))
  }
  const onMouseDown = (handle) => (e) => {
    e.preventDefault(); dragging.current = handle
    const move = (ev) => {
      const x = ev.touches ? ev.touches[0].clientX : ev.clientX
      const idx = posToIdx(x)
      if (dragging.current === 'start') onChange({ start: Math.min(idx, range.end), end: range.end })
      else onChange({ start: range.start, end: Math.max(idx, range.start) })
    }
    const up = () => { dragging.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    window.addEventListener('touchmove', move); window.addEventListener('touchend', up)
  }
  const fmtTop = (q) => q ? q.split('-')[0].replace('20','y') + '·' + q.split('-')[1]?.toLowerCase() : ''
  const fmtBot = (q) => q.split('-')[1]?.toLowerCase()
  return (
    <div style={{ ..._styles.qrWrap, gap:0 }}>
      <div style={{ display:'flex', flexDirection:'column', gap:0, minWidth:220 }}>
        <div ref={trackRef} style={{ position:'relative', height:2, background:_styles.qrTrack.background, borderRadius:2, margin:'10px 0', cursor:'pointer' }}
          onClick={e => { const idx = posToIdx(e.clientX); if (Math.abs(idx-range.start) <= Math.abs(idx-range.end)) onChange({ start: Math.min(idx,range.end), end: range.end }); else onChange({ start: range.start, end: Math.max(idx,range.start) }) }}>
          <div style={{ position:'absolute', top:0, height:'100%', left: pct(range.start)+'%', width: (pct(range.end)-pct(range.start))+'%', background:'#7c3aed', borderRadius:2, pointerEvents:'none' }} />
          {['start','end'].map(h => {
            const idx = h === 'start' ? range.start : range.end
            return (
              <div key={h} onMouseDown={onMouseDown(h)} onTouchStart={onMouseDown(h)}
                style={{ position:'absolute', top:'50%', left: pct(idx)+'%', transform:'translate(-50%,-50%)', height:18, minWidth:32, paddingInline:6, borderRadius:9, background:'#7c3aed', cursor:'grab', zIndex:2, boxShadow:'0 1px 4px rgba(0,0,0,0.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <span style={{ fontSize:9, fontWeight:600, color:'#fff', whiteSpace:'nowrap', pointerEvents:'none' }}>{fmtTop(quarters[idx])}</span>
              </div>
            )
          })}
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:2 }}>
          {quarters.map((q, i) => <span key={q} style={{ fontSize:9, fontWeight: i>=range.start&&i<=range.end ? 500 : 400, color: i>=range.start&&i<=range.end ? '#a78bfa' : _styles.qrQLbl.color, minWidth:0, textAlign:'center' }}>{fmtBot(q)}</span>)}
        </div>
      </div>
    </div>
  )
}

// ── AddProjectModal ───────────────────────────────────
function AddProjectModal({ quarters, owners, productCats, session, darkMode, onClose, onSaved }) {
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState(null)
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
  const STATUS_OPTS = [['active','진행중','#60a5fa'],['won','계약','#4ade80'],['pending','대기','#fbbf24'],['drop','드랍','#f87171']]
  const handleSave = async () => {
    if (!caseName.trim()) { setError('프로젝트명을 입력해주세요'); return }
    setSaving(true); setError(null)
    const { error } = await supabase.from('projects').insert({
      case_name:caseName, customer, product_cat: productCat.replace('\u200b','').trim() || null, country, quarter, status,
      book_amount:amt, probability:conf, start_month:startMonth||null, end_month:endMonth||null,
      contract_month:contractMonth||null, comment, created_by:createdBy||getAlias(session),
      is_simulation:false, created_at:new Date().toISOString(), updated_at:new Date().toISOString()
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved()
  }
  const dk = darkMode
  const modalBg = dk?'#111':'#ffffff', modalBdr = dk?'#2a1f5c':'#e5e7eb'
  const headerBg = dk?'#1e1635':'#f5f3ff', titleClr = dk?'#c4b5fd':'#5b21b6'
  const footerBg = dk?'#0d0d0d':'#f9fafb', inactiveBdr = dk?'#2a2a2a':'#e5e7eb'
  const inp = { fontSize:12, padding:'7px 9px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:dk?'#1a1a1a':'#f9fafb', color:dk?'#f0f0f0':'#111827', fontFamily:"'Geist', sans-serif", outline:'none', width:'100%', boxSizing:'border-box' }
  const lbl = { fontSize:11, color:'#6b7280', marginBottom:4, display:'block' }
  const field = { display:'flex', flexDirection:'column', gap:3 }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 }}>
      <div style={{ background:modalBg, border:`1px solid ${modalBdr}`, borderRadius:12, width:'100%', maxWidth:640, overflow:'hidden', fontFamily:"'Geist', sans-serif" }}>
        <div style={{ background:headerBg, padding:'13px 18px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:`1px solid ${modalBdr}` }}>
          <span style={{ fontSize:13, fontWeight:500, color:titleClr }}>+ 프로젝트 추가</span>
          <button onClick={onClose} style={{ fontSize:20, color:'#7c3aed', cursor:'pointer', background:'none', border:'none', lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:'20px 20px 0' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:12, marginBottom:14 }}>
            <div style={field}><label style={lbl}>프로젝트명 *</label><input style={inp} value={caseName} onChange={e => setCaseName(e.target.value)} /></div>
            <div style={field}><label style={lbl}>고객사</label><input style={inp} value={customer} onChange={e => setCustomer(e.target.value)} /></div>
            <div style={field}><label style={lbl}>고객사 국가</label><select style={{...inp}} value={country} onChange={e => setCountry(e.target.value)}><option value="">선택</option>{COUNTRY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select></div>
            <div style={field}><label style={lbl}>제품구분</label>
              <select style={{...inp}}
                value={productCats.includes(productCat) ? productCat : '__other__'}
                onChange={e => {
                  if (e.target.value === '__other__') setProductCat('\u200b')  // 빈 string 대신 zero-width space로 기타 상태 표시
                  else setProductCat(e.target.value)
                }}>
                <option value="__other__">선택</option>
                {(productCats||[]).map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__other__">기타 (직접 입력)</option>
              </select>
              {!productCats.includes(productCat) && productCat !== '' && (
                <input style={{...inp, marginTop:4}}
                  value={productCat === '\u200b' ? '' : productCat}
                  onChange={e => setProductCat(e.target.value || '\u200b')}
                  placeholder="제품구분 입력" autoFocus />
              )}
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,minmax(0,1fr))', gap:12, marginBottom:14 }}>
            <div style={field}><label style={lbl}>분기</label><select style={{...inp}} value={quarter} onChange={e => setQuarter(e.target.value)}>{[...quarters,'2026-Q1','2026-Q2','2026-Q3','2026-Q4'].filter((v,i,a)=>a.indexOf(v)===i).map(q => <option key={q} value={q}>{q}</option>)}</select></div>
            <div style={field}><label style={lbl}>예상 계약월</label><input style={inp} type="month" value={contractMonth} onChange={e => setContractMonth(e.target.value)} /></div>
            <div style={field}><label style={lbl}>확률 (%)</label><input style={inp} type="number" min={0} max={100} value={conf} onChange={e => setConf(Number(e.target.value))} /></div>
            <div style={field}><label style={lbl}>계약금액 (K KRW)</label><input style={inp} type="number" step={1000} value={amt} onChange={e => setAmt(Number(e.target.value))} /></div>
            <div style={field}><label style={lbl}>반영금액 (자동)</label><input style={{...inp,color:'#6b7280'}} value={reflect.toLocaleString()+' K'} readOnly /></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 2fr', gap:12, marginBottom:14 }}>
            <div style={field}><label style={lbl}>착수월</label><input style={inp} type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} /></div>
            <div style={field}><label style={lbl}>종료월</label><input style={inp} type="month" value={endMonth} onChange={e => setEndMonth(e.target.value)} /></div>
            <div style={field}><label style={lbl}>담당자</label><select style={{...inp}} value={createdBy} onChange={e => setCreatedBy(e.target.value)}><option value="">선택</option>{(owners||[]).map(o => <option key={o} value={o}>{o}</option>)}</select></div>
            <div style={field}><label style={lbl}>상태</label><div style={{ display:'flex', gap:6 }}>{STATUS_OPTS.map(([val,label,color]) => <button key={val} style={{ fontSize:11, padding:'4px 12px', borderRadius:5, border:`1px solid ${status===val?color:inactiveBdr}`, background:status===val?color+'18':'transparent', color:status===val?color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }} onClick={() => setStatus(val)}>{label}</button>)}</div></div>
          </div>
          <div style={{ marginBottom:16 }}><label style={lbl}>코멘트</label><textarea style={{...inp,minHeight:56,resize:'vertical'}} value={comment} onChange={e => setComment(e.target.value)} /></div>
          {error && <div style={{ fontSize:12, color:'#f87171', marginBottom:12 }}>{error}</div>}
        </div>
        <div style={{ padding:'12px 20px', background:footerBg, display:'flex', justifyContent:'flex-end', gap:8, borderTop:`1px solid ${modalBdr}` }}>
          <button onClick={onClose} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:`1px solid ${inactiveBdr}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{ fontSize:12, padding:'6px 16px', borderRadius:6, border:'none', background:saving?'#4c1d95':'#7c3aed', color:'#f0f0f0', cursor:saving?'not-allowed':'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" }}>{saving?'저장 중...':'저장'}</button>
        </div>
      </div>
    </div>
  )
}

// ── 스타일 ────────────────────────────────────────────
function getStyles(dark) {
  const bg1=dark?'#111111':'#ffffff', bg2=dark?'#1a1a1a':'#f0f0f0', bg3=dark?'#0d0d0d':'#e8e8e8'
  const br=dark?'#1f1f1f':'#e2e2e2', br2=dark?'#2a2a2a':'#d1d5db'
  const tx0=dark?'#f0f0f0':'#111111', tx1=dark?'#6b7280':'#6b7280', tx2=dark?'#d1d5db':'#374151', tx3=dark?'#4b5563':'#9ca3af', tx4=dark?'#9ca3af':'#6b7280'
  return {
    simBanner:{background:'#1c1400',borderBottom:'1px solid #3d2e00',padding:'9px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12},
    simBannerLeft:{display:'flex',alignItems:'center',gap:10},
    simPulse:{width:7,height:7,borderRadius:'50%',background:'#fbbf24'},
    simBannerTitle:{fontSize:12,fontWeight:500,color:'#fcd34d'},
    simBannerSub:{fontSize:11,color:'#fcd34d'},
    chgPill:{fontSize:11,background:'#3d2e00',color:'#fcd34d',padding:'2px 8px',borderRadius:20,fontWeight:500},
    btnDiscard:{fontSize:11,padding:'4px 10px',borderRadius:6,border:'1px solid #fcd34d',background:'transparent',color:'#fcd34d',cursor:'pointer',fontFamily:"'Geist', sans-serif"},
    btnDiff:{fontSize:11,padding:'4px 12px',borderRadius:6,border:'1px solid #fcd34d',background:'#7c3aed',color:'#f0f0f0',cursor:'pointer',fontWeight:500,fontFamily:"'Geist', sans-serif"},
    toolbar:{display:'flex',alignItems:'center',padding:'8px 24px',background:dark?'#0f0f0f':'#fafafa',borderBottom:'1px solid '+br,gap:8,flexWrap:'wrap'},
    ownerSel:{fontSize:12,padding:'0 10px',height:30,boxSizing:'border-box',borderRadius:6,border:'1px solid '+br2,background:bg2,color:tx0,fontFamily:"'Geist', sans-serif"},
    searchInput:{fontSize:12,padding:'0 10px',height:30,boxSizing:'border-box',borderRadius:6,border:'1px solid '+br2,background:bg2,color:tx0,fontFamily:"'Geist', sans-serif",outline:'none',width:148},
    btnAddProject:{fontSize:12,padding:'0 14px',height:30,boxSizing:'border-box',borderRadius:6,border:'none',background:'#7c3aed',color:'#f0f0f0',cursor:'pointer',fontWeight:500,fontFamily:"'Geist', sans-serif",whiteSpace:'nowrap'},
    ccyWrap:{display:'flex',alignItems:'center',gap:6,height:30,boxSizing:'border-box',background:bg2,border:'1px solid '+br2,borderRadius:8,padding:'0 10px'},
    ccyLabel:{fontSize:11,color:tx1},
    ccySel:{fontSize:12,fontWeight:500,color:tx0,border:'none',background:'transparent',cursor:'pointer',fontFamily:"'Geist', sans-serif"},
    rateDot:{width:6,height:6,borderRadius:'50%'},
    rateLabel:{fontSize:10,color:tx1},
    body:{padding:'16px 24px',display:'flex',flexDirection:'column',gap:12,overflowY:'auto',flex:1,minHeight:0},
    kpiRow:{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:10},
    kpi:{background:bg1,border:'1px solid '+br,borderRadius:10,padding:'14px 16px'},
    kpiTop:{display:'flex',alignItems:'center',gap:6,marginBottom:5},
    kpiDot:{width:6,height:6,borderRadius:'50%'},
    kpiLabel:{fontSize:11,color:tx1},
    kpiVal:{fontSize:22,fontWeight:500,lineHeight:1.2,color:tx0},
    kpiSub:{fontSize:11,color:tx3,marginTop:3},
    kpiSim:{display:'flex',alignItems:'center',gap:6,marginTop:6,paddingTop:6,borderTop:'1px dashed '+br2},
    simBadge:{fontSize:10,background:'#2e1a1a',color:'#f87171',padding:'1px 5px',borderRadius:3,fontWeight:500},
    simVal:{fontSize:13,fontWeight:500,color:'#f87171'},
    tblCard:{background:bg1,border:'1px solid '+br,borderRadius:10,overflow:'visible'},
    tblTop:{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 16px',borderBottom:'1px solid '+br},
    tblTitle:{fontSize:13,fontWeight:500,color:tx0},
    simHint:{fontSize:11,color:'#fbbf24',display:'flex',alignItems:'center',gap:4},
    tbl:{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'},
    th:{fontSize:11,fontWeight:500,color:tx3,padding:'7px 14px',borderBottom:'1px solid '+br,background:bg3,whiteSpace:'nowrap'},
    td:{fontSize:12,color:tx2,padding:'10px 14px',borderBottom:'1px solid '+(dark?'#161616':'#f0f0f0'),verticalAlign:'middle'},
    tr:{transition:'background .1s',cursor:'pointer'},
    trHover:{background:dark?'#1a1a1a':'#f0f0f0'},
    simDot:{fontSize:8,color:'#fbbf24'},
    trSim:{background:dark?'#161820':'#f0f4ff'},
    trOpen:{background:dark?'#161820':'#f0f4ff'},
    badge:{display:'inline-block',fontSize:11,padding:'2px 7px',borderRadius:4,fontWeight:500},
    caseName:{fontSize:12,fontWeight:500,color:dark?'#e5e7eb':'#111827',marginBottom:2},
    caseSub:{fontSize:11,color:tx1},
    amtNormal:{fontSize:12,color:tx2},
    amtStrike:{fontSize:10,textDecoration:'line-through',color:tx3,display:'block',textAlign:'right'},
    amtNew:{fontSize:12,fontWeight:500,color:'#4ade80',display:'block',textAlign:'right'},
    confWrap:{display:'flex',alignItems:'center',gap:6},
    confBg:{width:44,height:3,background:br2,borderRadius:2,overflow:'hidden'},
    confFill:{height:'100%',borderRadius:2,transition:'width .3s'},
    ownerChip:{fontSize:11,padding:'2px 7px',borderRadius:4,background:bg2,color:tx4},
    quarterChip:{fontSize:11,color:tx1},
    chevron:{fontSize:12,color:tx3,transition:'transform .2s',display:'inline-block'},
    editPanel:{background:dark?'#0d0d12':'#f8f7ff',borderTop:'1px solid #2a1f5c',padding:'16px 20px'},
    editGrid:{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:12,marginBottom:12},
    editField:{display:'flex',flexDirection:'column',gap:4},
    editLabel:{fontSize:11,color:tx1},
    editInput:{fontSize:12,padding:'7px 9px',borderRadius:6,border:'1px solid '+br2,background:bg1,color:tx0,fontFamily:"'Geist', sans-serif",outline:'none'},
    editSelect:{fontSize:12,padding:'7px 9px',borderRadius:6,border:'1px solid '+br2,background:bg1,color:tx0,fontFamily:"'Geist', sans-serif"},
    editHint:{fontSize:11,color:tx1},
    statusRow:{display:'flex',gap:5,flexWrap:'wrap'},
    statusBtn:{fontSize:11,padding:'3px 9px',borderRadius:5,border:'1px solid '+br2,background:'transparent',color:tx1,cursor:'pointer',fontFamily:"'Geist', sans-serif",transition:'all .1s'},
    deriveBtn:{fontSize:11,padding:'5px 12px',borderRadius:6,border:'1px dashed #2a1f5c',background:'transparent',color:'#7c3aed',cursor:'pointer',fontFamily:"'Geist', sans-serif",marginBottom:10},
    childRowBg:{background:dark?'#111318':'#f5f3ff'},
    childEditBtn:{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid #7c3aed',background:'transparent',color:'#7c3aed',cursor:'pointer',fontFamily:"'Geist', sans-serif"},
    childDelBtn:{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid #f87171',background:'transparent',color:'#f87171',cursor:'pointer',fontFamily:"'Geist', sans-serif"},
    childCard:{background:dark?'#0a0a14':'#f0eeff',border:'1px solid #2a1f5c',borderRadius:7,padding:'10px 12px',marginBottom:8},
    childHeader:{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8},
    childBadge:{fontSize:10,padding:'1px 6px',borderRadius:4,background:dark?'#1e1635':'#ede9fe',color:dark?'#a78bfa':'#5b21b6',fontWeight:500},
    childGrid:{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8},
    btnRm:{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid '+br2,background:'transparent',color:tx1,cursor:'pointer',fontFamily:"'Geist', sans-serif"},
    editFoot:{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:12},
    btnCancel:{fontSize:12,padding:'5px 14px',borderRadius:6,border:'1px solid '+br2,background:'transparent',color:tx1,cursor:'pointer',fontFamily:"'Geist', sans-serif"},
    btnApply:{fontSize:12,padding:'5px 16px',borderRadius:6,border:'none',background:'#7c3aed',color:'#f0f0f0',cursor:'pointer',fontWeight:500,fontFamily:"'Geist', sans-serif"},
    qrWrap:{display:'flex',alignItems:'center',gap:10,background:bg2,border:'1px solid '+br2,borderRadius:8,padding:'6px 12px'},
    qrLabel:{fontSize:11,color:tx1,whiteSpace:'nowrap'},
    qrTrack:{background:br2},
    qrQLbl:{color:tx3},
    overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:20},
    diffModal:{background:bg1,border:'1px solid #2a1f5c',borderRadius:12,width:'100%',maxWidth:540,overflow:'hidden'},
    diffHeader:{background:dark?'#1e1635':'#f5f3ff',padding:'13px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:`1px solid ${dark?'#2a1f5c':'#e5e7eb'}`},
    diffTitle:{fontSize:13,fontWeight:500,color:dark?'#c4b5fd':'#5b21b6'},
    diffClose:{fontSize:20,color:'#7c3aed',cursor:'pointer',background:'none',border:'none',lineHeight:1,fontFamily:"'Geist', sans-serif"},
    diffItem:{padding:'13px 18px',borderBottom:'1px solid '+br,display:'flex',gap:10,alignItems:'flex-start'},
    diffChk:{width:16,height:16,borderRadius:4,border:'1px solid '+br2,background:bg1,flexShrink:0,marginTop:1,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',fontSize:10,color:tx0},
    diffChkOn:{background:'#7c3aed',borderColor:'#7c3aed'},
    diffName:{fontSize:12,fontWeight:500,color:dark?'#e5e7eb':'#111827',marginBottom:5},
    diffCo:{fontSize:11,background:bg2,color:tx1,padding:'1px 6px',borderRadius:3,marginLeft:5},
    diffRows:{display:'flex',flexDirection:'column',gap:3},
    diffRow:{display:'flex',alignItems:'center',gap:6,fontSize:11},
    diffField:{color:tx1,width:44,flexShrink:0},
    diffBefore:{color:'#f87171',textDecoration:'line-through'},
    diffAfter:{color:'#4ade80',fontWeight:500},
    diffFoot:{padding:'12px 18px',background:bg3,display:'flex',gap:8,alignItems:'center'},
    commitInp:{flex:1,fontSize:12,padding:'7px 10px',borderRadius:6,border:'1px solid '+br2,background:bg1,color:tx0,fontFamily:"'Geist', sans-serif"},
    btnCommit:{fontSize:12,padding:'7px 16px',borderRadius:6,border:'none',background:'#7c3aed',color:'#f0f0f0',cursor:'pointer',fontWeight:500,fontFamily:"'Geist', sans-serif",whiteSpace:'nowrap'},
  }
}
