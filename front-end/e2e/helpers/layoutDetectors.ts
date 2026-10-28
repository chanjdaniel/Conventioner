/**
 * Layout detectors, run in the page: what a screen's geometry gets wrong, measured from the DOM.
 *
 * `detectLayout` is passed to `page.evaluate`, which serialises it, so it may reach nothing outside
 * its own body: every helper it uses is declared inside it. It returns every finding of every kind;
 * `GATING` names the kinds the layout sweep fails on, and the rest are reported beside the run.
 *
 * The kinds came out of T67's trial over the whole app, which also judged them on dev: the gating
 * kinds raised nothing false there, and the reported ones raise real drift buried in findings that
 * are by design (a centred card's empty band, a truncated name that carries its title), so only a
 * reviewer can triage them.
 */

/** The design language's scales (`docs/design-system.md`), in px. */
export const SPACE_SCALE = [2, 4, 8, 12, 16, 24, 32, 48];
export const TYPE_SCALE = [12, 14, 16, 20, 26, 32];

/** Narrower than this is a phone: a tap target under 24px fails there, and one under 44px is reported. */
export const PHONE_WIDTH = 600;

export interface DetectOptions {
  /** px values allowed for margin, padding and gap; 0 is always allowed. */
  spaceScale: number[];
  /** px font sizes allowed for text. */
  textScale: number[];
  /** px, the smallest tap target's width and height: WCAG 2.5.8's 24px. */
  minTarget: number;
  /**
   * px, the size a target on a phone is meant to reach (44px). Under it, and not under `minTarget`,
   * is a `tight-target`: reported, never failed on, until the phone controls are raised to it.
   */
  comfortableTarget?: number;
}

export interface Finding {
  kind: string;
  /** The element, as up to three `tag[testid].class` steps from its ancestors down. */
  el: string;
  /** The measurement. */
  detail: string;
  /** x, y (from the top of the page), width, height. */
  box: [number, number, number, number];
}

/** The kinds the sweep fails on; every other kind is reported beside the run. */
export const GATING = [
  'page-h-overflow',
  'outside-viewport',
  'child-outside-parent',
  'clipped-x',
  'clipped-y',
  'overlap',
  'squeezed-text',
  'off-scale-type',
];

/**
 * Whether the sweep fails on a finding at a window this wide. `small-target`, under WCAG 2.5.8's
 * 24px, only at phone width, where it is precise: on a desktop it is mostly hints inside larger
 * buttons. On a phone the gate is 24px, not the 44px a thumb wants, until the phone controls are
 * raised to 44px (Daniel, 2026-10-28); until then `tight-target` reports each one under 44px.
 */
export function gates(finding: Finding, width: number): boolean {
  if (finding.kind === 'small-target') return width < PHONE_WIDTH;
  return GATING.includes(finding.kind);
}

