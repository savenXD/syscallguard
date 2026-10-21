import Lenis from 'lenis';

let lenis: Lenis | null = null;
let raf = 0;

export function startSmoothScroll() {
  if (lenis) return;
  lenis = new Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4), smoothWheel: true });
  const loop = (time: number) => {
    lenis?.raf(time);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

export function stopSmoothScroll() {
  if (!lenis) return;
  cancelAnimationFrame(raf);
  lenis.destroy();
  lenis = null;
}

/** Scrolls so the section clears the fixed top bar (64px) plus some air. */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { offset: -88, duration: 1.3 });
  else window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 88, behavior: 'smooth' });
}
