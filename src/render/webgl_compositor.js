/**
 * WebGL2 Multi-Pass HDR Compositor for "Kagura of the Brass Astrolabe"
 * Implements the `procedural-i2i` & `prerendered-i2i` Two-Layer Architecture:
 * - Pass 1: Parallax scrolling normal-mapped backgrounds with smooth crossfade (`u_bgBlend`) and 16 dynamic point lights.
 * - Pass 2: Normal-mapped + Emissive-socket sprite & multi-part boss rig batch renderer (`raster albedo * normal shading + procedural emissive`).
 * - Pass 3: Instanced SDF Danmaku, Ribbon Lasers, and Ward Rings (`gl.drawArraysInstanced`, up to 10,000 instances at 60fps).
 * - Pass 4: Dual-Kawase Mipmap Bloom & Photosensitivity-Safe Warm Tone Mapping (zero strobe, zero saturated blue).
 */

const VS_QUAD = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FS_BG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_bgAbyss;
uniform sampler2D u_bgAbyssNorm;
uniform sampler2D u_bgSanctum;
uniform sampler2D u_bgSanctumNorm;
uniform sampler2D u_mandalaTex;

uniform float u_scrollY;
uniform float u_bgBlend;      // 0.0 = Abyss, 1.0 = Sanctum (prerendered-i2i crossfade)
uniform float u_mandalaAlpha; // Boss/Spell sacred astrolabe overlay intensity
uniform vec2 u_mandalaPos;    // Normalized [0..1] game coords
uniform float u_mandalaRot;
uniform float u_time;
uniform vec2 u_resolution;

uniform int u_numLights;
uniform vec4 u_lightsPosRad[16];   // xy = game px coords, z = radius px, w = intensity
uniform vec4 u_lightsColor[16];    // rgb = warm color

vec3 sampleNormal(sampler2D tex, vec2 uv) {
  vec3 n = texture(tex, uv).rgb * 2.0 - 1.0;
  return normalize(vec3(n.x * 1.35, n.y * 1.35, max(0.25, n.z)));
}

