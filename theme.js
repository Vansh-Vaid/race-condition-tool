const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Replace the root tokens fully
css = css.replace(/:root\s*\{[\s\S]*?--shadow-glow:[^\}]*\}/, `:root {
  --bg:         #f8fafc;
  --bg-raised:  #ffffff;
  --bg-card:    rgba(0,0,0,0.02);
  --bg-hover:   rgba(0,0,0,0.05);
  --bg-glass:   rgba(255,255,255,0.85);

  --border:     rgba(0,0,0,0.08);
  --border-2:   rgba(0,0,0,0.15);
  --border-3:   rgba(0,0,0,0.22);
  --glow:       rgba(37,99,235,0.4);

  --accent:     #2563eb;
  --accent2:    #0ea5e9;
  --danger:     #ef4444;
  --warning:    #f59e0b;
  --success:    #10b981;
  --info:       #0284c7;

  --text:       #0f172a;
  --text-2:     #334155;
  --text-3:     #64748b;

  --op-read:    #0284c7;
  --op-write:   #ea580c;
  --op-lock:    #16a34a;
  --op-unlock:  #059669;

  --tc0:#4f46e5;--tc1:#0284c7;--tc2:#e11d48;
  --tc3:#ea580c;--tc4:#059669;--tc5:#d97706;

  --r-sm: 8px;
  --r:    12px;
  --r-lg: 16px;
  --r-xl: 24px;

  --max-w: 1140px;

  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --mono: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace;

  --ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
  --transition: 0.3s var(--ease);

  --shadow-sm: 0 2px 8px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 20px rgba(0,0,0,0.08);
  --shadow-lg: 0 8px 40px rgba(0,0,0,0.12);
  --shadow-glow: 0 0 20px rgba(37,99,235,0.2);
}`);

// Fix specifically inverted colors across the document
css = css.replace(/rgba\(255,255,255,([^)]+)\)/g, 'rgba(0,0,0,$1)');

// But fix some things that actually shouldn't have been inverted (like white text on dark buttons)
// Like linear-gradient starting with transparent, rgba(255,255,255...)
// Actually, linear-gradient(135deg, rgba(124...)) didn't have white. 

// The 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)'
// changes to rgba(0,0,0,0.1) on buttons (which is fine, or we can make it white)
css = css.replace(/rgba\(0,0,0,0\.1\), transparent\)\;\s*\n\s*transform: translateX\(-100%\);/g, 'rgba(255,255,255,0.2), transparent);\n  transform: translateX(-100%);');

// Mesh gradient: radial-gradient(ellipse 60% 50% at 20% 30%, rgba(124,106,255,0.07) 0%, transparent 60%)
css = css.replace(/rgba\(124,106,255,0\.07\)/g, 'rgba(37,99,235,0.04)');
css = css.replace(/rgba\(0,212,255,0\.05\)/g, 'rgba(14,165,233,0.03)');

// Header scrolled bg
css = css.replace(/rgba\(10,14,26,0\.95\)/g, 'rgba(255,255,255,0.95)');

// Select option background
css = css.replace(/background: #1a1e30;/g, 'background: #ffffff;');

// Remove CSE316 References
const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

html = html.replace(/Race Condition Detector · CSE316/g, 'Advanced Debugging Utility');
html = html.replace(/CSE316 Operating Systems Project/g, 'System Debugging Utility');
html = html.replace(/CSE316/g, 'Advanced');

// Add more explanations to What's Happening Here
html = html.replace(
  /<p class="explain-note">\s*A <strong>race condition<\/strong>.+?<\/p>/s,
  `<div style="margin-top:12px; padding:12px; background:rgba(0,0,0,0.03); border-radius:6px; font-size:13px;">
    <strong>Why variables?</strong> Threads communicate using shared memory. By specifying a target variable (e.g., <code>counter</code>), you indicate which specific memory block is being accessed.
  </div>
  <p class="explain-note">
    A <strong>race condition</strong> occurs when two threads access the same variable concurrently and at least one writes — without holding a common lock. Our engine simulates these executions to warn you of potential corruption before it reaches production!
  </p>`
);

html = html.replace(/<span class="detect-sub">Runs Bernstein's Conditions \+ Lockset Analysis<\/span>/, '<span class="detect-sub">Runs Bernstein\'s Conditions + Lockset Analysis on the fly</span>');

// Save files
fs.writeFileSync(cssPath, css);
fs.writeFileSync(htmlPath, html);

// Process ui.js
const uiPath = path.join(__dirname, 'ui.js');
let jf = fs.readFileSync(uiPath, 'utf8');

jf = jf.replace(/const THREAD_COLORS = .+?;/, "const THREAD_COLORS = ['#4f46e5','#0ea5e9','#e11d48','#d97706','#059669','#ea580c'];");
jf = jf.replace(/const RACE_COLOR = '#ff4757';/, "const RACE_COLOR = '#ef4444';");
jf = jf.replace(/const OP_COLORS = \{ READ:'#38bdf8', WRITE:'#fb923c', LOCK:'#4ade80', UNLOCK:'#34d399' \};/, "const OP_COLORS = { READ:'#0284c7', WRITE:'#ea580c', LOCK:'#16a34a', UNLOCK:'#059669' };");

jf = jf.replace(/rgba\(255,255,255,0\.015\)/g, "rgba(0,0,0,0.02)");
jf = jf.replace(/rgba\(255,255,255,0\.03\)/g, "rgba(0,0,0,0.04)");
jf = jf.replace(/rgba\(255,255,255,0\.04\)/g, "rgba(0,0,0,0.08)");
jf = jf.replace(/rgba\(255,255,255,0\.2\)/g, "rgba(0,0,0,0.4)");
jf = jf.replace(/rgba\(255,255,255,0\.75\)/g, "rgba(0,0,0,0.85)");
jf = jf.replace(/#fff/g, "#111827"); // change timeline RACE highlight colors if any
jf = jf.replace(/color = step.isRace \? RACE_COLOR : '#111827';/, "color = step.isRace ? RACE_COLOR : '#0f172a';");
jf = jf.replace(/#eef0ff/g, "#0f172a");

// More explanations in Race Report
jf = jf.replace(/<b>Step 1 — Bernstein's Conditions<\/b>:.+?candidate pairs\.<\/div>/si, 
  `<b>Step 1 — Bernstein's Conditions</b>: Identifies all pairs of operations from different threads that access the same shared variable where at least one is a WRITE. These are <em>potential</em> race candidates.<br>
    <b>Step 2 — Lockset / Eraser Algorithm</b>: For each candidate pair, checks if both operations hold at least one common mutex lock. If yes → protected (safe). If no → <span style="color:var(--danger);font-weight:700">RACE CONDITION</span>.<br><br>
    <div style="font-size:12px; color:var(--text-3); background:rgba(0,0,0,0.03); padding:8px 12px; border-radius:6px; margin-top:8px;">💡 <b>Why this matters:</b> If a race condition makes it to production, your database rows may incorrectly update or the application might crash randomly.</div>
  </div>`);

fs.writeFileSync(uiPath, jf);

console.log("Assets updated successfully.");
