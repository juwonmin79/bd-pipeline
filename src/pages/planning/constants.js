// ── 공용 상수 & 헬퍼 ─────────────────────────────────
export const FALLBACK_RATES = { KRW: 1, USD: 1/1510, CNY: 1/217, JPY: 1/9.47, EUR: 1/1728 }
export const CCY_SYMS   = { KRW: '', USD: '$', CNY: '¥', JPY: '¥', EUR: '€' }
export const CCY_LABELS = { KRW: '원화', USD: 'USD', CNY: 'CNY', JPY: 'JPY', EUR: 'EUR' }

export const CUSTOMER_ALIASES = {
  'lgu+':    ['lgu', 'lg유플러스', '엘지유플러스', 'lgup', 'lguplus', '유플러스'],
  'kgm':     ['kgmotors', 'kg모빌리티', '케이지모빌리티', '쌍용', 'ssangyong', 'kgmobility'],
  'lge':     ['lg전자', 'lgelectronics', '엘지전자', 'lg이노텍'],
  '타타대우':  ['tata', '타타', '대우상용차', 'tatadaewoo', 'daewoo'],
  '효림xe':   ['효림', 'hyorim', 'hyorimxe', 'xe'],
  'hl만도':   ['만도', 'mando', 'hl', 'hlmando', '에이치엘만도'],
  '티맵':     ['tmap', 'tmobility', '티맵모빌리티', 'tmapmobility'],
  'mobis':   ['현대모비스', 'hyundaimobis', '모비스'],
  'hmgc':    ['현대차그룹', 'hyundaimotorgroup', '현대그룹', 'hmg'],
  'tmobi':   ['티모비', 'tmobi', '티모바일'],
  'como':    ['코모', 'comovehicle', '코모비히클'],
  '팅크웨어':  ['thinkware', '씽크웨어', 'inad', '아이나비', 'inavi'],
  'kgict':   ['kg아이씨티', 'kg정보통신', 'kginformation'],
  'hkmc':    ['현대기아차', '현대기아자동차', 'hyundaikia', '현대차', '현대자동차',
               'hyundai', 'kia', '기아', '기아차', 'hkmotor'],
  '삼성화재':  ['samsung화재', 'samsungfire', '삼성화재보험'],
  '현대로템':  ['rotem', '로템', 'hyundairotem'],
  '42dot':   ['포티투닷', '포티투', '포티', '42', '42닷', 'fortytwo', 'forty', 'fourtytwo'],
  'rkm':     ['르노코리아', 'renaultkorea', '르노삼성', 'renault', '르노', 'renaul'],
  '오토에버':  ['autoever', 'hyundaiautoever', '현대오토에버'],
  'volvo':   ['볼보', 'volvocar', 'volvotruck', '볼보트럭', '볼보카'],
  'bmw':     ['비엠더블유', 'bmwkorea', '비엠', 'bmwgroup'],
  'benz':    ['mercedes', '벤츠', '메르세데스', 'mercedesbenz', 'mb', '메르세데스벤츠', 'mbkorea'],
}

export const STATUS_STYLE = {
  won:     { bg: 'rgba(74,222,128,0.15)',  color: '#16a34a', label: '계약' },
  active:  { bg: 'rgba(96,165,250,0.15)',  color: '#2563eb', label: '진행중' },
  drop:    { bg: 'rgba(248,113,113,0.15)', color: '#dc2626', label: '드랍' },
  pending: { bg: 'rgba(251,191,36,0.15)',  color: '#d97706', label: '대기' },
}

export const CATEGORY_STYLE = {
  Pick:     { bg: 'rgba(96,165,250,0.15)',  color: '#2563eb' },
  New:      { bg: 'rgba(74,222,128,0.15)',  color: '#16a34a' },
  Maintain: { bg: 'rgba(251,191,36,0.15)', color: '#d97706' },
  Drop:     { bg: 'rgba(248,113,113,0.15)', color: '#dc2626' },
}

