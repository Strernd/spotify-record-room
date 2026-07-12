import type { AlbumSummary } from '@/lib/spotify-contracts';

type Rgb = [number, number, number];
type ColorBucket = { red: number; green: number; blue: number; weight: number };

function hashColor(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
  }

  return `hsl(${Math.abs(hash) % 360} 46% 38%)`;
}

function parseColor(color: string): Rgb | null {
  const hex = color.match(/^#([\da-f]{6})$/i);
  if (hex) {
    return [
      Number.parseInt(hex[1].slice(0, 2), 16),
      Number.parseInt(hex[1].slice(2, 4), 16),
      Number.parseInt(hex[1].slice(4, 6), 16),
    ];
  }

  const hsl = color.match(/^hsl\((\d+)\s+(\d+)%\s+(\d+)%\)$/i);
  if (!hsl) return null;

  const hue = Number(hsl[1]) / 360;
  const saturation = Number(hsl[2]) / 100;
  const lightness = Number(hsl[3]) / 100;
  const convert = (offset: number) => {
    const channel = (offset + hue) % 1;
    const amount = saturation * Math.min(lightness, 1 - lightness);
    const component = lightness - amount * Math.max(-1, Math.min(channel * 12 - 3, 9 - channel * 12, 1));
    return Math.round(component * 255);
  };

  return [convert(0), convert(8 / 12), convert(4 / 12)];
}

function relativeLuminance(rgb: Rgb): number {
  return rgb.reduce((sum, value, index) => {
    const channel = value / 255;
    const linear = channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function contrastRatio(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function contrastColor(background: string): '#14110f' | '#fffaf0' {
  const backgroundRgb = parseColor(background);
  if (!backgroundRgb) return '#fffaf0';

  const backgroundLuminance = relativeLuminance(backgroundRgb);
  const darkContrast = contrastRatio(backgroundLuminance, relativeLuminance([20, 17, 15]));
  const lightContrast = contrastRatio(backgroundLuminance, relativeLuminance([255, 250, 240]));
  return darkContrast >= lightContrast ? '#14110f' : '#fffaf0';
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

export async function extractSpineColor(album: AlbumSummary): Promise<string> {
  if (!album.imageUrl) return hashColor(album.id);

  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 40;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(hashColor(album.id));

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const buckets = new Map<string, ColorBucket>();

        for (let index = 0; index < pixels.length; index += 16) {
          const alpha = pixels[index + 3] / 255;
          if (alpha < 0.1) continue;

          const red = pixels[index];
          const green = pixels[index + 1];
          const blue = pixels[index + 2];
          const maximum = Math.max(red, green, blue);
          const minimum = Math.min(red, green, blue);
          const saturation = (maximum - minimum) / 255;
          const lightness = (maximum + minimum) / 510;
          const midtoneBoost = 1 - Math.abs(lightness - 0.5);
          const weight = alpha * (0.7 + saturation) * (0.75 + midtoneBoost * 0.35);
          const key = `${red >> 4}-${green >> 4}-${blue >> 4}`;
          const bucket = buckets.get(key) ?? { red: 0, green: 0, blue: 0, weight: 0 };
          bucket.red += red * weight;
          bucket.green += green * weight;
          bucket.blue += blue * weight;
          bucket.weight += weight;
          buckets.set(key, bucket);
        }

        const dominant = [...buckets.values()].reduce<ColorBucket | null>(
          (best, bucket) => (!best || bucket.weight > best.weight ? bucket : best),
          null,
        );
        resolve(
          dominant
            ? rgbToHex(
                dominant.red / dominant.weight,
                dominant.green / dominant.weight,
                dominant.blue / dominant.weight,
              )
            : hashColor(album.id),
        );
      } catch {
        resolve(hashColor(album.id));
      }
    };
    image.onerror = () => resolve(hashColor(album.id));
    image.src = album.imageUrl;
  });
}
