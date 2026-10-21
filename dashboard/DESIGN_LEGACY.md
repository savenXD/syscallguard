# SyscallGuard Dashboard: Design Legacy

**Read this whole file before you design or edit any page or component in `dashboard/src/`.**
It is written for a model that tends to produce messy, generic "AI slop" UI. Follow it literally. When a rule here conflicts with your instinct, the rule wins.

If you are unsure, copy an existing component. Do not invent a new look.

---

## 0. The one-paragraph picture

This is a professional security-operations dashboard, like Linear, Vercel or Datadog. It is **plain black**, with a **very faint static grain** behind the content, **thin 1px borders**, **big readable type**, and **almost no colour** except where the colour carries meaning (green allowed, red blocked, amber audit). Motion is smooth and purposeful (Framer Motion). It must look calm, sharp and expensive, never busy.

---

## 1. Hard rules (break one and the work is rejected)

1. **Real data only.** Show only what arrives from the guard (`useSyscallGuard`). Never invent numbers, charts, users, latency, CPU, or "trends". If there is no data, show an honest empty state. (The only placeholders allowed: the operator name/ID in the top bar.)
2. **No remote resources.** No CDN fonts, scripts, images, or icon URLs. The Electron CSP blocks them. Fonts come from `@fontsource*` npm packages, icons from `lucide-react`.
3. **Use the existing tokens, fonts and components** (sections 2 to 6). Do not add new colours, fonts, shadows or radii.
4. **No text smaller than 12.5px.** Body is 15 to 16px. Nothing "tiny and grey" scattered about.
5. **No div soup.** One idea per element. Use semantic tags (`header`, `nav`, `main`, `section`, `ul/li`, `dl`, `button`, `h1/h2`). Never nest more than 3 plain wrapper divs for layout.
6. **Do not touch other tracks.** Work only inside `dashboard/`. Never import `bcc`. Keep `contextIsolation` and `sandbox` on.
7. **Never use `any`, never leave `console.log`, never leave unused imports.** `npx tsc --noEmit` must pass.

---

## 2. Colour (black and white first)

| Role | Value | Use |
|---|---|---|
| Page | `#000` | `body` background. Plain black. Never a gradient, never blue-black. |
| Card | `linear-gradient(#0c0c0c, #070707)` | only through the `.card` class |
| Border | `rgba(255,255,255,0.10)`, hover `0.20` | 1px only, via `.card` or `.hairline` |
| Text primary | `text-white` | headings, values |
| Text body | `text-zinc-300` | paragraphs |
| Text muted | `text-zinc-400` | labels, hints. **Never darker than `zinc-500`.** |
| Allowed / OK | `#6ee7a1` (`signal-allow`) | allow events, "connected", secure state |
| Blocked / danger | `#ff5a5f` (`signal-red`) | block events, errors |
| Audit / warning | `#fbbf24` (`signal-amber`) | would-block |
| Avatar only | orange to pink gradient | the cartoon avatar, nowhere else |

Rules:
- Colour appears **only** to mean something (state, severity, a series in a chart). Never for decoration.
- Never use purple, blue, cyan, indigo or neon gradients. Never use gradient text.
- Never use coloured glows except the soft state tint already in `Hero.tsx`.
- Event colours live in one place: `EVENT_META` in `src/lib/utils.ts`. Import it. Do not re-type hex codes per component.

---

## 3. Typography

Three families, set in `tailwind.config.js`:

| Class | Font | Use |
|---|---|---|
| `font-sans` (default) | Geist Variable | all UI text |
| `font-mono` | Geist Mono Variable | data: pids, IPs, paths, timestamps, counts in tables, kbd keys |
| `font-serif` | Instrument Serif | **only** the brand name, the Hero headline, and big metric numbers |

Scale (use these, nothing in between):

| Use | Size |
|---|---|
| Hero headline | `text-[clamp(40px,5vw,72px)]` serif |
| Big metric number | `text-[60px]` to `text-[76px]` serif, `leading-[0.9]` |
| Card title | `text-lg font-medium` |
| Body | `text-[15px]` or `text-base`, `leading-relaxed` for paragraphs |
| Label (eyebrow) | `.eyebrow` class (13px mono, uppercase, wide tracking, `zinc-400`) |
| Data | `font-mono text-[15px]` |