// 오퍼튜니티 중요도
export const PRIORITY_LABEL = {
  high: { label: 'HIGH', range: [1, 3], color: '#D85A30', bg: '#FAECE7' },
  mid:  { label: 'MID',  range: [4, 6], color: '#BA7517', bg: '#FAEEDA' },
  low:  { label: 'LOW',  range: [7, 9], color: '#639922', bg: '#EAF3DE' },
  dummy:{ label: 'DUMMY',range: [10,10],color: '#888780', bg: '#F1EFE8' },
}
export const getPriorityGroup = (p) => {
  if (p <= 3) return 'high'
  if (p <= 6) return 'mid'
  if (p <= 9) return 'low'
  return 'dummy'
}

// 사업 기회 status — DB값(영문) → 표시값(한글) 매핑
// DB에는 'Idea' | 'In Progress' | 'Forecast' | 'Promoted' | 'Dropped' 저장
// UI에서는 '기획 중' | '포캐스트' | '드랍' 으로 표시
export const OPP_STATUS_OPTIONS = ['기획 중', '포캐스트', '드랍']  // UI 선택용
export const OPP_STATUS = ['Idea', 'In Progress', 'Forecast', 'Promoted', 'Dropped'] // 하위호환용

export const OPP_STATUS_DB_TO_LABEL = {
  'Idea':       '기획 중',
  'In Progress':'포캐스트',
  'Forecast':   '포캐스트',
  'Promoted':   '포캐스트',
  'Dropped':    '드랍',
}
export const OPP_STATUS_LABEL_TO_DB = {
  '기획 중': 'Idea',
  '포캐스트': 'In Progress',
  '드랍':    'Dropped',
}

// 사업 기회 상태 스타일 (DB값 또는 한글값 모두 지원)
export const OPP_STATUS_STYLE = {
  'Idea':       { bg: '#F1EFE8', color: '#444441' },
  'In Progress':{ bg: '#E6F1FB', color: '#0C447C' },
  'Forecast':   { bg: '#FAEEDA', color: '#633806' },
  'Promoted':   { bg: '#EAF3DE', color: '#27500A' },
  'Dropped':    { bg: '#FCEBEB', color: '#791F1F' },
  '기획 중':    { bg: '#F1EFE8', color: '#444441' },
  '포캐스트':   { bg: '#E6F1FB', color: '#0C447C' },
  '드랍':       { bg: '#FCEBEB', color: '#791F1F' },
}

export const normalize = (str) => (str || '').toLowerCase().replace(/[\s\+\-\_\.]/g, '')
export const expandSearch = (query) => {
  const q = normalize(query)
  for (const [key, aliases] of Object.entries(CUSTOMER_ALIASES)) {
    if (normalize(key).includes(q) || aliases.some(a => normalize(a).includes(q))) {
      return [key, ...aliases]
    }
  }
  return [q]
}
export const getAlias = (session) =>
  session?.user?.user_metadata?.alias ||
  session?.user?.email?.split('@')[0] ||
  'unknown'

// 주차 계산
export const getWeekLabel = (date = new Date()) => {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `W${String(weekNum).padStart(2, '0')}`
}

// 분기 포맷: '2025-Q4' → '25Q4'
export const fmtQuarter = (q) => {
  if (!q) return '—'
  const m = q.match(/^(\d{4})-Q(\d)$/)
  if (!m) return q
  return `${m[1].slice(2)}Q${m[2]}`
}

// 금액 포맷 (DB 단위: 만원)
// 890,000 → 89억 / 10,000 → 1억 / 1,000 → 0.1억
export const fmtAmt = (man, rates, ccy = 'KRW') => {
  if (!man) return '—'
  const rate = rates ? (rates[ccy] || 1) : 1
  const converted = man * rate
  if (ccy === 'KRW') {
    const uk = converted / 10000
    return `${parseFloat(uk.toFixed(1))}억`
  }
  // 외화: 만원 → 원 → 외화 변환 후 K 단위
  const won = man * 10000
  const v = won * rate
  const s = CCY_SYMS[ccy]
  if (ccy === 'JPY') return s + Math.round(v / 10).toLocaleString() + '万'
  return s + (v / 1000).toFixed(1) + 'K'
}

// 국가 옵션 (환율 기준)
export const COUNTRY_OPTIONS = [
  { code: 'KR', label: 'KR — 한국' },
  { code: 'US', label: 'US — 미국' },
  { code: 'CN', label: 'CN — 중국' },
  { code: 'JP', label: 'JP — 일본' },
  { code: 'EU', label: 'EU — 유럽' },
]