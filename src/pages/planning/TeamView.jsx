import { useState, useMemo } from 'react'
import { useDeals } from './useDeals'
import { useOpportunities } from './useOpportunities'
import { FALLBACK_RATES, CCY_SYMS, CCY_LABELS, getPriorityGroup, PRIORITY_LABEL, normalize, expandSearch } from './constants'
import DealDrawer, { StatusBadge, OppStatusBadge, PriorityBadge, ConfBar } from './DealDrawer'

// ── 환율 훅 ──────────────────────────────────────────
function useCurrency() {
  const [ccy, setCcy] = useState('KRW')
  const [rates, setRates] = useState(FALLBACK_RATES)
  const [rateStatus, setRateStatus] = useState('loading')
  useState(() => {
    fetch('https://api.exchangerate-api.com/v4/latest/KRW')
      .then(r => r.json())
      .then(data => { setRates({ KRW:1, USD:data.rates.USD, CNY:data.rates.CNY, JPY:data.rates.JPY, EUR:data.rates.EUR }); setRateStatus('live') })
      .catch(() => { setRates(FALLBACK_RATES); setRateStatus('fallback') })
  }, [])
  const fmtK = (krw) => {
    if (!krw) return '—'
    const v = krw * rates[ccy]
    const s = CCY_SYMS[ccy]
    if (ccy === 'KRW') return s + Math.round(v).toLocaleString() + 'K'
    if (ccy === 'JPY') return s + Math.round(v / 10).toLocaleString() + '万'
    return s + v.toFixed(1) + 'K'
  }
  return { ccy, setCcy, rates, rateStatus, fmtK }
}

