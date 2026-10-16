/**
 * Publications style their pages with the site's design classes, such as
 * `du-margin-top--8` or `dc-column-width--oneThird`, whose stylesheet is not
 * part of the file. Their names say what they do, so a rule is made for each
 * class a page uses: `du-{property}[-{side}][-{breakpoint}]--{value}`.
 */

/** Spacing steps are quarters of the reader's text size, as the names count them. */
const space = (v: string): string | null => {
  if (v === "none" || v === "0") return "0";
  if (v === "auto") return "auto";
  const neg = v.startsWith("negative-");
  const n = Number(neg ? v.slice(9) : v);
  if (!Number.isFinite(n)) return fraction(v);
  return `${neg ? -n * 0.25 : n * 0.25}em`;
};

const FRACTIONS: Record<string, number> = {
  full: 1,
  oneHalf: 1 / 2,
  oneThird: 1 / 3,
  twoThirds: 2 / 3,
  oneQuarter: 1 / 4,
  threeQuarters: 3 / 4,
  oneFifth: 1 / 5,
  twoFifths: 2 / 5,
  threeFifths: 3 / 5,
  fourFifths: 4 / 5,
  oneSixth: 1 / 6,
  oneEighth: 1 / 8,
  sevenEighths: 7 / 8,
};
const fraction = (v: string): string | null => (v in FRACTIONS ? `${+(FRACTIONS[v] * 100).toFixed(4)}%` : null);

const FONT_SIZES: Record<string, string> = {
  baseMinus2: "0.8em",
  baseMinus1: "0.9em",
  base: "1em",
  basePlus1: "1.125em",
  basePlus2: "1.3em",
  basePlus3: "1.5em",
};

/** Hue and saturation of each palette; the number after it (50–900) sets the lightness. */
const HUES: Record<string, [number, number]> = {
  gray: [220, 6],
  coolGray: [218, 12],
  warmGray: [30, 8],
  red: [356, 68],
  maroon: [345, 52],
  coral: [8, 72],
  orange: [24, 88],
  amber: [38, 90],
  gold: [42, 78],
  yellow: [48, 88],
  brown: [26, 34],
  lime: [78, 58],
  green: [138, 48],
  sage: [100, 14],
  jade: [160, 52],
  mint: [156, 40],
  teal: [184, 72],
  turquoise: [176, 58],
  cyan: [190, 78],
  blue: [212, 70],
  indigo: [234, 54],
  purple: [272, 46],
};
const LIGHTNESS: Record<number, number> = {
  50: 97,
  100: 93,
  200: 85,
  300: 75,
  400: 64,
  500: 54,
  600: 45,
  700: 37,
  800: 29,
  900: 22,
};
/** A light tint keeps its hue in the dark theme, but as a dark background. */
const DARK_TINT: Record<number, number> = { 50: 14, 100: 17, 200: 21, 300: 26 };

type Paint = { light: string; dark?: string };

/** A color by name, and how it changes in the dark theme. `fill` is for backgrounds. */
function paint(v: string, fill: boolean): Paint | null {
  const named: Record<string, Paint> = fill
    ? { white: { light: "#fff", dark: "var(--surface)" }, black: { light: "#000" } }
    : {
        white: { light: "#fff" },
        black: { light: "var(--text)" },
        textDefault: { light: "var(--text)" },
        textSubdued: { light: "var(--muted)" },
        borderDefault: { light: "var(--border)" },
      };
  if (v in named) return named[v];
  const m = /^([a-zA-Z]+)-(\d+)$/.exec(v);
  const hue = m && HUES[m[1].charAt(0).toLowerCase() + m[1].slice(1)];
  const shade = m ? Number(m[2]) : NaN;
  if (!hue || !(shade in LIGHTNESS)) return null;
  const [h, s] = hue;
  const light = `hsl(${h} ${s}% ${LIGHTNESS[shade]}%)`;
  if (fill) return { light, dark: shade in DARK_TINT ? `hsl(${h} ${Math.min(s, 40)}% ${DARK_TINT[shade]}%)` : undefined };
  // Dark text and lines turn light on the dark background.
  return { light, dark: shade >= 500 ? `hsl(${h} ${s}% ${LIGHTNESS[1000 - shade] ?? 64}%)` : undefined };
}

