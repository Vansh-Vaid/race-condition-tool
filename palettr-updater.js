// Node script to rewrite ui.js and style.css for perfectly readable adaptive colors
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');

// We will use standard color-mix or rgba CSS variables but since we need to generate SVGs, 
// dynamically maintaining a dark/light palette directly inside JS might be easiest to fix the appending hex suffix issue.

// Let's modify ui.js to hold two sets of palettes and swap them logically during toggleTheme()
const uiPath = path.join(__dirname, 'ui.js');
let jf = fs.readFileSync(uiPath, 'utf8');

jf = jf.replace(/const THREAD_COLORS = .+?;/, `let THREAD_COLORS = ['#0071e3','#5ac8fa','#ff3b30','#ff9500','#34c759','#ff2d55'];`);
jf = jf.replace(/const OP_COLORS = \{.+?\};/, `let OP_COLORS = { READ:'#007aff', WRITE:'#ff9500', LOCK:'#34c759', UNLOCK:'#30b0c7' };`);
jf = jf.replace(/const RACE_COLOR = '.+?';/, `let RACE_COLOR = '#ff3b30';`);

const paletteLogic = `
const PALETTE_LIGHT = {
  threads: ['#005cbf', '#0284c7', '#dc2626', '#d97706', '#059669', '#be123c'],
  ops: { READ:'#0071e3', WRITE:'#d97706', LOCK:'#059669', UNLOCK:'#0891b2' },
  race: '#dc2626'
};
const PALETTE_DARK = {
  threads: ['#60a5fa', '#38bdf8', '#f87171', '#fbbf24', '#34d399', '#fb7185'],
  ops: { READ:'#60a5fa', WRITE:'#fbbf24', LOCK:'#34d399', UNLOCK:'#22d3ee' },
  race: '#ff453a'
};

function updateJsPalette(isDark) {
  const p = isDark ? PALETTE_DARK : PALETTE_LIGHT;
  THREAD_COLORS = p.threads;
  OP_COLORS = p.ops;
  RACE_COLOR = p.race;
  // Re-assign thread colors since they hold the property locally when created
  uiThreads.forEach((t, i) => { t.color = THREAD_COLORS[i % THREAD_COLORS.length]; });
}
`;

if (!jf.includes('PALETTE_LIGHT')) {
  jf = jf.replace(/(let uiThreads = \[\];)/, `${paletteLogic}\n$1`);
  jf = jf.replace(/(document\.documentElement\.setAttribute\('data-theme', newTheme\);)/, `$1\n  updateJsPalette(newTheme === 'dark');`);
  
  // also run once on init:
  jf = jf.replace(/(function updateThemeButton\(\) \{)/, `
const currentStartTheme = document.documentElement.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
updateJsPalette(currentStartTheme === 'dark');

$1`);
}

// In ui.js SVG code we also appended '18', '40' to thread.color which is a 6-digit hex.
// If thread.color is dynamically switched by updateJsPalette when theme toggles and we redraw, 
// then the SVG automatically uses the legible hex code and appending '1a' for transparency works nicely!

fs.writeFileSync(uiPath, jf);

// Now style.css adjustments.
// Increase font contrast in light mode: #111827 is better than #1d1d1f for deep black visibility on some screens.
css = css.replace(/--text:\s*#1d1d1f;/g, '--text: #111827;');
css = css.replace(/--text-2:\s*#86868b;/g, '--text-2: #475569;'); // Slate 600, much better than light gray
css = css.replace(/--text-3:\s*#98989d;/g, '--text-3: #64748b;'); // Slate 500

// Increase contrast in dark mode:
css = css.replace(/--bg-card:\s*#1c1c1e;/g, '--bg-card: #222224;'); // slightly lighter than canvas for card visibility

fs.writeFileSync(cssPath, css);

console.log('Colors correctly adjusted for high visibility across themes.');
