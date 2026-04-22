const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Add Dark Theme properties
const darkThemeStr = `

[data-theme="dark"] {
  --bg:         #000000;
  --bg-raised:  #1c1c1e;
  --bg-card:    #1c1c1e;
  --bg-hover:   rgba(255,255,255,0.08);
  --bg-glass:   rgba(28,28,30,0.85);

  --border:     #38383a;
  --border-2:   #48484a;
  --border-3:   #636366;
  --glow:       rgba(10,132,255,0.4);

  --accent:     #0a84ff;
  --accent2:    #5e5ce6;
  --danger:     #ff453a;
  --warning:    #ffd60a;
  --success:    #32d74b;
  --info:       #64d2ff;

  --text:       #f5f5f7;
  --text-2:     #aeaeb2;
  --text-3:     #8e8e93;

  --op-read:    #64d2ff;
  --op-write:   #ff9f0a;
  --op-lock:    #32d74b;
  --op-unlock:  #66d4cf;

  --shadow-sm: 0 2px 8px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 20px rgba(0,0,0,0.5);
  --shadow-lg: 0 10px 40px rgba(0,0,0,0.6);
  --shadow-glow: 0 0 12px rgba(10,132,255,0.4);
}
`;
if (!css.includes('[data-theme="dark"]')) {
  css = css.replace(/(:root[\s\S]*?--shadow-glow:[^\}]*\n\s*\})/, `$1${darkThemeStr}`);
}

// Add smooth transitions to body and header
if (!css.includes('transition: background-color 0.4s var(--ease-smooth)')) {
  css = css.replace(/(body\s*\{[\s\S]*?)(line-height)/, '$1transition: background-color 0.4s var(--ease-smooth), color 0.4s var(--ease-smooth);\n  $2');
  css = css.replace(/(\.app-header\s*\{[\s\S]*?)(transition:\s*var\(--transition\))/, '$1transition: background-color 0.4s var(--ease-smooth), border-color 0.4s var(--ease-smooth), transform 0.3s var(--ease)');
}

fs.writeFileSync(cssPath, css);


// --- HTML Updates ---
const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Insert Theme Toggle button if not present
if (!html.includes('id="btn-theme"')) {
  html = html.replace(/(<button class="btn-reset" id="btn-print" onclick="window\.print\(\)" style="margin-right:4px;">⎙ Export Report<\/button>)/, `<button class="btn-reset" id="btn-theme" onclick="toggleTheme()" style="margin-right:4px;">🌙 Dark</button>\n    $1`);
}

// Insert inline script to prevent flash of wrong theme
if (!html.includes('initTheme()')) {
  const initScript = `
  <script>
    function initTheme() {
      const savedTheme = localStorage.getItem('raceguard-theme');
      if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
      } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    }
    initTheme();
  </script>
`;
  html = html.replace(/(<link rel="stylesheet" href="style.css" \/>)/, `$1\n${initScript}`);
}

fs.writeFileSync(htmlPath, html);

// --- UI.JS Updates ---
const uiPath = path.join(__dirname, 'ui.js');
let jf = fs.readFileSync(uiPath, 'utf8');

// Add toggle js logic
if (!jf.includes('toggleTheme(')) {
  jf = jf.replace(/(function resetAll\(\) \{)/, `function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('raceguard-theme', newTheme);
  updateThemeButton();
  if (currentTimelineReport) renderTimeline(currentTimelineReport); // Redraw
}

function updateThemeButton() {
  const btn = document.getElementById('btn-theme');
  if (btn) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.innerHTML = isDark ? '☀️ Light' : '🌙 Dark';
  }
}

$1`);
}

// Make sure the timeline accesses CSS variables instead of hardcoded #0f172a or #111827 text so it auto-updates
jf = jf.replace(/fill="#0f172a"/g, 'fill="var(--text)"');
jf = jf.replace(/fill="#111827"/g, 'fill="var(--text)"');
jf = jf.replace(/fill="#1d1d1f"/g, 'fill="var(--text)"'); // just in case

// Inside DOMContentLoaded, call updateThemeButton() to initialize the button string
jf = jf.replace(/(document\.getElementById\('btn-add-op-1'\)\.addEventListener\('click',\s*\(\)\s*=>\s*addOperationToThread\(1\)\);)/, `updateThemeButton();\n  $1`);

fs.writeFileSync(uiPath, jf);

console.log("Theme Manager installed.");