void main() {
  // Game coordinate space is 720 x 960 (3:4 vertical arcade aspect)
  vec2 gamePos = vec2(v_uv.x * 720.0, (1.0 - v_uv.y) * 960.0);

  // Layer 0: Deep scrolling background (1024x1536 aspect)
  vec2 uv0 = vec2(v_uv.x, fract((1.0 - v_uv.y) * 0.68 - u_scrollY * 0.12));
  // Layer 1: Secondary subtle parallax harmonic for depth
  vec2 uv1 = vec2(v_uv.x, fract((1.0 - v_uv.y) * 0.68 - u_scrollY * 0.18));

  vec3 colAbyss = texture(u_bgAbyss, uv0).rgb;
  vec3 nAbyss = sampleNormal(u_bgAbyssNorm, uv0);

  vec3 colSanctum = texture(u_bgSanctum, uv1).rgb;
  vec3 nSanctum = sampleNormal(u_bgSanctumNorm, uv1);

  vec3 albedo = mix(colAbyss, colSanctum, smoothstep(0.0, 1.0, u_bgBlend));
  vec3 normal = normalize(mix(nAbyss, nSanctum, u_bgBlend));

  // Base warm overhead temple directional lighting (key + warm amber fill from magma below)
  vec3 keyDir = normalize(vec3(-0.35, -0.45, 0.82));
  vec3 fillDir = normalize(vec3(0.30, 0.55, 0.78));
  float ndlKey = max(0.0, dot(normal, keyDir));
  float ndlFill = max(0.0, dot(normal, fillDir));

  vec3 lighting = vec3(0.30, 0.25, 0.20)
                + vec3(0.62, 0.50, 0.34) * ndlKey
                + vec3(0.35, 0.20, 0.10) * ndlFill;

  // Dynamic point lights from boss core, lasers, player shots, and grazing
  vec3 dynLight = vec3(0.0);
  vec3 specLight = vec3(0.0);
  vec3 viewDir = vec3(0.0, 0.0, 1.0);

  for (int i = 0; i < 16; i++) {
    if (i >= u_numLights) break;
    vec4 lpr = u_lightsPosRad[i];
    vec2 delta = lpr.xy - gamePos;
    float dist = length(delta);
    float rad = max(1.0, lpr.z);
    if (dist < rad) {
      float atten = pow(1.0 - dist / rad, 1.8) * lpr.w;
      vec3 lDir = normalize(vec3(delta.x, delta.y, rad * 0.32));
      float diff = max(0.0, dot(normal, lDir));
      vec3 halfVec = normalize(lDir + viewDir);
      float spec = pow(max(0.0, dot(normal, halfVec)), 18.0);
      dynLight += u_lightsColor[i].rgb * diff * atten * 1.15;
      specLight += u_lightsColor[i].rgb * spec * atten * 0.45;
    }
  }

  // Darken background slightly so foreground bullets & sprites pop with 100% clarity
  vec3 shaded = albedo * lighting * 0.68 + albedo * dynLight + specLight;

  // Optional sacred AGY Astrolabe Mandala layer beneath Boss / Midboss
  if (u_mandalaAlpha > 0.005) {
    vec2 mDelta = (gamePos - u_mandalaPos) / 340.0;
    float r = length(mDelta);
    if (r < 1.0) {
      float c = cos(u_mandalaRot);
      float s = sin(u_mandalaRot);
      vec2 rotUv = vec2(mDelta.x * c - mDelta.y * s, mDelta.x * s + mDelta.y * c) * 0.5 + 0.5;
      vec4 mSample = texture(u_mandalaTex, rotUv);
      float pulse = 0.85 + 0.15 * sin(u_time * 2.5 - r * 6.0);
      shaded = mix(shaded, shaded + mSample.rgb * 0.85 * pulse, mSample.a * u_mandalaAlpha);
    }
  }

  // Subtle warm vignette around edges of the arcade field
  vec2 vigUv = v_uv * (1.0 - v_uv.yx);
  float vig = clamp(pow(vigUv.x * vigUv.y * 16.0, 0.22), 0.35, 1.0);
  shaded *= vig;

  // Enforce strict zero saturated blue rule
  shaded.b = min(shaded.b, max(shaded.r, shaded.g) * 0.88);
  fragColor = vec4(shaded, 1.0);
}
`;

/**
 * Pass 2: Sprite & Multi-Part Boss Rig Batch Shader
 * Each instance provides:
 * - a_Transform: vec4(centerX, centerY, width, height) in game coordinates (720x960)
 * - a_UVRect:    vec4(u0, v0, u1, v1)
 * - a_RotPivot:  vec4(rotationRad, pivotOffsetX, pivotOffsetY, mirrorX)
 * - a_Emissive:  vec4(emissiveR, emissiveG, emissiveB, hitTint)
 */
const VS_SPRITE = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_quad;       // [-0.5 .. 0.5]
layout(location = 1) in vec4 a_transform;  // cx, cy, w, h
layout(location = 2) in vec4 a_uvRect;     // u0, v0, u1, v1
layout(location = 3) in vec4 a_rotPivot;   // rot, px, py, mirrorX (1 or -1)
layout(location = 4) in vec4 a_emissive;   // er, eg, eb, hitRim

out vec2 v_uv;
out vec2 v_gamePos;
out float v_rot;
out float v_mirrorX;
out vec4 v_emissive;

void main() {
  float rot = a_rotPivot.x;
  vec2 pivot = a_rotPivot.yz;
  float mirrorX = a_rotPivot.w;

  // Local point relative to pivot
  vec2 local = a_quad * a_transform.zw - pivot;
  local.x *= mirrorX;

  float c = cos(rot);
  float s = sin(rot);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 worldPos = a_transform.xy + rotated;

  v_gamePos = worldPos;
  v_rot = rot;
  v_mirrorX = mirrorX;
  v_emissive = a_emissive;

  vec2 uv01 = a_quad + 0.5;
  v_uv = mix(a_uvRect.xy, a_uvRect.zw, uv01);

  // Convert game coords (720x960, top-left origin) to clip space
  vec2 clip = vec2(
    (worldPos.x / 720.0) * 2.0 - 1.0,
    1.0 - (worldPos.y / 960.0) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const FS_SPRITE = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_gamePos;
in float v_rot;
in float v_mirrorX;
in vec4 v_emissive;
out vec4 fragColor;

uniform sampler2D u_atlasTex;
uniform sampler2D u_normalTex;
uniform sampler2D u_emissiveTex;
uniform float u_time;

uniform int u_numLights;
uniform vec4 u_lightsPosRad[16];
uniform vec4 u_lightsColor[16];

void main() {
  vec4 texel = texture(u_atlasTex, v_uv);
  if (texel.a < 0.03) discard;

  // Decode tangent-space normal and rotate it by the part's world rotation & mirror
  vec3 nLocal = texture(u_normalTex, v_uv).rgb * 2.0 - 1.0;
  nLocal.x *= v_mirrorX;
  float c = cos(v_rot);
  float s = sin(v_rot);
  vec3 normal = normalize(vec3(
    nLocal.x * c - nLocal.y * s,
    nLocal.x * s + nLocal.y * c,
    max(0.25, nLocal.z)
  ));

  // Overhead 2-light setup (warm golden key + crimson/amber rim)
  vec3 keyDir = normalize(vec3(-0.35, -0.55, 0.75));
  vec3 fillDir = normalize(vec3(0.45, 0.40, 0.80));
  vec3 viewDir = vec3(0.0, 0.0, 1.0);

  float ndl1 = max(0.0, dot(normal, keyDir));
  float ndl2 = max(0.0, dot(normal, fillDir));
  vec3 halfKey = normalize(keyDir + viewDir);
  float specBase = pow(max(0.0, dot(normal, halfKey)), 20.0);

  vec3 baseLight = vec3(0.55, 0.49, 0.42)
                 + vec3(0.68, 0.56, 0.38) * ndl1
                 + vec3(0.28, 0.18, 0.12) * ndl2;

  // Dynamic point lights from bullets, lasers, and boss core
  vec3 dynDiff = vec3(0.0);
  vec3 dynSpec = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= u_numLights) break;
    vec4 lpr = u_lightsPosRad[i];
    vec2 delta = lpr.xy - v_gamePos;
    float dist = length(delta);
    float rad = max(1.0, lpr.z);
    if (dist < rad) {
      float atten = pow(1.0 - dist / rad, 1.6) * lpr.w;
      vec3 lDir = normalize(vec3(delta.x, delta.y, rad * 0.35));
      float d = max(0.0, dot(normal, lDir));
      vec3 h = normalize(lDir + viewDir);
      float sp = pow(max(0.0, dot(normal, h)), 24.0);
      dynDiff += u_lightsColor[i].rgb * d * atten * 0.95;
      dynSpec += u_lightsColor[i].rgb * sp * atten * 0.65;
    }
  }

  vec3 totalDiff = min(baseLight + dynDiff * 0.55, vec3(1.18, 1.12, 1.02));
  vec3 color = texel.rgb * totalDiff + vec3(0.95, 0.78, 0.45) * specBase * 0.22 + dynSpec * 0.35;

  // Procedural Emissive Layer on inert-emissive sockets (Two-Layer Contract)
  vec3 emMask = texture(u_emissiveTex, v_uv).rgb;
  float socketGlow = emMask.r + emMask.g * 0.65;
  // Ignite dark internal recesses where socket mask is active
  float darkRecess = smoothstep(0.22, 0.04, dot(texel.rgb, vec3(0.333)));
  float pulse = 0.85 + 0.25 * sin(u_time * 7.0 + emMask.b * 6.28318);
  vec3 procEmissive = v_emissive.rgb * (socketGlow * 0.85 + darkRecess * socketGlow * 1.35) * pulse;
  color += procEmissive;

  // Smooth warm gold/amber damage rim tint (never harsh white flash!)
  float rimFactor = 1.0 - max(0.0, normal.z);
  color = mix(color, vec3(1.25, 0.78, 0.24), clamp(v_emissive.w * (0.25 + 0.55 * rimFactor), 0.0, 0.55));

  // Clamp blue channel for photosensitivity compliance
  color.b = min(color.b, max(color.r, color.g) * 0.90);

  fragColor = vec4(color, texel.a);
}
`;

