// Minimal inline icon set (stroke icons, 24x24) – no extra dependency.
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  plus: 'M12 5v14M5 12h14',
  egg: 'M12 3c3.6 0 6.5 5.3 6.5 10.2A6.5 6.5 0 0 1 5.5 13.2C5.5 8.3 8.4 3 12 3z',
  broken: 'M12 3c3.6 0 6.5 5.3 6.5 10.2A6.5 6.5 0 0 1 5.5 13.2C5.5 8.3 8.4 3 12 3zM8 12l2.5 2 1.5-3 2 2.5 2-1.5',
  chart: 'M4 20V11M10 20V5M16 20v-6M2 20h20',
  wallet: 'M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4M21 13v4a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6M17 13h4v4h-4a2 2 0 0 1 0-4z',
  sync: 'M21 12a9 9 0 0 1-15.4 6.4L3 16M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5M3 21v-5h5',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  hen: 'M3 21V9l9-6 9 6v12M3 21h18M9 21v-6h6v6M10 10h4',
  cloud: 'M17.5 19a4.5 4.5 0 0 0 .4-9A6 6 0 0 0 6.3 9.6 4.5 4.5 0 0 0 6.5 19z',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0zM8 21h8',
  drumstick: 'M15.4 15.6a6 6 0 1 0-7-7L4.6 12.4a2 2 0 1 0 2.8 2.8L4 18.6a1.5 1.5 0 1 0 2.1 2.1L9.5 17.3a2 2 0 1 0 2.8-2.8z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  barn: 'M3 21V9l9-6 9 6v12M3 21h18M9 21v-6h6v6M10 10h4',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  cart: 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20.5h.01M17 20.5h.01',
  note: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
  chevron: 'M9 18l6-6-6-6',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  syringe: 'M18 2l4 4M17 7l3-3M19 9 9 19l-4 1 1-4L16 6zM14 8l2 2M11 11l2 2M5 19l-3 3'
}

export default function Icon({ name, size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={PATHS[name]} />
    </svg>
  )
}

// Hen mark, drawn on a 40x40 grid (same drawing as public/favicon.svg)
export function HenMark({ size }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <path d="M26.5 20 30 7.5c2.6 3 4.6 8 3.8 14.5z" fill="#fff8e7" />
      <path d="M29.2 11.5 31 18.5" stroke="#e8d6ae" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M17.5 34.5v3.2M23 34.5v3.2M16 37.7h3M21.5 37.7h3" stroke="#f5b52e" strokeWidth="1.8" strokeLinecap="round" />
      <ellipse cx="21" cy="25" rx="12" ry="9.5" fill="#fff8e7" />
      <path d="M9.5 16.5 16 12l7 9-11 4z" fill="#fff8e7" />
      <circle cx="13" cy="13.5" r="5.5" fill="#fff8e7" />
      <path d="M9.6 9.2c-.4-2 1-3.4 2.3-2.6.3-1.7 2.4-2.1 3.1-.5 1.3-.9 3 .3 2.5 2.2z" fill="#e2513c" />
      <path d="M7.7 12.6 4 14.4l3.9 1.6z" fill="#f5b52e" />
      <path d="M8.6 16.6c-.9 1.6-.3 3.3 1 3.3s1.6-1.8.6-3.4z" fill="#e2513c" />
      <circle cx="12.2" cy="12.6" r="1.15" fill="#16382b" />
      <path d="M16.5 24c3 4.5 8.5 5 12.5.5" stroke="#e8d6ae" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export function Logo({ size = 40 }) {
  return (
    <span className="logo" style={{ width: size, height: size }}>
      <HenMark size={size * 0.74} />
    </span>
  )
}