Rules:
- **Never** use `font-mono` for ordinary sentences. Never use all-caps except `.eyebrow`.
- Use `tabular` (class) on any number that updates live.
- Max one serif element per card.
- Sentence case everywhere ("Event stream", not "EVENT STREAM" or "Event Stream").
- Write like a person: "Nothing has tried to leave." not "No anomalous egress events detected."

---

## 4. Layout and spacing

Shell (already built in `App.tsx`, do not restructure):
- **TopBar** fixed, `h-16`, full width, over everything. Brand left, search (Ctrl+K), live status, alerts bell, settings, profile.
- **Sidebar** fixed under the top bar. Collapsed 68px, expands to 216px on hover. A spacer div keeps `<main>` aligned.
- **Main** fills the rest. Padding `px-5 md:px-8 xl:px-10`, `py-7`. Vertical gap between sections `gap-6`, inside sections `gap-5`.
- Section order: Hero, Activity + Event mix, metric cards, Processes + Policy, Event stream. Do not reorder without being asked.

Spacing: use the Tailwind scale in steps of 2/3/4/5/6/8. Card padding is `p-6` (or `px-6` with `CardHeader`). Hero is `p-8 lg:p-12`. Never use random pixel paddings like `p-[13px]`.

Radii: cards `20px` (via `.card`), buttons and inputs `rounded-lg` (8px), pills `rounded-full`. Nothing else.

Grids: 12-column at `xl` (`xl:grid-cols-12`), single column below. Cards in a row must be the same height: give the child `h-full`.

---

## 5. Components you must reuse (do not rebuild these)

| Need | Use | File |
|---|---|---|
| A card that fades in | `<Reveal delay={n}>` (adds `.card`) | `components/ui/Reveal.tsx` |
| Card title row | `<CardHeader index="01" title="..." right={...} />` | same |
| Animated number | `<Count value={n} />` | `components/ui/Count.tsx` |
| Mini line chart | `<Sparkline data color />` | `components/ui/Sparkline.tsx` |
| On/off control | `<Switch checked onChange label />` | `components/ui/Switch.tsx` |
| Icon that sits inside text | `<Inline Icon={Eye} />` | `components/ui/Inline.tsx` |
| Profile picture | `<Avatar size />` | `components/Avatar.tsx` |
| Merge class names | `cn(...)` | `lib/utils.ts` |
| Current time that ticks | `useNow(ms)` | `lib/utils.ts` |
| Clock, duration, host formatting | `fmtClock`, `fmtDuration`, `fmtDest`, `basename` | `lib/utils.ts` |
| User preferences | `useSettings()` | `lib/settings.tsx` |
| Scroll to a section | `scrollToId(id)` | `lib/smoothScroll.ts` |

CSS helpers in `styles/globals.css`: `.card`, `.eyebrow`, `.hairline`, `.tabular`. Use them instead of re-writing border and background classes.

If a needed component does not exist, build it **in the same style as the nearest existing one** and put generic pieces in `components/ui/`.

---

## 6. Icons

- Only `lucide-react`. `strokeWidth` 1.5 to 1.75. Never filled icons, never emoji as icons.
- Standalone icons: size 17 to 21 and `text-zinc-400` (white on hover or when active).
- Icon inside a line of text: always `<Inline Icon={X} />`. It matches the text colour and height.
- Never put an icon in a coloured square "badge". Never use an icon just to fill space.
- Icons carry the same meaning everywhere: `ShieldCheck` secure, `ShieldAlert` blocked, `TriangleAlert` would-block, `Network` tagged processes, `FileLock2` protected files, `Globe` destination.

---

## 7. Motion (Framer Motion)

- Entrance: `opacity 0 to 1`, `y 24 to 0`, `blur(6px) to 0`, `0.7s`, ease `[0.22, 1, 0.36, 1]`. Stagger cards by `0.07s`.
- Lists: `AnimatePresence` + `layout`. New items drop in from above and flash briefly.
- Selected-pill tabs: one shared `layoutId` spring (`stiffness 400, damping 32`).
- Numbers: `Count`, 0.9s. Chart bars: tween 0.6s, **never a spring** (springs overshoot to negative height and throw SVG errors).
- Panels: spring `stiffness 320, damping 36`.
- Animate **meaning**: a pulse on live status, dots flowing in the data-flow diagram, red flash on a block. Never animate for decoration, never loop something huge, nothing flashing faster than 1 Hz.
- Respect the setting: the app is wrapped in `MotionConfig`, so do not bypass it.
- SVG gotchas: do not animate `r` (use `scale` with `transformOrigin`), set `shrink-0` on small flex dots so they do not collapse to 0 width.

