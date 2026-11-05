// The landing "world": one WebGL renderer behind the whole landing page, driven by scroll.
//
//   hero   — a live data painting: a flow field rendered as fur-like strokes (line-integral
//            convolution over a low-res field texture), tilting back into depth as you scroll.
//   house  — a particle apartment block that assembles floor by floor (the four milestones).
//   helix  — estate cards on a helix that turns and descends with scroll; hover + click.
//   always — concentric arcs rising from the bottom edge, drifting dust.
//
// Each stage is a tall DOM section ([data-world=name]) with a sticky inner frame. Every frame the
// world reads each section's scroll progress, writes it back as --p / data-step for the HTML
// overlay, and poses its own objects from it.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// Every material here writes display-space colour directly (custom shaders, raw textures), so the
// pipeline stays "raw": no colour management, no output encoding, post passes pass values through.
THREE.ColorManagement.enabled = false;

import { measure, type Stage, type StageName } from "./stages";

export type { StageName };
export type HelixCard = { title: string; sub: string; meta: string; tag: string; href: string; art: string };


const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------- shaders ----------------

const NOISE = /* glsl */ `
vec3 permute(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * snoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

const BG_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;

// The deep gallery field: indigo glow from the top, near-black floor, a slow breathing haze.
const BG_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uAspect;
uniform float uScroll;
${NOISE}
void main(){
  vec2 p = vUv - vec2(0.5, 1.0);
  p.x *= uAspect;
  float top = exp(-dot(p, p) * 1.1);
  vec2 q = vUv - vec2(0.5, -0.15);
  q.x *= uAspect;
  float bottom = exp(-dot(q, q) * 2.2);
  float haze = snoise(vec2(vUv.x * uAspect * 1.4, vUv.y * 1.4 - uScroll * 0.15) + uTime * 0.02) * 0.5 + 0.5;
  vec3 col = vec3(0.004, 0.008, 0.06);
  col += vec3(0.03, 0.04, 0.24) * top * (0.75 + 0.25 * haze);
  col += vec3(0.02, 0.02, 0.15) * bottom;
  col += vec3(0.015, 0.02, 0.07) * haze * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Final grade: lens fringing toward the edges and a soft vignette.
const FINAL = {
  uniforms: { tDiffuse: { value: null }, uCA: { value: 0.0045 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform float uCA;
varying vec2 vUv;
void main(){
  vec2 c = vUv - 0.5;
  vec2 off = c * dot(c, c) * uCA * 4.0;
  vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
  float vig = smoothstep(0.95, 0.25, length(c * vec2(1.0, 1.2)));
  col *= mix(0.62, 1.0, vig);
  gl_FragColor = vec4(col, 1.0);
}
`,
};

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Pass 1 (low-res): flow direction in .rg, two colour fields in .ba.
const FIELD_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uAspect;
uniform vec2 uMouse;
uniform float uMouseAmt;
${NOISE}
void main(){
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.4;
  float t = uTime * 0.045;
  vec2 q = vec2(fbm(p * 0.45 + vec2(0.0, t)), fbm(p * 0.45 + vec2(5.2, -t)));
  float a = fbm(p * 0.34 + q * 1.1 + t * 0.4) * 6.2831853 * 1.1;
  vec2 d = p - uMouse;
  float m = exp(-dot(d, d) * 2.2) * uMouseAmt;
  a += m * 3.2 + atan(d.y, d.x) * m * 0.6;
  float c1 = fbm(p * 0.42 + q * 0.6 + t * 0.2) * 0.5 + 0.5;
  float c2 = fbm(p * 0.75 - 3.1 - q * 0.4 - t * 0.25) * 0.5 + 0.5;
  gl_FragColor = vec4(cos(a) * 0.5 + 0.5, sin(a) * 0.5 + 0.5, c1, c2);
}
`;

// Pass 2 (full-res, on a plane in the scene): integrate high-frequency grain along the field.
const PAINT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uField;
uniform float uAspect;
uniform float uFade;
uniform float uEdge;
uniform float uTime;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float grain(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
vec2 dir(vec2 uv){ vec2 d = texture2D(uField, uv).rg * 2.0 - 1.0; return normalize(d + 1e-4); }
void main(){
  vec2 asp = vec2(uAspect, 1.0);
  vec2 a = vUv, b = vUv;
  float acc = 0.0, w = 0.0;
  for (int i = 0; i < 16; i++) {
    a += dir(a) / asp * 0.0034;
    b -= dir(b) / asp * 0.0034;
    float k = 1.0 - float(i) / 16.0;
    acc += (grain(a * asp * 420.0) + grain(b * asp * 420.0)) * k;
    w += 2.0 * k;
  }
  acc /= w;
  float strand = smoothstep(0.40, 0.74, acc);
  vec4 f = texture2D(uField, vUv);
  float c1 = f.b, c2 = f.a;
  vec3 wine = vec3(0.30, 0.06, 0.16), rose = vec3(0.85, 0.50, 0.58), cream = vec3(0.94, 0.86, 0.74);
  vec3 blue = vec3(0.16, 0.30, 0.68), teal = vec3(0.18, 0.83, 0.75), gold = vec3(0.91, 0.69, 0.29), navy = vec3(0.012, 0.016, 0.06);
  vec3 col = mix(wine, rose, smoothstep(0.25, 0.65, c1));
  col = mix(col, cream, smoothstep(0.62, 0.92, c1) * 0.85);
  col = mix(col, blue, smoothstep(0.48, 0.82, c2));
  col = mix(col, teal, smoothstep(0.80, 0.97, c2) * 0.55);
  col = mix(col, gold, smoothstep(0.86, 0.99, c1) * 0.35);
  float valley = smoothstep(0.15, 0.85, c1 * 0.6 + c2 * 0.5);
  col *= (0.18 + 1.05 * strand) * (0.45 + 0.75 * valley);
  float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x) * smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
  float alpha = uFade * mix(1.0, edge, uEdge);
  gl_FragColor = vec4(mix(navy, col, uFade), alpha);
}
`;

