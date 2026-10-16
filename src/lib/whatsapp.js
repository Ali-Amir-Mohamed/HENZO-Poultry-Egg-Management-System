// Sending an invoice or a receipt on WhatsApp: the customer's number is asked first (prefilled when known),
// then WhatsApp opens directly on the conversation with that number, the message already written.

// "6 99 00 00 00", "+237 699000000", "00237699000000" → "237699000000" ; null when it is not a phone number
export function numeroWhatsApp(saisie) {
  let n = String(saisie ?? '').replace(/\D/g, '')
  if (n.startsWith('00')) n = n.slice(2)
  if (n.length === 9 && /^[26]/.test(n)) n = `237${n}`          // Cameroon number typed without the country code
  return n.length >= 10 && n.length <= 15 ? n : null
}

export async function envoyerWhatsApp(ask, t, { telephone, texte, titre }) {
  const v = await ask.form({
    title: titre ?? t('whatsapp.title'), icon: 'users', submit: t('whatsapp.open'), message: t('whatsapp.hint'),
    fields: [{ name: 'tel', label: t('whatsapp.number'), type: 'tel', value: telephone ?? '', required: true, placeholder: '6XX XX XX XX' }]
  })
  if (!v) return
  const numero = numeroWhatsApp(v.tel)
  if (!numero) return ask.error(t('whatsapp.invalid'))
  const url = `https://wa.me/${numero}?text=${encodeURIComponent(texte)}`
  // a new tab on a computer; on a phone, the WhatsApp app (some phones block windows opened after a dialog)
  const w = window.open(url, '_blank', 'noopener')
  if (!w) window.location.href = url
}
