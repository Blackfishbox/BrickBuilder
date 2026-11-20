import { Color, SRGBColorSpace } from "three";
import { SvgBytes, SvgFaces } from "./svg-export-buffer";

/** Gouraud diffuse illumination, interpolated in linear light by SVG itself. */
export function surfaceStyle(f: SvgFaces, id: number, bytes: SvgBytes): { style: string; plane: string } {
  const x = f.get(id, 0), y = f.get(id, 1);
  const ux = f.get(id, 2) - x, uy = f.get(id, 3) - y;
  const vx = f.get(id, 4) - x, vy = f.get(id, 5) - y;
  const determinant = ux * vy - uy * vx;
  const plane = [0, 1, 2].map(k => f.get(id, 9 + k));
  const dz1 = plane[1] - plane[0], dz2 = plane[2] - plane[0];
  const zx = (dz1 * vy - uy * dz2) / determinant;
  const zy = (ux * dz2 - dz1 * vx) / determinant;
  const planeKey = [zx, zy, plane[0] - zx * x - zy * y].map(v => v.toFixed(10)).join(",");
  const values = [f.get(id, 12), f.get(id, 13), f.get(id, 14)];
  const base = new Color(f.get(id, 7));
  const emission = new Color(f.get(id, 16));
  const hex = (shade: number) => `#${base.clone().multiplyScalar(shade).add(emission).getHexString(SRGBColorSpace)}`;
  const alpha = f.get(id, 8);
  const opacity = alpha < 1 ? ` fill-opacity="${Number(alpha.toFixed(4))}"` : "";
  const min = Math.min(...values), max = Math.max(...values);
  if (max - min < 1e-5) return { style: ` fill="${hex(values[0])}"${opacity}`, plane: planeKey };
  const du = values[1] - values[0], dv = values[2] - values[0];
  const gx = (du * vy - uy * dv) / determinant;
  const gy = (ux * dv - du * vx) / determinant;
  const norm = gx * gx + gy * gy;
  const first = values.indexOf(min);
  const x1 = f.get(id, first * 2), y1 = f.get(id, first * 2 + 1);
  const x2 = x1 + gx * (max - min) / norm, y2 = y1 + gy * (max - min) / norm;
  const n = (v: number) => Number(v.toFixed(6));
  const name = `g${id}`;
  bytes.append(`<defs><linearGradient id="${name}" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" color-interpolation="linearRGB"><stop stop-color="${hex(min)}"/><stop offset="1" stop-color="${hex(max)}"/></linearGradient></defs>`);
  return { style: ` fill="url(#${name})"${opacity}`, plane: planeKey };
}
