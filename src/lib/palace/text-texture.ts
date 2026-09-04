/**
 * Card text, painted onto the screens that hang on the buildings.
 *
 * The wrapping is separated from the canvas so it can be tested with a fake
 * measurer, and so the two things it has to get right — never overflowing the
 * board, and never cutting a word in half in a language with long words, which
 * is most of the ones this app ships in — are checked rather than eyeballed.
 */

export type MeasureText = (text: string) => number;

export function wrapText(text: string, maxWidth: number, measure: MeasureText) {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    let line = "";

    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;

      if (line && measure(candidate) > maxWidth) {
        lines.push(line);
        line = word;
        continue;
      }

      /* A single word wider than the board is broken rather than clipped. */
      if (!line && measure(word) > maxWidth) {
        let chunk = "";

        for (const character of word) {
          if (chunk && measure(`${chunk}${character}`) > maxWidth) {
            lines.push(chunk);
            chunk = character;
            continue;
          }

          chunk += character;
        }

        line = chunk;
        continue;
      }

      line = candidate;
    }

    if (line) lines.push(line);
  }

  return lines;
}

/** Lines that do not fit end in an ellipsis rather than running off the board. */
export function clampLines(lines: string[], maxLines: number) {
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);

  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s.,;:]+$/u, "")}…`;

  return kept;
}

const FONT_STACK =
  '"Inter", "Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

/**
 * One screen. Drawn at a fixed size and reused, because a phone cannot hold a
 * megabyte of canvas per card in a deck of forty.
 */
export function drawCardScreen({
  canvas,
  title,
  body,
  hue,
  collected,
}: {
  canvas: HTMLCanvasElement;
  title: string;
  body: string;
  hue: number;
  collected: boolean;
}) {
  const width = canvas.width;
  const height = canvas.height;
  const context = canvas.getContext("2d");

  if (!context) return;

  context.clearRect(0, 0, width, height);
  context.fillStyle = collected ? `hsl(${hue} 44% 92%)` : "#ffffff";
  context.fillRect(0, 0, width, height);

  /* A coloured band along the top: the district's colour, read from a distance. */
  context.fillStyle = `hsl(${hue} 70% 55%)`;
  context.fillRect(0, 0, width, Math.round(height * 0.17));

  context.fillStyle = "#ffffff";
  context.font = `600 ${Math.round(height * 0.1)}px ${FONT_STACK}`;
  context.textBaseline = "middle";
  context.fillText(
    clampLines(wrapText(title, width - 48, (text) => context.measureText(text).width), 1)[0] ?? "",
    24,
    Math.round(height * 0.088),
  );

  const bodySize = Math.round(height * 0.115);

  context.fillStyle = "#14121a";
  context.font = `500 ${bodySize}px ${FONT_STACK}`;

  const lines = clampLines(
    wrapText(body, width - 64, (text) => context.measureText(text).width),
    4,
  );
  const top = Math.round(height * 0.34);

  lines.forEach((line, index) => {
    context.fillText(line, 32, top + index * bodySize * 1.32);
  });

  if (collected) {
    context.fillStyle = `hsl(${hue} 60% 42%)`;
    context.beginPath();
    context.arc(width - 46, height - 44, 22, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(width - 57, height - 45);
    context.lineTo(width - 49, height - 36);
    context.lineTo(width - 34, height - 54);
    context.stroke();
  }
}

/** The far-away version: a number you can count off, and nothing to read. */
export function drawNumberScreen({
  canvas,
  label,
  hue,
  collected,
}: {
  canvas: HTMLCanvasElement;
  label: string;
  hue: number;
  collected: boolean;
}) {
  const context = canvas.getContext("2d");

  if (!context) return;

  const width = canvas.width;
  const height = canvas.height;

  context.fillStyle = collected ? `hsl(${hue} 55% 60%)` : "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = collected ? "#ffffff" : `hsl(${hue} 70% 52%)`;
  context.font = `700 ${Math.round(height * 0.55)}px ${FONT_STACK}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, width / 2, height / 2);
  context.textAlign = "left";
}
