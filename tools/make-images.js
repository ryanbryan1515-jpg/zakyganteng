/**
 * Generates the vector pizza artwork used by PIZZAKY.AJA.
 * Run: node tools/make-images.js
 * Output: public/images/*.svg
 */
const fs = require('node:fs');
const path = require('node:path');

const outDir = path.join(__dirname, '..', 'public', 'images');
fs.mkdirSync(outDir, { recursive: true });

const bases = {
  // cheese + crust gradient stops
  classic: ['#ffd977', '#f7a92e'],
  cheese: ['#ffe08a', '#f6b23c'],
  sweet: ['#f3d9b0', '#d9a86b'],
  veggie: ['#ffe9a0', '#e9be55'],
};

const TOPPINGS = {
  sausage: (seed) => {
    let s = '';
    const spots = [
      [300, 190], [370, 240], [300, 300], [230, 250], [250, 360],
      [355, 345], [310, 405], [200, 320], [390, 300], [270, 230],
    ];
    spots.forEach(([x, y], i) => {
      const r = 26 + ((i * 7 + seed) % 7);
      s += `<g><circle cx="${x}" cy="${y}" r="${r + 3}" fill="#7d1a10" opacity=".55"/>
        <circle cx="${x}" cy="${y}" r="${r}" fill="#b8452c"/>
        <circle cx="${x}" cy="${y}" r="${r * 0.72}" fill="#d76a45"/>
        <circle cx="${x - r * 0.28}" cy="${y - r * 0.28}" r="${r * 0.28}" fill="#ef9d78" opacity=".85"/>
        <circle cx="${x + r * 0.1}" cy="${y + r * 0.25}" r="${r * 0.16}" fill="#8d2f1c"/></g>`;
    });
    return s;
  },
  pepperoni: () => {
    let s = '';
    const spots = [
      [300, 185], [375, 245], [225, 245], [300, 305], [230, 360],
      [372, 355], [300, 415], [195, 305], [400, 295],
    ];
    spots.forEach(([x, y]) => {
      s += `<circle cx="${x}" cy="${y}" r="30" fill="#8f0f0f" opacity=".45"/>
        <circle cx="${x}" cy="${y}" r="27" fill="#c11a12"/>
        <circle cx="${x - 8}" cy="${y - 9}" r="9" fill="#e04a33" opacity=".75"/>`;
    });
    return s;
  },
  mayo: () => {
    let s = '';
    for (let i = 0; i < 3; i++) {
      const off = i * 26;
      s += `<path d="M170 ${230 + off} q65 -45 130 0 t130 0 t90 -10" stroke="#fff8d6" stroke-width="14" fill="none" stroke-linecap="round" opacity=".95"/>
        <path d="M170 ${236 + off} q65 -45 130 0 t130 0 t90 -10" stroke="#ffd84d" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>`;
    }
    return s;
  },
  veggie: () => {
    let s = '';
    const peppers = [[250, 200, 20], [350, 230, -25], [270, 320, 65], [360, 350, 10], [300, 410, -40], [205, 300, 30]];
    peppers.forEach(([x, y, rot]) => {
      s += `<g transform="translate(${x} ${y}) rotate(${rot})">
        <rect x="-34" y="-10" width="68" height="20" rx="10" fill="#2f8b3a"/>
        <rect x="-26" y="-5" width="52" height="10" rx="5" fill="#57b04f"/></g>`;
    });
    [[320, 180], [230, 385], [390, 300], [265, 265], [355, 415]].forEach(([x, y]) => {
      s += `<g><circle cx="${x}" cy="${y}" r="19" fill="#3a2a1a"/><circle cx="${x}" cy="${y}" r="11" fill="#8a6a3f"/><circle cx="${x}" cy="${y}" r="5" fill="#e7d6ad"/></g>`;
    });
    [[290, 240], [330, 330], [240, 310]].forEach(([x, y]) => {
      s += `<circle cx="${x}" cy="${y}" r="14" fill="#e33b2e"/><circle cx="${x}" cy="${y}" r="7" fill="#ff7a5e"/>`;
    });
    return s;
  },
  sweet: () => {
    let s = '';
    [[280, 210], [345, 265], [255, 300], [330, 370], [250, 390], [385, 330]].forEach(([x, y], i) => {
      s += `<g transform="translate(${x} ${y}) rotate(${i * 35})">
        <ellipse rx="32" ry="24" fill="#f6e2b8" stroke="#d9b878" stroke-width="3"/>
        <ellipse rx="20" ry="14" fill="#fdf3d8"/></g>`;
    });
    s += `<g fill="#5a3018" opacity=".9">
      <circle cx="300" cy="180" r="9"/><circle cx="220" cy="270" r="8"/><circle cx="360" cy="220" r="10"/>
      <circle cx="300" cy="330" r="8"/><circle cx="380" cy="390" r="9"/><circle cx="230" cy="370" r="7"/></g>`;
    s += `<path d="M200 240 q100 40 200 -10" stroke="#3a1d0e" stroke-width="7" fill="none" opacity=".55" stroke-linecap="round"/>
      <path d="M210 350 q90 35 180 -5" stroke="#3a1d0e" stroke-width="7" fill="none" opacity=".55" stroke-linecap="round"/>`;
    return s;
  },
  bundle: () => {
    let s = TOPPINGS.sausage(3);
    s += `<g transform="translate(430 430)">
      <rect x="-60" y="-70" width="120" height="140" rx="18" fill="#e8eef5" stroke="#b9c7d6" stroke-width="5"/>
      <rect x="-48" y="-58" width="96" height="70" rx="8" fill="#c8102e"/>
      <text x="0" y="10" font-family="Arial Black, Arial" font-size="26" fill="#fff" text-anchor="middle">PIZZA</text>
      <rect x="-48" y="24" width="96" height="46" rx="8" fill="#ffbd08"/>
      <text x="0" y="56" font-family="Arial Black, Arial" font-size="20" fill="#7a1010" text-anchor="middle">COMBO</text></g>`;
    return s;
  },
};

