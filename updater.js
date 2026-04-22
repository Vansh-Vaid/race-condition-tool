const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Replace standard :root with Apple minimalist colors
const appleRoot = `:root {
  --bg:         #f5f5f7;
  --bg-raised:  #ffffff;
  --bg-card:    #ffffff;
  --bg-hover:   rgba(0,0,0,0.03);
  --bg-glass:   rgba(255,255,255,0.72);

  --border:     #d2d2d7;
  --border-2:   #c7c7cc;
  --border-3:   #aeaeb2;
  --glow:       rgba(0,113,227,0.3);

  --accent:     #0071e3;
  --accent2:    #007aff;
  --danger:     #ff3b30;
  --warning:    #ff9500;
  --success:    #34c759;
  --info:       #5ac8fa;

  --text:       #1d1d1f;
  --text-2:     #86868b;
  --text-3:     #98989d;

  --op-read:    #007aff;
  --op-write:   #ff9500;
  --op-lock:    #34c759;
  --op-unlock:  #30b0c7;

  --tc0:#0071e3;--tc1:#5ac8fa;--tc2:#ff3b30;
  --tc3:#ff9500;--tc4:#34c759;--tc5:#ff2d55;

  --r-sm: 10px;
  --r:    16px;
  --r-lg: 20px;
  --r-xl: 28px;

  --max-w: 1140px;

  --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;

  --ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  --ease-bounce: cubic-bezier(0.175, 0.885, 0.32, 1.275);
  --ease-smooth: cubic-bezier(0.4, 0.0, 0.2, 1);
  --transition: 0.25s var(--ease);

  --shadow-sm: 0 2px 5px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 10px rgba(0,0,0,0.06);
  --shadow-lg: 0 10px 30px rgba(0,0,0,0.08);
  --shadow-glow: 0 0 12px rgba(0,113,227,0.3);
}`;

css = css.replace(/:root\s*\{[\s\S]*?--shadow-glow:[^\}]*\}/, appleRoot);

// Remove the hard mesh background since Apple doesn't rely on radial meshes. Keep it pure flat color
css = css.replace(/body::before {[\s\S]*?z-index: 0;\s*\}/, `body::before { content: ''; }`);

// Soften borders across cards
css = css.replace(/border: 1px solid var\(--border\);/g, 'border: 1px solid rgba(0,0,0,0.05);');

// Header fixes for blurred light background
css = css.replace(/background: rgba\(255,255,255,0\.95\);/g, 'background: rgba(255,255,255,0.72); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%);');
css = css.replace(/box-shadow: 0 2px 20px rgba\(0,0,0,0\.3\);/, 'box-shadow: 0 1px 0 rgba(0,0,0,0.05);'); // Apple rarely uses heavy drop shadows below top bars

fs.writeFileSync(cssPath, css);


// --- HTML Updates ---
const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Remove google fonts
html = html.replace(/<link rel="preconnect"[^>]+>/g, '');
html = html.replace(/<link href="https:\/\/fonts.googleapis.com[^>]+>/g, '');
// Consolidate extra empty lines
html = html.replace(/\n\s*\n\s*\n/g, '\n\n');

// Add Export button to header actions
const printBtnHtml = `<button class="btn-reset" id="btn-print" onclick="window.print()" style="margin-right:4px;">⎙ Export Report</button>`;
html = html.replace(/(<button class="btn-reset" id="btn-reset" onclick="resetAll\(\)">)/, `${printBtnHtml}\n    $1`);

// Add deeper contextual block for Timeline
html = html.replace(
  /(<div class="tab-explain">\s*<strong>Execution Timeline:<\/strong>[\s\S]*?<\/div>)/,
  `$1\n          <div class="tab-explain" style="background:#ffffff; border-color:#0071e3; margin-top:8px;">
            <strong>Apple Design Insight — Visualizing Time:</strong> This view is inspired by performance profilers like Instruments. Vertically, you see independent threads. Horizontally, time advances. <em>Dashed lines indicate dependencies or conflicts.</em> If two actions intersect vertically with no locking mechanism across the same timeline block, a true race condition is structurally guaranteed.
          </div>`
);

// Add deeper contextual block for Heatmap
html = html.replace(
  /(<div class="tab-explain">\s*<strong>Memory Access Heatmap:<\/strong>[\s\S]*?<\/div>)/,
  `$1\n          <div class="tab-explain" style="background:#ffffff; border-color:#0071e3; margin-top:8px;">
            <strong>Apple Design Insight — Access Density:</strong> The Heatmap shifts your perspective from <em>Time</em> to <em>Memory</em>. While the timeline shows when things occur, this grid instantly spotlights overloaded shared memory addresses. Heavily coloured rows indicate variables that are concurrency-bottlenecks.
          </div>`
);

fs.writeFileSync(htmlPath, html);

// --- UI.JS Updates ---
const uiPath = path.join(__dirname, 'ui.js');
let jf = fs.readFileSync(uiPath, 'utf8');

// Align script THREAD_COLORS with CSS apple styling
jf = jf.replace(/const THREAD_COLORS = .+?;/, "const THREAD_COLORS = ['#0071e3','#5ac8fa','#ff3b30','#ff9500','#34c759','#ff2d55'];");
jf = jf.replace(/const RACE_COLOR = '.+?';/, "const RACE_COLOR = '#ff3b30';");
jf = jf.replace(/const OP_COLORS = \{.+?\};/, "const OP_COLORS = { READ:'#007aff', WRITE:'#ff9500', LOCK:'#34c759', UNLOCK:'#30b0c7' };");

fs.writeFileSync(uiPath, jf);

console.log("Apple Aesthetic & Export Features mapped.");
