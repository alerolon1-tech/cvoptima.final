<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>D&D | Diálogo y Desarrollo Educativo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300;1,9..40,400&display=swap" rel="stylesheet">

<style>
/* ─── RESET ─────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --navy:       #1B3A5C;
  --navy-deep:  #0F2540;
  --teal:       #0F6E56;
  --teal-mid:   rgba(15,110,86,0.45);
  --teal-light: #E4F4EF;
  --cream:      #F8F5F0;
  --cream-dark: #EDE8E0;
  --gold:       #B8892C;
  --charcoal:   #2A2A2A;
  --gray:       #6B7280;
  --gray-light: #D8D3CA;
  --white:      #FFFFFF;

  --font-serif: 'Libre Baskerville', Georgia, serif;
  --font-sans:  'DM Sans', system-ui, sans-serif;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}

html { scroll-behavior: smooth; }

body {
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.65;
  color: var(--charcoal);
  background: var(--cream);
  overflow-x: hidden;
}

a { text-decoration: none; color: inherit; }

/* ─── UTILITIES ─────────────────────────────────────────────── */
.container       { max-width: 1140px; margin: 0 auto; padding: 0 36px; }
.container-sm    { max-width: 760px;  margin: 0 auto; padding: 0 36px; }

/* ─── NAV ───────────────────────────────────────────────────── */
nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  padding: 12px 0;
  transition: background 0.35s, box-shadow 0.35s, padding 0.35s;
}
nav.scrolled {
  background: rgba(15, 37, 64, 0.96);
  backdrop-filter: blur(14px);
  box-shadow: 0 1px 0 rgba(255,255,255,0.06);
  padding: 8px 0;
}
.nav-inner {
  display: flex; align-items: center; justify-content: space-between;
}

/* Inline logo SVG in nav */
.nav-logo-wrap { display: flex; align-items: center; gap: 14px; }
.nav-logo-svg  { width: 88px; height: 88px; flex-shrink: 0; }
.nav-logo-text {
  display: flex; flex-direction: column; line-height: 1.1;
}
.nav-logo-dyd {
  font-family: var(--font-serif);
  font-size: 28px; font-weight: 700;
  color: var(--white);
  letter-spacing: -0.01em;
}
.nav-logo-sub {
  font-size: 11px; font-weight: 500;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: rgba(255,255,255,0.4);
}

.nav-links {
  display: flex; gap: 32px; list-style: none;
}
.nav-links a {
  font-size: 12.5px; font-weight: 500; letter-spacing: 0.06em;
  text-transform: uppercase; color: rgba(255,255,255,0.65);
  transition: color 0.2s;
}
.nav-links a:hover { color: var(--white); }
.nav-cta {
  background: var(--teal) !important;
  color: var(--white) !important;
  padding: 10px 22px;
  letter-spacing: 0.05em !important;
  transition: background 0.2s, transform 0.15s !important;
}
.nav-cta:hover { background: #0d5e49 !important; transform: translateY(-1px); }

/* Mobile */
.mobile-menu-btn {
  display: none; background: none; border: none;
  cursor: pointer; padding: 4px;
}
.mobile-menu-btn span {
  display: block; width: 22px; height: 2px;
  background: white; margin: 5px 0;
  transition: transform 0.3s, opacity 0.3s;
}

/* ─── HERO ──────────────────────────────────────────────────── */
#hero {
  min-height: 100vh;
  background: var(--navy-deep);
  display: flex; flex-direction: column;
  position: relative; overflow: hidden;
}

/* Teal accent stripe — matches logo language */
.hero-stripe-teal {
  position: absolute; left: 0; top: 0; bottom: 0;
  width: 6px; background: var(--teal); z-index: 2;
}
.hero-stripe-navy {
  position: absolute; left: 6px; top: 0; bottom: 0;
  width: 2px; background: rgba(15,110,86,0.25); z-index: 2;
}

/* Decorative circles */
.hero-deco {
  position: absolute; inset: 0; pointer-events: none;
}
.hero-deco::before {
  content: '';
  position: absolute; top: -15%; right: -8%;
  width: 65vw; height: 65vw; border-radius: 50%;
  border: 1.5px solid rgba(15,110,86,0.07);
  animation: spin-slow 70s linear infinite;
}
.hero-deco::after {
  content: '';
  position: absolute; top: 10%; right: 8%;
  width: 40vw; height: 40vw; border-radius: 50%;
  border: 1px solid rgba(248,245,240,0.03);
  animation: spin-slow 100s linear infinite reverse;
}
@keyframes spin-slow { to { transform: rotate(360deg); } }

.hero-content {
  flex: 1; display: flex; flex-direction: column;
  justify-content: center;
  padding: 175px 0 80px;
  position: relative; z-index: 3;
}

.hero-eyebrow {
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--teal); margin-bottom: 32px;
  opacity: 0; transform: translateY(18px);
  animation: reveal 0.8s var(--ease-out) 0.2s forwards;
}
/* green dot accent */
.hero-eyebrow::before {
  content: '';
  display: inline-block; width: 6px; height: 6px;
  border-radius: 50%; background: var(--teal);
  margin-right: 10px; vertical-align: middle;
}

.hero-headline {
  font-family: var(--font-serif);
  font-size: clamp(48px, 6.5vw, 82px);
  font-weight: 700; line-height: 1.05;
  letter-spacing: -0.02em; color: var(--white);
  margin-bottom: 36px;
  opacity: 0; transform: translateY(28px);
  animation: reveal 1s var(--ease-out) 0.4s forwards;
}
.hero-headline em {
  font-style: italic; font-weight: 400;
  color: rgba(248,245,240,0.38);
}

.hero-rule {
  width: 48px; height: 2px;
  background: var(--teal);
  margin-bottom: 32px;
  opacity: 0; animation: reveal 0.8s var(--ease-out) 0.55s forwards;
}

