// Icons + shared utility components

const Icon = ({ name, size = 14 }) => {
  const paths = {
    cursor: <path d="M4 3l13 7-5.5 1.5L9 17 4 3z" fill="currentColor" />,
    wall: <g><path d="M3 8h14M3 12h14" stroke="currentColor" strokeWidth="1.5" /></g>,
    door: <g><path d="M5 3v14h7l4-2V3z" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M16 3v14" stroke="currentColor" strokeWidth="1.4" /><circle cx="13" cy="10" r="0.8" fill="currentColor" /></g>,
    window: <g><rect x="3.5" y="5.5" width="13" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10 5.5v9M3.5 10h13" stroke="currentColor" strokeWidth="1.2" /></g>,
    room: <g><path d="M3 4l6-2 8 3v11l-7 2-7-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></g>,
    storey: <g><path d="M2 6l8-3 8 3-8 3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M2 11l8 3 8-3M2 14.5l8 3 8-3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none" /></g>,
    building: <g><path d="M3 17V7l7-3 7 3v10" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M7 17v-4h6v4M7 11h2M11 11h2" stroke="currentColor" strokeWidth="1.2" /></g>,
    project: <g><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M3 8h14" stroke="currentColor" strokeWidth="1.2" /></g>,
    furniture: <g><rect x="3" y="9" width="14" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5 9V7M15 9V7M4 15v2M16 15v2" stroke="currentColor" strokeWidth="1.4" /></g>,
    chev: <path d="M7 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
    plus: <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
    minus: <path d="M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
    x: <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
    search: <g><circle cx="9" cy="9" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M13 13l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></g>,
    settings: <g><circle cx="10" cy="10" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.5 1.5M14 14l1.5 1.5M4.5 15.5L6 14M14 6l1.5-1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></g>,
    sparkle: <path d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5zM15.5 13l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" fill="currentColor" />,
    download: <g><path d="M10 3v9M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 16h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></g>,
    upload: <g><path d="M10 14V5M5 9l5-5 5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 16h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></g>,
    chat: <g><path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H8l-3 3v-3a2 2 0 01-2-2z" fill="none" stroke="currentColor" strokeWidth="1.4" /></g>,
    eye: <g><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="10" cy="10" r="2" fill="currentColor" /></g>,
    lock: <g><rect x="4" y="9" width="12" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M7 9V6a3 3 0 016 0v3" fill="none" stroke="currentColor" strokeWidth="1.4" /></g>,
    folder: <path d="M3 6a1 1 0 011-1h4l1.5 1.5H16a1 1 0 011 1V15a1 1 0 01-1 1H4a1 1 0 01-1-1z" fill="none" stroke="currentColor" strokeWidth="1.4" />,
    grid: <g><path d="M3 7h14M3 13h14M7 3v14M13 3v14" stroke="currentColor" strokeWidth="1.4" /></g>,
    measure: <g><path d="M2 12l10-10 6 6L8 18z" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5 9l1 1M8 6l1 1M11 9l1 1M14 6l1 1" stroke="currentColor" strokeWidth="1.4" /></g>,
    move: <path d="M10 2v16M2 10h16M10 2l-3 3M10 2l3 3M10 18l-3-3M10 18l3-3M2 10l3-3M2 10l3 3M18 10l-3-3M18 10l-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    pencil: <path d="M14 3l3 3-9 9H5v-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
    bot: <g><rect x="4" y="6" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="8" cy="11" r="0.8" fill="currentColor" /><circle cx="12" cy="11" r="0.8" fill="currentColor" /><path d="M10 6V3M8 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></g>,
    check: <path d="M4 10l3 3 8-8" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    info: <g><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10 9v5M10 6.5v0.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></g>,
    layers: <g><path d="M10 2L2 6l8 4 8-4z M2 10l8 4 8-4 M2 14l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></g>,
    code: <path d="M7 5l-5 5 5 5M13 5l5 5-5 5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    sliders: <g><path d="M3 6h6M11 6h6M3 14h2M7 14h10M3 10h12M14 10h3" stroke="currentColor" strokeWidth="1.5" /><circle cx="10" cy="6" r="1.5" fill="currentColor" /><circle cx="6" cy="14" r="1.5" fill="currentColor" /><circle cx="13" cy="10" r="1.5" fill="currentColor" /></g>,
    history: <g><path d="M4 10a6 6 0 116 6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M2 6v4h4M10 7v3l2 2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></g>,
    play: <path d="M5 3l12 7-12 7z" fill="currentColor" />,
    arrow_right: <path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    copy: <g><rect x="6" y="6" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M3 13V4a1 1 0 011-1h9" fill="none" stroke="currentColor" strokeWidth="1.4" /></g>,
  };
  return (
    <svg className="svg-icon" width={size} height={size} viewBox="0 0 20 20">
      {paths[name] || null}
    </svg>
  );
};

// Type config (color + icon + key)
const TYPE_CONFIG = {
  Project: { icon: 'project', key: '' },
  Building: { icon: 'building', key: 'B' },
  Storey: { icon: 'storey', key: 'S' },
  Room: { icon: 'room', key: 'R' },
  Wall: { icon: 'wall', key: 'W' },
  Door: { icon: 'door', key: 'D' },
  Window: { icon: 'window', key: 'F' },
  Furniture: { icon: 'furniture', key: 'M' },
};

const TOOLBAR_TYPES = ['Wall', 'Door', 'Window', 'Room', 'Storey', 'Furniture'];

// Polygon area, signed
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
function polyPerimeter(pts) {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}
function wallLength(g) { return Math.hypot(g.x2 - g.x1, g.y2 - g.y1); }
function wallAngle(g) { return Math.atan2(g.y2 - g.y1, g.x2 - g.x1); }
function wallPointAtT(g, t) {
  return [g.x1 + (g.x2 - g.x1) * t, g.y1 + (g.y2 - g.y1) * t];
}
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
      (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
}

window.AS_UI = { Icon, TYPE_CONFIG, TOOLBAR_TYPES, polyArea, polyPerimeter, wallLength, wallAngle, wallPointAtT, pointInPoly, bbox };
