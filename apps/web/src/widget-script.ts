// The Scriptable script the user pastes into the Scriptable app: draws the silos.
export function widgetScript(origin: string, token: string): string {
  return `// critiCal — silos (widget de Scriptable)
// Pegalo en Scriptable, agregá un widget de Scriptable y elegí este script.
const TOKEN = ${JSON.stringify(token)};
const URL = ${JSON.stringify(`${origin}/api/widget`)};

const req = new Request(URL);
req.headers = { Authorization: "Bearer " + TOKEN };
let silos = [];
try {
  silos = (await req.loadJSON()).silos || [];
} catch (e) {}

const family = config.widgetFamily || "medium";
const max = family === "small" ? 3 : family === "large" ? 8 : 5;
const W = family === "small" ? 155 : 330;
const H = family === "large" ? 330 : 155;
const RED = new Color("#E0262E");
const YELLOW = new Color("#FFC400");
const ink = Color.dynamic(new Color("#1c1c1e"), new Color("#f2f2f4"));
const soft = Color.dynamic(new Color("#8e8e93"), new Color("#9a9aa3"));
const hours = (m) => (m >= 60 ? Math.round(m / 6) / 10 + " h" : Math.round(m) + " min");

const ctx = new DrawContext();
ctx.size = new Size(W, H);
ctx.opaque = false;
ctx.respectScreenScale = true;
const shown = silos.slice(0, max);
const col = W / Math.max(1, shown.length);
shown.forEach((s, i) => {
  const x = i * col + col * 0.2;
  const w = col * 0.6;
  const top = 18;
  const h = H - 54;
  const ratio = s.totalMinutes > 0 ? Math.min(1, s.remainingMinutes / s.totalMinutes) : 0;
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
  ctx.drawTextInRect(hours(s.remainingMinutes), new Rect(i * col, 2, col, 14));
  ctx.setFont(Font.systemFont(9));
  ctx.setTextColor(soft);
  ctx.drawTextInRect(s.title, new Rect(i * col + 2, H - 32, col - 4, 30));
});

const widget = new ListWidget();
widget.setPadding(8, 8, 8, 8);
if (shown.length === 0) {
  const t = widget.addText("Todo al día ✓");
  t.font = Font.semiboldSystemFont(14);
  t.textColor = ink;
} else {
  widget.addImage(ctx.getImage());
}
widget.url = ${JSON.stringify(`${origin}/?tab=silos`)};
widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
Script.setWidget(widget);
Script.complete();
`;
}