export function detectLayout(opts: DetectOptions): Finding[] {
  const findings: Finding[] = [];
  const de = document.documentElement;
  const vw = de.clientWidth;
  const root = document.body;

  // Nothing moves while the detectors read, so each element's style and box is read once: reading
  // them again for every pair and every ancestor made a long list take seconds.
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (el: Element): CSSStyleDeclaration => {
    let cs = styles.get(el);
    if (!cs) styles.set(el, (cs = getComputedStyle(el)));
    return cs;
  };
  const rects = new Map<Element, DOMRect>();
  const rectOf = (el: Element): DOMRect => {
    let r = rects.get(el);
    if (!r) rects.set(el, (r = el.getBoundingClientRect()));
    return r;
  };

  const label = (el: Element): string => {
    const tid = el.getAttribute('data-testid');
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    return `${el.tagName.toLowerCase()}${tid ? `[${tid}]` : ''}${cls ? `.${cls}` : ''}`;
  };
  const path = (el: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = el;
    for (let i = 0; cur && cur !== document.body && i < 3; i++, cur = cur.parentElement) {
      parts.unshift(label(cur));
    }
    return parts.join(' > ');
  };
  const box = (r: DOMRect): [number, number, number, number] => [
    Math.round(r.left),
    Math.round(r.top + scrollY),
    Math.round(r.width),
    Math.round(r.height),
  ];
  const push = (kind: string, el: Element, detail: string) =>
    findings.push({ kind, el: path(el), detail, box: box(rectOf(el)) });

  const shown = (cs: CSSStyleDeclaration, r: DOMRect) =>
    r.width > 0 &&
    r.height > 0 &&
    cs.visibility !== 'hidden' &&
    cs.display !== 'none' &&
    parseFloat(cs.opacity) > 0;
  // Drawn for a screen reader only: clipped to a pixel on purpose (`.visually-hidden`).
  const readerOnly = new Map<Element, boolean>();
  const forScreenReaders = (el: Element | null): boolean => {
    if (!el || el === document.body) return false;
    let known = readerOnly.get(el);
    if (known === undefined) {
      const r = rectOf(el);
      known =
        (r.width <= 1 && r.height <= 1 && styleOf(el).position === 'absolute') ||
        forScreenReaders(el.parentElement);
      readerOnly.set(el, known);
    }
    return known;
  };
  const inertOrHidden = (el: Element) =>
    !!el.closest('[inert],[aria-hidden="true"],#__vue-devtools-container__') ||
    (!!el.closest('details:not([open])') && !el.closest('summary')) ||
    forScreenReaders(el);
  const ownText = (el: Element) =>
    Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0,
    );
  const near = (v: number, scale: number[]) => scale.some((s) => Math.abs(s - v) < 0.5);
  // The boxes the element's own text is drawn in: a heading's box may span a row its words do not.
  const textRects = (el: Element): DOMRect[] => {
    const rects: DOMRect[] = [];
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== 3 || !(n.textContent || '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      rects.push(...Array.from(range.getClientRects()).filter((x) => x.width > 0 && x.height > 0));
    }
    // What its own clipping box hides (an ellipsis, a clamp) is not drawn.
    const cs = styleOf(el);
    if (!/hidden|clip/.test(cs.overflowX + cs.overflowY)) return rects;
    const b = rectOf(el);
    return rects
      .map(
        (x) =>
          new DOMRect(
            Math.max(x.left, b.left),
            Math.max(x.top, b.top),
            Math.min(x.right, b.right) - Math.max(x.left, b.left),
            Math.min(x.bottom, b.bottom) - Math.max(x.top, b.top),
          ),
      )
      .filter((x) => x.width > 0 && x.height > 0);
  };
  const descendantTextRects = (el: Element): DOMRect[] => {
    const rects: DOMRect[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n.textContent || '').trim()) continue;
      if (n.parentElement && inertOrHidden(n.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      rects.push(...Array.from(range.getClientRects()).filter((x) => x.width > 0 && x.height > 0));
    }
    return rects;
  };
  // A popover, menu, dialog or stuck bar: drawn over the page on purpose.
  const layers = new Map<Element, Element | null>();
  const layer = (el: Element | null): Element | null => {
    if (!el || el === document.body) return null;
    if (layers.has(el)) return layers.get(el)!;
    const p = styleOf(el).position;
    const own =
      p === 'absolute' ||
      p === 'fixed' ||
      p === 'sticky' ||
      el.matches('dialog,[role=dialog],[role=menu],[role=listbox],[popover]');
    const found = own ? el : layer(el.parentElement);
    layers.set(el, found);
    return found;
  };
  // Hidden by a clipping ancestor (a collapsed panel): nothing of it shows.
  const clippers = new Map<Element, DOMRect[]>();
  const clipsAbove = (el: Element | null): DOMRect[] => {
    if (!el || el === document.body) return [];
    let found = clippers.get(el);
    if (!found) {
      const cs = styleOf(el);
      const own = /hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY) ? [rectOf(el)] : [];
      clippers.set(el, (found = [...own, ...clipsAbove(el.parentElement)]));
    }
    return found;
  };
  const clippedAway = (r: DOMRect, el: Element): boolean =>
    clipsAbove(el.parentElement).some(
      (c) =>
        r.bottom <= c.top + 1 ||
        r.top >= c.bottom - 1 ||
        r.right <= c.left + 1 ||
        r.left >= c.right - 1,
    );

  if (de.scrollWidth > de.clientWidth + 1) {
    findings.push({
      kind: 'page-h-overflow',
      el: 'html',
      detail: `page is ${de.scrollWidth - de.clientWidth}px wider than the ${de.clientWidth}px window`,
      box: [0, 0, de.scrollWidth, 0],
    });
  }

  const all = [root, ...Array.from(root.querySelectorAll('*'))].filter(
    (el) => !(el instanceof SVGElement) || el.tagName.toLowerCase() === 'svg',
  );
  const leaves: { el: Element; r: DOMRect }[] = [];

  const shownEls = new Set<Element>();
  for (const el of all) {
    if (inertOrHidden(el)) continue;
    const cs = styleOf(el);
    const r = rectOf(el);
    if (!shown(cs, r)) continue;
    shownEls.add(el);
    const tag = el.tagName.toLowerCase();
    if (tag === 'svg') {
      leaves.push({ el, r });
      continue;
    }
    const dx = el.scrollWidth - el.clientWidth;
    const dy = el.scrollHeight - el.clientHeight;
    const isTextControl = tag === 'input' || tag === 'textarea' || tag === 'select';

    // Content cut off by its own box.
    if (cs.textOverflow === 'ellipsis' && dx > 0) {
      push(
        'truncated-text',
        el,
        `${dx}px hidden behind an ellipsis${el.getAttribute('title') ? ', has a title' : ', NO title'}`,
      );
    } else if (!isTextControl && /hidden|clip/.test(cs.overflowX) && dx > 1) {
      const cut = Math.max(0, ...descendantTextRects(el).map((x) => x.right - r.right));
      if (cut > 1) push('clipped-x', el, `text cut off ${Math.round(cut)}px past the right edge`);
    }
    const clamped =
      cs.textOverflow === 'ellipsis' || cs.getPropertyValue('-webkit-line-clamp') !== 'none';
    if (!isTextControl && !clamped && /hidden|clip/.test(cs.overflowY) && dy > 1) {
      const cut = Math.max(0, ...descendantTextRects(el).map((x) => x.bottom - r.bottom));
      if (cut > 1) push('clipped-y', el, `text cut off ${Math.round(cut)}px past the bottom edge`);
    }
    if (
      el !== de &&
      el !== document.body &&
      !isTextControl &&
      /auto|scroll/.test(cs.overflowY) &&
      dy > 1
    ) {
      push('nested-scroller', el, `scrolls ${dy}px of its own content vertically`);
    }
    if (!isTextControl && /auto|scroll/.test(cs.overflowX) && dx > 1) {
      push('nested-scroller-x', el, `scrolls ${dx}px of its own content horizontally`);
    }

    // A child that leaves its parent's box, the parent letting it show.
    if (cs.overflowX === 'visible' && cs.display !== 'inline' && cs.display !== 'contents') {
      for (const child of Array.from(el.children)) {
        const ccs = styleOf(child);
        if (/absolute|fixed/.test(ccs.position) || ccs.display === 'none' || inertOrHidden(child))
          continue;
        const cr = rectOf(child);
        if (cr.width === 0 || cr.height === 0) continue;
        const over = Math.max(cr.right - r.right, r.left - cr.left);
        if (over > 1)
          push('child-outside-parent', child, `${Math.round(over)}px outside ${label(el)}`);
      }
    }

    // Off the window sideways, and not inside a horizontal scroller.
    if ((r.right > vw + 1 || r.left < -1) && cs.position !== 'fixed') {
      let scroller: Element | null = el.parentElement;
      while (scroller && !/auto|scroll|hidden|clip/.test(styleOf(scroller).overflowX))
        scroller = scroller.parentElement;
      if (!scroller || scroller === de || scroller === document.body) {
        push(
          'outside-viewport',
          el,
          `spans x ${Math.round(r.left)} to ${Math.round(r.right)} in a ${vw}px window`,
        );
      }
    }

    // Spacing and type off the design system's scales.
    const off: string[] = [];
    for (const prop of [
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'row-gap',
      'column-gap',
    ]) {
      const v = Math.abs(parseFloat(cs.getPropertyValue(prop)));
      if (!Number.isFinite(v) || v === 0) continue;
      if (/gap/.test(prop) && !/flex|grid/.test(cs.display)) continue;
      // Equal side margins on a block are almost always `margin: auto` centring.
      if (/margin-(left|right)/.test(prop) && cs.marginLeft === cs.marginRight) continue;
      if (!near(v, opts.spaceScale)) off.push(`${prop} ${+v.toFixed(2)}px`);
    }
    if (off.length) push('off-scale-space', el, off.join(', '));
    if (ownText(el)) {
      const fs = parseFloat(cs.fontSize);
      if (!near(fs, opts.textScale)) push('off-scale-type', el, `font-size ${fs}px`);
      const trs = textRects(el);
      for (const tr of trs) leaves.push({ el, r: tr });
      // Text squeezed into a column too narrow for it: three or more lines of a few letters each.
      const lines = new Set(trs.map((x) => Math.round(x.top))).size;
      const chars = (el.textContent || '').trim().length;
      if (lines >= 3 && chars / lines <= 10)
        push(
          'squeezed-text',
          el,
          `${chars} characters over ${lines} lines in ${Math.round(r.width)}px`,
        );
    } else if (/^(img|input|select|textarea|button|canvas|video)$/.test(tag)) {
      leaves.push({ el, r });
    }

    // Tap targets. A link inside a run of text is exempt (WCAG 2.5.8's inline exception), and a
    // control's label is a target for it too: tapping "Gold" ticks the 20px box beside it.
    if (
      el.matches(
        'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch]',
      )
    ) {
      const inlineLink = tag === 'a' && el.parentElement && ownText(el.parentElement);
      // Only a label someone can see and tap: a hidden or inert one saves nothing.
      const labels = (el as HTMLInputElement).labels
        ? Array.from((el as HTMLInputElement).labels!)
            .filter((label) => !inertOrHidden(label) && shown(styleOf(label), rectOf(label)))
            .map(rectOf)
        : [];
      const reaches = (size: number) =>
        [r, ...labels].some((x) => x.width >= size && x.height >= size);
      const measured = `${Math.round(r.width)}x${Math.round(r.height)}px${labels.length ? ' and its label' : ''}`;
      if (inlineLink) {
        // Exempt.
      } else if (!reaches(opts.minTarget)) {
        push('small-target', el, `${measured}, under ${opts.minTarget}px`);
      } else if (opts.comfortableTarget && !reaches(opts.comfortableTarget)) {
        push('tight-target', el, `${measured}, under ${opts.comfortableTarget}px`);
      }
    }

    // Siblings of one kind spaced unevenly, and left edges that nearly line up.
    const kids = Array.from(el.children).filter((c) => {
      const ccs = styleOf(c);
      return !/absolute|fixed/.test(ccs.position) && ccs.display !== 'none' && rectOf(c).height > 0;
    });
    if (kids.length >= 3) {
      const key = (c: Element) =>
        `${c.tagName}.${typeof c.className === 'string' ? c.className.trim().split(/\s+/)[0] : ''}`;
      const same = kids.filter((c) => key(c) === key(kids[1]));
      if (same.length >= 3) {
        const rects = same.map((c) => rectOf(c));
        const row =
          /flex/.test(cs.display) &&
          !cs.flexDirection.startsWith('column') &&
          rects.every((x) => Math.abs(x.top - rects[0].top) < 2);
        const col = rects.every((x, i) => i === 0 || x.top >= rects[i - 1].bottom - 1);
        if (row || col) {
          const gaps = rects
            .slice(1)
            .map((x, i) => Math.round(row ? x.left - rects[i].right : x.top - rects[i].bottom));
          const spread = Math.max(...gaps) - Math.min(...gaps);
          if (spread > 2 && gaps.length >= 2)
            push(
              'uneven-gaps',
              el,
              `${row ? 'row' : 'column'} gaps ${gaps.slice(0, 8).join('/')}px`,
            );
        }
      }
    }
    if (kids.length >= 2) {
      const lefts = kids
        .map((c) => rectOf(c))
        .filter((x) => x.width > 0)
        .map((x) => Math.round(x.left));
      const distinct = [...new Set(lefts)].sort((a, b) => a - b);
      for (let i = 1; i < distinct.length; i++) {
        const d = distinct[i] - distinct[i - 1];
        if (d > 0 && d <= 4) {
          push(
            'near-miss-left',
            el,
            `children start at x ${distinct[i - 1]} and ${distinct[i]} (${d}px apart)`,
          );
          break;
        }
      }
    }

    // A card with a band of nothing at its bottom.
    const card =
      cs.boxShadow !== 'none' ||
      (cs.borderTopStyle !== 'none' &&
        parseFloat(cs.borderTopWidth) > 0 &&
        cs.backgroundColor !== 'rgba(0, 0, 0, 0)');
    if (card && r.width * r.height > 40000 && kids.length) {
      const contentBottom = Math.max(...kids.map((c) => rectOf(c).bottom));
      const empty =
        r.bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth) - contentBottom;
      if (empty > 96) push('empty-card-band', el, `${Math.round(empty)}px empty under its content`);
    }
  }

  // Overlapping leaves: text, controls and images drawn over one another in the same layer.
  const L = leaves
    .filter(
      (x) =>
        shownEls.has(x.el) &&
        !/fixed|sticky/.test(styleOf(x.el).position) &&
        !clippedAway(x.r, x.el),
    )
    .slice(0, 4000);
  L.sort((a, b) => a.r.left - b.r.left);
  let overlaps = 0;
  for (let i = 0; i < L.length && overlaps < 50; i++) {
    for (let j = i + 1; j < L.length && L[j].r.left < L[i].r.right; j++) {
      const a = L[i];
      const b = L[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (layer(a.el) !== layer(b.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 2 && h > 2) {
        overlaps++;
        findings.push({
          kind: 'overlap',
          el: `${path(a.el)} ~ ${path(b.el)}`,
          detail: `${Math.round(w)}x${Math.round(h)}px overlap`,
          box: box(a.r),
        });
      }
    }
  }

  // Text that nearly shares a left edge with the line above it: 1 to 4px apart reads as a slip.
  const starts = L.filter((x) => ownText(x.el) && !/center|right|end/.test(styleOf(x.el).textAlign))
    .map((x) => ({ el: x.el, left: x.r.left, top: x.r.top, bottom: x.r.bottom }))
    .sort((a, b) => a.top - b.top);
  let slips = 0;
  for (let i = 0; i < starts.length && slips < 20; i++) {
    for (let j = i + 1; j < starts.length && starts[j].top - starts[i].bottom < 60; j++) {
      const d = Math.abs(starts[j].left - starts[i].left);
      if (
        starts[j].top >= starts[i].bottom - 1 &&
        d >= 1 &&
        d <= 4 &&
        starts[i].el !== starts[j].el
      ) {
        slips++;
        findings.push({
          kind: 'text-edge-slip',
          el: `${path(starts[i].el)} | ${path(starts[j].el)}`,
          detail: `left edges ${Math.round(starts[i].left)} and ${Math.round(starts[j].left)} (${d.toFixed(1)}px)`,
          box: box(new DOMRect(starts[j].left, starts[j].top, 0, starts[j].bottom - starts[j].top)),
        });
        break;
      }
    }
  }

  // Bands of nothing across the page, between content.
  const spans = leaves
    .map((x) => [x.r.top + scrollY, x.r.bottom + scrollY])
    .sort((a, b) => a[0] - b[0]);
  let reach = spans.length ? spans[0][1] : 0;
  for (const [t, b] of spans) {
    if (t - reach > 200)
      findings.push({
        kind: 'empty-band',
        el: 'page',
        detail: `${Math.round(t - reach)}px with no content, y ${Math.round(reach)} to ${Math.round(t)}`,
        box: [0, Math.round(reach), vw, Math.round(t - reach)],
      });
    reach = Math.max(reach, b);
  }
  return findings;
}

/** A screen size at which some market screens put the market bar somewhere the others do not. */
export interface MisplacedBars {
  width: number;
  /** Where most screens of that size put it. */
  usual: string;
  /** Each screen that put it elsewhere, and where. */
  apart: string[];
}

/**
 * The market bar must stand at one x and width on every market screen of one size (bug 12: the
 * frame at x 0 on the floorplan, x 16 elsewhere), which no screen can see alone. `bars` is, by
 * window width, each screen's bar as [x, width].
 */
export function misplacedBars(bars: Map<number, Map<string, [number, number]>>): MisplacedBars[] {
  const misplaced: MisplacedBars[] = [];
  for (const [width, placed] of bars) {
    const ways = new Map<string, string[]>();
    for (const [state, [x, w]] of placed) {
      const key = `x ${x}, width ${w}`;
      ways.set(key, [...(ways.get(key) ?? []), state]);
    }
    const [usual] = [...ways.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const apart = [...ways.entries()]
      .filter(([key]) => key !== usual)
      .flatMap(([key, states]) => states.map((s) => `${s}: ${key}`));
    if (apart.length) misplaced.push({ width, usual, apart });
  }
  return misplaced;
}
