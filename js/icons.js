const s = (d, extra = '') => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const ICON = {
  chat: s('<path d="M19.5 3.5c-5.6.6-10.3 4.4-12.4 9.9L5 20l6.4-2.3c5.4-2 9.2-6.7 9.8-12.3z"/><path d="M7.6 16.4l2.1 2.1"/><path d="M13 8.5l2.5 2.5"/>'),
  forge: s('<path d="M3.5 8.5h12.2c.3 2.4 2 3.6 4.8 3.6v2.2h-6.2l1.2 3.2h2.6v2H6.6v-2h2.6l1.3-3.4C6.4 13.9 3.5 12 3.5 8.5z"/><path d="M8 5.5l1-2M12 5.5V3M16 5.5l-1-2"/>'),
  studio: s('<rect x="3" y="3.5" width="18" height="17" rx="2.2"/><path d="M3 8.5h18"/><circle cx="6" cy="6" r=".6" fill="currentColor"/><circle cx="8.2" cy="6" r=".6" fill="currentColor"/><path d="M7 12.5h6M7 15.5h10M7 18h4"/><path d="M16 11.5l1.2 1.2 2-2.2"/>'),
  lint: s('<path d="M12 2.8l7.8 2.9v5.8c0 5-3.4 8.4-7.8 9.7-4.4-1.3-7.8-4.7-7.8-9.7V5.7z"/><path d="M8.6 12l2.4 2.4 4.6-4.8"/>'),
  vault: s('<rect x="3" y="3.5" width="18" height="7.5" rx="1.6"/><rect x="3" y="13" width="18" height="7.5" rx="1.6"/><path d="M10 7.2h4M10 16.8h4"/>'),
  gear: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  send: s('<path d="M4.5 11.5L20 4l-6.2 16-2.3-6.3z"/><path d="M11.5 13.7L20 4"/>'),
  stop: s('<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>'),
  x: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  copy: s('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>'),
  download: s('<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>'),
  upload: s('<path d="M12 15V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M4.5 19.5h15"/>'),
  check: s('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  eye: s('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  refresh: s('<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16"/><path d="M20 20v-4h-4"/>'),
  trash: s('<path d="M4.5 7h15M10 11v6M14 11v6"/><path d="M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5"/><path d="M9.5 7V4.5h5V7"/>'),
  list: s('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9" fill="currentColor"/><circle cx="4.5" cy="12" r=".9" fill="currentColor"/><circle cx="4.5" cy="18" r=".9" fill="currentColor"/>'),
  edit: s('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  spark: s('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>'),
  folder: s('<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  chevron: s('<path d="M7 10l5 5 5-5"/>'),
  book: s('<path d="M5 4.5h10.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10.5"/>'),
  wand: s('<path d="M4 20L15 9"/><path d="M14 4v3M12.5 5.5h3M19 9v3M17.5 10.5h3M18 3.5l1 1"/>'),
  link: s('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>')
};

export const BRAND = `<svg viewBox="0 0 40 40" width="32" height="32" aria-hidden="true"><defs><linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f08a63"/><stop offset="1" stop-color="#c94a34"/></linearGradient></defs><rect x="1.5" y="1.5" width="37" height="37" rx="10" fill="#1d1920" stroke="#3b3441"/><rect x="5.5" y="5.5" width="29" height="29" rx="7" fill="none" stroke="#d8b46a" stroke-opacity=".45" stroke-dasharray="1.6 2.4"/><path d="M20 8.5c3.8 5 7.3 8.8 7.3 13.1a7.3 7.3 0 0 1-14.6 0c0-4.3 3.5-8.1 7.3-13.1z" fill="url(#bm-g)"/><path d="M20 13.5v15" stroke="#1d1920" stroke-width="1.4" stroke-linecap="round"/><path d="M16.6 22.6L20 28.5l3.4-5.9" fill="none" stroke="#1d1920" stroke-width="1.4" stroke-linejoin="round"/><circle cx="29.5" cy="11" r="1.6" fill="#6cc4b0"/></svg>`;
