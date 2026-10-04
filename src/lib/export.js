// Export to a file Excel opens directly: CSV with ';' separator (French Excel) and a UTF-8 BOM (accents)
export function exportExcel(filename, columns, rows) {
  const cell = (v) => {
    if (v == null) return ''
    if (typeof v === 'number') return String(v).replace('.', ',')
    const s = String(v)
    return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const lines = [columns.map((c) => cell(c.label)).join(';'), ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(';'))]
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${new Date().toLocaleDateString('en-CA')}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
