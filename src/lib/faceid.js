// Face ID / fingerprint sign-in = passkeys (WebAuthn), verified by Supabase Auth.
// The biometric data never leaves the phone: the phone only signs a challenge.

export const faceIdSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential

// Name shown to the user for this device's biometric unlock
export function nomBiometrie() {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'Face ID'
  if (/Macintosh/.test(ua)) return 'Touch ID'
  if (/Android/.test(ua)) return 'empreinte'
  if (/Windows/.test(ua)) return 'Windows Hello'
  return 'Face ID'
}

// Remembered on this device once a passkey was created here (to put the button first on the login page)
const FLAG = 'henzo.faceid'
export const faceIdActiveIci = () => { try { return localStorage.getItem(FLAG) === '1' } catch { return false } }
export const marquerFaceId = (on) => { try { on ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG) } catch {} }

// Readable message for the usual WebAuthn / Supabase errors
export function messageFaceId(error, t) {
  const code = error?.code ?? error?.name ?? ''
  const msg = String(error?.message ?? error ?? '')
  if (/NotAllowed|ABORTED|cancel/i.test(code + msg)) return t('faceid.cancelled')
  if (/passkey.*(disabled|not enabled)|webauthn.*disabled|feature_disabled/i.test(msg)) return t('faceid.disabled')
  if (/not found|no credentials|unknown credential/i.test(msg)) return t('faceid.unknown')
  return msg || t('faceid.failed')
}
