export default function Note({ darkMode, session }) {
  return (
    <div style={{ padding: 24, color: darkMode ? '#f0f0f0' : '#111827' }}>
      <h2 style={{ fontSize: 14, fontWeight: 500 }}>N · Note</h2>
    </div>
  )
}