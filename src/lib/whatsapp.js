// Sending an invoice or a receipt on WhatsApp, as an IMAGE of the document.
// - Phone: the phone's share menu (WhatsApp, then the customer) – the only way WhatsApp accepts an image from a web app.
// - Computer: the image is copied (and downloaded), then WhatsApp opens on the customer's conversation: paste it (Ctrl+V).
// If the image cannot be made, the text of the document is sent instead.

// "6 99 00 00 00", "+237 699000000", "00237699000000" → "237699000000" ; null when it is not a phone number
export function numeroWhatsApp(saisie) {
  let n = String(saisie ?? '').replace(/\D/g, '')
  if (n.startsWith('00')) n = n.slice(2)
  if (n.length === 9 && /^[26]/.test(n)) n = `237${n}`          // Cameroon number typed without the country code
  return n.length >= 10 && n.length <= 15 ? n : null
}

const ouvrir = (url) => {
  // a new tab on a computer; on a phone, the WhatsApp app (some phones block windows opened after a dialog)
  const w = window.open(url, '_blank', 'noopener')
  if (!w) window.location.href = url
}

async function demanderNumero(ask, t, telephone, message) {
  const v = await ask.form({
    title: t('whatsapp.title'), icon: 'users', submit: t('whatsapp.open'), message,
    fields: [{ name: 'tel', label: t('whatsapp.number'), type: 'tel', value: telephone ?? '', required: true, placeholder: '6XX XX XX XX' }]
  })
  if (!v) return null
  const numero = numeroWhatsApp(v.tel)
  if (!numero) { ask.error(t('whatsapp.invalid')); return null }
  return numero
}

// Text only (fallback, reminders); true when WhatsApp was opened
export async function envoyerWhatsApp(ask, t, { telephone, texte }) {
  const numero = await demanderNumero(ask, t, telephone, t('whatsapp.hint'))
  if (numero) ouvrir(`https://wa.me/${numero}?text=${encodeURIComponent(texte)}`)
  return !!numero
}

async function image(element, nom) {
  const { toBlob } = await import('html-to-image')
  const blob = await toBlob(element, { pixelRatio: 2, backgroundColor: '#ffffff', skipFonts: true, cacheBust: true })
  if (!blob) throw new Error('image')
  return new File([blob], `${nom}.png`, { type: 'image/png' })
}

const telecharger = (fichier) => {
  const url = URL.createObjectURL(fichier)
  const a = document.createElement('a')
  a.href = url
  a.download = fichier.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function envoyerImageWhatsApp(ask, t, { element, nom, telephone, texte, legende }) {
  let fichier
  try {
    fichier = await image(element, nom)
  } catch {
    return envoyerWhatsApp(ask, t, { telephone, texte })   // no image: the text instead
  }
  // phone: share menu with the picture (choose WhatsApp, then the customer)
  if (navigator.canShare?.({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier], text: legende })
      return
    } catch (err) {
      if (err?.name === 'AbortError') return               // closed by the user
    }
  }
  // computer: copy + download the image, then open the customer's conversation
  const numero = await demanderNumero(ask, t, telephone, t('whatsapp.imageHint'))
  if (!numero) return
  let copie = false
  try {
    await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': fichier })])
    copie = true
  } catch { /* clipboard refused: the downloaded file is enough */ }
  telecharger(fichier)
  ouvrir(`https://wa.me/${numero}?text=${encodeURIComponent(legende)}`)
  ask.info(t('whatsapp.imageReady'), copie ? t('whatsapp.imageCopied') : t('whatsapp.imageDownloaded'))
}