.hero-sub {
  font-size: 17.5px; line-height: 1.75;
  color: rgba(212,226,236,0.78);
  max-width: 540px; margin-bottom: 52px;
  opacity: 0; transform: translateY(18px);
  animation: reveal 0.9s var(--ease-out) 0.65s forwards;
}

.hero-actions {
  display: flex; gap: 14px; flex-wrap: wrap;
  opacity: 0; transform: translateY(18px);
  animation: reveal 0.9s var(--ease-out) 0.85s forwards;
}

.btn-primary {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--teal); color: var(--white);
  padding: 15px 32px; font-size: 13.5px; font-weight: 600;
  letter-spacing: 0.05em; text-transform: uppercase;
  transition: background 0.2s, transform 0.2s;
}
.btn-primary:hover { background: #0d5e49; transform: translateY(-2px); }
.btn-primary svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; }

.btn-ghost {
  display: inline-flex; align-items: center; gap: 8px;
  border: 1.5px solid rgba(255,255,255,0.18); color: rgba(255,255,255,0.72);
  padding: 15px 32px; font-size: 13.5px; font-weight: 500;
  letter-spacing: 0.05em; text-transform: uppercase;
  transition: border-color 0.2s, color 0.2s, transform 0.2s;
}
.btn-ghost:hover { border-color: rgba(255,255,255,0.45); color: var(--white); transform: translateY(-2px); }

.hero-scroll-hint {
  padding: 36px 0; position: relative; z-index: 3;
  display: flex; align-items: center; gap: 14px;
  color: rgba(255,255,255,0.2); font-size: 10.5px;
  letter-spacing: 0.14em; text-transform: uppercase;
  opacity: 0; animation: reveal 0.8s var(--ease-out) 1.3s forwards;
}
.hero-scroll-hint::before {
  content: ''; width: 1px; height: 36px;
  background: rgba(255,255,255,0.12);
  animation: blink 2s ease-in-out infinite;
}
@keyframes blink { 0%,100%{opacity:.25} 50%{opacity:1} }

@keyframes reveal { to { opacity:1; transform:translateY(0); } }

/* ─── SECTION BASE ──────────────────────────────────────────── */
section { padding: 108px 0; }

.section-eyebrow {
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--teal); margin-bottom: 18px;
  display: flex; align-items: center; gap: 10px;
}
.section-eyebrow::before {
  content: ''; display: block;
  width: 20px; height: 1.5px; background: var(--teal);
}
.section-title {
  font-family: var(--font-serif);
  font-size: clamp(34px, 3.8vw, 50px);
  font-weight: 700; line-height: 1.12;
  letter-spacing: -0.015em; color: var(--navy);
  margin-bottom: 22px;
}
.section-title em { font-style: italic; font-weight: 400; color: var(--teal); }
.section-intro {
  font-size: 17px; line-height: 1.75;
  color: var(--gray); max-width: 600px;
}

/* ─── MIRADA (intro rich text section) ─────────────────────── */
#mirada { background: var(--cream); }

.mirada-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 80px;
  align-items: start;
  margin-top: 64px;
}
.mirada-quote {
  font-family: var(--font-serif);
  font-size: clamp(20px, 2.2vw, 28px);
  font-style: italic; font-weight: 400;
  line-height: 1.5; color: var(--navy);
  padding-left: 28px;
  border-left: 3px solid var(--teal);
  position: sticky; top: 120px;
}
.mirada-quote cite {
  display: block; margin-top: 20px;
  font-family: var(--font-sans);
  font-size: 12px; font-style: normal;
  font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--teal);
}
.mirada-body p {
  font-size: 16px; line-height: 1.8;
  color: var(--charcoal); margin-bottom: 22px;
}
.mirada-body p strong { font-weight: 600; color: var(--navy); }
.mirada-dimensions {
  margin-top: 36px; display: flex; flex-direction: column; gap: 0;
  border-top: 1px solid var(--cream-dark);
}
.dim-item {
  display: flex; align-items: flex-start; gap: 18px;
  padding: 20px 0; border-bottom: 1px solid var(--cream-dark);
}
.dim-num {
  font-family: var(--font-serif);
  font-size: 13px; font-weight: 700;
  color: var(--teal); flex-shrink: 0; padding-top: 2px;
  min-width: 28px;
}
.dim-text {
  font-size: 15px; color: var(--charcoal); line-height: 1.6;
}
.dim-text strong { font-weight: 600; color: var(--navy); }

/* ─── PROBLEMA ──────────────────────────────────────────────── */
#problema { background: var(--white); }

.problema-intro { margin-bottom: 64px; }
.problema-intro blockquote {
  font-family: var(--font-serif);
  font-size: clamp(19px, 2vw, 25px);
  font-style: italic; line-height: 1.5;
  color: var(--navy); padding: 36px 36px 36px 44px;
  background: var(--cream); border-left: 3px solid var(--navy);
  margin-top: 40px;
}

.problema-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 1px; background: var(--cream-dark);
}
.problema-card {
  background: var(--white);
  padding: 44px 36px 48px;
  border-top: 3px solid var(--navy);
  transition: border-color 0.25s;
}
.problema-card:hover { border-color: var(--teal); }
.pcard-num {
  font-family: var(--font-serif);
  font-size: 52px; font-weight: 700;
  color: rgba(27,58,92,0.06); line-height: 1;
  margin-bottom: -8px;
}
.pcard-title {
  font-size: 17px; font-weight: 600;
  color: var(--navy); margin-bottom: 12px;
}
.pcard-text { font-size: 15px; color: var(--gray); line-height: 1.65; }

/* ─── DIFERENCIAL ───────────────────────────────────────────── */
#diferencial {
  background: var(--navy);
  position: relative; overflow: hidden;
}
#diferencial::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0;
  height: 1px; background: rgba(15,110,86,0.5);
}
/* Watermark */
#diferencial::after {
  content: 'D&D';
  position: absolute; right: -3%; bottom: -12%;
  font-family: var(--font-serif); font-size: clamp(180px, 24vw, 320px);
  font-weight: 700; color: rgba(255,255,255,0.025);
  pointer-events: none; user-select: none; line-height: 1;
}

