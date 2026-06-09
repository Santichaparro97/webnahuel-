/* ============================================================
   LANDING FX
   - Genera silueta de botella en canvas offscreen
   - Muestrea píxeles opacos → partículas en Three.js
   - Idle: flotación suave + parallax con mouse (profundidad)
   - Primer scroll: desintegración + dispersión + fade
   - Al terminar, revela el sitio (quita .fx-active del body)
   ============================================================ */

(function () {
  if (typeof THREE === 'undefined' || typeof gsap === 'undefined') {
    console.warn('Three.js o GSAP no se cargaron — saltando landing FX.');
    document.body.classList.remove('fx-active');
    const fx = document.getElementById('landing-fx');
    if (fx) fx.remove();
    return;
  }

  // Evitar que el browser restaure el scroll al recargar (dispara la animación)
  if ('scrollRestoration' in history) {
    try { history.scrollRestoration = 'manual'; } catch (e) {}
  }
  window.scrollTo(0, 0);

  // Marca de tiempo de carga del módulo — usado para ignorar eventos espurios
  // de scroll que el browser puede generar al hacer F5 (restauración de scroll,
  // wheel residual del touchpad, etc.)
  const LOAD_TS = performance.now();
  const ARMED_AFTER_MS = 800; // ignorar todo input durante 800ms para evitar
                              // que eventos fantasma del browser (restauración de
                              // scroll, inercia de touchpad) disparen la animación
  let userActivated = false;  // primer input REAL del usuario (mousemove/click cuentan)
  window.addEventListener('mousemove', () => { userActivated = true; }, { passive: true, once: true });
  window.addEventListener('keyup',     () => { userActivated = true; }, { passive: true, once: true });
  function isArmed() {
    return (performance.now() - LOAD_TS) > ARMED_AFTER_MS;
  }

  // ---------- Marquee JS-driven (rAF) ----------
  // No usamos animation CSS porque puede no correr según settings/OS.
  // Cada track se traduce manualmente cada frame; el wrap es perfecto
  // porque el contenido está duplicado dentro de cada track.
  const marqueeTracks = [];
  let marqueeStopped = false;

  function setupMarquees() {
    const SPEED_PX_S = 90; // velocidad: ~90 px/s (de 5/10 → 3/10, -40%)
    document.querySelectorAll('.brand-marquee-track').forEach((track, i) => {
      // dir: top → izquierda (-1), bottom (reverse) → derecha (+1)
      const dir = track.classList.contains('brand-marquee-reverse') ? +1 : -1;
      const halfWidth = () => track.scrollWidth / 2;
      // Posición inicial: si va a la derecha, arrancar en -halfWidth
      let pos = dir > 0 ? -halfWidth() : 0;
      marqueeTracks.push({ track, dir, getPos: () => pos, setPos: v => { pos = v; } });
      track.style.transform = `translate3d(${pos}px, 0, 0)`;
    });

    let lastT = performance.now();
    function frame(now) {
      if (marqueeStopped) return;
      const dt = (now - lastT) / 1000;
      lastT = now;
      marqueeTracks.forEach(m => {
        let p = m.getPos();
        const half = m.track.scrollWidth / 2;
        p += SPEED_PX_S * m.dir * dt;
        // Wrap perfecto: si el track salió completo de un lado, lo reposicionamos
        if (m.dir < 0 && p <= -half) p += half;
        if (m.dir > 0 && p >= 0)     p -= half;
        m.setPos(p);
        m.track.style.transform = `translate3d(${p}px, 0, 0)`;
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupMarquees);
  } else {
    setupMarquees();
  }

  // ---------- Resaltador rotativo de marcas ----------
  // Cada ~1.5s salta a la siguiente marca, dándole el highlighter magenta.
  // Misma marca destacada simultáneamente en arriba y abajo (sincronía).
  let brandHighlightTimer = null;
  function setupBrandHighlight() {
    const BRANDS = ['DIOR', 'CHANEL', 'CAROLINA HERRERA', 'PACO RABANNE',
                    'GIORGIO ARMANI', 'VERSACE', 'LE LABO', 'TOM FORD',
                    'BVLGARI', 'AZZARO', 'HUGO BOSS'];
    const N = BRANDS.length;
    let idx = 0;

    // Clases de los 3 highlighters (magenta, cyan, violeta)
    const COLOR_CLASSES = ['is-highlighted', 'is-highlighted-cyan', 'is-highlighted-violet'];

    function clearStripHighlights(stripSelector) {
      COLOR_CLASSES.forEach(cls => {
        document.querySelectorAll(`${stripSelector} .brand-marquee-track > span.${cls}`)
          .forEach(el => el.classList.remove(cls));
      });
    }

    function applyHighlightsToStrip(stripSelector, brandIdxArray) {
      const spans = document.querySelectorAll(`${stripSelector} .brand-marquee-track > span:not(.sep)`);
      brandIdxArray.forEach((bIdx, colorIdx) => {
        const target = BRANDS[bIdx % N];
        const cls = COLOR_CLASSES[colorIdx];
        spans.forEach(el => {
          if (el.textContent.trim() === target) el.classList.add(cls);
        });
      });
    }

    function tick() {
      // Limpiar todo highlight previo de ambas tiras
      clearStripHighlights('.brand-marquee-top');
      clearStripHighlights('.brand-marquee-bottom');

      // TOP: magenta=idx, cyan=idx+4, violet=idx+8 (separados ~4 marcas)
      applyHighlightsToStrip('.brand-marquee-top', [idx, idx + 4, idx + 8]);

      // BOTTOM: marcas distintas a la top (offset +2)
      // magenta=idx+2, cyan=idx+6, violet=idx+10
      applyHighlightsToStrip('.brand-marquee-bottom', [idx + 2, idx + 6, idx + 10]);

      idx = (idx + 1) % N;
    }

    tick(); // primer highlight inmediato
    brandHighlightTimer = setInterval(tick, 1500);
  }
  // Iniciamos cuando el DOM está disponible
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupBrandHighlight);
  } else {
    setupBrandHighlight();
  }

  // ---------- 1. Carga del PNG y muestreo de píxeles ----------
  // El PNG se embebe como data URI (window.PERFUME3D_BASE64) para evitar
  // problemas de CORS al abrir el archivo con file:// directamente.
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // OJO: NO seteamos crossOrigin: data URI no necesita y file:// rompe.
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Calcula la escala (world units por pixel) para que la botella ocupe
  // ~targetFrac de la altura del viewport, respetando el aspect ratio.
  function computeFitScale(img, camera, targetFrac = 0.6) {
    const fovRad = (camera.fov * Math.PI) / 180;
    const viewportH = 2 * Math.tan(fovRad / 2) * Math.abs(camera.position.z);
    const targetWorldH = viewportH * targetFrac;
    return targetWorldH / img.height;
  }

  // Recorre los píxeles con stride configurable, filtra fondo blanco y
  // devuelve atributos por partícula:
  //   position: vec3 (x, y, 0)
  //   color   : vec3 (r, g, b)
  //   aRandom : float 0..1
  //   aOffset : float (pequeño Z aleatorio en world units)
  function samplePNG(img, stride, scale) {
    // Submuestreo del PNG en un offscreen canvas.
    // Sin downscale → samplemos la resolución completa. Combinado con stride
    // chico, las partículas son ahora densas y el ojo las lee como la botella,
    // no como un cloud disperso.
    const downscale = 1.0;
    const W = Math.round(img.width * downscale);
    const H = Math.round(img.height * downscale);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;

    const positions = [];
    const colors = [];
    const aRandoms = [];
    const aOffsets = [];
    const cx = W / 2, cy = H / 2;

    for (let y = 0; y < H; y += stride) {
      for (let x = 0; x < W; x += stride) {
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 80) continue;

        // Fondo blanco/casi-blanco (alta luminancia + baja saturación) → skip
        const lum = (r + g + b) / 3;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;
        if (lum > 235 && sat < 0.08) continue;

        // Posición: mapeo centrado y escalado al viewport, manteniendo aspect
        positions.push((x - cx) * scale, (cy - y) * scale, 0);

        // Color: del píxel original con boost más fuerte (5/10 → 6/10)
        const boost = 1.30;
        colors.push(
          Math.min(1, (r / 255) * boost),
          Math.min(1, (g / 255) * boost),
          Math.min(1, (b / 255) * boost)
        );

        // aRandom (un único 0..1) y aOffset (Z sutil para falsa profundidad)
        aRandoms.push(Math.random());
        aOffsets.push((Math.random() - 0.5) * 6); // ±3 world units en Z
      }
    }
    return { positions, colors, aRandoms, aOffsets };
  }

  // ---------- 3. Three.js setup (espera el PNG) ----------
  const canvas = document.getElementById('particle-canvas');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.set(0, 0, 360);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  // Glow detrás de la botella
  const glowGeom = new THREE.PlaneGeometry(520, 520);
  const glowMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uProgress;
      varying vec2 vUv;
      void main() {
        float d = distance(vUv, vec2(0.5));
        float pulse = 0.5 + 0.16 * sin(uTime * 0.7);
        float g = (1.0 - smoothstep(0.05, 0.55, d)) * pulse;
        // Tonos fríos azul petróleo → cyan claro
        vec3 colorA = vec3(0.32, 0.78, 1.0);   // cyan claro al centro
        vec3 colorB = vec3(0.15, 0.32, 0.55);  // azul petróleo al borde
        vec3 col = mix(colorA, colorB, smoothstep(0.0, 0.5, d));
        float fadeOut = 1.0 - uProgress;
        gl_FragColor = vec4(col * g * fadeOut, g * fadeOut * 0.7);
      }
    `,
  });
  const glow = new THREE.Mesh(glowGeom, glowMat);
  glow.position.z = -120;
  scene.add(glow);

  // Partículas (se inicializan tras cargar el PNG)
  let geometry, particleMat, points;

  function buildParticles(img) {
    // Escala según viewport, manteniendo el aspect ratio de la imagen.
    // 0.62 ≈ matchea el `height: 62vh` del PNG HD para que la transición
    // PNG → partículas no tenga salto de tamaño visible.
    const scale = computeFitScale(img, camera, 0.62);

    // Stride MUY chico → partículas densas que conforman la botella
    // Antes: 3 desktop / 4 mobile (~5k partículas, dispersas)
    // Ahora: 2 desktop / 3 mobile (~15-20k partículas, sólidas)
    const stride = window.innerWidth < 600 ? 3 : 2;
    const { positions, colors, aRandoms, aOffsets } = samplePNG(img, stride, scale);
    const count = aRandoms.length;

    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aRandom', new THREE.Float32BufferAttribute(aRandoms, 1));
    geometry.setAttribute('aOffset', new THREE.Float32BufferAttribute(aOffsets, 1));

    particleMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 }, // 0 = botella formada · 1 = desintegrada
        uMouse: { value: new THREE.Vector2() },
        uPixelRatio: { value: renderer.getPixelRatio() },
        uDispersionColor: { value: new THREE.Color('#7cdcff') },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uProgress;
        uniform vec2 uMouse;
        uniform float uPixelRatio;

        attribute vec3 color;
        attribute float aRandom;   // 0..1, semilla por partícula
        attribute float aOffset;   // pequeño Z aleatorio

        varying vec3 vColor;
        varying float vRandom;
        varying float vProgress;

        // Ruido simplex 3D (ashima)
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
        float snoise(vec3 v) {
          const vec2 C = vec2(1.0/6.0, 1.0/3.0);
          const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
          vec3 i  = floor(v + dot(v, C.yyy));
          vec3 x0 = v - i + dot(i, C.xxx);
          vec3 g = step(x0.yzx, x0.xyz);
          vec3 l = 1.0 - g;
          vec3 i1 = min(g.xyz, l.zxy);
          vec3 i2 = max(g.xyz, l.zxy);
          vec3 x1 = x0 - i1 + C.xxx;
          vec3 x2 = x0 - i2 + C.yyy;
          vec3 x3 = x0 - D.yyy;
          i = mod289(i);
          vec4 p = permute(permute(permute(
                     i.z + vec4(0.0, i1.z, i2.z, 1.0))
                   + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                   + i.x + vec4(0.0, i1.x, i2.x, 1.0));
          float n_ = 0.142857142857;
          vec3 ns = n_ * D.wyz - D.xzx;
          vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
          vec4 x_ = floor(j * ns.z);
          vec4 y_ = floor(j - 7.0 * x_);
          vec4 x = x_ *ns.x + ns.yyyy;
          vec4 y = y_ *ns.x + ns.yyyy;
          vec4 h = 1.0 - abs(x) - abs(y);
          vec4 b0 = vec4(x.xy, y.xy);
          vec4 b1 = vec4(x.zw, y.zw);
          vec4 s0 = floor(b0)*2.0 + 1.0;
          vec4 s1 = floor(b1)*2.0 + 1.0;
          vec4 sh = -step(h, vec4(0.0));
          vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
          vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
          vec3 p0 = vec3(a0.xy, h.x);
          vec3 p1 = vec3(a0.zw, h.y);
          vec3 p2 = vec3(a1.xy, h.z);
          vec3 p3 = vec3(a1.zw, h.w);
          vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
          p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
          vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
          m = m * m;
          return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
        }

        // "Curl-noise" aproximado: 3 muestras de simplex con offsets
        vec3 curlNoise(vec3 p) {
          float eps = 0.1;
          vec3 dx = vec3(eps, 0.0, 0.0);
          vec3 dy = vec3(0.0, eps, 0.0);
          vec3 dz = vec3(0.0, 0.0, eps);
          float p_x0 = snoise(p - dx); float p_x1 = snoise(p + dx);
          float p_y0 = snoise(p - dy); float p_y1 = snoise(p + dy);
          float p_z0 = snoise(p - dz); float p_z1 = snoise(p + dz);
          float x = p_y1 - p_y0 - p_z1 + p_z0;
          float y = p_z1 - p_z0 - p_x1 + p_x0;
          float z = p_x1 - p_x0 - p_y1 + p_y0;
          return normalize(vec3(x, y, z) + 0.0001);
        }

        void main() {
          vec3 pos = position;
          pos.z += aOffset;

          float idle = 1.0 - uProgress;

          // Flotación global
          float wave = sin(uTime * 0.8 + pos.y * 0.015 + aRandom * 6.28) * 2.2;
          pos.y += wave * idle;
          pos.x += cos(uTime * 0.55 + pos.y * 0.01 + aRandom * 4.0) * 1.3 * idle;

          // Parallax con mouse (profundidad)
          float depthLayer = 0.35 + aRandom * 0.5 + aOffset * 0.02;
          pos.x += uMouse.x * 18.0 * depthLayer * idle;
          pos.y += uMouse.y * 12.0 * depthLayer * idle;

          // ===== Desintegración =====
          // pEase ease-out cuadrático: explosivo desde el primer instante,
          // las partículas se dispersan rápido y luego se atenúan.
          float p = uProgress;
          float pEase = 1.0 - (1.0 - p) * (1.0 - p);

          // 1) Dirección dominante hacia ARRIBA + AFUERA desde el origen
          vec3 outward = normalize(vec3(position.x, position.y + 5.0, position.z + 1.0));
          vec3 mainDir = mix(outward, vec3(0.0, 1.0, 0.0), 0.55);

          // 2) Curl noise para turbulencia (polvo arremolinado)
          vec3 curl = curlNoise(position * 0.012 + vec3(uTime * 0.25, 0.0, aRandom * 10.0));

          // 3) Dirección aleatoria por partícula (variedad)
          float a = aRandom * 6.2831853;
          float b = (fract(aRandom * 7.31) - 0.5) * 3.14159;
          vec3 randDir = vec3(cos(a)*cos(b), sin(b), sin(a)*cos(b));

          // Combinamos: la magnitud crece con pEase
          vec3 disperse =
              mainDir * (180.0 + aRandom * 120.0) * pEase
            + curl    * (220.0 + aRandom *  80.0) * pEase
            + randDir * 70.0 * pEase;

          // Empuje extra hacia arriba en el tramo final → "humo"
          disperse.y += pow(pEase, 1.4) * (110.0 + aRandom * 90.0);

          pos += disperse;

          // Proyección + atenuación de tamaño con la distancia
          vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPos;

          // Tamaño mayor + leve variación → puntos solapan y se leen como la botella
          float baseSize = 3.4 + aRandom * 2.2;
          gl_PointSize = baseSize * (1.0 - p * 0.30) * uPixelRatio * (260.0 / -mvPos.z);

          vColor = color;
          vRandom = aRandom;
          vProgress = p;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uDispersionColor;
        varying vec3 vColor;
        varying float vRandom;
        varying float vProgress;

        void main() {
          vec2 cc = gl_PointCoord - vec2(0.5);
          float d = length(cc);
          if (d > 0.5) discard;
          // Falloff más estrecho: el núcleo brillante ocupa más espacio
          // (5/10 → 6/10). Antes 0.18 → 0.5, ahora 0.22 → 0.5: núcleo +22%
          float soft = 1.0 - smoothstep(0.22, 0.5, d);

          // Fade escalonado por partícula (sin cambios)
          float fadeStart = mix(0.15, 0.80, vRandom);
          float fadeEnd   = fadeStart + 0.18;
          float particleAlpha = 1.0 - smoothstep(fadeStart, fadeEnd, vProgress);

          // Viraje a tono frío
          vec3 col = mix(vColor, uDispersionColor, vProgress * 0.55);
          // Boost de brillo final (+18%) sin saturar a blanco gracias al clamp
          col = clamp(col * 1.18, 0.0, 1.0);

          gl_FragColor = vec4(col, soft * particleAlpha);
        }
      `,
    });

    points = new THREE.Points(geometry, particleMat);
    scene.add(points);
  }

  // ---------- 4a. Botella HD: el PNG real flotando antes del trigger ----------
  // Mostramos el `<img>` nítido por encima de las partículas hasta que el
  // usuario scrollee. En el trigger, burst del img y las partículas quedan
  // a la vista para desintegrarse.
  //
  // OJO: el PNG original tiene fondo blanco. En el canvas oscuro eso forma
  // un rectángulo visible alrededor de la botella, lo que rompe la ilusión
  // de "imagen = partículas". Procesamos el PNG eliminando el blanco para
  // que sólo se vea la botella, y así matcheé exactamente la silueta de
  // las partículas.
  const heroImg = document.getElementById('hero-bottle-img');

  function makeMaskedImageDataURL(img) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const lum = (r + g + b) / 3;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (lum > 235 && sat < 0.08) {
        d[i + 3] = 0;                                  // blanco puro → transparente
      } else if (lum > 195 && sat < 0.12) {
        // Borde casi-blanco → semi-transparente para suavizar el contorno
        d[i + 3] = Math.round(d[i + 3] * Math.max(0, 1 - (lum - 195) / 40));
      }
    }
    ctx.putImageData(id, 0, 0);
    return c.toDataURL('image/png');
  }

  // Mouse en pixeles (separado del normalizado)
  const mousePx = { x: 0, y: 0, tx: 0, ty: 0, has: false };
  // Pull suavizado: el offset actual de la botella hacia el mouse,
  // se acerca lentamente al target → sensación de atracción magnética
  // con resistencia, sin volver al centro abruptamente
  const heroPull = { x: 0, y: 0 };

  function updateHeroImg(t) {
    if (!heroImg || heroImg.classList.contains('is-burst')) return;
    // Vaivén vertical sutil
    const yFloat = Math.sin(t * 0.9) * 10; // ±10px
    const xFloat = Math.cos(t * 0.6) * 4;  // ±4px
    // Tilt 3D según mouse (sensación de profundidad sobre la imagen)
    const rotX = -mouse.y * 6;  // hasta ±6deg
    const rotY = mouse.x * 6;

    // ====== EFECTO IMÁN ======
    // La botella SIEMPRE es atraída hacia el mouse (sin radio de corte que la
    // haga "volver al centro"). Magnitud crece con la distancia hasta un tope
    // de 45px y se suaviza con lerp 0.05 → movimiento elegante, continuo,
    // como si la botella tuviera un anclaje elástico al medio.
    if (mousePx.has) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const dx = mousePx.x - cx;
      const dy = mousePx.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const dirX = dx / dist;
      const dirY = dy / dist;
      // Distancia "saturada": dist 0 → pull 0; dist 600+ → pull max (~45px)
      const MAX_PULL = 45;
      const REACH = 600; // a partir de 600px ya está en máximo
      const norm = Math.min(dist / REACH, 1);
      // Curva ease-out: pull crece rápido cerca, satura suave
      const magnitude = (1 - (1 - norm) * (1 - norm)) * MAX_PULL;
      const targetX = dirX * magnitude;
      const targetY = dirY * magnitude;
      // Lerp lento (0.05): resistencia → la botella tarda en alcanzar el target
      heroPull.x += (targetX - heroPull.x) * 0.05;
      heroPull.y += (targetY - heroPull.y) * 0.05;
    }

    heroImg.style.transform =
      `translate(calc(-50% + ${xFloat + heroPull.x}px), calc(-50% + ${yFloat + heroPull.y}px)) ` +
      `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
  }

  // ---------- 4b. Mouse parallax ----------
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('mousemove', (e) => {
    mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    mouse.ty = -(e.clientY / window.innerHeight - 0.5) * 2;
    // Posición en pixeles para el efecto imán
    mousePx.tx = e.clientX;
    mousePx.ty = e.clientY;
    if (!mousePx.has) {
      mousePx.x = e.clientX;
      mousePx.y = e.clientY;
      mousePx.has = true;
    }
  }, { passive: true });

  // Touch parallax
  window.addEventListener('touchmove', (e) => {
    if (!e.touches[0]) return;
    mouse.tx = (e.touches[0].clientX / window.innerWidth - 0.5) * 2;
    mouse.ty = -(e.touches[0].clientY / window.innerHeight - 0.5) * 2;
    mousePx.tx = e.touches[0].clientX;
    mousePx.ty = e.touches[0].clientY;
    if (!mousePx.has) {
      mousePx.x = e.touches[0].clientX;
      mousePx.y = e.touches[0].clientY;
      mousePx.has = true;
    }
  }, { passive: true });

  // ---------- 5. Render loop ----------
  const clock = new THREE.Clock();
  function tick() {
    const t = clock.getElapsedTime();
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    // Track instantáneo del mouse (la resistencia/suavidad del imán
    // está en heroPull dentro de updateHeroImg, no acá)
    mousePx.x = mousePx.tx;
    mousePx.y = mousePx.ty;

    if (particleMat) {
      particleMat.uniforms.uTime.value = t;
      particleMat.uniforms.uMouse.value.set(mouse.x, mouse.y);
    }
    glowMat.uniforms.uTime.value = t;

    if (points) {
      points.rotation.y = mouse.x * 0.12;
      points.rotation.x = -mouse.y * 0.09;
    }
    glow.rotation.y = mouse.x * 0.05;

    // Botella HD: actualizamos transform por frame mientras esté visible
    updateHeroImg(t);

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();

  // ---------- Cargar el PNG (data URI embebido), enmascarar y armar partículas ----------
  const PERFUME_SRC = window.PERFUME3D_BASE64 || 'perfume3d.png';
  loadImage(PERFUME_SRC)
    .then(img => {
      // 1) Mostramos el PNG en el <img> con el fondo blanco hecho transparente
      //    → solo se ve la botella nítida flotando, sin recuadro alrededor.
      if (heroImg) {
        try {
          heroImg.src = makeMaskedImageDataURL(img);
        } catch (e) {
          // Si por algún motivo no podemos enmascarar, usamos el PNG tal cual.
          console.warn('No se pudo enmascarar el PNG, uso el original:', e);
          heroImg.src = PERFUME_SRC;
        }
      }
      // 2) Las partículas se construyen igual y quedan tapadas por el <img>
      //    hasta que el usuario scrollea y dispara el burst.
      buildParticles(img);
    })
    .catch(err => {
      console.error('No se pudo cargar la imagen de la botella:', err);
      // NO destrabamos el sitio: el overlay se mantiene con texto + glow,
      // y el primer scroll igual reproduce la animación (sin partículas).
    });

  // ---------- 6. Resize ----------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    particleMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  });

  // ---------- 7. One-shot trigger: el primer scroll inicia la desintegración ----------
  // - Mientras carga: idle (botella flotando + parallax con mouse)
  // - Primer scroll/wheel/touch/tecla → arranca timeline GSAP (2.5s)
  // - Scrolls adicionales aceleran la animación (timeScale + .35 por evento)
  // - Al terminar: fade del overlay, scroll a top, sitio visible
  const fx = document.getElementById('landing-fx');
  const hint = document.querySelector('.landing-hint');
  const bgText = document.querySelector('.landing-bg-text');

  let tl = null;
  let triggered = false;
  let triggerStartTs = 0;

  function buildTimeline() {
    const t = gsap.timeline({
      paused: true,
      defaults: { ease: 'power2.out' }, // explosivo: rápido al inicio, desacelera
      onComplete: () => {
        // Scroll a top, ocultar overlay y revelar sitio
        window.scrollTo(0, 0);
        document.body.classList.remove('fx-active');
        fx.classList.add('is-gone');
        if (typeof window.__startSiteReveal === 'function') {
          window.__startSiteReveal();
        }
        // Cleanup three.js
        setTimeout(() => {
          if (geometry) geometry.dispose();
          if (particleMat) particleMat.dispose();
          glowMat.dispose();
          glowGeom.dispose();
          renderer.dispose();
        }, 200);
      },
    });

    // Duración fija: 2.0 segundos para las partículas
    const DUR = 2.0;

    // uProgress 0 → 1 (partículas se desintegran con curl noise + fade escalonado)
    if (particleMat) {
      t.to(particleMat.uniforms.uProgress, { value: 1, duration: DUR }, 0);
    }
    // Glow se apaga ligeramente antes
    t.to(glowMat.uniforms.uProgress, { value: 1, duration: DUR * 0.85 }, 0);

    // Texto de marca: opacity + scale + blur
    if (bgText) {
      t.to(bgText, {
        opacity: 0,
        scale: 1.06,
        filter: 'blur(10px)',
        duration: DUR * 0.9,
        ease: 'power2.out',
      }, 0);
    }
    // Hint desaparece rapido al primer toque
    if (hint) {
      t.to(hint, { opacity: 0, duration: 0.35, ease: 'power1.out' }, 0);
    }
    // BIENVENIDO timeline (todos los tiempos absolutos):
    //   t=1.0s → empieza a aparecer (mitad del recorrido de partículas)
    //   t=1.5s → pico de opacidad 0.55 (partículas aún se mueven 0.5s más)
    //   t=1.5s-1.7s → hold breve mientras terminan las partículas
    //   t=1.7s-2.0s → fade out + overlay desaparece → web accesible
    //
    // Total: 2.0s (antes 2.5s, -0.5s)
    // El BV se ve POR ENCIMA de las partículas (z-index 5 vs canvas z-index 1).
    const welcome = document.getElementById('hero-welcome');
    if (welcome) {
      // Fade in: 1.0s → 1.5s (0.5s)
      t.to(welcome, {
        opacity: .55,
        scale: 1.0,
        filter: 'blur(0px)',
        duration: 0.5,
        ease: 'power2.out',
      }, 1.0);

      // Fade out: 1.7s → 2.0s
      t.to(welcome, {
        opacity: 0,
        scale: 1.04,
        filter: 'blur(3px)',
        duration: 0.3,
        ease: 'power2.in',
      }, 1.7);
    }

    // Overlay fade out: 1.7s → 2.0s (a los 2.0s la web es accesible)
    t.to(fx, {
      opacity: 0,
      duration: 0.3,
      ease: 'power2.out',
    }, 1.7);

    return t;
  }

  function trigger() {
    // Bloqueo anti-rebote: ignoramos cualquier input los primeros 800ms
    if (!isArmed()) return;
    if (triggered) return; // ya disparado → eventos siguientes se ignoran
    triggered = true;
    triggerStartTs = performance.now();

    // Revelar el canvas de partículas (invisible hasta ahora).
    // Las partículas ya están "armadas" en la forma exacta de la botella,
    // así que al hacerse visibles + arrancar uProgress simultáneamente
    // se ven materializar y dispersarse en un solo gesto.
    if (canvas) canvas.classList.add('is-revealed');

    // Disparar el burst del PNG HD: escala + blur + flash cyan en ~320ms.
    if (heroImg) heroImg.classList.add('is-burst');

    // Fade simultáneo de las dos marquees (tira superior + inferior)
    document.querySelectorAll('.brand-marquee').forEach(m => m.classList.add('is-burst'));
    if (brandHighlightTimer) { clearInterval(brandHighlightTimer); brandHighlightTimer = null; }
    marqueeStopped = true;

    tl = buildTimeline();
    tl.timeScale(1);
    tl.play();
  }

  // ----- Listeners para disparar (UN solo trigger, sin aceleración) -----
  window.addEventListener('wheel', (e) => {
    // Filtramos wheel sin movimiento real (eventos fantasma del browser)
    if (Math.abs(e.deltaY) < 1 && Math.abs(e.deltaX) < 1) return;
    trigger();
  }, { passive: true });

  window.addEventListener('touchmove', () => trigger(), { passive: true });

  window.addEventListener('keydown', (e) => {
    if (['Space', 'PageDown', 'ArrowDown', 'ArrowUp', 'PageUp', 'End', 'Home', 'Enter'].includes(e.code)) {
      trigger();
    }
  });

  // Click en el overlay también dispara
  fx.addEventListener('click', () => trigger());
})();