const SIDES: Record<string, string[]> = {
  top: ["top"],
  bottom: ["bottom"],
  left: ["left"],
  right: ["right"],
  inlineStart: ["inline-start"],
  inlineEnd: ["inline-end"],
  vertical: ["top", "bottom"],
  horizontal: ["inline-start", "inline-end"],
};
const sided = (prop: string, side: string | undefined) =>
  side ? (SIDES[side] ?? []).map((s) => `${prop}-${s}`) : [prop];

const LIST_TYPES: Record<string, string> = {
  none: "none",
  disc: "disc",
  circle: "circle",
  lowerAlpha: "lower-alpha",
  upperAlpha: "upper-alpha",
};

/** The width at which the site switches from its mobile to its desktop layout, in the reader's own width. */
const WIDE = "@container reader (min-width: 36rem)";
const NARROW = "@container reader (max-width: 35.99rem)";

/** Classes that styles.css already styles by hand, for the meeting workbook. */
const HANDLED = /^(du-color--(teal|gold|red|maroon)-[67]00|du-color--textSubdued|du-bgColor--bgSecondary|du-listStyleType--none|du-fontWeight--normal|dc-icon.*|dc-screenReaderText)$/;

type Decl = { decls: string; children?: boolean; dark?: string };

function declarations(prop: string, side: string | undefined, children: boolean, value: string): Decl | null {
  const set = (props: string[], v: string | null) => (v === null || !props.length ? null : props.map((p) => `${p}:${v}`).join(";"));
  switch (prop) {
    case "margin":
    case "padding": {
      const decls = set(sided(prop, side), space(value));
      return decls ? { decls, children } : null;
    }
    case "fontSize":
      return value in FONT_SIZES ? { decls: `font-size:${FONT_SIZES[value]}` } : null;
    case "fontWeight":
      return value === "bold" ? { decls: "font-weight:700" } : null;
    case "letterSpacing": {
      const n = Number(value);
      return Number.isFinite(n) ? { decls: `letter-spacing:${n * 0.0125}em` } : null;
    }
    case "textAlign":
      return ["center", "start", "end", "left", "right"].includes(value) ? { decls: `text-align:${value}` } : null;
    case "listStyleType":
      return value in LIST_TYPES ? { decls: `list-style-type:${LIST_TYPES[value]}` } : null;
    case "float":
      return value === "inlineStart" || value === "inlineEnd"
        ? { decls: `float:${value === "inlineStart" ? "left" : "right"};margin-${value === "inlineStart" ? "right" : "left"}:1em` }
        : null;
    case "clear":
      return value === "both" ? { decls: "clear:both" } : value === "inlineEnd" ? { decls: "clear:right" } : null;
    case "display":
      return value === "none" ? { decls: "display:none" } : null;
    case "width": {
      const w = fraction(value);
      return w ? { decls: `width:${w}` } : null;
    }
    case "borderRadius":
      return value === "circle" ? { decls: "border-radius:50%" } : null;
    case "borderStyle":
      return ["solid", "dashed", "dotted", "none"].includes(value)
        ? { decls: set(sided("border", side).map((p) => `${p}-style`), value)! }
        : null;
    case "borderWidth": {
      const n = Number(value);
      return Number.isFinite(n) ? { decls: set(sided("border", side).map((p) => `${p}-width`), `${n}px`)! } : null;
    }
    case "color":
    case "bgColor":
    case "borderColor": {
      const p = paint(value, prop === "bgColor");
      if (!p) return null;
      const props = prop === "color" ? ["color"] : prop === "bgColor" ? ["background-color"] : sided("border", side).map((s) => `${s}-color`);
      return { decls: set(props, p.light)!, dark: p.dark && set(props, p.dark)! };
    }
    default:
      return null;
  }
}

/** The CSS for one `du-` class, or null for a class it does not know. */
function duRule(cls: string): string | null {
  if (cls === "du-clearfix") return `.${cls}.${cls}{display:flow-root}`;
  const [name, value, extra] = cls.slice(3).split("--");
  if (value === undefined || extra !== undefined) return null;
  const parts = name.split("-");
  const prop = parts.shift()!;
  let children = false;
  let side: string | undefined;
  let bp: string | undefined;
  for (const p of parts) {
    if (p === "children") children = true;
    else if (p === "desktopOnly" || p === "mobileOnly") bp = p;
    else if (p in SIDES && !side) side = p;
    else return null;
  }
  const d = declarations(prop, side, children, value);
  if (!d) return null;
  // The class twice outweighs the reader's own rules for paragraphs and headings.
  const sel = `.${cls}.${cls}${d.children ? " > *" : ""}`;
  let css = `${sel}{${d.decls}}`;
  if (d.dark) css += `.dark ${sel}{${d.dark}}`;
  if (bp) css = `${bp === "desktopOnly" ? WIDE : NARROW}{${css}}`;
  return css;
}

