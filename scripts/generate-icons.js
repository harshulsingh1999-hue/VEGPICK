import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const publicDir = path.resolve(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Create SVG Icon
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#22c55e" />
      <stop offset="100%" stop-color="#15803d" />
    </linearGradient>
    <linearGradient id="leaf" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#86efac" />
      <stop offset="100%" stop-color="#22c55e" />
    </linearGradient>
    <linearGradient id="carrot" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f97316" />
      <stop offset="100%" stop-color="#ea580c" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="100" fill="url(#bg)" />
  
  <!-- Basket / Bag base -->
  <g transform="translate(64, 50)">
    <!-- Vegetables sticking out -->
    <path d="M192 100 C150 50 170 10 220 30 C260 50 250 90 220 110" fill="url(#leaf)" opacity="0.95" />
    <path d="M220 90 C260 40 310 50 300 90 C290 120 250 120 220 100" fill="url(#leaf)" opacity="0.9" />
    <!-- Carrot -->
    <path d="M140 140 L190 70 C200 60 215 65 210 80 L170 160 Z" fill="url(#carrot)" />
    
    <!-- Bag Body -->
    <rect x="72" y="140" width="240" height="230" rx="36" fill="#ffffff" />
    
    <!-- Bag Handle -->
    <path d="M132 140 V90 C132 55 252 55 252 90 V140" fill="none" stroke="#ffffff" stroke-width="24" stroke-linecap="round" />
    
    <!-- Fresh Leaf Badge in Bag -->
    <path d="M192 200 C240 200 255 250 220 285 C185 320 150 290 155 250 C160 210 192 200 192 200 Z" fill="#16a34a" />
    <path d="M175 270 Q205 240 235 225" fill="none" stroke="#86efac" stroke-width="8" stroke-linecap="round" />

    <!-- Fresh Veggie text / dot -->
    <circle cx="210" cy="330" r="8" fill="#16a34a" />
    <circle cx="174" cy="330" r="8" fill="#f97316" />
  </g>
</svg>`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgIcon, 'utf8');

// 2. Helper to generate standard PNGs
function crc32(buf) {
  let crc = -1;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const combined = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function generatePNG(width, height, isMaskable = false) {
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(height * rowSize);
  
  // Safe zone radius for maskable: central 80% circle
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) / 2;
  const bagScale = isMaskable ? 0.65 : 0.78;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0; // Filter 0
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      
      // Normalized coordinates from -1 to 1
      const nx = (x - cx) / (maxR * bagScale);
      const ny = (y - cy) / (maxR * bagScale);
      
      // Default background: Emerald Green #16a34a (22, 163, 74)
      let r = 22, g = 163, b = 74, a = 255;

      // Slight top-to-bottom green gradient
      const grad = y / height;
      r = Math.round(34 - grad * 15);
      g = Math.round(197 - grad * 45);
      b = Math.round(94 - grad * 35);

      // Bag shape: rounded box from nx: -0.55 to 0.55, ny: -0.1 to 0.7
      const inBagX = nx >= -0.55 && nx <= 0.55;
      const inBagY = ny >= -0.15 && ny <= 0.7;
      
      // Bag corners rounding
      const cornerR = 0.15;
      let insideBag = false;
      if (inBagX && inBagY) {
        let dx = 0, dy = 0;
        if (nx < -0.55 + cornerR) dx = nx - (-0.55 + cornerR);
        else if (nx > 0.55 - cornerR) dx = nx - (0.55 - cornerR);
        if (ny < -0.15 + cornerR) dy = ny - (-0.15 + cornerR);
        else if (ny > 0.7 - cornerR) dy = ny - (0.7 - cornerR);
        if (dx * dx + dy * dy <= cornerR * cornerR) {
          insideBag = true;
        }
      }

      // Handle shape: arch from nx: -0.35 to 0.35, ny: -0.6 to -0.15
      const handleDist = Math.sqrt(nx * nx * 1.5 + Math.pow(ny + 0.15, 2));
      const inHandle = ny <= -0.15 && handleDist >= 0.28 && handleDist <= 0.45 && Math.abs(nx) <= 0.38;

      // Vegetable leaves / carrot above bag
      const inCarrot = (nx >= -0.25 && nx <= 0.1 && ny >= -0.45 && ny <= -0.1) && (nx * 2 + ny * -1.5 < 0.2);
      const inLeaf = Math.pow(nx - 0.2, 2) + Math.pow(ny + 0.35, 2) < 0.04;

      if (inHandle) {
        // White handle
        r = 255; g = 255; b = 255;
      } else if (inCarrot) {
        // Orange carrot
        r = 249; g = 115; b = 22;
      } else if (inLeaf) {
        // Light green leaf
        r = 134; g = 239; b = 172;
      } else if (insideBag) {
        // Bag interior: crisp white
        r = 255; g = 255; b = 255;
        
        // Leaf emblem inside bag
        const emblemDist = Math.hypot(nx, ny - 0.25);
        if (emblemDist < 0.2) {
          r = 22; g = 163; b = 74;
          // Leaf stem
          if (Math.abs(nx - (ny - 0.25)) < 0.02) {
            r = 134; g = 239; b = 172;
          }
        }
      }

      raw[pixelOffset] = r;
      raw[pixelOffset + 1] = g;
      raw[pixelOffset + 2] = b;
      raw[pixelOffset + 3] = a;
    }
  }

  const deflated = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", deflated),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
}

// Write PWA Icons
console.log('Generating PWA icons in /public...');
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), generatePNG(192, 192, false));
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), generatePNG(512, 512, false));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), generatePNG(512, 512, true));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), generatePNG(180, 180, false));
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), generatePNG(64, 64, false));

// Also write a standalone manifest.json in public for any direct crawler or browser fetch
const manifestObj = {
  id: '/',
  name: 'FreshVeggie Delivery',
  short_name: 'FreshVeggie',
  description: 'Farm fresh vegetables delivered to your doorstep in minutes.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait-primary',
  background_color: '#16a34a',
  theme_color: '#16a34a',
  categories: ['shopping', 'food', 'lifestyle'],
  icons: [
    {
      src: '/pwa-192x192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: '/pwa-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: '/pwa-maskable-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable'
    }
  ],
  shortcuts: [
    {
      name: 'Explore Veggies',
      short_name: 'Browse',
      url: '/browse',
      icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }]
    },
    {
      name: 'My Orders',
      short_name: 'Orders',
      url: '/orders',
      icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }]
    },
    {
      name: 'Shopping Cart',
      short_name: 'Cart',
      url: '/cart',
      icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }]
    }
  ]
};

fs.writeFileSync(path.join(publicDir, 'manifest.json'), JSON.stringify(manifestObj, null, 2), 'utf8');
console.log('Icons and manifest generated successfully!');
