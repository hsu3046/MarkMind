import type { HtmlSlideThemeId } from '../htmlSlideTheme';
import { getFrontendSlidesTemplateProfile } from './templateProfiles';

const LAYOUT_SEQUENCES: Record<HtmlSlideThemeId, string[]> = {
  'blue-professional': [
    'layout-cover',
    'layout-agenda',
    'layout-metrics',
    'layout-dashboard',
    'layout-split',
    'layout-bars',
    'layout-timeline',
    'layout-detail',
    'layout-quote',
    'layout-closing',
  ],
  'neo-grid-bold': [
    's-cover',
    's-toc',
    's-stats',
    's-features',
    's-chart',
    's-section',
    's-quote',
    's-consult',
    's-chart2',
    's-process2',
    's-matrix2',
    's-cta',
  ],
  signal: [
    'slide--cover',
    'slide--chapter',
    'slide--statement',
    'slide--split',
    'slide--stats',
    'slide--quote',
    'slide--list',
    'slide--compare',
    'slide--editorial',
    'slide--chart',
    'slide--diagram',
    'slide--pyramid',
    'slide--cycle',
    'slide--end',
  ],
};

function themeIdOrDefault(themeId?: string): HtmlSlideThemeId {
  if (themeId === 'neo-grid-bold' || themeId === 'signal' || themeId === 'blue-professional') return themeId;
  return 'blue-professional';
}

function layoutForIndex(themeId: HtmlSlideThemeId, index: number, total: number): string {
  const sequence = LAYOUT_SEQUENCES[themeId];
  if (index === 0) return sequence[0];
  if (index === total - 1) return sequence[sequence.length - 1];
  return sequence[((index - 1) % (sequence.length - 2)) + 1];
}

