// Amount in French words, as written at the bottom of an invoice:
// « Arrêtée la présente facture à la somme de quarante-neuf mille francs CFA »
const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf']
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt']

// 0–99
function deuxChiffres(n) {
  if (n < 20) return UNITES[n]
  const d = Math.floor(n / 10)
  const u = n % 10
  if (d === 7 || d === 9) {                       // 70–79 : soixante-dix… ; 90–99 : quatre-vingt-dix…
    const reste = 10 + u
    return `${DIZAINES[d]}${d === 7 && u === 1 ? ' et ' : '-'}${UNITES[reste]}`
  }
  if (u === 0) return d === 8 ? 'quatre-vingts' : DIZAINES[d]
  if (u === 1 && d !== 8) return `${DIZAINES[d]} et un`
  return `${DIZAINES[d]}-${UNITES[u]}`
}

// 0–999 ; « fin » = le groupe termine le nombre (accord de « cent » et « vingt »)
function troisChiffres(n, fin) {
  const c = Math.floor(n / 100)
  const r = n % 100
  let txt = ''
  if (c > 0) txt = c === 1 ? 'cent' : `${UNITES[c]} cent${r === 0 && fin ? 's' : ''}`
  if (r > 0) {
    let dz = deuxChiffres(r)
    if (!fin && dz === 'quatre-vingts') dz = 'quatre-vingt'
    txt = txt ? `${txt} ${dz}` : dz
  }
  return txt
}

export function montantEnLettres(montant) {
  let n = Math.round(Math.abs(Number(montant) || 0))
  if (n === 0) return 'zéro'
  const groupes = [['milliard', 1e9], ['million', 1e6], ['mille', 1e3]]
  const parts = []
  for (const [nom, val] of groupes) {
    const q = Math.floor(n / val)
    n %= val
    if (q === 0) continue
    if (nom === 'mille') parts.push(q === 1 ? 'mille' : `${troisChiffres(q, false)} mille`)
    else parts.push(`${troisChiffres(q, true)} ${nom}${q > 1 ? 's' : ''}`)
  }
  if (n > 0) parts.push(troisChiffres(n, true))
  return parts.join(' ')
}
