// Scroll measurement shared by the WebGL world and its no-WebGL fallback. Each stage is a tall
// section ([data-world]) with a sticky frame; its progress is written back for the HTML overlay
// as --p (0→1 while pinned), --enter, --exit and data-step (0..3).

export type StageName = "hero" | "house" | "helix";
export type Stage = { el: HTMLElement; p: number; enter: number; exit: number; visible: boolean };

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function collectStages(root: ParentNode = document) {
  const m = new Map<StageName, Stage>();
  root.querySelectorAll<HTMLElement>("[data-world]").forEach((el) => m.set(el.dataset.world as StageName, { el, p: 0, enter: 0, exit: 0, visible: false }));
  return m;
}

export function collectReveal(root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
}

export function measure(stages: Map<StageName, Stage>, reveal: HTMLElement[]) {
  const vh = window.innerHeight;
  for (const s of stages.values()) {
    const r = s.el.getBoundingClientRect();
    // pinned stages scroll through their extra height; an unpinned one (the hero on phones) over 60% of a screen
    const total = Math.max(vh * 0.6, r.height - vh);
    s.p = clamp(-r.top / total);
    s.enter = clamp((vh - r.top) / vh);
    s.exit = clamp((vh - r.bottom) / vh);
    s.visible = r.top < vh && r.bottom > 0;
    s.el.style.setProperty("--p", s.p.toFixed(4));
    s.el.style.setProperty("--enter", s.enter.toFixed(4));
    s.el.style.setProperty("--exit", s.exit.toFixed(4));
    s.el.dataset.step = String(Math.min(3, Math.floor(s.p * 4 * 0.999)));
  }
  for (const el of reveal) {
    const r = el.getBoundingClientRect();
    if (r.top > vh * 1.2 || r.bottom < -vh * 0.2) continue;
    const v = smooth(0, 1, (vh - r.top) / (vh * 0.45));
    el.style.opacity = String(0.08 + 0.92 * v);
    el.style.transform = `perspective(1400px) translate3d(0, ${((1 - v) * 90).toFixed(1)}px, ${((1 - v) * -260).toFixed(1)}px) rotateX(${((1 - v) * 28).toFixed(2)}deg)`;
  }
}
