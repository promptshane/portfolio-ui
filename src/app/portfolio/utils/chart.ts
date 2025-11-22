export const VIEW_W = 1000;
export const VIEW_H = 300;
export const PAD = 12;

export const mapX = (t: number) => PAD + t * (VIEW_W - 2 * PAD);
export const mapY = (t: number) => PAD + t * (VIEW_H - 2 * PAD);

export function toPathPx(pts: Array<[number, number]>) {
  if (!pts || pts.length < 2) return "";
  const [x0, y0] = [mapX(pts[0][0]), mapY(pts[0][1])];
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < pts.length; i++) {
    const x = mapX(pts[i][0]);
    const y = mapY(pts[i][1]);
    d += ` L ${x} ${y}`;
  }
  return d;
}

export function yForValue(v: number, min: number, max: number) {
  return mapY(1 - (v - min) / Math.max(1e-9, max - min));
}