const COLUMN_WIDTHS: Record<string, number> = Object.fromEntries(
  Object.entries(FRACTIONS).map(([k, v]) => [k, Math.round(v * 1000)]),
);

/** The CSS for one `dc-` layout class, or null. */
function dcRule(cls: string): string | null {
  const sel = `.${cls}.${cls}`;
  const [name, value] = cls.slice(3).split("--");
  switch (name) {
    case "columns":
      return `${sel}{display:flex;gap:1.5em}${sel} > *{flex:1 1 0;min-width:0}`;
    case "columns-desktopOnly":
      return `${WIDE}{${sel}{display:flex;gap:1.5em}${sel} > *{flex:1 1 0;min-width:0}}`;
    case "columns-mobileOnly":
      return `${NARROW}{${sel}{display:flex;gap:1em}${sel} > *{flex:1 1 0;min-width:0}}`;
    case "columns-order":
    case "columns-order-desktopOnly": {
      if (value !== "reverse") return null;
      const css = `${sel}{flex-direction:row-reverse}`;
      return name.endsWith("desktopOnly") ? `${WIDE}{${css}}` : css;
    }
    case "columns-verticalAlign":
      return value === "center" || value === "bottom" ? `${sel}{align-items:${value === "center" ? "center" : "flex-end"}}` : null;
    case "column-width":
    case "column-width-desktopOnly": {
      const w = value && COLUMN_WIDTHS[value];
      if (!w) return null;
      // Three times, so it outweighs the even share `dc-columns` gives each column.
      const css = `${sel}.${cls}{flex:${w} 1 0}`;
      return name.endsWith("desktopOnly") ? `${WIDE}{${css}}` : css;
    }
    case "table":
      return `${sel}{border-collapse:collapse;width:100%}${sel} :is(td,th){padding:0.4em 0.6em;vertical-align:top}`;
    case "table-border":
      return value === "rows"
        ? `${sel} tr + tr > *{border-top:1px solid var(--border)}`
        : value === "columns"
          ? `${sel} :is(td,th) + :is(td,th){border-left:1px solid var(--border)}`
          : null;
    case "button":
      return value === "primary"
        ? `${sel}{display:inline-block;padding:0.4em 1em;border-radius:6px;background:var(--brand);color:var(--brand-fg)}`
        : null;
    default:
      return name.startsWith("bgImageLayout") ? `${sel}{background-size:cover;background-position:center;background-repeat:no-repeat}` : null;
  }
}

/** The CSS for one class of a publication, or null when it is not a design class this knows. */
export function designRule(cls: string): string | null {
  if (HANDLED.test(cls)) return null;
  if (cls.startsWith("du-")) return duRule(cls);
  if (cls.startsWith("dc-")) return dcRule(cls);
  return null;
}

const seen = new Set<string>();
let style: HTMLStyleElement | null = null;

/** Adds the rules for the design classes in `root`, itself included, that no page has used yet. */
export function addDesignRules(root: Element, doc: Document = root.ownerDocument) {
  const rules: string[] = [];
  for (const el of [root, ...root.querySelectorAll('[class*="du-"], [class*="dc-"]')]) {
    el.classList.forEach((cls) => {
      if (seen.has(cls)) return;
      seen.add(cls);
      const rule = designRule(cls);
      if (rule) rules.push(rule);
    });
  }
  if (!rules.length) return;
  if (!style?.isConnected) {
    style = doc.createElement("style");
    style.dataset.designClasses = "";
    doc.head.append(style);
  }
  style.textContent += rules.join("\n") + "\n";
}

/** Keeps adding rules for every publication page put into `doc`, wherever it is shown. */
export function watchDesignClasses(doc: Document = document) {
  addDesignRules(doc.body, doc);
  const observer = new MutationObserver((records) => {
    for (const r of records)
      r.addedNodes.forEach((n) => n.nodeType === Node.ELEMENT_NODE && addDesignRules(n as Element, doc));
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** For tests: forget which classes have rules. */
export function resetDesignRules() {
  seen.clear();
  style?.remove();
  style = null;
}
