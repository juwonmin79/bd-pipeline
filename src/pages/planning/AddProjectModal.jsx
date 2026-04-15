import { useState } from 'react'
import { supabase } from '../../supabase'
import { getAlias, fmtQuarter, COUNTRY_OPTIONS } from './constants'
import { ProductCatSelect } from './DealDrawer'

export default function AddProjectModal({ quarters, owners, productCats, session, darkMode, onClose, onSaved }) {
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
    const pc = productCat.replace('\u200b','').trim()
    if (!caseName.trim())  { setError('프로젝트명을 입력해주세요'); return }
    if (!customer.trim())  { setError('고객사를 입력해주세요'); return }
    if (!country.trim())   { setError('국가를 입력해주세요'); return }
    if (!pc)               { setError('제품구분을 선택해주세요'); return }
    if (!quarter)          { setError('분기를 선택해주세요'); return }
    if (!conf && conf !== 0) { setError('확도를 입력해주세요'); return }
    if (!amt)              { setError('계약금액을 입력해주세요'); return }
    if (!startMonth)       { setError('착수월을 입력해주세요'); return }
    if (!endMonth)         { setError('종료월을 입력해주세요'); return }
    const owner = createdBy || getAlias(session)
    if (!owner)            { setError('담당자를 선택해주세요'); return }
    setSaving(true); setError(null)
    const { error } = await supabase.from('projects').insert({
      case_name: caseName.trim(), customer: customer.trim(), product_cat: pc,
      country: country.trim(), quarter, status,
      book_amount: amt, probability: conf,
      start_month: startMonth, end_month: endMonth,
      contract_month: contractMonth || null, comment,
      created_by: owner,
      is_simulation: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
            <div style={field}><label style={lbl}>고객사 *</label><input style={inp} value={customer} onChange={e => setCustomer(e.target.value)} /></div>
            <div style={field}><label style={lbl}>국가 *</label><select style={{...inp}} value={country} onChange={e => setCountry(e.target.value)}><option value="">선택</option>{COUNTRY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select></div>
            <div style={field}><label style={lbl}>제품구분 *</label><ProductCatSelect value={productCat} onChange={setProductCat} productCats={productCats||[]} inp={inp} darkMode={dk} /></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,minmax(0,1fr))', gap:12, marginBottom:14 }}>
            <div style={field}><label style={lbl}>분기 *</label><select style={{...inp}} value={quarter} onChange={e => setQuarter(e.target.value)}><option value="">선택</option>{[...( quarters||[]),'2026-Q1','2026-Q2','2026-Q3','2026-Q4'].filter((v,i,a)=>a.indexOf(v)===i).sort().map(q => <option key={q} value={q}>{fmtQuarter(q)}</option>)}</select></div>
            <div style={field}><label style={lbl}>예상 계약월</label><input style={inp} type="month" value={contractMonth} onChange={e => setContractMonth(e.target.value)} /></div>
            <div style={field}><label style={lbl}>확도 (%) *</label><input style={inp} type="number" min={0} max={100} value={conf} onChange={e => setConf(Number(e.target.value))} /></div>
            <div style={field}><label style={lbl}>계약금액 (K) *</label><input style={inp} type="number" step={1000} value={amt} onChange={e => setAmt(Number(e.target.value))} /></div>
            <div style={field}><label style={lbl}>반영금액 (자동)</label><input style={{...inp,color:'#6b7280'}} value={reflect.toLocaleString()+' K'} readOnly /></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 2fr', gap:12, marginBottom:14 }}>
            <div style={field}><label style={lbl}>착수월 *</label><input style={inp} type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} /></div>
            <div style={field}><label style={lbl}>종료월 *</label><input style={inp} type="month" value={endMonth} onChange={e => setEndMonth(e.target.value)} /></div>
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