export default function TeamView({ tab, darkMode, session }) {
  const s = useMemo(() => getStyles(darkMode), [darkMode])
  const { ccy, setCcy, rateStatus, fmtK } = useCurrency()

  const [innerTab, setInnerTab]       = useState('deals')   // 'deals' | 'opps'
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [customerFilter, setCustomerFilter] = useState('all')
  const [quarterFilter, setQuarterFilter]   = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [drawerItem, setDrawerItem]   = useState(null)
  const [toast, setToast]             = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  // ── 딜 데이터 ──
  const { deals, filteredDeals: rawDeals, owners, quarters, productCats, loading: dealsLoading, loadDeals, wonAmount, activeAmount, targetAmount, gap, achieveRate } = useDeals({
    session, mode: 'all', ownerFilter,
  })

  // ── 오퍼튜니티 데이터 ──
  const { opportunities, filteredOpportunities, loading: oppLoading, loadOpportunities, updatePriority, promoteOpportunity, dropOpportunity } = useOpportunities({
    session, ownerFilter,
  })

  const loading = dealsLoading || oppLoading

  // 고객사 목록
  const customers = [...new Set(deals.map(d => d.customer).filter(Boolean))].sort()
  const oppCustomers = [...new Set(opportunities.map(o => o.customer).filter(Boolean))].sort()

  // 딜 추가 필터 (고객사, 분기, 검색)
  const filteredDeals = rawDeals.filter(d => {
    if (customerFilter !== 'all' && d.customer !== customerFilter) return false
    if (quarterFilter !== 'all' && d.quarter !== quarterFilter) return false
    if (searchQuery.trim()) {
      const terms = expandSearch(searchQuery)
      const match = s => terms.some(t => normalize(s).includes(t))
      if (!match(d.case_name) && !match(d.customer)) return false
    }
    return true
  })

  // 오퍼튜니티 추가 필터
  const filteredOpps = filteredOpportunities.filter(o => {
    if (customerFilter !== 'all' && o.customer !== customerFilter) return false
    if (searchQuery.trim()) {
      const terms = expandSearch(searchQuery)
      const match = s => terms.some(t => normalize(s).includes(t))
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
            정식 딜 <span style={s.tabCount}>{filteredDeals.length}</span>
          </button>
          <button style={{ ...s.innerTab, ...(innerTab==='opps' ? s.innerTabOn : {}) }} onClick={() => setInnerTab('opps')}>
            오퍼튜니티 <span style={s.tabCount}>{filteredOpps.length}</span>
          </button>
        </div>

        <div style={{ width:'1px', height:20, background: darkMode?'#2a2a2a':'#e5e7eb', margin:'0 4px' }} />

        {/* 필터 */}
        <input style={s.searchInput} placeholder="프로젝트 / 고객사 검색" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        <select style={s.sel} value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
          <option value="all">전체 담당자</option>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select style={s.sel} value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}>
          <option value="all">전체 고객사</option>
          {(innerTab==='deals' ? customers : oppCustomers).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {innerTab === 'deals' && (
          <select style={s.sel} value={quarterFilter} onChange={e => setQuarterFilter(e.target.value)}>
            <option value="all">전체 분기</option>
            {quarters.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        )}

        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
          <div style={s.ccyWrap}>
            <span style={s.ccyLabel}>단위</span>
            <select style={s.ccySel} value={ccy} onChange={e => setCcy(e.target.value)}>
              {['KRW','USD','CNY','JPY','EUR'].map(c => <option key={c} value={c}>{CCY_LABELS[c]}</option>)}
            </select>
            <div style={{ ...s.rateDot, background: rateStatus==='live'?'#4ade80':'#fbbf24' }} />
          </div>
        </div>
      </div>

      {/* ── KPI 바 (딜 탭만) ── */}
      {innerTab === 'deals' && (
        <div style={s.kpiBar}>
          <KpiChip label="확정" value={fmtK(wonAmount)} color="#4ade80" />
          <KpiChip label="예측" value={fmtK(activeAmount)} color="#60a5fa" />
          <KpiChip label="목표" value={fmtK(targetAmount)} color="#fbbf24" />
          <KpiChip label="갭" value={fmtK(gap)} color={achieveRate >= 90 ? '#4ade80' : achieveRate >= 70 ? '#fbbf24' : '#f87171'} />
          <span style={{ fontSize:11, color:'#6b7280', marginLeft:4 }}>달성률 {achieveRate}%</span>
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
          />
        ) : (
          <OppsTable
            opps={filteredOpps}
            darkMode={darkMode}
            fmtK={fmtK}
            onRowClick={opp => setDrawerItem({ type:'opp', data:opp })}
            s={s}
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
          onClose={() => setDrawerItem(null)}
          onPromote={async (oppId) => {
            const { error } = await promoteOpportunity(oppId, null)
            if (!error) { showToast('정식딜로 승격했어요 🎉'); loadOpportunities(); loadDeals() }
          }}
          onDrop={async (oppId) => {
            const { error } = await dropOpportunity(oppId)
            if (!error) { showToast('드랍 처리했어요', 'info'); setDrawerItem(null) }
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
function DealsTable({ deals, darkMode, fmtK, onRowClick, s }) {
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
            {[['프로젝트','left'],['고객사','left'],['분기','center'],['상태','center'],
              ['담당자','center'],['계약금액','right'],['반영금액','right'],['착수','center'],['종료','center']
            ].map(([h,a],i) => <th key={i} style={{ ...s.th, textAlign:a }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {deals.length === 0 ? (
            <tr><td colSpan={9} style={s.empty}>데이터가 없습니다</td></tr>
          ) : deals.map(deal => (
            <tr key={deal.id} style={s.tr}
              onClick={() => onRowClick(deal)}
              onMouseEnter={e => e.currentTarget.style.background = darkMode?'#1a1a1a':'#f5f3ff'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <td style={s.td}><div style={s.caseName}>{deal.case_name}</div><div style={s.caseSub}>{deal.product_cat}</div></td>
              <td style={s.td}><span style={s.chip}>{deal.customer}</span></td>
              <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{deal.quarter}</span></td>
              <td style={{ ...s.td, textAlign:'center' }}><StatusBadge status={deal.status} /></td>
              <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{deal.created_by || '—'}</span></td>
              <td style={{ ...s.td, textAlign:'right' }}>{fmtK(deal.book_amount)}</td>
              <td style={{ ...s.td, textAlign:'right' }}>{fmtK(Math.round((deal.book_amount * deal.probability) / 100))}</td>
              <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{deal.start_month || '—'}</span></td>
              <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{deal.end_month || '—'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 오퍼튜니티 테이블 ─────────────────────────────────
function OppsTable({ opps, darkMode, fmtK, onRowClick, s }) {
  // 중요도 그룹별 정렬
  const grouped = {
    high:  opps.filter(o => getPriorityGroup(o.priority) === 'high'),
    mid:   opps.filter(o => getPriorityGroup(o.priority) === 'mid'),
    low:   opps.filter(o => getPriorityGroup(o.priority) === 'low'),
    dummy: opps.filter(o => getPriorityGroup(o.priority) === 'dummy'),
  }

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
                  <col style={{ width:'24%' }} /><col style={{ width:'10%' }} /><col style={{ width:'10%' }} />
                  <col style={{ width:'12%' }} /><col style={{ width:'10%' }} /><col style={{ width:'10%' }} />
                  <col style={{ width:'12%' }} /><col style={{ width:'12%' }} />
                </colgroup>
                <thead>
                  <tr>
                    {[['프로젝트','left'],['고객사','left'],['담당자','center'],['예상금액','right'],
                      ['중요도','center'],['확도','center'],['상태','center'],['예상월','center']
                    ].map(([h,a],i) => <th key={i} style={{ ...s.th, textAlign:a }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {items.map(opp => (
                    <tr key={opp.id} style={s.tr}
                      onClick={() => onRowClick(opp)}
                      onMouseEnter={e => e.currentTarget.style.background = darkMode?'#1a1a1a':'#f5f3ff'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={s.td}><div style={s.caseName}>{opp.title}</div><div style={s.caseSub}>{opp.product}</div></td>
                      <td style={s.td}><span style={s.chip}>{opp.customer}</span></td>
                      <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{opp.owner || '—'}</span></td>
                      <td style={{ ...s.td, textAlign:'right' }}>{fmtK(opp.amount)}</td>
                      <td style={{ ...s.td, textAlign:'center' }}><PriorityBadge priority={opp.priority} /></td>
                      <td style={{ ...s.td, textAlign:'center' }}><ConfBar pct={opp.confidence || 0} /></td>
                      <td style={{ ...s.td, textAlign:'center' }}><OppStatusBadge status={opp.status} /></td>
                      <td style={{ ...s.td, textAlign:'center' }}><span style={s.chip}>{opp.expected_date || '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      {opps.length === 0 && <div style={s.empty}>오퍼튜니티가 없습니다</div>}
    </div>
  )
}

// ── KPI 칩 ────────────────────────────────────────────
function KpiChip({ label, value, color }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
      <div style={{ width:6, height:6, borderRadius:'50%', background:color }} />
      <span style={{ fontSize:11, color:'#6b7280' }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:500, color:'inherit' }}>{value}</span>
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
    kpiBar:     { display:'flex', alignItems:'center', gap:16, padding:'8px 20px', background:dark?'#0d0d0d':'#f0f0f0', borderBottom:'1px solid '+br },
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