.dif-top {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 80px; align-items: end; margin-bottom: 72px;
}
.dif-top .section-eyebrow { color: var(--teal); }
.dif-top .section-title { color: var(--white); }
.dif-top .section-title em { color: rgba(248,245,240,0.28); }
.dif-statement {
  font-family: var(--font-serif);
  font-size: clamp(18px, 2vw, 24px);
  font-style: italic; font-weight: 400;
  color: rgba(212,226,236,0.65);
  line-height: 1.55; align-self: end;
}
.dif-statement strong { color: var(--white); font-style: normal; }

.dif-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 1px; background: rgba(255,255,255,0.05);
}
.dif-card {
  background: rgba(255,255,255,0.03);
  padding: 44px 36px 48px;
  border-bottom: 2px solid var(--teal);
  transition: background 0.25s, transform 0.25s;
  position: relative;
}
.dif-card:hover { background: rgba(255,255,255,0.07); transform: translateY(-4px); }
.dcard-num {
  font-family: var(--font-serif);
  font-size: 52px; font-weight: 700;
  color: rgba(15,110,86,0.12); line-height: 1;
  margin-bottom: -8px;
}
.dcard-title {
  font-size: 18px; font-weight: 600;
  color: var(--white); margin-bottom: 12px;
}
.dcard-text { font-size: 15px; color: rgba(200,218,230,0.62); line-height: 1.65; }

/* ─── PROCESO ───────────────────────────────────────────────── */
#proceso { background: var(--cream); }

.proceso-intro { text-align: center; max-width: 580px; margin: 0 auto 72px; }
.proceso-intro .section-eyebrow { justify-content: center; }
.proceso-intro .section-intro { margin: 0 auto; }

.steps {
  display: grid; grid-template-columns: repeat(5, 1fr);
  position: relative;
}
.steps-line {
  position: absolute; top: 27px; left: calc(10% + 28px); right: calc(10% + 28px);
  height: 1px; background: var(--cream-dark); z-index: 0;
}
.step {
  display: flex; flex-direction: column; align-items: center;
  text-align: center; padding: 0 12px; position: relative; z-index: 1;
}
.step-circle {
  width: 54px; height: 54px; border-radius: 50%;
  background: var(--navy);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-serif); font-size: 20px; font-weight: 700;
  color: var(--white); margin-bottom: 24px;
  transition: background 0.2s, transform 0.2s;
  border: 2px solid var(--cream);
  box-shadow: 0 0 0 1px var(--cream-dark);
}
.step:hover .step-circle { background: var(--teal); transform: scale(1.08); }
.step-title {
  font-size: 13.5px; font-weight: 600;
  color: var(--navy); margin-bottom: 8px;
}
.step-text { font-size: 13px; color: var(--gray); line-height: 1.55; }

.proceso-cierre {
  margin-top: 64px; padding: 40px 44px;
  background: var(--white); border-left: 3px solid var(--teal);
  font-family: var(--font-serif);
  font-size: 18px; font-style: italic;
  color: var(--navy); line-height: 1.6;
  max-width: 680px; margin-left: auto; margin-right: auto;
}

/* ─── ÁREAS ─────────────────────────────────────────────────── */
#areas { background: var(--white); }

.areas-layout {
  display: grid; grid-template-columns: 5fr 4fr;
  gap: 80px; align-items: start; margin-top: 60px;
}
.areas-text p {
  font-size: 16px; line-height: 1.8; color: var(--charcoal);
  margin-bottom: 22px;
}
.areas-text p strong { font-weight: 600; color: var(--navy); }
.areas-profiles {
  padding: 40px 36px; background: var(--cream);
  border-top: 3px solid var(--teal);
}
.areas-profiles-title {
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--teal); margin-bottom: 24px;
}
.areas-list {
  list-style: none; display: flex; flex-direction: column; gap: 12px;
}
.areas-list li {
  font-size: 15px; color: var(--charcoal); line-height: 1.5;
  display: flex; align-items: flex-start; gap: 12px;
}
.areas-list li::before {
  content: ''; flex-shrink: 0;
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--teal); margin-top: 8px;
}

/* ─── PARA QUIÉN ─────────────────────────────────────────────── */
#paraquien { background: var(--cream); }

.pq-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 24px; margin-top: 56px;
}
.pq-card { padding: 48px 44px; }
.pq-si { background: var(--teal-light); border-left: 3px solid var(--teal); }
.pq-no { background: var(--white); border-left: 3px solid var(--cream-dark); }
.pq-label {
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase; margin-bottom: 28px;
}
.pq-si .pq-label { color: var(--teal); }
.pq-no .pq-label { color: var(--gray); }
.pq-list { list-style: none; display: flex; flex-direction: column; gap: 14px; }
.pq-item {
  font-size: 15px; line-height: 1.6;
  display: flex; align-items: flex-start; gap: 12px;
}
.pq-si .pq-item { color: var(--charcoal); }
.pq-no .pq-item { color: var(--gray); }
.pq-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; margin-top: 8px; }
.pq-si .pq-dot { background: var(--teal); }
.pq-no .pq-dot { background: var(--gray-light); }

/* ─── EQUIPO ─────────────────────────────────────────────────── */
#equipo {
  background: var(--navy-deep);
  position: relative; overflow: hidden;
}

.equipo-top {
  margin-bottom: 64px;
}
.equipo-top .section-eyebrow { color: var(--teal); }
.equipo-top .section-title { color: var(--white); }
.equipo-top .section-intro { color: rgba(200,218,232,0.65); max-width: 640px; }

.equipo-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 32px;
}
.persona-card {
  padding: 52px 44px;
  border: 1px solid rgba(255,255,255,0.07);
  background: rgba(255,255,255,0.03);
  transition: background 0.25s;
  position: relative;
}
.persona-card::before {
  content: ''; position: absolute; top: 0; left: 0;
  width: 5px; height: 100%; background: var(--teal);
}
.persona-card:hover { background: rgba(255,255,255,0.06); }

