// Small Cloudflare Worker in front of the app files: forces HTTPS and adds the security headers.
// Everything else (files, single-page fallback, cache rules of public/_headers) is served by the assets.
const SUPABASE = 'https://sparyeehebawsnnvblnr.supabase.co'

// Content Security Policy, in « report only » mode first: the browser lists what would be blocked
// (console) without blocking anything. Switch to Content-Security-Policy once nothing is reported.
// The hash is the one of the small theme script in index.html (to recompute if that script changes).
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'sha256-jts3bI8WaYH9KKaAN7sZyvWJpUfnxpeJNJerBa//Mcg='",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${SUPABASE} ${SUPABASE.replace('https', 'wss')} https://fonts.googleapis.com https://fonts.gstatic.com`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ')

const SECURITY = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy-Report-Only': CSP
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.protocol === 'http:') {
      url.protocol = 'https:'
      return Response.redirect(url.toString(), 301)
    }
    const res = await env.ASSETS.fetch(request)
    const out = new Response(res.body, res)
    for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v)
    return out
  }
}
