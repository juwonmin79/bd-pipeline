import { useState, useEffect, useMemo } from 'react'
import { useDeals } from './useDeals'
import { useOpportunities } from './useOpportunities'
import { FALLBACK_RATES, CCY_SYMS, CCY_LABELS, STATUS_STYLE, OPP_STATUS_STYLE, OPP_STATUS_DB_TO_LABEL, OPP_STATUS_LABEL_TO_DB, getPriorityGroup, PRIORITY_LABEL, normalize, expandSearch, fmtQuarter, fmtAmt } from './constants'
import DealDrawer, { StatusBadge, OppStatusBadge, PriorityBadge, ConfBar } from './DealDrawer'
import ColumnFilter from './ColumnFilter'

// ── 환율 훅 ──────────────────────────────────────────
function useCurrency() {
  const [ccy, setCcy] = useState('KRW')
  const [rates, setRates] = useState(FALLBACK_RATES)
  const [rateStatus, setRateStatus] = useState('loading')
  useEffect(() => {
    fetch('https://api.exchangerate-api.com/v4/latest/KRW')
      .then(r => r.json())
      .then(data => { setRates({ KRW:1, USD:data.rates.USD, CNY:data.rates.CNY, JPY:data.rates.JPY, EUR:data.rates.EUR }); setRateStatus('live') })
      .catch(() => { setRates(FALLBACK_RATES); setRateStatus('fallback') })
  }, [])
  const fmtK = (man) => fmtAmt(man, rates, ccy)
  return { ccy, setCcy, rates, rateStatus, fmtK }
}