const POINTS_VERT = /* glsl */ `
attribute vec3 aTarget;
attribute vec3 aScatter;
attribute float aFloor;
attribute float aRand;
attribute float aKind;
uniform float uProgress;
uniform float uTime;
uniform float uSize;
uniform float uPR;
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main(){
  float local = clamp(uProgress - aFloor, 0.0, 1.0);
  float e = local * local * (3.0 - 2.0 * local);
  vec3 pos = mix(aScatter, aTarget, e);
  float drift = 1.0 - e;
  pos += drift * 0.35 * vec3(sin(uTime * 0.7 + aRand * 31.0), cos(uTime * 0.55 + aRand * 17.0), sin(uTime * 0.45 + aRand * 11.0));
  pos += e * 0.012 * vec3(sin(uTime * 2.0 + aRand * 50.0));
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize * uPR * (0.7 + aRand * 0.9) / -mv.z, 5.0 * uPR);
  vec3 teal = vec3(0.18, 0.83, 0.75), ice = vec3(0.75, 0.82, 1.0), gold = vec3(0.93, 0.70, 0.30), violet = vec3(0.55, 0.49, 0.96);
  vec3 c = mix(violet, ice, aRand);
  c = mix(c, teal, e * (aKind < 0.5 ? 1.0 : 0.55));
  if (aKind > 1.5) c = mix(c, gold, e);
  vColor = c;
  vAlpha = uOpacity * mix(0.22, aKind < 0.5 ? 0.95 : 0.55, e);
}
`;

