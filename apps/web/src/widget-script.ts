// The Scriptable script the user pastes into the Scriptable app. It only paints what the
// server sends ready (`mode`, `style`, `rows`, `empty`): new content needs no new paste.
export function widgetScript(origin: string, token: string): string {
  return `// critiCal — widget de Scriptable (silos o Bandeja)
// Pegalo en Scriptable, agregá un widget de Scriptable y elegí este script.
// Para el widget de la Bandeja, escribí «bandeja» en su Parameter.
const TOKEN = ${JSON.stringify(token)};
const INBOX = String(args.widgetParameter || "").trim().toLowerCase() === "bandeja";
const URL = ${JSON.stringify(`${origin}/api/widget`)} + (INBOX ? "?view=inbox" : "");
const STALE_MIN = 45;

// The last good answer is kept: offline, the widget says how old it is instead of
// pretending it is fresh, and never shows «todo al día» for data it could not read.
const fm = FileManager.local();
const cache = fm.joinPath(fm.documentsDirectory(), "critical-widget" + (INBOX ? "-bandeja" : "") + ".json");
let body = null;
let cached = false;
try {
  const req = new Request(URL);
  req.headers = { Authorization: "Bearer " + TOKEN };
  req.timeoutInterval = 20;
  const got = await req.loadJSON();
  if (Array.isArray(got.silos)) {
    body = got;
    fm.writeString(cache, JSON.stringify(got));
  }
} catch (e) {}
if (!body) {
  try {
    body = JSON.parse(fm.readString(cache));
    cached = true;
  } catch (e) {}
}

const family = config.widgetFamily || "medium";
const W = family === "small" ? 155 : 330;
const H = family === "large" ? 330 : 155;
const RED = new Color("#E0262E");
const YELLOW = new Color("#FFC400");
const ink = Color.dynamic(new Color("#1c1c1e"), new Color("#f2f2f4"));
const soft = Color.dynamic(new Color("#8e8e93"), new Color("#9a9aa3"));
const hours = (m) => (m >= 60 ? Math.round(m / 6) / 10 + " h" : Math.round(m) + " min");
const ago = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? m + " min" : m < 1440 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " d";
};

// Rows as the server sends them; a server from before «rows» only has the silos.
let rows = [];
let style = "tanks";
let empty = "Todo al día ✓";
let mode = "silos";
let minutes = 5;
let total = 0;
if (body) {
  mode = body.mode || "silos";
  style = body.style || "tanks";
  if (typeof body.empty === "string") empty = body.empty;
  if (typeof body.refreshMinutes === "number") minutes = Math.min(60, Math.max(5, body.refreshMinutes));
  total = typeof body.total === "number" ? body.total : 0;
  rows = Array.isArray(body.rows)
    ? body.rows
    : body.silos.map((s) => ({
        title: s.title,
        detail: hours(s.remainingMinutes),
        color: s.color,
        level: s.level,
        ratio: s.totalMinutes > 0 ? Math.min(1, s.remainingMinutes / s.totalMinutes) : 0,
      }));
}
total = Math.max(total, rows.length);
const age = body && typeof body.updatedAt === "number" ? Date.now() - body.updatedAt : 0;
const old = body && (cached || age > STALE_MIN * 60000);

const widget = new ListWidget();
widget.setPadding(8, 8, 8, 8);
if (!body) {
  // Never "all clear" when the data could not be read (revoked token, offline…).
  const t = widget.addText("critiCal: no pude actualizar");
  t.font = Font.semiboldSystemFont(13);
  t.textColor = RED;
} else {
  if (rows.length === 0) {
    const t = widget.addText(empty);
    t.font = Font.semiboldSystemFont(14);
    t.textColor = ink;
  } else if (style === "list") {
    const max = family === "small" ? 2 : family === "large" ? 7 : 3;
    if (mode === "inbox") {
      const h = widget.addText("Bandeja · " + total);
      h.font = Font.semiboldSystemFont(12);
      h.textColor = soft;
    }
    rows.slice(0, max).forEach((r) => {
      widget.addSpacer(4);
      const t = widget.addText(r.title);
      t.font = Font.semiboldSystemFont(12);
      t.textColor = ink;
      t.lineLimit = 1;
      const d = widget.addText(r.detail || "");
      d.font = Font.systemFont(10);
      d.textColor = r.level === "critical" ? RED : r.level === "warn" ? YELLOW : soft;
      d.lineLimit = 1;
    });
    if (total > max) {
      widget.addSpacer(4);
      const more = widget.addText("y " + (total - max) + " más");
      more.font = Font.systemFont(10);
      more.textColor = soft;
    }
  } else {
    const max = family === "small" ? 3 : family === "large" ? 8 : 5;
    const ctx = new DrawContext();
    ctx.size = new Size(W, H);
    ctx.opaque = false;
    ctx.respectScreenScale = true;
    const shown = rows.slice(0, max);
    const col = W / Math.max(1, shown.length);
    shown.forEach((s, i) => {
      const x = i * col + col * 0.2;
      const w = col * 0.6;
      const top = 18;
      const h = H - 54;
      const ratio = s.ratio || 0;
      const tank = new Path();
      tank.addRoundedRect(new Rect(x, top, w, h), 8, 8);
      ctx.addPath(tank);
      ctx.setStrokeColor(s.level === "critical" ? RED : s.level === "warn" ? YELLOW : soft);
      ctx.setLineWidth(2);
      ctx.strokePath();
      const fill = new Path();
      fill.addRoundedRect(new Rect(x, top + h * (1 - ratio), w, h * ratio), 8, 8);
      ctx.addPath(fill);
      ctx.setFillColor(new Color(s.color, 0.85));
      ctx.fillPath();
      ctx.setFont(Font.semiboldSystemFont(10));
      ctx.setTextColor(ink);
      ctx.setTextAlignedCenter();
      ctx.drawTextInRect(s.detail || "", new Rect(i * col, 2, col, 14));
      ctx.setFont(Font.systemFont(9));
      ctx.setTextColor(soft);
      ctx.drawTextInRect(s.title, new Rect(i * col + 2, H - 32, col - 4, 30));
    });
    widget.addImage(ctx.getImage());
  }
  if (old) {
    // Old data says so: «Sin conexión» when this is the saved copy, else just how old it is.
    widget.addSpacer(2);
    const t = widget.addText((cached ? "Sin conexión · " : "") + "datos de hace " + ago(age));
    t.font = Font.systemFont(9);
    t.textColor = YELLOW;
  }
}
widget.url = ${JSON.stringify(`${origin}/?tab=`)} + (INBOX || mode === "inbox" ? "inbox" : "silos");
// iOS decides when to refresh; this only asks for it soon.
widget.refreshAfterDate = new Date(Date.now() + minutes * 60 * 1000);
Script.setWidget(widget);
Script.complete();
`;
}