.persona-initial {
  width: 120px; height: 120px; border-radius: 50%;
  background: var(--teal);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-serif); font-size: 48px;
  font-weight: 700; color: var(--white);
  margin-bottom: 28px;
  border: 3px solid rgba(255,255,255,0.08);
  overflow: hidden;
}
.persona-name {
  font-family: var(--font-serif);
  font-size: 26px; font-weight: 700;
  color: var(--white); margin-bottom: 4px;
}
.persona-role {
  font-size: 11.5px; font-weight: 600;
  letter-spacing: 0.1em; color: var(--teal);
  text-transform: uppercase; margin-bottom: 24px;
}
.persona-rule { width: 28px; height: 1px; background: rgba(255,255,255,0.12); margin-bottom: 20px; }
.persona-bio {
  font-size: 15px; color: rgba(180,200,218,0.78); line-height: 1.75;
  margin-bottom: 24px;
}
.persona-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.persona-tag {
  padding: 5px 12px; border: 1px solid rgba(255,255,255,0.1);
  font-size: 11px; color: rgba(180,200,218,0.5);
  letter-spacing: 0.04em;
}

/* ─── CONTACTO ──────────────────────────────────────────────── */
#contacto {
  background: var(--navy);
  text-align: center; position: relative; overflow: hidden;
}
#contacto::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--teal) 30%, var(--teal) 70%, transparent);
}

.contacto-headline {
  font-family: var(--font-serif);
  font-size: clamp(38px, 5vw, 60px);
  font-weight: 700; line-height: 1.1;
  color: var(--white); margin-bottom: 24px;
}
.contacto-headline em { font-style: italic; font-weight: 400; color: rgba(248,245,240,0.32); }
.contacto-sub {
  font-size: 17px; color: rgba(200,218,232,0.65);
  line-height: 1.7; margin-bottom: 60px;
  max-width: 500px; margin-left: auto; margin-right: auto;
}

.contacto-cards {
  display: flex; gap: 24px; justify-content: center;
  flex-wrap: wrap; margin-bottom: 72px;
}
.contacto-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-top: 2px solid var(--teal);
  padding: 40px 48px; min-width: 260px;
  transition: background 0.2s, transform 0.2s;
  cursor: pointer;
  position: relative;
}
.contacto-card-wa {
  position: absolute; top: 16px; right: 16px;
  width: 28px; height: 28px;
  background: #25D366; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  opacity: 0.85;
}
.contacto-card-wa svg { width: 16px; height: 16px; fill: white; }
.contacto-card:hover { background: rgba(255,255,255,0.08); transform: translateY(-4px); }
.contacto-card-logo { margin-bottom: 20px; display: flex; justify-content: center; }
.contacto-name {
  font-family: var(--font-serif);
  font-size: 22px; font-weight: 700;
  color: var(--white); margin-bottom: 4px;
}
.contacto-role {
  font-size: 11px; color: var(--teal);
  font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; margin-bottom: 20px;
}
.contacto-detail {
  font-size: 14px; color: rgba(180,200,218,0.65); line-height: 1.9;
}
.contacto-detail span { color: rgba(180,200,218,0.65); }
.contacto-wa {
  display: inline-flex; align-items: center;
  background: #25D366; color: white;
  padding: 5px 12px; border-radius: 20px;
  font-size: 12px; font-weight: 600;
  margin-top: 10px; letter-spacing: 0.03em;
}

.contacto-tagline {
  font-family: var(--font-serif);
  font-size: 19px; font-style: italic;
  color: rgba(255,255,255,0.22);
}

/* ─── FOOTER ─────────────────────────────────────────────────── */
footer {
  background: var(--navy-deep);
  padding: 32px 0;
  border-top: 1px solid rgba(255,255,255,0.05);
}
.footer-inner {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 14px;
}
.footer-logo { display: flex; align-items: center; gap: 12px; }
.footer-logo-svg { width: 32px; height: 32px; }
.footer-brand {
  font-family: var(--font-serif);
  font-size: 18px; font-weight: 700; color: var(--white);
}
.footer-brand span {
  display: block; font-family: var(--font-sans);
  font-size: 9px; font-weight: 500;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(255,255,255,0.3); margin-top: 2px;
}
.footer-links {
  display: flex; gap: 24px; list-style: none;
}
.footer-links a {
  font-size: 11.5px; font-weight: 500;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: rgba(255,255,255,0.28); transition: color 0.2s;
}
.footer-links a:hover { color: rgba(255,255,255,0.65); }
.footer-copy {
  font-size: 12px; color: rgba(255,255,255,0.22);
}

/* ─── WHATSAPP FLOAT ─────────────────────────────────────────── */
.wa-float {
  position: fixed; bottom: 30px; right: 30px; z-index: 200;
  width: 54px; height: 54px; border-radius: 50%;
  background: #25D366;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 18px rgba(37,211,102,0.35);
  transition: transform 0.2s, box-shadow 0.2s;
  animation: wa-pulse 3s ease-in-out infinite 2.5s;
}
.wa-float:hover { transform: scale(1.1); box-shadow: 0 6px 26px rgba(37,211,102,0.5); }
.wa-float svg { width: 26px; height: 26px; fill: white; }
@keyframes wa-pulse {
  0%,100%{box-shadow:0 4px 18px rgba(37,211,102,0.35)}
  50%{box-shadow:0 4px 28px rgba(37,211,102,0.6),0 0 0 8px rgba(37,211,102,0.07)}
}