export default function TeamOverview({ tab, darkMode, session, lastSeen }) {
  const s = useMemo(() => getStyles(darkMode), [darkMode])
  const { ccy, setCcy, rateStatus, fmtK } = useCurrency()

  const [innerTab, setInnerTab]       = useState('deals')
  const [searchQuery, setSearchQuery] = useState('')
  const [drawerItem, setDrawerItem]   = useState(null)
  const [toast, setToast]             = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  // ── 딜 데이터 ──
  const { deals, filteredDeals: rawDeals, quarters, loading: dealsLoading, loadDeals, wonAmount, activeAmount, targetAmount, gap, achieveRate, productCats } = useDeals({
    session, mode: 'all',
  })

  // ── 오퍼튜니티 데이터 ──
  const { opportunities, filteredOpportunities, loading: oppLoading, loadOpportunities, updatePriority, promoteOpportunity, dropOpportunity } = useOpportunities({
    session,
  })

  const loading = dealsLoading || oppLoading

  // 딜 필터 (검색)
  const filteredDeals = rawDeals.filter(d => {
    if (searchQuery.trim()) {
      const terms = expandSearch(searchQuery)
      const match = str => terms.some(t => normalize(str).includes(t))
      if (!match(d.case_name) && !match(d.customer)) return false
    }
    return true
  })

  // 오퍼튜니티 필터 (검색)
  const filteredOpps = filteredOpportunities.filter(o => {
    if (searchQuery.trim()) {
      const terms = expandSearch(searchQuery)
      const match = str => terms.some(t => normalize(str).includes(t))
      if (!match(o.title) && !match(o.customer)) return false
    }
    return true
  })

  if (loading) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
      <div style={{ width:8, height:8, borderRadius:'50%', background:'#7c3aed' }} />
      <span style={{ fontSize:13, color:'#6b7280' }}>로딩 중...</span>
    </div>
  )

  return (
    <div style={s.wrap}>

      {/* ── 툴바 ── */}
      <div style={s.toolbar}>
        {/* 내부 탭 */}
        <div style={s.innerTabs}>
          <button style={{ ...s.innerTab, ...(innerTab==='deals' ? s.innerTabOn : {}) }} onClick={() => setInnerTab('deals')}>
            계약 건 <span style={s.tabCount}>{filteredDeals.length}</span>
          </button>
          <button style={{ ...s.innerTab, ...(innerTab==='opps' ? s.innerTabOn : {}) }} onClick={() => setInnerTab('opps')}>
            사업 기회 <span style={s.tabCount}>{filteredOpps.length}</span>
          </button>
        </div>

        {/* 필터 + 단위 오른쪽 정렬 */}
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6 }}>
          <input style={s.searchInput} placeholder="프로젝트 / 고객사 검색" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          <div style={{ width:'1px', height:20, background: darkMode?'#2a2a2a':'#e5e7eb', margin:'0 2px' }} />
          <div style={s.ccyWrap}>
            <span style={s.ccyLabel}>단위</span>
            <select style={s.ccySel} value={ccy} onChange={e => setCcy(e.target.value)}>
              {['KRW','USD','CNY','JPY','EUR'].map(c => <option key={c} value={c}>{CCY_LABELS[c]}</option>)}
            </select>
            <div style={{ ...s.rateDot, background: rateStatus==='live'?'#4ade80':'#fbbf24' }} />
          </div>
        </div>
      </div>

      {/* ── KPI 카드 (딜 탭만) ── */}
      {innerTab === 'deals' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:10, padding:'12px 20px', background:darkMode?'#0a0a0a':'#f5f5f7', borderBottom:`1px solid ${darkMode?'#1f1f1f':'#e2e2e2'}` }}>
          <KpiCard dot="#4ade80" label="확정 매출" value={fmtK(wonAmount)} sub={`계약 ${filteredDeals.filter(d=>d.status==='won').length}건`} darkMode={darkMode} />
          <KpiCard dot="#60a5fa" label="예측 매출" value={fmtK(activeAmount)} sub="확도 반영 합산" darkMode={darkMode} />
          <KpiCard dot="#fbbf24" label="사업계획 목표" value={fmtK(targetAmount)} sub="연간 합산" darkMode={darkMode} />
          <KpiCard dot="#f87171" label="갭 (부족)" value={fmtK(gap)} sub={`달성률 ${achieveRate}%`} darkMode={darkMode} isGap achieveRate={achieveRate} />
        </div>
      )}

      {/* ── 바디 ── */}
      <div style={s.body}>
        {innerTab === 'deals' ? (
          <DealsTable
            deals={filteredDeals}
            darkMode={darkMode}
            fmtK={fmtK}
            onRowClick={deal => setDrawerItem({ type:'deal', data:deal })}
            s={s}
            lastSeen={lastSeen}
          />
        ) : (
          <OppsTable
            opps={filteredOpps}
            darkMode={darkMode}
            fmtK={fmtK}
            onRowClick={opp => setDrawerItem({ type:'opp', data:opp })}
            s={s}
            lastSeen={lastSeen}
          />
        )}
      </div>

      {/* ── 드로어 ── */}
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
          onPromote={async (oppId) => {
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
          position:'fixed', bottom:24, right:24, zIndex:9999,
          background: toast.type==='info' ? (darkMode?'#0f2010':'#f0fdf4') : (darkMode?'#1e1635':'#ede9fe'),
          border: `1px solid ${toast.type==='info' ? '#4ade80' : '#7c3aed'}`,
          color: toast.type==='info' ? (darkMode?'#4ade80':'#16a34a') : (darkMode?'#c4b5fd':'#5b21b6'),
          padding:'10px 18px', borderRadius:8, fontSize:13, fontWeight:500, fontFamily:"'Geist', sans-serif",
        }}>{toast.msg}</div>
      )}
    </div>
  )
}

