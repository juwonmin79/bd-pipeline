import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabase'
import { useDeals } from './useDeals'
import { useOpportunities } from './useOpportunities'
import { FALLBACK_RATES, CCY_SYMS, CCY_LABELS, STATUS_STYLE, OPP_STATUS_STYLE, OPP_STATUS_DB_TO_LABEL, OPP_STATUS_LABEL_TO_DB, OPP_STATUS_OPTIONS, getPriorityGroup, PRIORITY_LABEL, getAlias, getWeekLabel, normalize, expandSearch, fmtQuarter, fmtAmt } from './constants'
import DealDrawer, { StatusBadge, OppStatusBadge, PriorityBadge, ConfBar, ProductCatSelect } from './DealDrawer'
import AddProjectModal from './AddProjectModal'
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

export default function OwnPipeline({ darkMode, session, lastSeen }) {
  const s = useMemo(() => getStyles(darkMode), [darkMode])
  const { ccy, setCcy, rateStatus, fmtK } = useCurrency()
  const myAlias = getAlias(session)

  const [quarterRange] = useState({ start: 0, end: 99 })
  const [drawerItem, setDrawerItem]         = useState(null)
  const [addOppOpen, setAddOppOpen]         = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [toast, setToast]                   = useState(null)
  const [searchQuery, setSearchQuery]       = useState('')

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  const { filteredDeals, quarters, loading: dealsLoading, loadDeals, productCats } = useDeals({
    session, mode: 'personal', quarterRange,
  })
  const { myOpportunities, loading: oppLoading, loadOpportunities, updatePriority, dropOpportunity } = useOpportunities({ session })
  const loading = dealsLoading || oppLoading

  // ── 컬럼 필터 ──────────────────────────────────────
  const [dealCf, setDealCf] = useState({ caseName:[], customer:[], quarter:[], status:[], owner:[] })
  const [oppCf,  setOppCf]  = useState({ title:[], customer:[], status:[], owner:[] })
  const [dealSort, setDealSort] = useState({ key: null, dir: null })
  const [oppSort,  setOppSort]  = useState({ key: null, dir: null })
  const setDealFilter = (k, v) => setDealCf(p => ({ ...p, [k]: v }))
  const setOppFilter  = (k, v) => setOppCf(p  => ({ ...p, [k]: v }))
  const handleDealSort = (key, dir) => setDealSort({ key: dir ? key : null, dir })
  const handleOppSort  = (key, dir) => setOppSort({ key: dir ? key : null, dir })

  const dk = darkMode

  // 딜 필터 옵션 — 분기는 fmtQuarter 표시
  const statusLabelMap = Object.fromEntries(Object.entries(STATUS_STYLE).map(([k,v]) => [k, v.label]))
  const statusKeyMap   = Object.fromEntries(Object.entries(STATUS_STYLE).map(([k,v]) => [v.label, k]))
  const rawStatuses    = [...new Set(filteredDeals.map(d => d.status).filter(Boolean))]
  const dealOpts = {
    caseName: [...new Set(filteredDeals.map(d => d.case_name).filter(Boolean))].sort(),
    customer: [...new Set(filteredDeals.map(d => d.customer).filter(Boolean))].sort(),
    quarter:  [...new Set(filteredDeals.map(d => d.quarter).filter(Boolean))].sort().map(q => fmtQuarter(q)),
    status:   rawStatuses.map(st => statusLabelMap[st] || st).sort(),
    owner:    [...new Set(filteredDeals.map(d => d.created_by).filter(Boolean))].sort(),
  }
  const oppOpts = {
    title:    [...new Set(myOpportunities.map(o => o.title).filter(Boolean))].sort(),
    customer: [...new Set(myOpportunities.map(o => o.customer).filter(Boolean))].sort(),
    status:   ['기획 중', '포캐스트', '드랍'],
    owner:    [...new Set(myOpportunities.map(o => o.owner).filter(Boolean))].sort(),
  }
  

  // 필터 적용
  const columnFilteredDeals = filteredDeals.filter(d => {
    if (dealCf.caseName.length > 0 && !dealCf.caseName.includes(d.case_name)) return false
    if (dealCf.customer.length > 0 && !dealCf.customer.includes(d.customer)) return false
    if (dealCf.quarter.length  > 0 && !dealCf.quarter.includes(fmtQuarter(d.quarter))) return false
    if (dealCf.status.length   > 0 && !dealCf.status.includes(statusLabelMap[d.status] || d.status)) return false
    if (dealCf.owner.length    > 0 && !dealCf.owner.includes(d.created_by)) return false
    return true
  }).sort((a, b) => {
    if (!dealSort.key || !dealSort.dir) return 0
    const mul = dealSort.dir === 'asc' ? 1 : -1
    if (dealSort.key === 'book_amount') return ((a.book_amount||0) - (b.book_amount||0)) * mul
    if (dealSort.key === 'reflect')     return ((a.book_amount*a.probability/100) - (b.book_amount*b.probability/100)) * mul
    if (dealSort.key === 'start_month') return String(a.start_month||'').localeCompare(String(b.start_month||'')) * mul
    if (dealSort.key === 'end_month')   return String(a.end_month||'').localeCompare(String(b.end_month||'')) * mul
    const aVal = dealSort.key === 'caseName' ? a.case_name : dealSort.key === 'customer' ? a.customer : dealSort.key === 'quarter' ? a.quarter : dealSort.key === 'owner' ? a.created_by : a[dealSort.key]
    const bVal = dealSort.key === 'caseName' ? b.case_name : dealSort.key === 'customer' ? b.customer : dealSort.key === 'quarter' ? b.quarter : dealSort.key === 'owner' ? b.created_by : b[dealSort.key]
    return String(aVal||'').localeCompare(String(bVal||'')) * mul
  })
  const columnFilteredOpps = myOpportunities.filter(o => {
    if (oppCf.title.length    > 0 && !oppCf.title.includes(o.title))    return false
    if (oppCf.customer.length > 0 && !oppCf.customer.includes(o.customer)) return false
    if (oppCf.owner.length    > 0 && !oppCf.owner.includes(o.owner))    return false
    if (oppCf.status.length   > 0) {
      const label = OPP_STATUS_DB_TO_LABEL[o.status] || o.status
      if (!oppCf.status.includes(label)) return false
    }
    if (searchQuery.trim()) {
      const terms = expandSearch(searchQuery)
      const match = str => terms.some(t => normalize(str).includes(t))
      if (!match(o.title) && !match(o.customer)) return false
    }
    return true
  }).sort((a, b) => {
    if (!oppSort.key || !oppSort.dir) return 0
    const mul = oppSort.dir === 'asc' ? 1 : -1
    if (oppSort.key === 'amount')        return ((a.amount||0) - (b.amount||0)) * mul
    if (oppSort.key === 'expected_date') return String(a.expected_date||'').localeCompare(String(b.expected_date||'')) * mul
    if (oppSort.key === 'confidence')    return ((a.confidence||0) - (b.confidence||0)) * mul
    return 0
  })

  // 사업 기회 그룹
  const oppGrouped = {
    high:  columnFilteredOpps.filter(o => getPriorityGroup(o.priority) === 'high'),
    mid:   columnFilteredOpps.filter(o => getPriorityGroup(o.priority) === 'mid'),
    low:   columnFilteredOpps.filter(o => getPriorityGroup(o.priority) === 'low'),
    dummy: columnFilteredOpps.filter(o => getPriorityGroup(o.priority) === 'dummy'),
  }

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
        <span style={s.pageTitle}>{myAlias} 님의 뷰</span>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6 }}>
          <input style={s.searchInput} placeholder="프로젝트 / 고객사 검색" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          <div style={{ width:'1px', height:20, background: dk?'#2a2a2a':'#e5e7eb', margin:'0 2px' }} />
          <div style={s.ccyWrap}>
            <span style={s.ccyLabel}>단위</span>
            <select style={s.ccySel} value={ccy} onChange={e => setCcy(e.target.value)}>
              {['KRW','USD','CNY','JPY','EUR'].map(c => <option key={c} value={c}>{CCY_LABELS[c]}</option>)}
            </select>
            <div style={{ ...s.rateDot, background: rateStatus==='live' ? '#4ade80' : '#fbbf24' }} />
          </div>
        </div>
      </div>

      {/* ── 바디: 상/하 분할 ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* ── 상단: 계약 건 ── */}
        {/* 컬럼: 프로젝트 / 고객사 / 분기 / 상태 / 담당자 / 계약금액 / 반영금액 / 착수 / 종료 */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 24px 6px', flexShrink:0 }}>
            <span style={s.sectionTitle}>계약 건</span>
            <span style={s.sectionCount}>{columnFilteredDeals.length}건</span>
            {columnFilteredDeals.length !== filteredDeals.length && (
              <span style={{ fontSize:11, color:'#7c3aed' }}>/ 전체 {filteredDeals.length}건</span>
            )}
            <button style={s.addIconBtn} onClick={() => setAddProjectOpen(true)} title="계약 건 추가">+</button>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'0 24px 12px' }}>
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
                    <ColumnFilter label="프로젝트" align="left"   options={dealOpts.caseName} value={dealCf.caseName} onChange={v => setDealFilter('caseName',v)} thStyle={s.th} darkMode={dk} withSearch sortable={false} />
                    {/* 체크박스만 */}
                    <ColumnFilter label="고객사"   align="left"   options={dealOpts.customer} value={dealCf.customer} onChange={v => setDealFilter('customer',v)} thStyle={s.th} darkMode={dk} />
                    <ColumnFilter label="분기"     align="center" options={dealOpts.quarter}  value={dealCf.quarter}  onChange={v => setDealFilter('quarter',v)}  thStyle={s.th} darkMode={dk} />
                    <ColumnFilter label="상태"     align="center" options={dealOpts.status}   value={dealCf.status}   onChange={v => setDealFilter('status',v)}   thStyle={s.th} darkMode={dk} />
                    <ColumnFilter label="담당자"   align="center" options={dealOpts.owner}    value={dealCf.owner}    onChange={v => setDealFilter('owner',v)}    thStyle={s.th} darkMode={dk} />
                    {/* 정렬만 */}
                    <ColumnFilter label="계약금액" align="right"  options={[]} value={[]} onChange={()=>{}} onSort={dir => handleDealSort('book_amount',dir)} sortDir={dealSort.key==='book_amount'?dealSort.dir:null} thStyle={s.th} darkMode={dk} sortable filterable={false} />
                    <ColumnFilter label="반영금액" align="right"  options={[]} value={[]} onChange={()=>{}} onSort={dir => handleDealSort('reflect',dir)}     sortDir={dealSort.key==='reflect'?dealSort.dir:null}     thStyle={s.th} darkMode={dk} sortable filterable={false} />
                    <ColumnFilter label="착수"     align="center" options={[]} value={[]} onChange={()=>{}} onSort={dir => handleDealSort('start_month',dir)}  sortDir={dealSort.key==='start_month'?dealSort.dir:null}  thStyle={s.th} darkMode={dk} sortable filterable={false} />
                    <ColumnFilter label="종료"     align="center" options={[]} value={[]} onChange={()=>{}} onSort={dir => handleDealSort('end_month',dir)}    sortDir={dealSort.key==='end_month'?dealSort.dir:null}    thStyle={s.th} darkMode={dk} sortable filterable={false} />
                  </tr>
                </thead>
                <tbody>
                  {columnFilteredDeals.length === 0 ? (
                    <tr><td colSpan={9} style={s.empty}>담당 프로젝트가 없습니다</td></tr>
                  ) : columnFilteredDeals.map(deal => {
                    const isNew = lastSeen && deal.created_at && new Date(deal.created_at) > new Date(lastSeen)
                    return (
                    <tr key={deal.id}
                      style={{ ...s.tr, boxShadow: isNew ? 'inset 3px 0 0 #7c3aed' : 'none' }}
                      onClick={() => setDrawerItem({ type:'deal', data:deal })}
                      onMouseEnter={e => e.currentTarget.style.background = dk?'#1a1a1a':'#f5f3ff'}
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
          </div>
        </div>

        {/* ── 구분선 ── */}
        <div style={{ flexShrink:0, height:1, borderTop:`1px dashed ${dk?'#2a2a2a':'#d1d5db'}`, margin:'4px 24px' }} />

        {/* ── 하단: 사업 기회 ── */}
        {/* 컬럼: 프로젝트 / 고객사 / 상태 / 담당자 / 예상금액 / 예상월 / 확도 / 중요도 */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 24px 6px', flexShrink:0 }}>
            <span style={s.sectionTitle}>사업 기회</span>
            <span style={s.sectionCount}>{columnFilteredOpps.length}건</span>
            {columnFilteredOpps.length !== myOpportunities.length && (
              <span style={{ fontSize:11, color:'#7c3aed' }}>/ 전체 {myOpportunities.length}건</span>
            )}
            <button style={s.addIconBtn} onClick={() => setAddOppOpen(true)} title="사업 기회 추가">+</button>
          </div>

          {myOpportunities.length === 0 ? (
            <div style={{ textAlign:'center', padding:'32px 0' }}>
              <p style={{ fontSize:13, color:'#6b7280' }}>등록된 사업 기회가 없어요</p>
            </div>
          ) : (
            <div style={{ flex:1, overflowY:'auto', padding:'0 24px 16px', display:'flex', flexDirection:'column', gap:12 }}>
              {['high','mid','low','dummy'].map(group => {
                const items = oppGrouped[group]
                if (items.length === 0) return null
                const { label, color, bg } = PRIORITY_LABEL[group]
                return (
                  <div key={group}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                      <span style={{ fontSize:11, fontWeight:500, background:bg, color, padding:'2px 10px', borderRadius:99 }}>{label}</span>
                      <span style={s.sectionCount}>{items.length}건</span>
                      <div style={{ flex:1, height:'0.5px', background: dk?'#1f1f1f':'#e2e2e2' }} />
                    </div>
                    <div style={s.tableCard}>
                      <table style={s.tbl}>
                        <colgroup>
                          <col style={{ width:'22%' }} /><col style={{ width:'11%' }} /><col style={{ width:'10%' }} />
                          <col style={{ width:'10%' }} /><col style={{ width:'13%' }} /><col style={{ width:'10%' }} />
                          <col style={{ width:'10%' }} /><col style={{ width:'10%' }} />
                        </colgroup>
                        <thead>
                          <tr>
                            {/* 검색만 */}
                            <ColumnFilter label="프로젝트" align="left" options={oppOpts.title}    value={oppCf.title}    onChange={v => setOppFilter('title',v)}    thStyle={s.th} darkMode={dk} withSearch sortable={false} />
                            {/* 체크박스만 */}
                            <ColumnFilter label="고객사"   align="left" options={oppOpts.customer} value={oppCf.customer} onChange={v => setOppFilter('customer',v)} thStyle={s.th} darkMode={dk} />
                            {/* 체크박스만 */}
                            <ColumnFilter label="상태"   align="center" options={oppOpts.status} value={oppCf.status} onChange={v => setOppFilter('status',v)} thStyle={s.th} darkMode={dk} />
                            <ColumnFilter label="담당자" align="center" options={oppOpts.owner}  value={oppCf.owner}  onChange={v => setOppFilter('owner',v)}  thStyle={s.th} darkMode={dk} />
                            {/* 정렬만 */}
                            <ColumnFilter label="예상금액" align="right"  options={[]} value={[]} onChange={()=>{}} onSort={dir => handleOppSort('amount',dir)}        sortDir={oppSort.key==='amount'?oppSort.dir:null}        thStyle={s.th} darkMode={dk} sortable filterable={false} />
                            <ColumnFilter label="예상월"   align="center" options={[]} value={[]} onChange={()=>{}} onSort={dir => handleOppSort('expected_date',dir)} sortDir={oppSort.key==='expected_date'?oppSort.dir:null} thStyle={s.th} darkMode={dk} sortable filterable={false} />
                            <ColumnFilter label="확도"     align="center" options={[]} value={[]} onChange={()=>{}} onSort={dir => handleOppSort('confidence',dir)}    sortDir={oppSort.key==='confidence'?oppSort.dir:null}    thStyle={s.th} darkMode={dk} sortable filterable={false} />
                            {/* 아무것도 없음 */}
                            <th style={{ ...s.th, textAlign:'center' }}>중요도</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(opp => {
                            const isNew = lastSeen && opp.created_at && new Date(opp.created_at) > new Date(lastSeen)
                            return (
                            <tr key={opp.id}
                              style={{ ...s.tr, boxShadow: isNew ? 'inset 3px 0 0 #7c3aed' : 'none' }}
                              onClick={() => setDrawerItem({ type:'opp', data:opp })}
                              onMouseEnter={e => e.currentTarget.style.background = dk?'#1a1a1a':'#f5f3ff'}
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
            </div>
          )}
        </div>
      </div>

      {/* ── DealDrawer (공용) — showDrop=true (내 파이프라인은 드랍 허용) ── */}
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
          onDrop={async (oppId) => {
            const { error } = await dropOpportunity(oppId)
            if (!error) { showToast('사업 기회를 드랍했어요', 'info'); setDrawerItem(null) }
          }}
          onPriorityChange={async (oppId, p) => { await updatePriority(oppId, p); loadOpportunities() }}
          onRefreshDeals={loadDeals}
          onRefreshOpps={loadOpportunities}
        />
      )}

      {/* ── 사업 기회 추가 모달 ── */}
      {addOppOpen && (
        <AddOpportunityModal
          darkMode={dk}
          session={session}
          productCats={productCats}
          onClose={() => setAddOppOpen(false)}
          onSaved={() => { setAddOppOpen(false); loadOpportunities(); showToast('사업 기회를 추가했어요') }}
        />
      )}

      {/* ── 프로젝트 추가 모달 ── */}
      {addProjectOpen && (
        <AddProjectModal
          quarters={quarters}
          owners={[myAlias]}
          productCats={productCats}
          session={session}
          darkMode={dk}
          onClose={() => setAddProjectOpen(false)}
          onSaved={() => { setAddProjectOpen(false); loadDeals(); showToast('프로젝트를 추가했어요') }}
        />
      )}

      {/* ── 토스트 ── */}
      {toast && (
        <div style={{
          position:'fixed', bottom:24, right:24, zIndex:9999,
          background: toast.type==='info' ? (dk?'#0f2010':'#f0fdf4') : (dk?'#1e1635':'#ede9fe'),
          border: `1px solid ${toast.type==='info' ? '#4ade80' : '#7c3aed'}`,
          color: toast.type==='info' ? (dk?'#4ade80':'#16a34a') : (dk?'#c4b5fd':'#5b21b6'),
          padding:'10px 18px', borderRadius:8, fontSize:13, fontWeight:500, fontFamily:"'Geist', sans-serif",
        }}>{toast.msg}</div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// AddOpportunityModal
// ─────────────────────────────────────────────────────
function AddOpportunityModal({ darkMode, session, onClose, onSaved, productCats = [] }) {
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState(null)
  const [title, setTitle]           = useState('')
  const [customer, setCustomer]     = useState('')
  const [product, setProduct]       = useState('')
  const [currency, setCurrency]     = useState('KRW')
  const [amount, setAmount]         = useState(0)
  const [expectedDate, setExpectedDate] = useState('')
  const [statusLabel, setStatusLabel]   = useState('기획 중')
  const [confidence, setConfidence] = useState(0)
  const [priority, setPriority]     = useState(5)
  const PRIORITY_OPTS = [
    { val:'high', range:[1,3], label:'HIGH', color:'#D85A30', bg:'#FAECE7' },
    { val:'mid',  range:[4,6], label:'MID',  color:'#BA7517', bg:'#FAEEDA' },
    { val:'low',  range:[7,9], label:'LOW',  color:'#639922', bg:'#EAF3DE' },
  ]
  const currentGroup = priority <= 3 ? 'high' : priority <= 6 ? 'mid' : 'low'

  const handleSave = async () => {
    const pc = product.replace('\u200b','').trim()
    if (!title.trim())    { setError('프로젝트명을 입력해주세요'); return }
    if (!customer.trim()) { setError('고객사를 입력해주세요'); return }
    if (!pc)              { setError('제품구분을 선택해주세요'); return }
    if (!amount)          { setError('예상금액을 입력해주세요'); return }
    if (!expectedDate)    { setError('예상 계약월을 입력해주세요'); return }
    setSaving(true); setError(null)
    const { error: e } = await supabase.from('opportunities').insert({
      title: title.trim(), customer: customer.trim(), product: pc,
      currency, amount,
      expected_date: expectedDate,
      status: OPP_STATUS_LABEL_TO_DB[statusLabel] || 'Idea',
      confidence, priority,
      owner: getAlias(session), is_active: true,
      created_at: new Date().toISOString(),
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    onSaved()
  }

  const dk = darkMode
  const bg = dk?'#111':'#fff', br = dk?'#2a1f5c':'#e5e7eb', tx = dk?'#f0f0f0':'#111'
  const inp = { fontSize:12, padding:'7px 9px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:dk?'#1a1a1a':'#f9fafb', color:tx, fontFamily:"'Geist', sans-serif", outline:'none', width:'100%', boxSizing:'border-box' }
  const lbl = { fontSize:11, color:'#6b7280', marginBottom:4, display:'block' }
  const field = { display:'flex', flexDirection:'column', gap:3 }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:20 }}>
      <div style={{ background:bg, border:`1px solid ${br}`, borderRadius:12, width:'100%', maxWidth:580, overflow:'hidden', fontFamily:"'Geist', sans-serif" }}>
        <div style={{ background:dk?'#1e1635':'#f5f3ff', padding:'13px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:`1px solid ${br}` }}>
          <span style={{ fontSize:13, fontWeight:500, color:dk?'#c4b5fd':'#5b21b6' }}>+ 사업 기회 추가</span>
          <button onClick={onClose} style={{ fontSize:20, color:'#7c3aed', background:'none', border:'none', cursor:'pointer', lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:'20px 20px 0' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:12, marginBottom:14 }}>
            <div style={{ ...field, gridColumn:'span 2' }}><label style={lbl}>프로젝트명 *</label><input style={inp} value={title} onChange={e => setTitle(e.target.value)} /></div>
            <div style={field}><label style={lbl}>고객사</label><input style={inp} value={customer} onChange={e => setCustomer(e.target.value)} /></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:12, marginBottom:14 }}>
            <div style={field}>
              <label style={lbl}>제품구분</label>
              <ProductCatSelect value={product} onChange={setProduct} productCats={productCats} inp={inp} darkMode={dk} />
            </div>
            <div style={field}><label style={lbl}>통화</label>
              <select style={inp} value={currency} onChange={e => setCurrency(e.target.value)}>
                {['KRW','USD','CNY','JPY','EUR'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={field}><label style={lbl}>예상 금액 (K)</label><input style={inp} type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} /></div>
            <div style={field}><label style={lbl}>예상 계약월</label><input style={inp} type="month" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} /></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
            <div style={field}>
              <label style={lbl}>상태</label>
              <div style={{ display:'flex', gap:6 }}>
                {OPP_STATUS_OPTIONS.map(v => (
                  <button key={v}
                    style={{ fontSize:11, padding:'4px 10px', borderRadius:5, border:`1px solid ${statusLabel===v?'#7c3aed':dk?'#2a2a2a':'#e5e7eb'}`, background:statusLabel===v?'rgba(124,58,237,0.1)':'transparent', color:statusLabel===v?'#7c3aed':'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}
                    onClick={() => setStatusLabel(v)}>{v}</button>
                ))}
              </div>
            </div>
            <div style={field}><label style={lbl}>확도 (%)</label><input style={inp} type="number" min={0} max={100} value={confidence} onChange={e => setConfidence(Number(e.target.value))} /></div>
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={lbl}>초기 중요도</label>
            <div style={{ display:'flex', gap:8 }}>
              {PRIORITY_OPTS.map(({ val, range, label, color, bg: pbg }) => (
                <button key={val}
                  style={{ fontSize:12, padding:'6px 20px', borderRadius:99, border:`1.5px solid ${currentGroup===val?color:dk?'#2a2a2a':'#e5e7eb'}`, background:currentGroup===val?pbg:'transparent', color:currentGroup===val?color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif", fontWeight:currentGroup===val?500:400 }}
                  onClick={() => setPriority(range[0])}>{label}</button>
              ))}
            </div>
          </div>
          {error && <div style={{ fontSize:12, color:'#f87171', marginBottom:12 }}>{error}</div>}
        </div>
        <div style={{ padding:'12px 20px', background:dk?'#0d0d0d':'#f9fafb', display:'flex', justifyContent:'flex-end', gap:8, borderTop:`1px solid ${br}` }}>
          <button onClick={onClose} style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:`1px solid ${dk?'#2a2a2a':'#e5e7eb'}`, background:'transparent', color:'#6b7280', cursor:'pointer', fontFamily:"'Geist', sans-serif" }}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{ fontSize:12, padding:'6px 18px', borderRadius:6, border:'none', background:saving?'#4c1d95':'#7c3aed', color:'#f0f0f0', cursor:saving?'not-allowed':'pointer', fontWeight:500, fontFamily:"'Geist', sans-serif" }}>{saving?'저장 중...':'저장'}</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 스타일
// ─────────────────────────────────────────────────────
function getStyles(dark) {
  const bg1 = dark?'#111':'#fff', bg2 = dark?'#1a1a1a':'#f0f0f0', bg3 = dark?'#0d0d0d':'#e8e8e8'
  const br  = dark?'#1f1f1f':'#e2e2e2', br2 = dark?'#2a2a2a':'#d1d5db'
  const tx0 = dark?'#f0f0f0':'#111', tx1 = dark?'#6b7280':'#6b7280', tx2 = dark?'#d1d5db':'#374151', tx3 = dark?'#4b5563':'#9ca3af'
  return {
    wrap:        { flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:dark?'#0a0a0a':'#f5f5f7', fontFamily:"'Geist', sans-serif" },
    toolbar:     { display:'flex', alignItems:'center', padding:'8px 24px', background:dark?'#0f0f0f':'#fafafa', borderBottom:'1px solid '+br, gap:8, flexShrink:0 },
    pageTitle:   { fontSize:13, fontWeight:500, color:tx0 },
    ccyWrap:     { display:'flex', alignItems:'center', gap:6, height:30, background:bg2, border:'1px solid '+br2, borderRadius:8, padding:'0 10px' },
    ccyLabel:    { fontSize:11, color:tx1 },
    ccySel:      { fontSize:12, fontWeight:500, color:tx0, border:'none', background:'transparent', cursor:'pointer', fontFamily:"'Geist', sans-serif" },
    rateDot:     { width:6, height:6, borderRadius:'50%' },
    sectionTitle:{ fontSize:13, fontWeight:500, color:tx0 },
    sectionCount:{ fontSize:11, color:tx1, background:bg2, padding:'2px 8px', borderRadius:99 },
    tableCard:   { background:bg1, border:'1px solid '+br, borderRadius:10, overflow:'hidden' },
    tbl:         { width:'100%', borderCollapse:'collapse', tableLayout:'fixed' },
    th:          { fontSize:11, fontWeight:500, color:tx3, padding:'7px 14px', borderBottom:'1px solid '+br, background:bg3, whiteSpace:'nowrap' },
    td:          { fontSize:12, color:tx2, padding:'9px 14px', borderBottom:'1px solid '+(dark?'#161616':'#f0f0f0'), verticalAlign:'middle' },
    tr:          { cursor:'pointer', transition:'background .1s' },
    empty:       { padding:'28px', textAlign:'center', color:'#6b7280', fontSize:13 },
    caseName:    { fontSize:12, fontWeight:500, color:dark?'#e5e7eb':'#111827', marginBottom:2 },
    caseSub:     { fontSize:11, color:tx1 },
    chip:        { fontSize:11, color:tx1, background:bg2, padding:'2px 7px', borderRadius:4 },
    searchInput: { fontSize:12, padding:'0 10px', height:30, borderRadius:6, border:'1px solid '+br2, background:bg2, color:tx0, fontFamily:"'Geist', sans-serif", outline:'none', width:180 },
    addIconBtn:  { width:22, height:22, borderRadius:5, border:'1px solid '+br2, background:'transparent', color:tx1, cursor:'pointer', fontFamily:"'Geist', sans-serif", fontSize:16, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, padding:0 },
  }
}