/**
 * Pass 3: Instanced SDF Danmaku, Ribbon Lasers & Ward Rings
 * Each instance is 8 floats (2 x vec4):
 * - a_inst0: vec4(x, y, radiusX, radiusY)
 * - a_inst1: vec4(angleRad, shapeType, paletteIdx, alphaOrPhase)
 */
const VS_BULLET = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_quad;  // [-1 .. 1]
layout(location = 1) in vec4 a_inst0; // x, y, rx, ry
layout(location = 2) in vec4 a_inst1; // angle, shapeType, paletteIdx, alpha

out vec2 v_local;
flat out int v_shape;
flat out int v_palette;
out float v_alpha;

void main() {
  v_local = a_quad;
  v_shape = int(a_inst1.y + 0.5);
  v_palette = int(a_inst1.z + 0.5);
  v_alpha = a_inst1.w;

  vec2 scaled = a_quad * a_inst0.zw;
  float c = cos(a_inst1.x);
  float s = sin(a_inst1.x);
  vec2 rot = vec2(scaled.x * c - scaled.y * s, scaled.x * s + scaled.y * c);
  vec2 world = a_inst0.xy + rot;

  vec2 clip = vec2(
    (world.x / 720.0) * 2.0 - 1.0,
    1.0 - (world.y / 960.0) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const FS_BULLET = `#version 300 es
precision highp float;
in vec2 v_local;
flat in int v_shape;
flat in int v_palette;
in float v_alpha;
out vec4 fragColor;

uniform float u_time;

// Warm, high-contrast photosensitivity-safe Danmaku palette (zero saturated blue)
vec3 getPaletteColor(int idx) {
  if (idx == 0) return vec3(0.95, 0.26, 0.16); // Vermilion Red
  if (idx == 1) return vec3(0.96, 0.68, 0.14); // Amber Gold
  if (idx == 2) return vec3(0.22, 0.78, 0.50); // Celadon Jade Emerald
  if (idx == 3) return vec3(0.84, 0.22, 0.42); // Imperial Crimson-Plum
  if (idx == 4) return vec3(0.92, 0.80, 0.36); // Burnished Sun Brass
  if (idx == 5) return vec3(0.98, 0.46, 0.18); // Solar Copper-Orange
  return vec3(0.96, 0.88, 0.65);               // Ivory Starlight
}

void main() {
  vec2 p = v_local;
  float r = length(p);
  if (r > 1.0) discard;

  vec3 rimCol = getPaletteColor(v_palette);
  vec3 coreCol = vec3(1.0, 0.97, 0.88); // Crisp bright ivory-white core for 100% visibility

  float coreMask = 0.0;
  float auraMask = 0.0;
  float darkOutline = 0.0;

  if (v_shape == 0) {
    // 0: ORB_LARGE — Concentric solar sphere with dark contrast rim + bright ivory center
    coreMask = smoothstep(0.46, 0.18, r);
    float ring = smoothstep(0.74, 0.56, r) * (1.0 - smoothstep(0.82, 0.74, r));
    auraMask = smoothstep(1.0, 0.32, r) + ring * 0.45;
    darkOutline = smoothstep(0.84, 0.68, r) * (1.0 - smoothstep(0.62, 0.46, r));
  } else if (v_shape == 1) {
    // 1: RICE_NEEDLE — Sharp velocity-aligned crystal needle / kunai
    vec2 q = vec2(p.x * 1.65, p.y * 0.92);
    float d = length(q) + abs(p.x) * 0.38;
    coreMask = smoothstep(0.48, 0.15, d);
    auraMask = smoothstep(1.0, 0.25, d);
    darkOutline = smoothstep(0.82, 0.62, d) * (1.0 - coreMask);
  } else if (v_shape == 2) {
    // 2: OFUDA_TALISMAN — Ceremonial rectangular charm with inner border
    vec2 b = abs(p) - vec2(0.46, 0.74);
    float d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0);
    coreMask = smoothstep(0.06, -0.18, d);
    float innerBorder = smoothstep(0.04, 0.0, abs(d + 0.14));
    auraMask = smoothstep(0.28, -0.10, d) + innerBorder * 0.5;
    darkOutline = smoothstep(0.12, 0.0, abs(d));
  } else if (v_shape == 3) {
    // 3: PETAL_MANDALA — Pointed lotus petal
    vec2 q = p;
    q.x *= 1.35 + 0.45 * p.y;
    float d = length(q);
    coreMask = smoothstep(0.46, 0.14, d);
    auraMask = smoothstep(0.98, 0.22, d);
    darkOutline = smoothstep(0.78, 0.58, d) * (1.0 - coreMask);
  } else if (v_shape == 4) {
    // 4: STAR_WHEEL — 6-pointed astrolabe star cog
    float ang = atan(p.y, p.x) + u_time * 3.0;
    float star = r * (0.82 + 0.22 * cos(ang * 6.0));
    coreMask = smoothstep(0.42, 0.15, star);
    auraMask = smoothstep(0.95, 0.20, star);
    darkOutline = smoothstep(0.76, 0.56, star) * (1.0 - coreMask);
  } else if (v_shape == 5) {
    // 5: LASER_SEGMENT — Ribbon / beam segment (x across width, y along beam)
    float dx = abs(p.x);
    float endCap = smoothstep(1.0, 0.75, abs(p.y));
    coreMask = smoothstep(0.38, 0.08, dx) * endCap;
    auraMask = smoothstep(1.0, 0.15, dx) * endCap;
  } else if (v_shape == 6) {
    // 6: SPARK_PARTICLE — Soft glowing ember / grazing spark
    coreMask = smoothstep(0.35, 0.0, r);
    auraMask = pow(max(0.0, 1.0 - r), 2.0);
  } else {
    // 7: WARD_RING — Expanding astrolabe ring / Focus sigil
    float ringDist = abs(r - 0.76);
    float innerRing = abs(r - 0.52);
    float ang = atan(p.y, p.x);
    float spokes = smoothstep(0.92, 0.99, cos(ang * 8.0)) * step(0.52, r) * step(r, 0.76);
    coreMask = smoothstep(0.06, 0.01, ringDist) + smoothstep(0.04, 0.005, innerRing) * 0.7 + spokes * 0.5;
    auraMask = smoothstep(0.22, 0.0, ringDist) + smoothstep(0.14, 0.0, innerRing) * 0.6;
  }

  float totalAlpha = clamp((auraMask + coreMask) * v_alpha, 0.0, 1.0);
  if (totalAlpha < 0.01) discard;

  // High-contrast composition: dark warm bronze collar -> saturated warm rim -> bright ivory core
  vec3 col = mix(rimCol * 1.35, vec3(0.16, 0.08, 0.04), darkOutline * 0.55);
  col = mix(col, coreCol * 1.45, coreMask);

  fragColor = vec4(col, totalAlpha);
}
`;

const FS_BLOOM_DOWN = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_texelSize;
uniform bool u_thresholdPass;

vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float knee = smoothstep(0.68, 1.25, br);
  return c * knee * 0.85;
}

void main() {
  vec2 d = u_texelSize;
  vec3 c = texture(u_tex, v_uv).rgb * 4.0;
  c += texture(u_tex, v_uv - d).rgb;
  c += texture(u_tex, v_uv + d).rgb;
  c += texture(u_tex, v_uv + vec2(d.x, -d.y)).rgb;
  c += texture(u_tex, v_uv + vec2(-d.x, d.y)).rgb;
  c *= 0.125;
  if (u_thresholdPass) {
    c = prefilter(c);
  }
  fragColor = vec4(c, 1.0);
}
`;

const FS_BLOOM_FINAL = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_sceneTex;
uniform sampler2D u_bloomTex;
uniform float u_bloomStrength;

void main() {
  vec3 scene = texture(u_sceneTex, v_uv).rgb;
  vec3 bloom = texture(u_bloomTex, v_uv).rgb;

  // Clamp bloom to prevent any full-screen luminance flash (photosensitivity guarantee)
  bloom = min(bloom, vec3(0.85, 0.68, 0.42));
  vec3 hdr = scene + bloom * u_bloomStrength;

  // Warm filmic shoulder tone-map
  vec3 mapped = (hdr * (2.51 * hdr + 0.03)) / (hdr * (2.43 * hdr + 0.59) + 0.14);
  mapped = clamp(mapped, 0.0, 0.96);

  // Final safety clamp on blue channel
  mapped.b = min(mapped.b, max(mapped.r, mapped.g) * 0.88);

  fragColor = vec4(mapped, 1.0);
}
`;

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile error: ${info}`);
  }
  return sh;
}

function createProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`Program link error: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

function createFBO(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
}

export class WebGLCompositor {
  constructor(canvas, manifest) {
    this.canvas = canvas;
    this.manifest = manifest;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      throw new Error("WebGL2 not supported");
    }
    this.gl = gl;

    // Compile programs
    this.progBg = createProgram(gl, VS_QUAD, FS_BG);
    this.progSprite = createProgram(gl, VS_SPRITE, FS_SPRITE);
    this.progBullet = createProgram(gl, VS_BULLET, FS_BULLET);
    this.progBloomDown = createProgram(gl, VS_QUAD, FS_BLOOM_DOWN);
    this.progBloomFinal = createProgram(gl, VS_QUAD, FS_BLOOM_FINAL);

    this._initBuffers();
    this._initFBOs();
    this.textures = {};
    this.uvLookup = this._buildUVLookup(manifest);

    // Dynamic lights uniform buffers (16 lights)
    this.lightsPosRad = new Float32Array(16 * 4);
    this.lightsColor = new Float32Array(16 * 4);
    this.numLights = 0;
  }

  _buildUVLookup(manifest) {
    const map = {};
    for (const sheetKey of ["ships_and_enemies", "boss_parts"]) {
      const sheet = manifest[sheetKey];
      const [W, H] = sheet.size;
      for (const cell of sheet.cells) {
        const [x0, y0, x1, y1] = cell.rect;
        map[cell.key] = {
          sheet: sheetKey,
          u0: x0 / W,
          v0: y0 / H,
          u1: x1 / W,
          v1: y1 / H,
          w: x1 - x0,
          h: y1 - y0,
          pivot: cell.pivot || [0, 0],
        };
      }
    }
    return map;
  }

  _initBuffers() {
    const gl = this.gl;

    // Fullscreen quad VAO [-1..1]
    this.quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.quadVAO);
    const qBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instanced Sprite VAO (quad [-0.5..0.5] + 16 floats per sprite instance)
    this.maxSprites = 512;
    this.spriteData = new Float32Array(this.maxSprites * 16);
    this.spriteVAO = gl.createVertexArray();
    gl.bindVertexArray(this.spriteVAO);

    const sqBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sqBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.spriteInstBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteInstBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.spriteData.byteLength, gl.DYNAMIC_DRAW);

    const stride16 = 16 * 4;
    for (let i = 0; i < 4; i++) {
      const loc = 1 + i;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride16, i * 16);
      gl.vertexAttribDivisor(loc, 1);
    }

    // Instanced Bullet VAO (quad [-1..1] + 8 floats per bullet instance)
    this.maxBullets = 10000;
    this.bulletData = new Float32Array(this.maxBullets * 8);
    this.bulletVAO = gl.createVertexArray();
    gl.bindVertexArray(this.bulletVAO);

    gl.bindBuffer(gl.ARRAY_BUFFER, qBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.bulletInstBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bulletInstBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.bulletData.byteLength, gl.DYNAMIC_DRAW);

    const stride8 = 8 * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride8, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride8, 16);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  _initFBOs() {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.sceneFBO = createFBO(gl, W, H);
    this.bloomFBO1 = createFBO(gl, Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.bloomFBO2 = createFBO(gl, Math.max(1, W >> 2), Math.max(1, H >> 2));
  }

  async loadTextures(baseUrl = "public/assets") {
    const files = {
      ships_atlas: `${baseUrl}/ships_and_enemies_atlas.png`,
      ships_normal: `${baseUrl}/ships_and_enemies_normal.png`,
      ships_emissive: `${baseUrl}/ships_and_enemies_emissive.png`,
      boss_atlas: `${baseUrl}/boss_parts_atlas.png`,
      boss_normal: `${baseUrl}/boss_parts_normal.png`,
      boss_emissive: `${baseUrl}/boss_parts_emissive.png`,
      bg_abyss: `${baseUrl}/stage_bg_abyss.png`,
      bg_abyss_norm: `${baseUrl}/stage_bg_abyss_normal.png`,
      bg_sanctum: `${baseUrl}/stage_bg_sanctum.png`,
      bg_sanctum_norm: `${baseUrl}/stage_bg_sanctum_normal.png`,
      mandala: `${baseUrl}/astrolabe_mandala.png`,
    };

    const entries = Object.entries(files);
    await Promise.all(
      entries.map(
        ([key, url]) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              this.textures[key] = this._createTextureFromImage(img, key.startsWith("bg_"));
              resolve();
            };
            img.onerror = () => {
              this.textures[key] = this._createFallbackTexture();
              resolve();
            };
            img.src = `${url}?t=${Date.now()}`;
          })
      )
    );
  }

  _createTextureFromImage(img, repeat = false) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  }

  _createFallbackTexture() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([128, 128, 255, 255])
    );
    return tex;
  }

  clearLights() {
    this.numLights = 0;
  }

  addPointLight(x, y, radius, r, g, b, intensity = 1.0) {
    if (this.numLights >= 16) return;
    const i4 = this.numLights * 4;
    this.lightsPosRad[i4] = x;
    this.lightsPosRad[i4 + 1] = y;
    this.lightsPosRad[i4 + 2] = radius;
    this.lightsPosRad[i4 + 3] = intensity;
    this.lightsColor[i4] = r;
    this.lightsColor[i4 + 1] = g;
    this.lightsColor[i4 + 2] = b;
    this.lightsColor[i4 + 3] = 1.0;
    this.numLights++;
  }

  renderFrame(state) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // 1. Bind HDR/Scene FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);

    // --- PASS 1: Parallax Background + Dynamic Point Lighting ---
    gl.useProgram(this.progBg);
    this._bindTex(0, this.textures.bg_abyss, this.progBg, "u_bgAbyss");
    this._bindTex(1, this.textures.bg_abyss_norm, this.progBg, "u_bgAbyssNorm");
    this._bindTex(2, this.textures.bg_sanctum, this.progBg, "u_bgSanctum");
    this._bindTex(3, this.textures.bg_sanctum_norm, this.progBg, "u_bgSanctumNorm");
    this._bindTex(4, this.textures.mandala, this.progBg, "u_mandalaTex");

    gl.uniform1f(gl.getUniformLocation(this.progBg, "u_scrollY"), state.scrollY);
    gl.uniform1f(gl.getUniformLocation(this.progBg, "u_bgBlend"), state.bgBlend);
    gl.uniform1f(gl.getUniformLocation(this.progBg, "u_mandalaAlpha"), state.mandalaAlpha);
    gl.uniform2f(gl.getUniformLocation(this.progBg, "u_mandalaPos"), state.mandalaX, state.mandalaY);
    gl.uniform1f(gl.getUniformLocation(this.progBg, "u_mandalaRot"), state.mandalaRot);
    gl.uniform1f(gl.getUniformLocation(this.progBg, "u_time"), state.time);
    gl.uniform2f(gl.getUniformLocation(this.progBg, "u_resolution"), W, H);
    gl.uniform1i(gl.getUniformLocation(this.progBg, "u_numLights"), this.numLights);
    gl.uniform4fv(gl.getUniformLocation(this.progBg, "u_lightsPosRad"), this.lightsPosRad);
    gl.uniform4fv(gl.getUniformLocation(this.progBg, "u_lightsColor"), this.lightsColor);

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- PASS 2: Normal-Mapped Sprites & Multi-Part Boss Rig ---
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.progSprite);
    gl.uniform1f(gl.getUniformLocation(this.progSprite, "u_time"), state.time);
    gl.uniform1i(gl.getUniformLocation(this.progSprite, "u_numLights"), this.numLights);
    gl.uniform4fv(gl.getUniformLocation(this.progSprite, "u_lightsPosRad"), this.lightsPosRad);
    gl.uniform4fv(gl.getUniformLocation(this.progSprite, "u_lightsColor"), this.lightsColor);

    // Split sprites by sheet (`ships_and_enemies` vs `boss_parts`)
    this._drawSpriteBatch(state.shipSprites, "ships");
    this._drawSpriteBatch(state.bossSprites, "boss");

    // --- PASS 3: Instanced SDF Danmaku, Ribbon Lasers & Ward Rings ---
    gl.useProgram(this.progBullet);
    gl.uniform1f(gl.getUniformLocation(this.progBullet, "u_time"), state.time);
    gl.bindVertexArray(this.bulletVAO);

    // First draw standard alpha-blended bullets
    if (state.bulletCount > 0) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bulletInstBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.bulletData.subarray(0, state.bulletCount * 8));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, state.bulletCount);
    }

    // Then draw additive glow particles / lasers / ward rings
    if (state.additiveCount > 0) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bulletInstBuf);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        state.additiveData.subarray(0, state.additiveCount * 8)
      );
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, state.additiveCount);
    }

    // --- PASS 4: Dual-Kawase Mipmap Bloom & Safe Tone Mapping ---
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.quadVAO);
    gl.useProgram(this.progBloomDown);

    // Downsample 1 (threshold prefilter)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFBO1.fbo);
    gl.viewport(0, 0, this.bloomFBO1.w, this.bloomFBO1.h);
    this._bindTex(0, this.sceneFBO.tex, this.progBloomDown, "u_tex");
    gl.uniform2f(gl.getUniformLocation(this.progBloomDown, "u_texelSize"), 1.5 / W, 1.5 / H);
    gl.uniform1i(gl.getUniformLocation(this.progBloomDown, "u_thresholdPass"), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Downsample 2 (blur)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFBO2.fbo);
    gl.viewport(0, 0, this.bloomFBO2.w, this.bloomFBO2.h);
    this._bindTex(0, this.bloomFBO1.tex, this.progBloomDown, "u_tex");
    gl.uniform2f(
      gl.getUniformLocation(this.progBloomDown, "u_texelSize"),
      2.0 / this.bloomFBO1.w,
      2.0 / this.bloomFBO1.h
    );
    gl.uniform1i(gl.getUniformLocation(this.progBloomDown, "u_thresholdPass"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.progBloomFinal);
    this._bindTex(0, this.sceneFBO.tex, this.progBloomFinal, "u_sceneTex");
    this._bindTex(1, this.bloomFBO2.tex, this.progBloomFinal, "u_bloomTex");
    gl.uniform1f(gl.getUniformLocation(this.progBloomFinal, "u_bloomStrength"), 0.55);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindVertexArray(null);
  }

  _drawSpriteBatch(list, prefix) {
    if (!list || list.length === 0) return;
    const gl = this.gl;
    this._bindTex(0, this.textures[`${prefix}_atlas`], this.progSprite, "u_atlasTex");
    this._bindTex(1, this.textures[`${prefix}_normal`], this.progSprite, "u_normalTex");
    this._bindTex(2, this.textures[`${prefix}_emissive`], this.progSprite, "u_emissiveTex");

    const count = Math.min(list.length, this.maxSprites);
    let ptr = 0;
    for (let i = 0; i < count; i++) {
      const s = list[i];
      const uv = this.uvLookup[s.key];
      if (!uv) continue;
      const scale = s.scale || 1.0;
      const w = (s.w || uv.w) * scale;
      const h = (s.h || uv.h) * scale;
      const px = (s.pivotX !== undefined ? s.pivotX : uv.pivot[0]) * scale;
      const py = (s.pivotY !== undefined ? s.pivotY : uv.pivot[1]) * scale;

      this.spriteData[ptr + 0] = s.x;
      this.spriteData[ptr + 1] = s.y;
      this.spriteData[ptr + 2] = w;
      this.spriteData[ptr + 3] = h;

      this.spriteData[ptr + 4] = uv.u0;
      this.spriteData[ptr + 5] = uv.v0;
      this.spriteData[ptr + 6] = uv.u1;
      this.spriteData[ptr + 7] = uv.v1;

      this.spriteData[ptr + 8] = s.rot || 0.0;
      this.spriteData[ptr + 9] = px;
      this.spriteData[ptr + 10] = py;
      this.spriteData[ptr + 11] = s.mirrorX ? -1.0 : 1.0;

      this.spriteData[ptr + 12] = s.er !== undefined ? s.er : 1.1;
      this.spriteData[ptr + 13] = s.eg !== undefined ? s.eg : 0.65;
      this.spriteData[ptr + 14] = s.eb !== undefined ? s.eb : 0.18;
      this.spriteData[ptr + 15] = s.hitTint || 0.0;
      ptr += 16;
    }

    const validCount = ptr / 16;
    if (validCount === 0) return;

    gl.bindVertexArray(this.spriteVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteInstBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.spriteData.subarray(0, ptr));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, validCount);
  }

  _bindTex(unit, tex, prog, uniformName) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, uniformName), unit);
  }
}