/* ─── SCROLL ANIMATIONS ──────────────────────────────────────── */
.fade-up {
  opacity: 1; transform: translateY(0);
  transition: opacity 0.72s var(--ease-out), transform 0.72s var(--ease-out);
}
.js-ready .fade-up {
  opacity: 0; transform: translateY(28px);
}
.js-ready .fade-up.visible { opacity: 1; transform: translateY(0); }
.delay-1 { transition-delay: 0.1s; }
.delay-2 { transition-delay: 0.2s; }
.delay-3 { transition-delay: 0.3s; }
.delay-4 { transition-delay: 0.4s; }
.delay-5 { transition-delay: 0.5s; }

/* ─── RESPONSIVE ─────────────────────────────────────────────── */
.mobile-menu-btn { display: none; background: none; border: none; cursor: pointer; padding: 4px; }
.mobile-menu-btn span { display: block; width: 22px; height: 2px; background: white; margin: 5px 0; transition: transform 0.3s, opacity 0.3s; }

@media (max-width: 960px) {
  .nav-links { display: none; }
  .nav-links.open {
    display: flex; flex-direction: column;
    position: fixed; inset: 0;
    background: var(--navy-deep);
    justify-content: center; align-items: center;
    gap: 36px; z-index: 90;
  }
  .nav-links.open a { font-size: 18px; }
  .mobile-menu-btn { display: block; position: relative; z-index: 110; }
  .mirada-layout { grid-template-columns: 1fr; gap: 40px; }
  .mirada-quote { position: static; }
  .problema-grid, .dif-grid, .equipo-grid { grid-template-columns: 1fr; }
  .dif-top { grid-template-columns: 1fr; gap: 24px; }
  .steps { grid-template-columns: repeat(2, 1fr); gap: 36px; }
  .steps-line { display: none; }
  .areas-layout { grid-template-columns: 1fr; gap: 40px; }
  .pq-grid { grid-template-columns: 1fr; }
  .contacto-cards { flex-direction: column; align-items: center; }
  .footer-inner { justify-content: center; text-align: center; }
  .footer-links { justify-content: center; }
}
@media (max-width: 600px) {
  .steps { grid-template-columns: 1fr; }
  .container, .container-sm { padding: 0 22px; }
  section { padding: 76px 0; }
  .pq-card, .persona-card { padding: 36px 28px; }
}
</style>
</head>
<body>

<!-- WhatsApp float -->
<a href="https://wa.me/5491100000000?text=Hola%20D%26D%2C%20me%20interesa%20conocer%20m%C3%A1s%20sobre%20el%20servicio" class="wa-float" target="_blank" aria-label="WhatsApp">
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
</a>

<!-- ══ NAV ══ -->
<nav id="main-nav">
  <div class="container">
    <div class="nav-inner">
      <a href="#hero" class="nav-logo-wrap">
        <!-- Logo círculo crema (sobre fondo oscuro) -->
        <svg class="nav-logo-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
          <defs>
            <clipPath id="nc"><circle cx="100" cy="100" r="100"/></clipPath>
          </defs>
          <circle cx="100" cy="100" r="100" fill="#1B3A5C"/>
          <rect x="0" y="0" width="22" height="200" fill="#0F6E56" clip-path="url(#nc)"/>
          <rect x="178" y="0" width="22" height="136" fill="rgba(15,110,86,0.45)" clip-path="url(#nc)"/>
          <text x="60"  y="118" font-family="'Libre Baskerville',Georgia,serif" font-size="60" font-weight="700" fill="#F8F5F0" text-anchor="middle">D</text>
          <text x="100" y="110" font-family="'Libre Baskerville',Georgia,serif" font-size="28" font-weight="700" fill="#F8F5F0" text-anchor="middle">&amp;</text>
          <text x="140" y="118" font-family="'Libre Baskerville',Georgia,serif" font-size="60" font-weight="700" fill="#F8F5F0" text-anchor="middle">D</text>
        </svg>
        <div class="nav-logo-text">
          <span class="nav-logo-dyd">D&amp;D</span>
          <span class="nav-logo-sub">Diálogo y Desarrollo Educativo</span>
        </div>
      </a>
      <ul class="nav-links" id="nav-links">
        <li><a href="#mirada">Nuestra mirada</a></li>
        <li><a href="#diferencial">Lo que hacemos</a></li>
        <li><a href="#proceso">Cómo trabajamos</a></li>
        <li><a href="#equipo">Quiénes somos</a></li>
        <li><a href="#contacto" class="nav-cta">Hablemos</a></li>
      </ul>
      <button class="mobile-menu-btn" id="menu-btn" aria-label="Menú">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
</nav>

<!-- ══ HERO ══ -->
<section id="hero">
  <div class="hero-deco"></div>
  <div class="hero-stripe-teal"></div>
  <div class="hero-stripe-navy"></div>

  <div class="hero-content container">
    <p class="hero-eyebrow">Consultora en desarrollo educativo · Buenos Aires</p>
    <h1 class="hero-headline">
      Docentes que se integran<br>
      al proyecto educativo<br>
      <em>y construyen equipo.</em>
    </h1>
    <div class="hero-rule"></div>
    <p class="hero-sub">
      Acompañamos a instituciones educativas privadas en la búsqueda y selección de docentes que se alinean con su proyecto pedagógico, su cultura institucional y su equipo.
    </p>
    <div class="hero-actions">
      <a href="#contacto" class="btn-primary">
        Quiero saber más
        <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </a>
      <a href="#mirada" class="btn-ghost">Cómo pensamos</a>
    </div>
  </div>
  <div class="hero-scroll-hint container">Scroll</div>
</section>