function classValue(tag: string): string {
  return tag.match(/\bclass=(["'])(.*?)\1/i)?.[2] ?? '';
}

function hasDataLayout(tag: string): boolean {
  return /\bdata-layout=(["']).*?\1/i.test(tag);
}

function classRegex(className: string): RegExp {
  return new RegExp(`\\b${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
}

function upsertClass(tag: string, classes: string[]): string {
  const existing = classValue(tag);
  const nextClasses = Array.from(new Set([...existing.split(/\s+/).filter(Boolean), ...classes]));
  if (/\bclass=(["']).*?\1/i.test(tag)) {
    return tag.replace(/\bclass=(["'])(.*?)\1/i, `class="${nextClasses.join(' ')}"`);
  }
  return tag.replace(/<section\b/i, `<section class="${nextClasses.join(' ')}"`);
}

function upsertDataLayout(tag: string, layout: string): string {
  if (hasDataLayout(tag)) return tag;
  return tag.replace(/>$/, ` data-layout="${layout.replace(/^(layout-|slide--|s-)/, '')}">`);
}

export function coerceTemplateSectionClasses(html: string, themeId?: string): string {
  const id = themeIdOrDefault(themeId);
  const profile = getFrontendSlidesTemplateProfile(id);
  const sectionTags = [...html.matchAll(/<section\b[^>]*>/gi)];
  const total = sectionTags.length;
  if (total === 0) return html;
  let index = 0;
  return html.replace(/<section\b[^>]*>/gi, (tag) => {
    const existing = classValue(tag);
    const hasTemplateClass = profile.layoutClasses.some((className) => classRegex(className).test(existing));
    const layout = hasTemplateClass
      ? profile.layoutClasses.find((className) => classRegex(className).test(existing)) ?? layoutForIndex(id, index, total)
      : layoutForIndex(id, index, total);
    index += 1;
    return upsertDataLayout(upsertClass(tag, ['slide', layout]), layout);
  });
}

function wrapNeoFrames(html: string, themeId: HtmlSlideThemeId): string {
  if (themeId !== 'neo-grid-bold') return html;
  return html.replace(/(<section\b[^>]*>)([\s\S]*?)(<\/section>)/gi, (_match, open, body, close) => {
    const classes = classValue(open);
    if (!/\bslide\b/i.test(classes) || !/\bs-[\w-]+\b/i.test(classes)) return `${open}${body}${close}`;
    if (/\bclass=(["'])[^"']*\bframe\b/i.test(body)) return `${open}${body}${close}`;
    return `${open}<div class="frame">${body}</div>${close}`;
  });
}

function injectIntoHead(html: string, block: string): string {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}\n</head>`);
  if (/<html[\s>]/i.test(html)) return html.replace(/<body\b/i, `<head>${block}</head>\n<body`);
  return `${block}\n${html}`;
}

function injectBeforeBodyClose(html: string, block: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${block}\n</body>`);
  return `${html}\n${block}`;
}

function commonRuntimeCss(themeId: HtmlSlideThemeId): string {
  return `
<style id="markmind-template-runtime" data-template="${themeId}">
html,body{margin:0;width:100%;height:100%;background:#0b0f18;overflow:hidden}
body{font-family:var(--mm-body-font,Arial,sans-serif);color:var(--mm-text)}
.deck-stage{position:relative;width:1920px;height:1080px;margin:0 auto;overflow:hidden;background:var(--mm-bg);transform-origin:top left}
.slide{position:absolute;inset:0;box-sizing:border-box;overflow:hidden;background:var(--mm-bg);color:var(--mm-text)}
.slide:not(.active){display:none}
.slide h1,.slide h2,.slide h3,.slide p{margin-top:0}
.slide img{max-width:100%;height:auto;object-fit:cover}
.mm-runtime-counter{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;padding:10px 18px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font:700 18px/1 var(--mm-body-font,Arial,sans-serif);letter-spacing:.03em}
:fullscreen .mm-runtime-counter{display:none}
`;
}

function blueCss(): string {
  return `${commonRuntimeCss('blue-professional')}
:root{--mm-bg:#fdfae7;--mm-surface:#f2efd9;--mm-text:#111;--mm-muted:#6b6b6b;--mm-accent:#1e2bfa;--mm-body-font:"Inter","Noto Sans KR",Arial,sans-serif;--mm-display-font:"Space Grotesk","Noto Sans KR",Arial,sans-serif}
.slide{padding:72px 88px 86px}
.slide-header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid var(--mm-accent);padding-bottom:18px;margin-bottom:44px}
.slide-header h2,.layout-cover h1,.layout-closing h1{font-family:var(--mm-display-font);font-weight:700;letter-spacing:-.02em}
.slide-header h2{font-size:58px;line-height:.95}
.slide-content{height:820px}
.layout-cover{display:flex;flex-direction:column;justify-content:center;padding:110px 130px;background:var(--mm-bg)}
.layout-cover h1{font-size:112px;line-height:.9;max-width:13ch}
.layout-cover .subtitle,.layout-cover p{font-size:32px;line-height:1.35;max-width:34ch;color:var(--mm-muted)}
.layout-cover:after,.layout-closing:after{content:"";position:absolute;right:90px;bottom:90px;width:300px;height:300px;border:42px solid var(--mm-accent);border-radius:50%}
.agenda-grid,.metrics-row,.stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:26px}
.agenda-item,.metric-card,.detail-block,.stat-card,.split-highlight,.bar-item,.layout-dashboard .slide-content>*{background:var(--mm-surface);border:1.5px solid rgba(30,43,250,.28);padding:28px 30px}
.agenda-num,.metric-change,.bar-pct{font-family:var(--mm-display-font);font-weight:700;color:var(--mm-accent)}
.agenda-num{font-size:24px}.agenda-item h3{font:700 34px/1.05 var(--mm-display-font);margin:18px 0 12px}.agenda-item p{font-size:20px;line-height:1.45;color:var(--mm-muted)}
.layout-metrics .slide-content{display:flex;align-items:center}.metrics-row{width:100%}.metric-card{min-height:520px}.metric-value{font:700 86px/.9 var(--mm-display-font);color:var(--mm-accent)}.metric-label{font:700 30px/1.1 var(--mm-display-font);margin:24px 0 14px}.metric-desc,.metric-supports{font-size:19px;line-height:1.45;color:var(--mm-muted)}
.layout-dashboard .slide-content,.layout-detail .detail-body{display:grid;grid-template-columns:repeat(2,1fr);gap:28px}.layout-dashboard .slide-content>*{min-height:180px}
.layout-split .split-body{display:grid;grid-template-columns:1.1fr .9fr;gap:40px}.split-left,.split-right{display:flex;flex-direction:column;gap:22px}.split-highlight{font:600 38px/1.2 var(--mm-display-font);color:var(--mm-accent)}
.bars-container{display:flex;flex-direction:column;gap:20px}.bar-item{display:grid;grid-template-columns:1fr 6fr 80px;align-items:center;gap:18px}.bar-track{height:24px;background:#dedbc8}.bar-fill{height:100%;background:var(--mm-accent)}
.layout-timeline .timeline-track{display:grid;grid-template-columns:repeat(4,1fr);gap:26px;margin-top:160px}.timeline-step{background:var(--mm-surface);padding:34px;min-height:360px}.step-circle{width:86px;height:86px;border-radius:50%;background:var(--mm-accent);color:#fff;display:grid;place-items:center;font:700 30px var(--mm-display-font)}
.layout-quote{display:grid;place-items:center;text-align:left}.layout-quote blockquote{font:700 70px/1.08 var(--mm-display-font);max-width:1200px;color:var(--mm-accent)}.quote-source{font-size:24px;color:var(--mm-muted)}
.layout-closing{display:flex;flex-direction:column;justify-content:center}.layout-closing h1{font-size:104px;line-height:.95}.cta-btn{display:inline-flex;background:var(--mm-accent);color:white;padding:22px 34px;font:700 24px var(--mm-display-font);width:max-content}
</style>`;
}

function neoCss(): string {
  return `${commonRuntimeCss('neo-grid-bold')}
:root{--mm-bg:#ecece8;--mm-paper:#f5f4ef;--mm-text:#0a0a0a;--mm-accent:#e6ff3d;--mm-muted:#8a8a85;--mm-body-font:"Space Grotesk","Noto Sans KR",Arial,sans-serif;--mm-mono-font:"JetBrains Mono","Noto Sans KR",monospace}
.slide{padding:40px;background:var(--mm-bg);font-family:var(--mm-body-font);text-transform:none}
.frame{position:absolute;inset:40px;display:grid;grid-template-columns:repeat(12,1fr);grid-template-rows:repeat(8,1fr);gap:14px}
.frame>*{min-width:0;min-height:0}
.s-cover .panel-photo-l,.s-cover .panel-mid,.s-cover .panel-titletile,.s-cover .panel-photo-r,.s-cover .panel-cap,.s-stats .copy,.s-stats .stat-a,.s-stats .stat-b,.s-stats .stat-c,.s-stats .stat-big,.s-features .feat,.s-chart .pane-l,.s-chart .pane-r,.s-section .pane-num,.s-section .pane-title,.s-quote .copy,.s-quote .attr,.s-quote .mark,.s-consult .col,.s-process2 .node,.s-matrix2 .table,.s-cta .step,.s-cta .head,.s-cta .qr{background:var(--mm-paper);border:2px solid var(--mm-text);padding:28px;overflow:hidden}
.s-cover .panel-photo-l{grid-column:1/span 3;grid-row:1/span 8;background:#111}.s-cover .panel-mid{grid-column:4/span 5;grid-row:1/span 5;background:var(--mm-accent)}.s-cover .panel-titletile{grid-column:4/span 5;grid-row:6/span 3;background:var(--mm-accent)}.s-cover .panel-photo-r{grid-column:9/span 4;grid-row:1/span 5;background:#111}.s-cover .panel-cap{grid-column:9/span 4;grid-row:6/span 3}
.s-cover h1,.s-section h2,.s-cta h2{font-size:108px;line-height:.88;letter-spacing:-.025em;text-transform:uppercase}
.s-toc .head{grid-column:1/span 12;grid-row:1/span 2;background:var(--mm-text);color:var(--mm-paper);padding:34px}.s-toc .row{grid-column:span 4;grid-row:span 3;background:var(--mm-paper);border:2px solid var(--mm-text);padding:34px}.s-toc h1{font-size:88px;text-transform:uppercase}
.s-stats .accent-l{grid-column:1/span 2;grid-row:1/span 8;background:var(--mm-accent)}.s-stats .copy{grid-column:3/span 4;grid-row:1/span 8}.s-stats .stat-a{grid-column:7/span 3;grid-row:1/span 2}.s-stats .stat-b{grid-column:10/span 3;grid-row:1/span 2}.s-stats .stat-c{grid-column:7/span 3;grid-row:3/span 2}.s-stats .stat-big{grid-column:7/span 6;grid-row:5/span 4;background:var(--mm-accent)}.stat-big .v,.metric-value{font-size:190px;line-height:.8;font-weight:700}
.s-features .head{grid-column:1/span 12;grid-row:1/span 2;background:var(--mm-paper);border:2px solid var(--mm-text);padding:30px}.s-features .feat{grid-column:span 4;grid-row:span 6}.s-features h2{font-size:82px;text-transform:uppercase}.s-features h3{font-size:34px;text-transform:uppercase}.pic{background:#111;min-height:190px;margin-bottom:18px}
.s-chart .pane-l,.s-chart2 .pane-l{grid-column:1/span 5;grid-row:1/span 8;background:var(--mm-text);color:var(--mm-paper)}.s-chart .pane-r,.s-chart2 .pane-r{grid-column:6/span 7;grid-row:1/span 8}.bars{display:grid;grid-template-columns:repeat(6,1fr);gap:16px;align-items:end;height:470px}.bar{background:var(--mm-text);min-height:80px}.bar .b,.bar-fill{background:var(--mm-accent);border:2px solid var(--mm-text)}
.s-section{background:var(--mm-text);color:var(--mm-paper)}.s-section .pane-num{grid-column:1/span 4;grid-row:1/span 8;background:var(--mm-accent);color:var(--mm-text)}.s-section .pane-title{grid-column:5/span 8;grid-row:1/span 8;background:var(--mm-text);color:var(--mm-paper)}
.s-quote .photo{grid-column:1/span 5;grid-row:1/span 8;background:#111}.s-quote .copy{grid-column:6/span 7;grid-row:1/span 5}.s-quote .attr{grid-column:6/span 4;grid-row:6/span 3;background:var(--mm-accent)}.s-quote .mark{grid-column:10/span 3;grid-row:6/span 3;background:var(--mm-text);color:var(--mm-paper)}blockquote{font-size:38px;line-height:1.2}
.s-consult .head,.s-process2 .head,.s-matrix2 .head{grid-column:1/span 12;grid-row:1/span 2;background:var(--mm-text);color:var(--mm-paper);padding:28px}.s-consult .col{grid-row:3/span 6}.s-consult .col.a{grid-column:1/span 4}.s-consult .col.b{grid-column:5/span 4;background:var(--mm-accent)}.s-consult .col.c{grid-column:9/span 4}
.s-process2 .node{grid-row:3/span 5}.s-process2 .n1{grid-column:1/span 2}.s-process2 .n2{grid-column:3/span 2;background:var(--mm-accent)}.s-process2 .n3{grid-column:5/span 2}.s-process2 .n4{grid-column:7/span 2;background:var(--mm-accent)}.s-process2 .n5{grid-column:9/span 2}.s-process2 .out{grid-column:11/span 2;background:var(--mm-text);color:var(--mm-paper)}
.s-matrix2 .table{grid-column:1/span 12;grid-row:3/span 5;display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;padding:0}.cell{border-right:2px solid var(--mm-text);border-bottom:2px solid var(--mm-text);padding:18px;font-size:22px}.head-row{background:var(--mm-text);color:var(--mm-paper);font:700 14px var(--mm-mono-font);text-transform:uppercase}.pill{display:inline-block;background:var(--mm-accent);padding:6px 12px;font:700 14px var(--mm-mono-font)}
.s-cta .head{grid-column:1/span 8;grid-row:1/span 3;background:var(--mm-accent)}.s-cta .qr{grid-column:9/span 4;grid-row:1/span 3;background:var(--mm-text)}.s-cta .step{grid-row:4/span 5}.s-cta .step.a{grid-column:1/span 4}.s-cta .step.b{grid-column:5/span 4}.s-cta .step.c{grid-column:9/span 4;background:var(--mm-text);color:var(--mm-paper)}
</style>`;
}

function signalCss(): string {
  return `${commonRuntimeCss('signal')}
:root{--mm-bg:#1c2644;--mm-surface:#f0ece3;--mm-text:#e2dcd0;--mm-ink:#1a2030;--mm-muted:#8a96a8;--mm-accent:#c8a870;--mm-body-font:"DM Sans","Noto Sans KR",Arial,sans-serif;--mm-display-font:"Source Serif 4","Noto Serif KR",serif;--mm-mono-font:"IBM Plex Mono","Noto Sans KR",monospace}
.slide{padding:72px 86px;font-family:var(--mm-body-font);background:var(--mm-bg);color:var(--mm-text)}
.slide.light{background:var(--mm-surface);color:var(--mm-ink)}.slide.dark{background:var(--mm-bg);color:var(--mm-text)}
.slide-chrome,.slide-foot{display:flex;justify-content:space-between;align-items:center;font:500 13px var(--mm-mono-font);letter-spacing:.16em;text-transform:uppercase;color:var(--mm-accent)}
.slide-chrome{border-bottom:1px solid rgba(200,168,112,.55);padding-bottom:16px}.slide-foot{position:absolute;left:86px;right:86px;bottom:42px;border-top:1px solid rgba(200,168,112,.35);padding-top:14px}
.slide-body{position:absolute;left:86px;right:86px;top:150px;bottom:100px}
.slide h1,.slide h2{font-family:var(--mm-display-font);font-weight:600;letter-spacing:0;line-height:.98}.slide h1{font-size:112px}.slide h2{font-size:74px}.slide em{font-style:italic;color:var(--mm-accent)}
.slide--cover{display:flex;flex-direction:column;justify-content:center}.slide--cover h1{font-size:124px;max-width:12ch}.slide--cover p{font-size:26px;max-width:42ch;line-height:1.45;color:var(--mm-muted)}
.slide--chapter{display:grid;grid-template-columns:360px 1fr;gap:70px;align-items:center}.chapter-num{font:500 180px/.8 var(--mm-mono-font);color:var(--mm-accent)}.chapter-rule{height:2px;background:var(--mm-accent);width:100%}
.statement-body{display:grid;place-items:center;height:100%;font:600 72px/1.08 var(--mm-display-font);max-width:1200px}.statement-body p{font:600 72px/1.08 var(--mm-display-font)}
.slide--split .slide-body{display:grid;grid-template-columns:1fr .92fr;gap:58px}.split-text{font-size:25px;line-height:1.5}.split-image{background:#0d1325;overflow:hidden;min-height:620px}.split-image img{width:100%;height:100%;object-fit:cover}
.stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:38px}.stats-grid.cols-4{grid-template-columns:repeat(4,1fr)}.stat-card{border:1px solid rgba(200,168,112,.45);padding:32px;background:rgba(255,255,255,.035)}.light .stat-card{background:#fff;border-color:rgba(26,32,48,.18)}.stat-card .value{font:600 72px/.9 var(--mm-display-font);color:var(--mm-accent)}.stat-card .label{font:500 18px/1.35 var(--mm-body-font)}
.slide--quote{display:grid;place-items:center}.quote-mark{position:absolute;top:90px;left:120px;font:600 180px/.8 var(--mm-display-font);color:var(--mm-accent)}.quote-text{font:600 70px/1.12 var(--mm-display-font);max-width:1280px}.quote-attr{font:500 18px var(--mm-mono-font);color:var(--mm-accent)}
.slide--list .slide-body,.slide--dense .slide-body{display:grid;grid-template-columns:1fr 1fr;gap:36px}.slide--list li,.slide--dense li{font-size:24px;line-height:1.45;margin-bottom:18px}.slide--compare .slide-body{display:grid;grid-template-columns:1fr 1fr;gap:34px}.slide--compare .slide-body>*{border-top:2px solid var(--mm-accent);padding-top:24px}
.slide--editorial .slide-body{display:grid;grid-template-columns:.8fr 1.2fr;gap:52px}.slide--editorial p{font-size:24px;line-height:1.52}
.slide--chart .slide-body,.slide--diagram .slide-body,.slide--pie .slide-body,.slide--pyramid .slide-body,.slide--cycle .slide-body{display:grid;grid-template-columns:.9fr 1.1fr;gap:48px;align-items:center}
.chart-wrapper,.diagram,.pyramid,.cycle-grid,.vtimeline{border:1px solid rgba(200,168,112,.42);background:rgba(255,255,255,.035);min-height:520px;padding:34px}.light .chart-wrapper,.light .diagram,.light .pyramid,.light .cycle-grid,.light .vtimeline{background:#fff;border-color:rgba(26,32,48,.18)}
.chart-wrapper{display:grid;align-items:end;grid-template-columns:repeat(5,1fr);gap:18px}.chart-wrapper .bar{background:var(--mm-accent);min-height:80px}
.pyramid{display:flex;flex-direction:column-reverse;justify-content:center;gap:14px}.pyramid>*{background:var(--mm-accent);color:var(--mm-ink);padding:18px 24px;text-align:center;margin:0 auto}.pyramid>*:nth-child(1){width:90%}.pyramid>*:nth-child(2){width:70%}.pyramid>*:nth-child(3){width:50%}.pyramid>*:nth-child(4){width:32%}
.cycle-grid{display:grid;grid-template-columns:1fr 80px 1fr;grid-template-rows:1fr 80px 1fr;gap:18px}.cycle-step{border:1px solid rgba(200,168,112,.48);padding:24px}.cycle-num{font:500 18px var(--mm-mono-font);color:var(--mm-accent)}.cycle-title{font:600 28px var(--mm-display-font)}.cycle-arrow{display:grid;place-items:center;color:var(--mm-accent);font-size:42px}
.vtimeline{display:flex;flex-direction:column;gap:22px}.vtimeline>*{border-left:3px solid var(--mm-accent);padding-left:24px;font-size:22px;line-height:1.4}
.slide--end{display:flex;flex-direction:column;justify-content:center;text-align:center}.slide--end h1{font-size:116px;color:var(--mm-accent)}
</style>`;
}

function runtimeScript(): string {
  return `<script id="markmind-template-runtime-script">
(() => {
  const stage = document.querySelector('.deck-stage');
  if (!stage) return;
  const slides = Array.from(stage.querySelectorAll('.slide'));
  if (!slides.length) return;
  let current = Math.max(0, slides.findIndex(s => s.classList.contains('active')));
  if (current < 0) current = 0;
  let counter = document.querySelector('.mm-runtime-counter');
  if (!counter) {
    counter = document.createElement('div');
    counter.className = 'mm-runtime-counter';
    document.body.appendChild(counter);
  }
  const fit = () => {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = 'scale(' + scale + ')';
    stage.style.left = Math.max(0, (window.innerWidth - 1920 * scale) / 2) + 'px';
    stage.style.top = Math.max(0, (window.innerHeight - 1080 * scale) / 2) + 'px';
  };
  const show = (index) => {
    current = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((slide, i) => slide.classList.toggle('active', i === current));
    counter.textContent = (current + 1) + ' / ' + slides.length;
  };
  document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') show(current + 1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') show(current - 1);
    if (event.key.toLowerCase() === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  });
  window.addEventListener('resize', fit);
  fit();
  show(current);
})();
</script>`;
}

function runtimeCss(themeId: HtmlSlideThemeId): string {
  if (themeId === 'neo-grid-bold') return neoCss();
  if (themeId === 'signal') return signalCss();
  return blueCss();
}

export function applyFrontendTemplateRuntime(html: string, themeId?: string): string {
  const id = themeIdOrDefault(themeId);
  let next = coerceTemplateSectionClasses(html, id);
  next = wrapNeoFrames(next, id);
  next = next.replace(/<style\b[^>]*id=(["'])markmind-template-runtime\1[\s\S]*?<\/style>/gi, '');
  next = next.replace(/<script\b[^>]*id=(["'])markmind-template-runtime-script\1[\s\S]*?<\/script>/gi, '');
  next = injectIntoHead(next, runtimeCss(id));
  next = injectBeforeBodyClose(next, runtimeScript());
  return next;
}