const POINTS_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  float a = smoothstep(0.25, 0.0, r);
  gl_FragColor = vec4(vColor, vAlpha * a);
}
`;

const DUST_VERT = /* glsl */ `
attribute float aRand;
uniform float uTime;
uniform float uPR;
uniform float uOpacity;
varying float vAlpha;
void main(){
  vec3 p = position;
  p.y = mod(p.y + uTime * (0.08 + aRand * 0.12) + 20.0, 40.0) - 20.0;
  p.x += sin(uTime * 0.2 + aRand * 40.0) * 0.4;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min((1.0 + aRand * 2.2) * uPR * 8.0 / -mv.z, 3.5 * uPR);
  vAlpha = uOpacity * (0.25 + 0.75 * aRand);
}
`;

const DUST_FRAG = /* glsl */ `
precision highp float;
varying float vAlpha;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  gl_FragColor = vec4(0.72, 0.78, 1.0, vAlpha * smoothstep(0.25, 0.0, r));
}
`;

// ---------------- geometry builders ----------------

/** Points on the edges, faces and windows of a four-storey block. aFloor 0..3 is the milestone. */
function buildHouse(count: number) {
  const target = new Float32Array(count * 3);
  const scatter = new Float32Array(count * 3);
  const floor = new Float32Array(count);
  const rand = new Float32Array(count);
  const kind = new Float32Array(count);
  const W = 3.4, D = 2.3, H = 0.95, FLOORS = 4;
  const base = -1.9;
  const edgesOf = (y0: number, y1: number): [number[], number[]][] => {
    const c = [
      [-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2],
    ];
    const e: [number[], number[]][] = [];
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = c[i];
      const [x1, z1] = c[(i + 1) % 4];
      e.push([[x0, y0, z0], [x1, y0, z1]], [[x0, y1, z0], [x1, y1, z1]], [[x0, y0, z0], [x0, y1, z0]]);
    }
    return e;
  };
  for (let i = 0; i < count; i++) {
    const f = Math.min(FLOORS - 1, Math.floor((i / count) * FLOORS));
    const y0 = base + f * H;
    const y1 = y0 + H;
    const r = Math.random();
    let x = 0, y = 0, z = 0, k = 0;
    if (r < 0.42) {
      // edges
      const es = edgesOf(y0, y1);
      const [a, b] = es[Math.floor(Math.random() * es.length)];
      const t = Math.random();
      x = lerp(a[0], b[0], t); y = lerp(a[1], b[1], t); z = lerp(a[2], b[2], t);
    } else if (r < 0.8) {
      // windows: small rectangles on the two front faces
      const front = Math.random() < 0.55;
      const n = 4;
      const wi = Math.floor(Math.random() * n);
      const span = front ? W : D;
      const cx = -span / 2 + (span / n) * (wi + 0.5);
      const ww = (span / n) * 0.42, wh = H * 0.42;
      const cy = y0 + H * 0.5;
      const side = Math.floor(Math.random() * 4);
      const t = Math.random();
      let u = 0, v = 0;
      if (side === 0) { u = cx - ww / 2 + ww * t; v = cy - wh / 2; }
      else if (side === 1) { u = cx - ww / 2 + ww * t; v = cy + wh / 2; }
      else if (side === 2) { u = cx - ww / 2; v = cy - wh / 2 + wh * t; }
      else { u = cx + ww / 2; v = cy - wh / 2 + wh * t; }
      if (front) { x = u; z = D / 2; } else { x = W / 2; z = u; }
      y = v;
      k = f === 3 && front && wi === 2 ? 2 : 1; // unit 4B glows gold
    } else {
      // faces: sparse fill
      const face = Math.floor(Math.random() * 3);
      const u = Math.random(), v = Math.random();
      if (face === 0) { x = -W / 2 + W * u; z = D / 2; }
      else if (face === 1) { x = W / 2; z = -D / 2 + D * u; }
      else { x = -W / 2 + W * u; z = -D / 2; }
      y = y0 + H * v;
      k = 1;
    }
    target.set([x, y, z], i * 3);
    // scatter: a loose shell around the block
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const rr = 5 + Math.random() * 6;
    scatter.set([Math.sin(ph) * Math.cos(th) * rr, Math.cos(ph) * rr * 0.7 + 1, Math.sin(ph) * Math.sin(th) * rr], i * 3);
    floor[i] = f;
    rand[i] = Math.random();
    kind[i] = k;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(target, 3));
  g.setAttribute("aTarget", new THREE.BufferAttribute(target, 3));
  g.setAttribute("aScatter", new THREE.BufferAttribute(scatter, 3));
  g.setAttribute("aFloor", new THREE.BufferAttribute(floor, 1));
  g.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
  g.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 14);
  return g;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

/** A card texture laid out like a gallery collection plate: title block on the left, artwork on the right. */
async function cardTexture(card: HelixCard, font: string, maxAniso: number) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, c.width, c.height);
  // plate
  g.fillStyle = "rgba(10,14,40,0.55)";
  g.fillRect(0, 40, 1024, 432);
  g.strokeStyle = "rgba(140,160,255,0.22)";
  g.lineWidth = 2;
  g.strokeRect(1, 41, 1022, 430);
  // art
  const ax = 640, ay = 24, aw = 340, ah = 464;
  try {
    const im = await loadImage(card.art);
    g.fillStyle = "#05070f";
    g.fillRect(ax, ay, aw, ah);
    const s = Math.min(aw / im.width, ah / im.height);
    const iw = im.width * s, ih = im.height * s;
    g.save();
    g.beginPath();
    g.rect(ax, ay, aw, ah);
    g.clip();
    g.drawImage(im, ax + (aw - iw) / 2, ay + (ah - ih) / 2, iw, ih);
    g.restore();
  } catch {
    g.fillStyle = "#0f3d45";
    g.fillRect(ax, ay, aw, ah);
  }
  // corner brackets on the art
  g.strokeStyle = "#2dd4bf";
  g.lineWidth = 4;
  const L = 26;
  for (const [x, y, dx, dy] of [[ax, ay, 1, 1], [ax + aw, ay, -1, 1], [ax, ay + ah, 1, -1], [ax + aw, ay + ah, -1, -1]]) {
    g.beginPath();
    g.moveTo(x + dx * L, y);
    g.lineTo(x, y);
    g.lineTo(x, y + dy * L);
    g.stroke();
  }
  // title, right-aligned against the art
  g.textAlign = "right";
  g.textBaseline = "alphabetic";
  g.fillStyle = "#e8eaf4";
  const words = card.title.toUpperCase().split(" ");
  const lines: string[] = [];
  g.font = `300 58px ${font}`;
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > 560 && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => g.fillText(l, 610, 150 + i * 62));
  const after = 150 + Math.min(3, lines.length) * 62;
  g.font = `400 24px ${font}`;
  g.fillStyle = "#8d96b8";
  g.fillText(card.sub.toUpperCase(), 610, after + 10);
  g.font = `400 19px ${font}`;
  g.fillStyle = "#59628a";
  g.fillText(card.meta.toUpperCase(), 610, 440);
  // boxed tag
  g.font = `500 18px ${font}`;
  const tw = g.measureText(card.tag).width + 20;
  g.strokeStyle = "rgba(200,210,255,0.55)";
  g.lineWidth = 2;
  g.strokeRect(610 - tw, 380, tw, 30);
  g.fillStyle = "#b9c0dc";
  g.fillText(card.tag, 600, 402);
  // vertical index along the art edge
  g.save();
  g.translate(ax - 14, ay + ah);
  g.rotate(-Math.PI / 2);
  g.textAlign = "left";
  g.font = `400 16px ${font}`;
  g.fillStyle = "#59628a";
  g.fillText("PLOTE · NEAR", 0, 0);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return tex;
}

// ---------------- the world ----------------

export class World {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private t0 = performance.now();
  private stages = new Map<StageName, Stage>();
  private raf = 0;
  private disposed = false;
  private mobile: boolean;

  private fieldRT: THREE.WebGLRenderTarget;
  private bgMat: THREE.ShaderMaterial;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private fieldScene = new THREE.Scene();
  private fieldCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
  private fieldMat: THREE.ShaderMaterial;
  private paint: THREE.Mesh;
  private paintMat: THREE.ShaderMaterial;

  private house: THREE.Points;
  private houseMat: THREE.ShaderMaterial;
  private arcs = new THREE.Group();
  private arcMats: THREE.LineBasicMaterial[] = [];
  private dust: THREE.Points;
  private dustMat: THREE.ShaderMaterial;

  private helix = new THREE.Group();
  private cards: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; href: string; theta: number; y: number }[] = [];
  private cardsKey = "";
  private hovered: number | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2(-9, -9);

  private mouse = new THREE.Vector2(0, 0);
  private mouseTarget = new THREE.Vector2(0, 0);
  private mouseAmt = 0;
  private onNavigate: (href: string) => void;
  private reveal: HTMLElement[] = [];

  constructor(canvas: HTMLCanvasElement, opts: { onNavigate: (href: string) => void }) {
    this.onNavigate = opts.onNavigate;
    this.mobile = window.matchMedia("(max-width: 768px)").matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.mobile, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x01020f, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1.25 : 1.6));
    this.camera.position.set(0, 0, 10);

    // the field behind everything
    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: BG_VERT,
      fragmentShader: BG_FRAG,
      depthWrite: false,
      depthTest: false,
      uniforms: { uTime: { value: 0 }, uAspect: { value: 1.6 }, uScroll: { value: 0 } },
    });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat);
    bg.frustumCulled = false;
    bg.renderOrder = -10;
    this.scene.add(bg);

    // cinematic post: bloom on the light (desktop), then fringing + vignette
    if (!this.mobile) {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.55, 0.7);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new ShaderPass(FINAL));
    }

    // painting
    this.fieldRT = new THREE.WebGLRenderTarget(320, 200, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.fieldMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: FIELD_FRAG,
      uniforms: { uTime: { value: 0 }, uAspect: { value: 1.6 }, uMouse: { value: new THREE.Vector2() }, uMouseAmt: { value: 0 } },
    });
    this.fieldScene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.fieldMat));
    this.paintMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: PAINT_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: { uField: { value: this.fieldRT.texture }, uAspect: { value: 1.6 }, uFade: { value: 1 }, uEdge: { value: 0 }, uTime: { value: 0 } },
    });
    this.paint = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.paintMat);
    this.paint.renderOrder = -1;
    this.scene.add(this.paint);

    // arcs
    for (let i = 0; i < 26; i++) {
      const r = 1.4 + i * 1.15;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 128; k++) {
        const a = (k / 128) * Math.PI;
        pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
      }
      const mat = new THREE.LineBasicMaterial({ color: 0x8ca0ff, transparent: true, opacity: 0, depthWrite: false });
      this.arcMats.push(mat);
      this.arcs.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    this.arcs.position.set(0, -6.2, -6);
    this.arcs.rotation.x = -0.32;
    this.scene.add(this.arcs);

    // dust
    const dn = this.mobile ? 700 : 1800;
    const dp = new Float32Array(dn * 3);
    const dr = new Float32Array(dn);
    for (let i = 0; i < dn; i++) {
      dp.set([(Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, -Math.random() * 30 + 4], i * 3);
      dr[i] = Math.random();
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
    dg.setAttribute("aRand", new THREE.BufferAttribute(dr, 1));
    dg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPR: { value: this.renderer.getPixelRatio() }, uOpacity: { value: 0.4 } },
    });
    this.dust = new THREE.Points(dg, this.dustMat);
    this.scene.add(this.dust);

    // house
    this.houseMat = new THREE.ShaderMaterial({
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uProgress: { value: 0 }, uTime: { value: 0 }, uSize: { value: this.mobile ? 26 : 30 },
        uPR: { value: this.renderer.getPixelRatio() }, uOpacity: { value: 0 },
      },
    });
    this.house = new THREE.Points(buildHouse(this.mobile ? 26000 : 64000), this.houseMat);
    this.house.visible = false;
    this.scene.add(this.house);

    // helix
    this.helix.visible = false;
    this.scene.add(this.helix);

    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    window.addEventListener("click", this.onClick);
    this.loop();
  }

  attach(stages: Map<StageName, Stage>, reveal: HTMLElement[]) {
    this.stages = stages;
    this.reveal = reveal;
  }

  async setCards(cards: HelixCard[]) {
    const key = JSON.stringify(cards.map((c) => [c.title, c.sub, c.meta, c.tag, c.art.length]));
    if (key === this.cardsKey || !cards.length) return;
    this.cardsKey = key;
    await document.fonts?.ready;
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-tech").trim() || "sans-serif";
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const textures = await Promise.all(cards.map((c) => cardTexture(c, font, aniso)));
    if (this.disposed || key !== this.cardsKey) {
      textures.forEach((t) => t.dispose());
      return;
    }
    for (const c of this.cards) {
      this.helix.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mat.map?.dispose();
      c.mat.dispose();
    }
    const geo = new THREE.PlaneGeometry(3.6, 1.8);
    this.cards = cards.map((c, i) => {
      const mat = new THREE.MeshBasicMaterial({ map: textures[i], transparent: true, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(i === 0 ? geo : geo.clone(), mat);
      const theta = i * 0.62;
      const y = -i * 1.05;
      this.helix.add(mesh);
      return { mesh, mat, href: c.href, theta, y };
    });
  }

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const aspect = w / h;
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
    this.paint.scale.set(vh * aspect * 1.02, vh * 1.02, 1);
    this.paintMat.uniforms.uAspect.value = aspect;
    this.fieldMat.uniforms.uAspect.value = aspect;
    const fw = this.mobile ? 200 : 360;
    this.fieldRT.setSize(fw, Math.max(64, Math.round(fw / aspect)));
    this.bgMat.uniforms.uAspect.value = aspect;
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.mobile = window.matchMedia("(max-width: 768px)").matches;
  };

  private onPointer = (e: PointerEvent) => {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = -(e.clientY / window.innerHeight) * 2 + 1;
    this.ndc.set(x, y);
    const aspect = window.innerWidth / window.innerHeight;
    this.mouseTarget.set(x * aspect * 1.2, y * 1.2);
    this.mouseAmt = 1;
  };

  private interactive(t: EventTarget | null) {
    return t instanceof Element && !!t.closest("a,button,input,textarea,select,label,summary,[role=button]");
  }

  private onClick = (e: MouseEvent) => {
    if (this.hovered === null || this.interactive(e.target)) return;
    const c = this.cards[this.hovered];
    if (c) this.onNavigate(c.href);
  };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = (performance.now() - this.t0) / 1000;
    measure(this.stages, this.reveal);
    const hero = this.stages.get("hero");
    const house = this.stages.get("house");
    const helix = this.stages.get("helix");
    this.mouse.lerp(this.mouseTarget, 0.06);
    this.mouseAmt *= 0.985;

    // camera: gentle parallax with the pointer
    this.camera.position.x = lerp(this.camera.position.x, this.ndc.x * 0.35 * (this.ndc.x > -2 ? 1 : 0), 0.04);
    this.camera.position.y = lerp(this.camera.position.y, this.ndc.y * 0.22 * (this.ndc.y > -2 ? 1 : 0), 0.04);
    this.camera.lookAt(0, 0, 0);

    // hero painting
    const hp = hero ? hero.p : 1;
    const paintOn = !!hero && (hero.visible || hp < 1) && hp < 0.999;
    this.paint.visible = paintOn;
    if (paintOn) {
      this.fieldMat.uniforms.uTime.value = t;
      this.fieldMat.uniforms.uMouse.value.copy(this.mouse);
      this.fieldMat.uniforms.uMouseAmt.value = 0.4 + 0.6 * this.mouseAmt;
      this.renderer.setRenderTarget(this.fieldRT);
      this.renderer.render(this.fieldScene, this.fieldCam);
      this.renderer.setRenderTarget(null);
      const tilt = smooth(0, 1, hp);
      this.paint.rotation.x = -tilt * 1.18;
      this.paint.position.set(0, -tilt * 2.6, -tilt * 7);
      this.paintMat.uniforms.uFade.value = 1 - smooth(0.55, 0.98, hp);
      this.paintMat.uniforms.uEdge.value = smooth(0, 0.35, hp);
      this.paintMat.uniforms.uTime.value = t;
    }

    // arcs + dust come up as the painting falls away
    const field = smooth(0.25, 0.9, hp);
    this.arcMats.forEach((m, i) => (m.opacity = field * (0.16 - i * 0.004)));
    this.arcs.rotation.z = Math.sin(t * 0.05) * 0.02;
    const scrollY = window.scrollY / Math.max(1, window.innerHeight);
    this.bgMat.uniforms.uTime.value = t;
    this.bgMat.uniforms.uScroll.value = scrollY;
    this.arcs.position.y = -6.2 - Math.sin(scrollY * 0.35) * 0.6;
    this.dustMat.uniforms.uTime.value = t;
    this.dustMat.uniforms.uOpacity.value = 0.18 + 0.4 * field;
    this.dust.rotation.y = scrollY * 0.04;

    // house
    if (house && house.visible) {
      this.house.visible = true;
      this.houseMat.uniforms.uTime.value = t;
      this.houseMat.uniforms.uProgress.value = house.p * 4.4 - 0.15;
      const inA = smooth(0, 1, house.enter);
      const outA = smooth(0, 1, house.exit);
      this.houseMat.uniforms.uOpacity.value = inA * (1 - outA);
      this.house.position.set(this.mobile ? 0 : 2.1, (this.mobile ? 1.95 : 0.1) + outA * 3, -14 * (1 - inA) + outA * 3);
      this.house.rotation.y = -0.6 + house.p * 2.2 + t * 0.03;
      this.house.rotation.x = 0.28 - house.p * 0.12;
      const s = this.mobile ? 0.58 : 1;
      this.house.scale.setScalar(s);
    } else this.house.visible = false;

    // helix
    if (helix && helix.visible && this.cards.length) {
      this.helix.visible = true;
      const n = this.cards.length;
      const inA = smooth(0, 1, helix.enter);
      const outA = smooth(0, 1, helix.exit);
      const along = helix.p * (n - 1);
      this.helix.rotation.y = -along * 0.62;
      const hs = this.mobile ? 0.6 : 1;
      this.helix.scale.setScalar(hs);
      this.helix.position.set(this.mobile ? 0.2 : 1.5, (along * 1.05) * hs + (this.mobile ? -0.9 : 0) + (1 - inA) * -6 + outA * 6, -2 - (1 - inA) * 10);
      const R = 3.6;
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const hits = this.raycaster.intersectObjects(this.cards.map((c) => c.mesh), false);
      let hov: number | null = null;
      for (const h of hits) {
        const i = this.cards.findIndex((c) => c.mesh === h.object);
        if (i >= 0) {
          const wp = new THREE.Vector3();
          this.cards[i].mesh.getWorldPosition(wp);
          if (wp.z > -2) {
            hov = i;
            break;
          }
        }
      }
      if (hov !== this.hovered) window.dispatchEvent(new CustomEvent("plote:cursor", { detail: hov !== null ? "Open" : null }));
      this.hovered = hov;
      document.documentElement.style.cursor = hov !== null ? "pointer" : "";
      const wp = new THREE.Vector3();
      this.cards.forEach((c, i) => {
        c.mesh.position.set(Math.sin(c.theta) * R, c.y, Math.cos(c.theta) * R);
        c.mesh.rotation.y = c.theta;
        c.mesh.getWorldPosition(wp);
        const facing = clamp((wp.z + 2 + R) / (2 * R)); // back of helix → 0, front → 1
        const nearY = 1 - clamp(Math.abs(wp.y - (this.mobile ? -0.9 : 0)) / (this.mobile ? 3.4 : 5.5));
        const target = (0.08 + 0.92 * facing * facing) * nearY * inA * (1 - outA);
        c.mat.opacity = lerp(c.mat.opacity, target, 0.15);
        const sc = hov === i ? 1.07 : 1;
        c.mesh.scale.setScalar(lerp(c.mesh.scale.x || 1, sc, 0.15));
      });
    } else {
      this.helix.visible = false;
      if (this.hovered !== null) {
        window.dispatchEvent(new CustomEvent("plote:cursor", { detail: null }));
        this.hovered = null;
        document.documentElement.style.cursor = "";
      }
    }

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("pointermove", this.onPointer);
    window.removeEventListener("click", this.onClick);
    document.documentElement.style.cursor = "";
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => {
        (x as THREE.MeshBasicMaterial).map?.dispose();
        x.dispose();
      });
    });
    this.fieldMat.dispose();
    this.fieldRT.dispose();
    this.composer?.dispose();
    this.bloom?.dispose();
    this.renderer.dispose();
  }
}