<!-- ══ NUESTRA MIRADA ══ -->
<section id="mirada">
  <div class="container">
    <div class="fade-up">
      <p class="section-eyebrow">Nuestra mirada</p>
      <h2 class="section-title">Más allá de<br><em>cubrir un cargo.</em></h2>
    </div>
      <div class="mirada-layout fade-up delay-1">
        <blockquote class="mirada-quote">
          "Formar parte de una institución educativa implica algo más profundo que ocupar un puesto: supone integrarse a un proyecto pedagógico, a una cultura institucional, para consolidar una comunidad educativa en movimiento, con propósito."
          <cite>D&D · Diálogo y Desarrollo Educativo</cite>
        </blockquote>
        <div class="mirada-body">
          <p>Conocer y comprender el proyecto educativo de cada institución es el punto de partida de nuestro trabajo. Esto implica considerar, además de la trayectoria del docente:</p>
          <div class="mirada-dimensions">
            <div class="dim-item">
              <span class="dim-num">01</span>
              <span class="dim-text"><strong>La cultura institucional</strong> a la que se integrará el nuevo docente.</span>
            </div>
            <div class="dim-item">
              <span class="dim-num">02</span>
              <span class="dim-text"><strong>Los lineamientos pedagógicos</strong> del nivel o la modalidad de la institución.</span>
            </div>
            <div class="dim-item">
              <span class="dim-num">03</span>
              <span class="dim-text"><strong>Las dinámicas del equipo</strong> existente y cómo la incorporación las afectará.</span>
            </div>
            <div class="dim-item">
              <span class="dim-num">04</span>
              <span class="dim-text"><strong>Los vínculos</strong> que la institución busca construir con su comunidad educativa.</span>
            </div>
          </div>
        </div>
      </div>
  </div>
</section>

<!-- ══ EL PROBLEMA ══ -->
<section id="problema">
  <div class="container">
    <div class="fade-up">
      <p class="section-eyebrow">El problema que resolvemos</p>
      <h2 class="section-title">La selección docente<br><em>define el proyecto educativo.</em></h2>
    </div>
    <div class="problema-intro fade-up delay-1">
      <blockquote>
        "Incorporar el docente adecuado implica encontrar a alguien que entienda el proyecto educativo, que se integre al equipo y que represente a la institución."
      </blockquote>
    </div>
    <div class="problema-grid fade-up delay-2">
      <div class="problema-card">
        <div class="pcard-num">01</div>
        <h3 class="pcard-title">Procesos a cargo del equipo directivo</h3>
        <p class="pcard-text">La búsqueda recae sobre quienes ya tienen múltiples responsabilidades, con poco tiempo y criterios que se construyen caso por caso.</p>
      </div>
      <div class="problema-card">
        <div class="pcard-num">02</div>
        <h3 class="pcard-title">Búsqueda por recomendación</h3>
        <p class="pcard-text">Las redes informales son el canal habitual. Funcionan a veces, pero raramente garantizan el perfil institucional que cada escuela necesita.</p>
      </div>
      <div class="problema-card">
        <div class="pcard-num">03</div>
        <h3 class="pcard-title">El encaje tiene consecuencias reales</h3>
        <p class="pcard-text">Cada incorporación impacta en el aula y en el equipo. Cuando el perfil es inadecuado, lo sienten los estudiantes primero.</p>
      </div>
    </div>
  </div>
</section>

<!-- ══ DIFERENCIAL ══ -->
<section id="diferencial">
  <div class="container">
    <div class="dif-top">
      <div class="fade-up">
        <p class="section-eyebrow">Lo que hacemos diferente</p>
        <h2 class="section-title">Acompañamiento desde<br><em>adentro del proyecto.</em></h2>
      </div>
      <p class="dif-statement fade-up delay-2">
        Antes de salir a buscar candidatos, entendemos <strong>qué tipo de docente necesita esta institución</strong>. No cualquier institución — esta.
      </p>
    </div>
    <div class="dif-grid fade-up delay-1">
      <div class="dif-card">
        <div class="dcard-num">01</div>
        <h3 class="dcard-title">Proyecto pedagógico</h3>
        <p class="dcard-text">El perfil surge de la propuesta educativa específica de la institución — no del CV más disponible.</p>
      </div>
      <div class="dif-card">
        <div class="dcard-num">02</div>
        <h3 class="dcard-title">Equipo existente</h3>
        <p class="dcard-text">Quién trabaja junto a quién importa. La incorporación es siempre un acto relacional.</p>
      </div>
      <div class="dif-card">
        <div class="dcard-num">03</div>
        <h3 class="dcard-title">Cultura institucional</h3>
        <p class="dcard-text">Los valores, el estilo y la misión que distinguen a esa institución son parte del criterio de evaluación.</p>
      </div>
    </div>
  </div>
</section>

<!-- ══ PROCESO ══ -->
<section id="proceso">
  <div class="container">
    <div class="proceso-intro fade-up">
      <p class="section-eyebrow">Cómo trabajamos</p>
      <h2 class="section-title">Un proceso de<br><em>cinco etapas.</em></h2>
      <p class="section-intro">Cada búsqueda empieza por entender la institución — no por buscar candidatos.</p>
    </div>
    <div class="steps" style="position:relative;">
      <div class="steps-line"></div>
      <div class="step fade-up delay-1">
        <div class="step-circle">1</div>
        <h3 class="step-title">Comprensión del proyecto</h3>
        <p class="step-text">Conversación diagnóstica para conocer la institución, su cultura y el cargo a cubrir.</p>
      </div>
      <div class="step fade-up delay-2">
        <div class="step-circle">2</div>
        <h3 class="step-title">Definición del perfil</h3>
        <p class="step-text">Definimos juntos la formación, competencias y capacidad de integración buscadas.</p>
      </div>
      <div class="step fade-up delay-3">
        <div class="step-circle">3</div>
        <h3 class="step-title">Búsqueda y evaluación</h3>
        <p class="step-text">Difusión en canales especializados y entrevistas con foco pedagógico e institucional.</p>
      </div>
      <div class="step fade-up delay-4">
        <div class="step-circle">4</div>
        <h3 class="step-title">Presentación de candidatos</h3>
        <p class="step-text">Terna evaluada con informe de fit institucional para facilitar una decisión informada.</p>
      </div>
      <div class="step fade-up delay-5">
        <div class="step-circle">5</div>
        <h3 class="step-title">Acompañamiento e integración</h3>
        <p class="step-text">Acompañamos la decisión final y orientamos la integración al equipo cuando es requerido.</p>
      </div>
    </div>
    <div class="fade-up delay-2">
      <p class="proceso-cierre">
        "El objetivo es contribuir a la construcción de equipos educativos sólidos y comprometidos con el trabajo pedagógico."
      </p>
    </div>
  </div>
