import * as THREE from "three";

/**
 * A sign over a stop you have collected, saying what you stored there.
 *
 * This is the method of loci made visible: the place and the thing are meant
 * to become one memory, and walking back past "the lighthouse" and seeing the
 * question you answered there is the association being rehearsed. It shows the
 * question, never the answer — the cue, not the spoiler.
 */

const WIDTH = 512;
const HEIGHT = 150;
const MAX_LINE = 34;

function wrap(text: string) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;

    if (next.length > MAX_LINE && line) {
      lines.push(line);
      line = word;
      if (lines.length === 2) break;
    } else {
      line = next;
    }
  }
  if (lines.length < 2 && line) lines.push(line);

  const shown = lines.slice(0, 2);
  const used = shown.join(" ").length;

  if (used < text.replace(/\s+/g, " ").trim().length) shown[shown.length - 1] = `${shown[shown.length - 1].replace(/[.,;:!?]?$/, "")}…`;

  return shown;
}

export function createStationLabel(text: string, hue: number) {
  const canvas = document.createElement("canvas");

  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const context = canvas.getContext("2d");

  if (context) {
    context.fillStyle = "rgba(255, 255, 255, 0.94)";
    context.beginPath();
    context.roundRect(4, 4, WIDTH - 8, HEIGHT - 8, 26);
    context.fill();
    context.fillStyle = `hsl(${hue} 70% 55%)`;
    context.beginPath();
    context.roundRect(4, 4, 16, HEIGHT - 8, [26, 0, 0, 26]);
    context.fill();
    context.fillStyle = "#1f2430";
    context.font = "600 34px system-ui, -apple-system, 'Segoe UI', sans-serif";
    context.textBaseline = "middle";

    const lines = wrap(text);

    lines.forEach((line, index) => {
      context.fillText(line, 40, HEIGHT / 2 + (index - (lines.length - 1) / 2) * 44);
    });
  }

  const texture = new THREE.CanvasTexture(canvas);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);

  sprite.scale.set(2.7, (2.7 * HEIGHT) / WIDTH, 1);

  return {
    sprite,
    dispose: () => {
      texture.dispose();
      material.dispose();
    },
  };
}