function pizza({ topping = 'sausage', base = 'classic', seed = 1, backdrop = true }) {
  const [c1, c2] = bases[base];
  const id = `g${seed}${topping}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" role="img">
  <defs>
    <radialGradient id="cheese-${id}" cx="42%" cy="36%" r="70%">
      <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
    </radialGradient>
    <radialGradient id="crust-${id}" cx="50%" cy="45%" r="55%">
      <stop offset="72%" stop-color="#d98b2b"/><stop offset="100%" stop-color="#a95c14"/>
    </radialGradient>
    <radialGradient id="bg-${id}" cx="20%" cy="15%" r="95%">
      <stop offset="0%" stop-color="#fff4e2"/><stop offset="60%" stop-color="#ffe6c9"/><stop offset="100%" stop-color="#f6cf9f"/>
    </radialGradient>
    <filter id="sh-${id}" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#7a2d00" flood-opacity=".35"/>
    </filter>
  </defs>
  ${backdrop ? `<rect width="600" height="600" fill="url(#bg-${id})"/>
  <circle cx="520" cy="90" r="150" fill="#ffbd08" opacity=".13"/>
  <circle cx="80" cy="520" r="130" fill="#c8102e" opacity=".09"/>` : ''}
  <g filter="url(#sh-${id})">
    <circle cx="300" cy="300" r="222" fill="url(#crust-${id})"/>
    <circle cx="300" cy="300" r="196" fill="#e0a24a"/>
    <circle cx="300" cy="300" r="184" fill="url(#cheese-${id})"/>
    <circle cx="280" cy="270" r="150" fill="#fff3b8" opacity=".18"/>
    ${TOPPINGS[topping](seed)}
    <g opacity=".22" fill="#fff">
      <circle cx="255" cy="235" r="4"/><circle cx="345" cy="290" r="3"/><circle cx="300" cy="355" r="4"/>
      <circle cx="365" cy="215" r="3"/><circle cx="215" cy="335" r="3"/></g>
  </g>
  <g fill="#a95c14" opacity=".35">
    <circle cx="300" cy="84" r="7"/><circle cx="140" cy="180" r="6"/><circle cx="470" cy="195" r="6"/>
    <circle cx="470" cy="420" r="6"/><circle cx="150" cy="445" r="7"/><circle cx="300" cy="516" r="6"/></g>
</svg>`;
}

const products = [
  { file: 'sosis-jumbo.svg', topping: 'sausage', base: 'classic', seed: 2 },
  { file: 'pepperoni-fire.svg', topping: 'pepperoni', base: 'classic', seed: 4 },
  { file: 'sosis-mayo.svg', topping: 'mayo', base: 'cheese', seed: 5 },
  { file: 'garden-veggie.svg', topping: 'veggie', base: 'veggie', seed: 6 },
  { file: 'choco-banana.svg', topping: 'sweet', base: 'sweet', seed: 7 },
  { file: 'cheese-bomb.svg', topping: 'sausage', base: 'cheese', seed: 9 },
  { file: 'trio-party.svg', topping: 'bundle', base: 'classic', seed: 11 },
  { file: 'pedas-gila.svg', topping: 'pepperoni', base: 'classic', seed: 13 },
  { file: 'sausage-combo.svg', topping: 'bundle', base: 'cheese', seed: 15 },
  { file: 'caramel-almond.svg', topping: 'sweet', base: 'sweet', seed: 17 },
];

for (const p of products) {
  fs.writeFileSync(path.join(outDir, p.file), pizza(p));
}

// Large decorative pizza for the hero (no backdrop so CSS gradients show through)
fs.writeFileSync(
  path.join(outDir, 'hero-pizza.svg'),
  pizza({ topping: 'sausage', base: 'classic', seed: 21, backdrop: false })
);

// Small brand mark
fs.writeFileSync(
  path.join(outDir, 'logo.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <circle cx="60" cy="60" r="56" fill="#ffbd08"/>
  <circle cx="60" cy="60" r="47" fill="#c8102e"/>
  <circle cx="60" cy="60" r="39" fill="#ffcf5c"/>
  <g fill="#b8452c">
    <circle cx="60" cy="42" r="10"/><circle cx="42" cy="63" r="9"/><circle cx="78" cy="63" r="9"/>
    <circle cx="60" cy="82" r="9"/><circle cx="60" cy="62" r="8" fill="#d76a45"/>
  </g>
</svg>`
);

console.log('Generated', products.length + 2, 'images in', outDir);