</section>

<!-- ══ ÁREAS DE INTERVENCIÓN ══ -->
<section id="areas">
  <div class="container">
    <div class="fade-up">
      <p class="section-eyebrow">Áreas de intervención</p>
      <h2 class="section-title">Conformación de<br><em>equipos educativos.</em></h2>
    </div>
      <div class="areas-layout fade-up delay-1">
        <div class="areas-text">
          <p>Acompañamos a instituciones en la incorporación de profesionales que se integren de manera coherente a su proyecto pedagógico. Cada proceso se desarrolla de manera situada, atendiendo a las características de la institución y al perfil específico del cargo.</p>
        </div>
        <div class="areas-profiles">
          <p class="areas-profiles-title">Perfiles con los que trabajamos</p>
          <ul class="areas-list">
            <li>Docentes de nivel inicial, primario, secundario y terciario</li>
            <li>Modalidades: educación de adultos, educación física, artística, especial</li>
            <li>Coordinadores pedagógicos</li>
            <li>Profesionales de orientación escolar</li>
            <li>Perfiles educativos especializados según necesidades institucionales</li>
          </ul>
        </div>
      </div>
  </div>
</section>

<!-- ══ PARA QUIÉN ══ -->
<section id="paraquien">
  <div class="container">
    <div class="fade-up">
      <p class="section-eyebrow">Para quién es D&amp;D</p>
      <h2 class="section-title">Instituciones con una<br><em>identidad pedagógica propia.</em></h2>
    </div>
    <div class="pq-grid fade-up delay-1">
      <div class="pq-card pq-si">
        <p class="pq-label">Instituciones que se benefician</p>
        <ul class="pq-list">
          <li class="pq-item"><span class="pq-dot"></span><span>Buscan apoyo externo profesionalizado para sus procesos de selección</span></li>
          <li class="pq-item"><span class="pq-dot"></span><span>Quieren ampliar sus canales de búsqueda con criterio institucional</span></li>
          <li class="pq-item"><span class="pq-dot"></span><span>Valoran la coherencia entre el perfil docente y el proyecto pedagógico</span></li>
          <li class="pq-item"><span class="pq-dot"></span><span>Tienen una identidad pedagógica propia que quieren preservar</span></li>
          <li class="pq-item"><span class="pq-dot"></span><span>Quieren sistematizar la selección con criterio institucional propio</span></li>
          <li class="pq-item"><span class="pq-dot"></span><span>Están en procesos de crecimiento o transformación institucional</span></li>
        </ul>
      </div>
      <div class="pq-card pq-no">
        <p class="pq-label">Nuestro enfoque</p>
        <ul class="pq-list">
          <li class="pq-item"><span class="pq-dot"></span><span>Acompañamiento personalizado para cada institución y cada búsqueda</span></li>
          <li class="pq-item"><span class="pq-dot"></span><span>Proceso con foco en el proyecto educativo específico de cada escuela</span></li>
          <li class="pq-item"><span class="pq-dot"></span><span>Evaluación que va más allá del CV: competencias pedagógicas y fit institucional</span></li>
          <li class="pq-item"><span class="pq-dot"></span><span>Un apoyo profesional que fortalece — y respeta — la decisión directiva</span></li>
        </ul>
      </div>
    </div>
  </div>
</section>

<!-- ══ EQUIPO ══ -->
<section id="equipo">
  <div class="container">
    <div class="equipo-top fade-up">
      <p class="section-eyebrow">Quiénes somos</p>
      <h2 class="section-title">Dos trayectorias.<br><em>Un servicio.</em></h2>
      <p class="section-intro">D&D surge del encuentro entre la experiencia en selección profesional y una trayectoria extensa en el sistema educativo. Ese cruce de miradas nos permite leer cada institución con profundidad y encontrar el perfil que realmente necesita.</p>
    </div>
    <div class="equipo-grid">
      <div class="persona-card fade-up delay-2">
        <div class="persona-initial">
  <img src="foto-alejandra.jpeg" alt="Alejandra Rolón" style="width:100%; height:100%; object-fit:cover;">
</div>
        <h3 class="persona-name">Alejandra Rolón</h3>
        <p class="persona-role">Selección y desarrollo profesional</p>
        <div class="persona-rule"></div>
        <p class="persona-bio">Licenciada en Sociología (UBA) con más de veinte años acompañando tanto a organizaciones en la selección de perfiles como a profesionales en el desarrollo de sus trayectorias. Esa doble perspectiva es lo que aporta a D&D.</p>
        <div class="persona-tags">
          <span class="persona-tag">Sociología · UBA</span>
          <span class="persona-tag">Headhunting</span>
          <span class="persona-tag">Empleabilidad</span>
        </div>
      </div>
      <div class="persona-card fade-up delay-3">
        <div class="persona-initial">
  <img src="foto-mariaines.jpg" alt="María Inés Solé" style="width:100%; height:100%; object-fit:cover;">
</div>        <h3 class="persona-name">María Inés Solé</h3>
        <p class="persona-role">Educación y gestión institucional</p>
        <div class="persona-rule"></div>
        <p class="persona-bio">Con más de cuarenta años de trayectoria en el sistema educativo, incluyendo funciones de supervisión. Coach Ontológico Profesional Certificada (PCC) por la International Coaching Federation.</p>
        <div class="persona-tags">
          <span class="persona-tag">Supervisión educativa</span>
          <span class="persona-tag">Coach PCC</span>
          <span class="persona-tag">ICF</span>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ══ CONTACTO ══ -->