---

## 8. Background, grain, borders

- Background is plain `#000`. The grain is `body::after` at `opacity 0.09`, **static**, behind content (`z-index: 0`). Do not move it, animate it, raise it, or add another grain layer.
- Cards are solid so the grain never shows through text.
- Borders: 1px, white at 10 percent. Never thick, never coloured (except the state-tinted Hero and alert toasts).
- Shadows: none on cards. Only floating layers (menus, drawers, toasts, palette) get a deep black shadow.

---

## 9. Writing the UI copy

- Short, plain, human. A label is 1 to 3 words. A hint is one short sentence.
- Say what it is, not what it "leverages".
- Empty states explain what will appear and when. Example: "No process is carrying a tag. One appears here the moment it opens a protected file."
- Never write: "Unlock", "Seamless", "Powerful", "Supercharge", "Real-time insights", "Next-gen". No exclamation marks.
- Every status has **text plus colour**, never colour alone.

---

## 10. Things this project has already taught us (do not repeat)

- Tailwind config changes are not hot-reloaded by an already running `vite`. If a custom class (like `bg-signal-allow`) renders transparent, **restart the dev server**.
- WebSocket reconnect: tear down the old socket by clearing `wsRef` first, otherwise StrictMode opens two connections and every event shows twice.
- Event list keys must be stable and unique, otherwise rows blank out.
- A card that should match its neighbour's height needs `h-full` on the card **and** a grid parent.
- Lenis owns scrolling. For anchor jumps use `scrollToId`, not `scrollIntoView`.

---

## 11. Slop blacklist (instant reject)

- Wall of identical small cards with a coloured icon square in the corner
- Gradient text, rainbow borders, neon glows, glassmorphism everywhere
- `text-xs` grey paragraphs, tiny uppercase labels everywhere
- Random emoji, random illustrations, fake avatars of strangers
- Fake charts, fake percentages, "+12% vs last week"
- Different border radius on every card
- 5 nested divs to centre one icon
- A new colour or a new font "because it looked nice"
- Inline `style={{...}}` for things Tailwind handles (inline style is OK only for dynamic values like a state colour or computed position)

---

## 12. Recipes (copy these shapes)

**A standard card**
```tsx
<Reveal delay={0.4} className="flex h-full flex-col">
  <CardHeader index="03" title="Tagged processes" right={<span className="rounded-full border hairline px-3 py-1 font-mono text-[14px] text-zinc-300">2 live</span>} />
  <div className="px-6 pb-6">{/* content */}</div>
</Reveal>
```

**A label + value pair**
```tsx
<div>
  <div className="eyebrow">Mode</div>
  <div className="mt-1.5 text-xl text-white">Enforcing</div>
</div>
```

**A pill tab group with sliding highlight** (copy `ActivityChart.tsx` range switch).

**A row in a list** (copy `Processes.tsx` rows): `rounded-xl border border-transparent px-4 py-3.5 hover:border-white/10 hover:bg-white/[0.035]`.

**A floating menu** (copy `TopBar.tsx` `Menu`): `rounded-xl border border-white/15 bg-[#0a0a0a]` with the enter/exit scale and fade.

---

## 13. Before you say "done" (checklist)

1. `cd dashboard && npx tsc --noEmit` passes.
2. Look at it. Run `python3 mock_bridge.py` and `npx vite`, open it at 1440x900 **and** at about 1100px wide. Wait for the mock story to reach the **BLOCK** state (about 8 seconds) and check the red state too.
3. Every number on screen traces to a real event.
4. No text under 12.5px, no grey text darker than `zinc-500`.
5. All colours, fonts, radii come from this file.
6. Same spacing rhythm as the neighbouring cards.
7. Nothing overflows, nothing is clipped, long paths are truncated with a `title` tooltip.
8. Animations are smooth, and nothing jumps when data arrives.
9. You reused existing components instead of copy-pasting new ones.
10. Add one line to `dashboard/docs/devansh.md` section 10 (work log). Only sections 6, 9 and 10.

If any answer is "no", fix it before reporting.