// ── 정식 딜 테이블 ────────────────────────────────────
function DealsTable({ deals, darkMode, fmtK, onRowClick, s, lastSeen }) {
  const [cf, setCf] = useState({ caseName:[], customer:[], quarter:[], status:[], owner:[] })
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState(null)
  const setFilter = (key, val) => setCf(prev => ({ ...prev, [key]: val }))
  const handleSort = (key, dir) => { setSortKey(dir ? key : null); setSortDir(dir) }

  const statusLabelMap = Object.fromEntries(Object.entries(STATUS_STYLE).map(([k,v]) => [k, v.label]))
  const statusKeyMap   = Object.fromEntries(Object.entries(STATUS_STYLE).map(([k,v]) => [v.label, k]))
  const rawStatuses    = [...new Set(deals.map(d => d.status).filter(Boolean))]

  const opts = {
    caseName: [...new Set(deals.map(d => d.case_name).filter(Boolean))].sort(),
    customer: [...new Set(deals.map(d => d.customer).filter(Boolean))].sort(),
    quarter:  [...new Set(deals.map(d => d.quarter).filter(Boolean))].sort(),
    status:   rawStatuses.map(s => statusLabelMap[s] || s).sort(),
    owner:    [...new Set(deals.map(d => d.created_by).filter(Boolean))].sort(),
  }

  // 분기 필터 옵션은 fmtQuarter 표시, 값은 raw
  const quarterDisplayOpts = opts.quarter.map(q => fmtQuarter(q))

  const filtered = deals.filter(d => {
    if (cf.caseName.length > 0 && !cf.caseName.includes(d.case_name)) return false
    if (cf.customer.length > 0 && !cf.customer.includes(d.customer)) return false
    if (cf.quarter.length  > 0 && !cf.quarter.includes(fmtQuarter(d.quarter))) return false
    if (cf.status.length   > 0 && !cf.status.includes(statusLabelMap[d.status] || d.status)) return false
    if (cf.owner.length    > 0 && !cf.owner.includes(d.created_by)) return false
    return true
  }).sort((a, b) => {
    if (!sortKey || !sortDir) return 0
    const mul = sortDir === 'asc' ? 1 : -1
    if (sortKey === 'book_amount')   return (a.book_amount - b.book_amount) * mul
    if (sortKey === 'reflect')       return ((a.book_amount*a.probability/100) - (b.book_amount*b.probability/100)) * mul
    if (sortKey === 'start_month')   return String(a.start_month||'').localeCompare(String(b.start_month||'')) * mul
    if (sortKey === 'end_month')     return String(a.end_month||'').localeCompare(String(b.end_month||'')) * mul
    const aVal = sortKey === 'caseName' ? a.case_name : sortKey === 'customer' ? a.customer : sortKey === 'quarter' ? a.quarter : sortKey === 'owner' ? a.created_by : a[sortKey]
    const bVal = sortKey === 'caseName' ? b.case_name : sortKey === 'customer' ? b.customer : sortKey === 'quarter' ? b.quarter : sortKey === 'owner' ? b.created_by : b[sortKey]
    return String(aVal||'').localeCompare(String(bVal||'')) * mul
  })

  const th = s.th
  return (
    <div style={s.tableCard}>
      <table style={s.tbl}>
        <colgroup>
          <col style={{ width:'22%' }} /><col style={{ width:'10%' }} /><col style={{ width:'8%' }} />
          <col style={{ width:'8%' }} /><col style={{ width:'10%' }} /><col style={{ width:'11%' }} />
          <col style={{ width:'11%' }} /><col style={{ width:'10%' }} /><col style={{ width:'10%' }} />
        </colgroup>
        <thead>
          <tr>
            {/* 검색만 */}
            <ColumnFilter label="프로젝트" align="left"   options={opts.caseName}     value={cf.caseName} onChange={v => setFilter('caseName',v)} thStyle={th} darkMode={darkMode} withSearch sortable={false} />
            {/* 체크박스만 */}
            <ColumnFilter label="고객사"   align="left"   options={opts.customer}     value={cf.customer} onChange={v => setFilter('customer',v)} thStyle={th} darkMode={darkMode} />
            <ColumnFilter label="분기"     align="center" options={quarterDisplayOpts} value={cf.quarter}  onChange={v => setFilter('quarter',v)}  thStyle={th} darkMode={darkMode} />
            <ColumnFilter label="상태"     align="center" options={opts.status}        value={cf.status}   onChange={v => setFilter('status',v)}   thStyle={th} darkMode={darkMode} />
            <ColumnFilter label="담당자"   align="center" options={opts.owner}         value={cf.owner}    onChange={v => setFilter('owner',v)}    thStyle={th} darkMode={darkMode} />
            {/* 정렬만 */}
            <ColumnFilter label="계약금액" align="right"  options={[]} value={[]} onChange={()=>{}} onSort={dir => handleSort('book_amount',dir)} sortDir={sortKey==='book_amount'?sortDir:null} thStyle={th} darkMode={darkMode} sortable filterable={false} />
            <ColumnFilter label="반영금액" align="right"  options={[]} value={[]} onChange={()=>{}} onSort={dir => handleSort('reflect',dir)}     sortDir={sortKey==='reflect'?sortDir:null}     thStyle={th} darkMode={darkMode} sortable filterable={false} />
            <ColumnFilter label="착수"     align="center" options={[]} value={[]} onChange={()=>{}} onSort={dir => handleSort('start_month',dir)}  sortDir={sortKey==='start_month'?sortDir:null}  thStyle={th} darkMode={darkMode} sortable filterable={false} />
            <ColumnFilter label="종료"     align="center" options={[]} value={[]} onChange={()=>{}} onSort={dir => handleSort('end_month',dir)}    sortDir={sortKey==='end_month'?sortDir:null}    thStyle={th} darkMode={darkMode} sortable filterable={false} />
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan={9} style={s.empty}>데이터가 없습니다</td></tr>
          ) : filtered.map(deal => {
            const isNew = lastSeen && deal.created_at && new Date(deal.created_at) > new Date(lastSeen)
            return (
            <tr key={deal.id}
              style={{ ...s.tr, boxShadow: isNew ? 'inset 3px 0 0 #7c3aed' : 'none' }}
              onClick={() => onRowClick(deal)}
              onMouseEnter={e => e.currentTarget.style.background = darkMode?'#1a1a1a':'#f5f3ff'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <td style={s.td}>
                <div style={s.caseName}>{deal.case_name}</div>
                <div style={s.caseSub}>{deal.product_cat}</div>
              </td>
              <td style={s.td}><span style={s.chip}>{deal.customer}</span></td>
              <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{fmtQuarter(deal.quarter)}</span></td>
              <td style={{ ...s.td, textAlign:'center' }}><StatusBadge status={deal.status} /></td>
              <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{deal.created_by || '—'}</span></td>
              <td style={{ ...s.td, textAlign:'right' }}>{fmtK(deal.book_amount)}</td>
              <td style={{ ...s.td, textAlign:'right' }}>{fmtK(Math.round((deal.book_amount * deal.probability) / 100))}</td>
              <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{deal.start_month || '—'}</span></td>
              <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{deal.end_month || '—'}</span></td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── 사업 기회 테이블 ──────────────────────────────────
// 컬럼 순서: 프로젝트 / 고객사 / 상태 / 담당자 / 예상금액 / 예상월 / 확도 / 중요도
function OppsTable({ opps, darkMode, fmtK, onRowClick, s, lastSeen }) {
  const [cf, setCf] = useState({ title:[], customer:[], owner:[], status:[] })
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState(null)
  const setFilter = (key, val) => setCf(prev => ({ ...prev, [key]: val }))
  const handleSort = (key, dir) => { setSortKey(dir ? key : null); setSortDir(dir) }

  const opts = {
    title:    [...new Set(opps.map(o => o.title).filter(Boolean))].sort(),
    customer: [...new Set(opps.map(o => o.customer).filter(Boolean))].sort(),
    owner:    [...new Set(opps.map(o => o.owner).filter(Boolean))].sort(),
    status:   ['기획 중', '포캐스트', '드랍'],
  }

  const filteredOpps = opps.filter(o => {
    if (cf.title.length    > 0 && !cf.title.includes(o.title))    return false
    if (cf.customer.length > 0 && !cf.customer.includes(o.customer)) return false
    if (cf.owner.length    > 0 && !cf.owner.includes(o.owner))    return false
    if (cf.status.length   > 0) {
      const label = OPP_STATUS_DB_TO_LABEL[o.status] || o.status
      if (!cf.status.includes(label)) return false
    }
    return true
  }).sort((a, b) => {
    if (!sortKey || !sortDir) return 0
    const mul = sortDir === 'asc' ? 1 : -1
    if (sortKey === 'amount')       return ((a.amount||0) - (b.amount||0)) * mul
    if (sortKey === 'expected_date') return String(a.expected_date||'').localeCompare(String(b.expected_date||'')) * mul
    if (sortKey === 'confidence')   return ((a.confidence||0) - (b.confidence||0)) * mul
    return 0
  })

  const grouped = {
    high:  filteredOpps.filter(o => getPriorityGroup(o.priority) === 'high'),
    mid:   filteredOpps.filter(o => getPriorityGroup(o.priority) === 'mid'),
    low:   filteredOpps.filter(o => getPriorityGroup(o.priority) === 'low'),
    dummy: filteredOpps.filter(o => getPriorityGroup(o.priority) === 'dummy'),
  }

  const th = s.th
  const OppHeader = () => (
    <tr>
      {/* 검색만 */}
      <ColumnFilter label="프로젝트" align="left"   options={opts.title}    value={cf.title}    onChange={v => setFilter('title',v)}    thStyle={th} darkMode={darkMode} withSearch sortable={false} />
      {/* 체크박스만 */}
      <ColumnFilter label="고객사"   align="left"   options={opts.customer} value={cf.customer} onChange={v => setFilter('customer',v)} thStyle={th} darkMode={darkMode} />
      <ColumnFilter label="상태"     align="center" options={opts.status}   value={cf.status}   onChange={v => setFilter('status',v)}   thStyle={th} darkMode={darkMode} />
      <ColumnFilter label="담당자"   align="center" options={opts.owner}    value={cf.owner}    onChange={v => setFilter('owner',v)}    thStyle={th} darkMode={darkMode} />
      {/* 정렬만 */}
      <ColumnFilter label="예상금액" align="right"  options={[]} value={[]} onChange={()=>{}} onSort={dir => handleSort('amount',dir)}        sortDir={sortKey==='amount'?sortDir:null}        thStyle={th} darkMode={darkMode} sortable filterable={false} />
      <ColumnFilter label="예상월"   align="center" options={[]} value={[]} onChange={()=>{}} onSort={dir => handleSort('expected_date',dir)} sortDir={sortKey==='expected_date'?sortDir:null} thStyle={th} darkMode={darkMode} sortable filterable={false} />
      <ColumnFilter label="확도"     align="center" options={[]} value={[]} onChange={()=>{}} onSort={dir => handleSort('confidence',dir)}    sortDir={sortKey==='confidence'?sortDir:null}    thStyle={th} darkMode={darkMode} sortable filterable={false} />
      {/* 아무것도 없음 */}
      <th style={{ ...th, textAlign:'center' }}>중요도</th>
    </tr>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {['high','mid','low','dummy'].map(group => {
        const items = grouped[group]
        if (items.length === 0) return null
        const { label, color, bg } = PRIORITY_LABEL[group]
        return (
          <div key={group}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <span style={{ fontSize:11, fontWeight:500, background:bg, color, padding:'2px 10px', borderRadius:99 }}>{label}</span>
              <span style={{ fontSize:11, color:'#6b7280', background: darkMode?'#1a1a1a':'#f0f0f0', padding:'2px 8px', borderRadius:99 }}>{items.length}건</span>
              <div style={{ flex:1, height:'0.5px', background: darkMode?'#1f1f1f':'#e2e2e2' }} />
            </div>
            <div style={s.tableCard}>
              <table style={s.tbl}>
                <colgroup>
                  <col style={{ width:'26%' }} /><col style={{ width:'11%' }} /><col style={{ width:'10%' }} />
                  <col style={{ width:'10%' }} /><col style={{ width:'13%' }} /><col style={{ width:'11%' }} />
                  <col style={{ width:'10%' }} /><col style={{ width:'9%' }} />
                </colgroup>
                <thead><OppHeader /></thead>
                <tbody>
                  {items.map(opp => {
                    const isNew = lastSeen && opp.created_at && new Date(opp.created_at) > new Date(lastSeen)
                    return (
                    <tr key={opp.id}
                      style={{ ...s.tr, boxShadow: isNew ? 'inset 3px 0 0 #7c3aed' : 'none' }}
                      onClick={() => onRowClick(opp)}
                      onMouseEnter={e => e.currentTarget.style.background = darkMode?'#1a1a1a':'#f5f3ff'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={s.td}>
                        <div style={s.caseName}>{opp.title}</div>
                        <div style={s.caseSub}>{opp.product}</div>
                      </td>
                      <td style={s.td}><span style={s.chip}>{opp.customer}</span></td>
                      <td style={{ ...s.td, textAlign:'center' }}><OppStatusBadge status={opp.status} /></td>
                      <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{opp.owner || '—'}</span></td>
                      <td style={{ ...s.td, textAlign:'right' }}>{fmtK(opp.amount)}</td>
                      <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{opp.expected_date || '—'}</span></td>
                      <td style={{ ...s.td, textAlign:'center' }}><ConfBar pct={opp.confidence || 0} /></td>
                      <td style={{ ...s.td, textAlign:'center' }}><PriorityBadge priority={opp.priority} /></td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      {filteredOpps.length === 0 && <div style={s.empty}>사업 기회가 없습니다</div>}
    </div>
  )
}

// ── KPI 카드 ──────────────────────────────────────────
function KpiCard({ dot, label, value, sub, darkMode, isGap, achieveRate }) {
  const dark = darkMode
  const bg1 = dark?'#111':'#fff', br = dark?'#1f1f1f':'#e2e2e2'
  const tx0 = dark?'#f0f0f0':'#111', tx1 = dark?'#6b7280':'#6b7280', tx3 = dark?'#4b5563':'#9ca3af'
  const gapColor = isGap ? (achieveRate >= 90 ? '#4ade80' : achieveRate >= 70 ? '#fbbf24' : '#f87171') : null
  return (
    <div style={{ background:bg1, border:`1px solid ${br}`, borderRadius:10, padding:'14px 16px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
        <div style={{ width:6, height:6, borderRadius:'50%', background: gapColor || dot }} />
        <span style={{ fontSize:11, color:tx1 }}>{label}</span>
      </div>
      <div style={{ fontSize:22, fontWeight:500, lineHeight:1.2, color: gapColor || tx0 }}>{value}</div>
      <div style={{ fontSize:11, color:tx3, marginTop:3 }}>{sub}</div>
    </div>
  )
}

// ── 스타일 ────────────────────────────────────────────
function getStyles(dark) {
  const bg1 = dark?'#111':'#fff', bg2 = dark?'#1a1a1a':'#f0f0f0', bg3 = dark?'#0d0d0d':'#e8e8e8'
  const br  = dark?'#1f1f1f':'#e2e2e2', br2 = dark?'#2a2a2a':'#d1d5db'
  const tx0 = dark?'#f0f0f0':'#111', tx1 = dark?'#6b7280':'#6b7280', tx2 = dark?'#d1d5db':'#374151', tx3 = dark?'#4b5563':'#9ca3af'
  return {
    wrap:       { flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:dark?'#0a0a0a':'#f5f5f7', fontFamily:"'Geist', sans-serif" },
    toolbar:    { display:'flex', alignItems:'center', padding:'8px 16px', background:dark?'#0f0f0f':'#fafafa', borderBottom:'1px solid '+br, gap:6, flexWrap:'wrap' },
    innerTabs:  { display:'flex', gap:2 },
    innerTab:   { fontSize:12, padding:'5px 14px', borderRadius:6, border:`1px solid ${br2}`, background:'transparent', color:tx1, cursor:'pointer', fontFamily:"'Geist', sans-serif", transition:'all .1s' },
    innerTabOn: { background:bg2, color:tx0, fontWeight:500, borderColor:br },
    tabCount:   { fontSize:11, background:dark?'#2a2a2a':'#e5e7eb', color:tx1, padding:'1px 6px', borderRadius:99, marginLeft:4 },
    searchInput:{ fontSize:12, padding:'0 10px', height:30, borderRadius:6, border:'1px solid '+br2, background:bg2, color:tx0, fontFamily:"'Geist', sans-serif", outline:'none', width:160 },
    sel:        { fontSize:12, padding:'0 8px', height:30, borderRadius:6, border:'1px solid '+br2, background:bg2, color:tx0, fontFamily:"'Geist', sans-serif" },
    ccyWrap:    { display:'flex', alignItems:'center', gap:6, height:30, background:bg2, border:'1px solid '+br2, borderRadius:8, padding:'0 10px' },
    ccyLabel:   { fontSize:11, color:tx1 },
    ccySel:     { fontSize:12, fontWeight:500, color:tx0, border:'none', background:'transparent', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
    rateDot:    { width:6, height:6, borderRadius:'50%' },
    body:       { flex:1, overflowY:'auto', padding:'14px 20px', display:'flex', flexDirection:'column', gap:10 },
    tableCard:  { background:bg1, border:'1px solid '+br, borderRadius:10, overflow:'hidden' },
    tbl:        { width:'100%', borderCollapse:'collapse', tableLayout:'fixed' },
    th:         { fontSize:11, fontWeight:500, color:tx3, padding:'7px 14px', borderBottom:'1px solid '+br, background:bg3, whiteSpace:'nowrap' },
    td:         { fontSize:12, color:tx2, padding:'9px 14px', borderBottom:'1px solid '+(dark?'#161616':'#f0f0f0'), verticalAlign:'middle' },
    tr:         { cursor:'pointer', transition:'background .1s' },
    empty:      { padding:'28px', textAlign:'center', color:'#6b7280', fontSize:13 },
    caseName:   { fontSize:12, fontWeight:500, color:dark?'#e5e7eb':'#111827', marginBottom:2 },
    caseSub:    { fontSize:11, color:tx1 },
    chip:       { fontSize:11, color:tx1, background:bg2, padding:'2px 7px', borderRadius:4 },
  }
}