<section id="contacto">
  <div class="container">
    <div class="fade-up">
      <h2 class="contacto-headline">
        Construir el equipo que<br>
        <em>tu institución necesita</em><br>
        empieza por un diálogo.
      </h2>
      <p class="contacto-sub">Si tu institución tiene una vacante activa o la anticipa, este es un buen momento para iniciar ese diálogo.</p>
    </div>
    <div class="contacto-cards fade-up delay-1">
      <a href="https://wa.me/5491100000000?text=Hola%20D%26D%2C%20me%20interesa%20conocer%20m%C3%A1s%20sobre%20el%20servicio" class="contacto-card" target="_blank">
        <div class="contacto-card-logo">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="52" height="52">
            <defs><clipPath id="ct1"><circle cx="100" cy="100" r="100"/></clipPath></defs>
            <circle cx="100" cy="100" r="100" fill="#0F6E56"/>
            <rect x="0" y="0" width="20" height="200" fill="rgba(27,58,92,0.5)" clip-path="url(#ct1)"/>
            <rect x="180" y="0" width="20" height="136" fill="rgba(248,245,240,0.2)" clip-path="url(#ct1)"/>
            <text x="60"  y="118" font-family="'Libre Baskerville',Georgia,serif" font-size="60" font-weight="700" fill="#F8F5F0" text-anchor="middle">D</text>
            <text x="100" y="110" font-family="'Libre Baskerville',Georgia,serif" font-size="28" font-weight="700" fill="#F8F5F0" text-anchor="middle">&amp;</text>
            <text x="140" y="118" font-family="'Libre Baskerville',Georgia,serif" font-size="60" font-weight="700" fill="#F8F5F0" text-anchor="middle">D</text>
          </svg>
        </div>
        <h3 class="contacto-name">Alejandra Rolón</h3>
        <p class="contacto-role">Selección y headhunting</p>
        <div class="contacto-detail">
          <span>alejandra@dyd.com.ar</span><br>
          <span class="contacto-wa">
            <svg viewBox="0 0 24 24" width="13" height="13" style="fill:white;vertical-align:middle;margin-right:5px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            WhatsApp
          </span>
        </div>
      </a>
      <a href="https://wa.me/5491100000001?text=Hola%20D%26D%2C%20me%20interesa%20conocer%20m%C3%A1s%20sobre%20el%20servicio" class="contacto-card" target="_blank">
        <div class="contacto-card-logo">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="52" height="52">
            <defs><clipPath id="ct2"><circle cx="100" cy="100" r="100"/></clipPath></defs>
            <circle cx="100" cy="100" r="100" fill="#0F6E56"/>
            <rect x="0" y="0" width="20" height="200" fill="rgba(27,58,92,0.5)" clip-path="url(#ct2)"/>
            <rect x="180" y="0" width="20" height="136" fill="rgba(248,245,240,0.2)" clip-path="url(#ct2)"/>
            <text x="60"  y="118" font-family="'Libre Baskerville',Georgia,serif" font-size="60" font-weight="700" fill="#F8F5F0" text-anchor="middle">D</text>
            <text x="100" y="110" font-family="'Libre Baskerville',Georgia,serif" font-size="28" font-weight="700" fill="#F8F5F0" text-anchor="middle">&amp;</text>
            <text x="140" y="118" font-family="'Libre Baskerville',Georgia,serif" font-size="60" font-weight="700" fill="#F8F5F0" text-anchor="middle">D</text>
          </svg>
        </div>
        <h3 class="contacto-name">María Inés Solé</h3>
        <p class="contacto-role">Educación y gestión</p>
        <div class="contacto-detail">
          <span>mariaines@dyd.com.ar</span><br>
          <span class="contacto-wa">
            <svg viewBox="0 0 24 24" width="13" height="13" style="fill:white;vertical-align:middle;margin-right:5px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            WhatsApp
          </span>
        </div>
      </a>
    </div>
    <p class="contacto-tagline fade-up delay-2">"El docente correcto para tu institución existe. Lo ayudamos a encontrarlo."</p>
  </div>
</section>

<!-- ══ FOOTER ══ -->
<footer>
  <div class="container">
    <div class="footer-inner">
      <div class="footer-logo">
        <svg class="footer-logo-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
          <defs><clipPath id="nf"><circle cx="100" cy="100" r="100"/></clipPath></defs>
          <circle cx="100" cy="100" r="100" fill="#1B3A5C"/>
          <rect x="0" y="0" width="22" height="200" fill="#0F6E56" clip-path="url(#nf)"/>
          <rect x="178" y="0" width="22" height="136" fill="rgba(15,110,86,0.45)" clip-path="url(#nf)"/>
          <text x="60"  y="118" font-family="'Libre Baskerville',Georgia,serif" font-size="60" font-weight="700" fill="#F8F5F0" text-anchor="middle">D</text>
          <text x="100" y="110" font-family="'Libre Baskerville',Georgia,serif" font-size="28" font-weight="700" fill="#F8F5F0" text-anchor="middle">&amp;</text>
          <text x="140" y="118" font-family="'Libre Baskerville',Georgia,serif" font-size="60" font-weight="700" fill="#F8F5F0" text-anchor="middle">D</text>
        </svg>
        <div class="footer-brand">
          D&amp;D
          <span>Diálogo y Desarrollo Educativo</span>
        </div>
      </div>
      <ul class="footer-links">
        <li><a href="#mirada">Nuestra mirada</a></li>
        <li><a href="#diferencial">Lo que hacemos</a></li>
        <li><a href="#proceso">Cómo trabajamos</a></li>
        <li><a href="#equipo">Equipo</a></li>
      </ul>
      <span class="footer-copy">© 2026 D&D · Buenos Aires</span>
    </div>
  </div>
</footer>

<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script><script>
// Activar animaciones solo si JS funciona
document.body.classList.add('js-ready');

// Nav scroll
const nav = document.getElementById('main-nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

// Mobile menu
const menuBtn = document.getElementById('menu-btn');
const navLinks = document.getElementById('nav-links');
menuBtn.addEventListener('click', () => navLinks.classList.toggle('open'));
navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => navLinks.class
