import { Component } from 'react'
import i18n from '../i18n'
import Icon from './Icon'
import { forcerMiseAJour } from '../lib/version'

// A page file that no longer exists (the app was updated while it was open): reload once on the new version
const RELOAD_KEY = 'henzo.chunkReload'
export const isChunkError = (e) => /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|Failed to fetch dynamically|ChunkLoadError/i.test(String(e?.message ?? e))

export function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0
    if (Date.now() - last < 15000) return false // already tried just now: show the message instead of looping
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch { /* storage unavailable: reload anyway */ }
  window.location.reload()
  return true
}

// No more blank screen: a readable message with a "Reload" button instead
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    if (isChunkError(error)) reloadOnce()
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    const t = i18n.t.bind(i18n)
    return (
      <section className="panel">
        <div className="alert warn"><Icon name="alert" size={18} />{t('erreur.title')}</div>
        <p className="muted">{isChunkError(this.state.error) ? t('erreur.update') : t('erreur.text')}</p>
        {/* an old version kept by the browser: a plain reload is not enough, empty the cache and update */}
        <button className="btn primary" onClick={() => (isChunkError(this.state.error) ? forcerMiseAJour() : window.location.reload())}><Icon name="sync" size={16} />{t('erreur.reload')}</button>
      </section>
    )
  }
}
