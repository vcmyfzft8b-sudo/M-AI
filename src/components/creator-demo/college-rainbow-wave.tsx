"use client";

import { useEffect, useRef } from "react";

/**
 * The rainbow listening wave for the `/creator/college` recording takeover.
 *
 * Purely decorative and entirely synthetic: no microphone is opened and no
 * audio is analysed. The envelope is a scripted "speech" curve so the ribbon
 * breathes like someone is lecturing into it.
 *
 * It reacts to the pointer — the ribbon bulges toward the cursor and a tap
 * sends a ripple down its length — so a creator can play with it on camera.
 */

const RIBBON_LAYERS = 5;
const PARTICLE_COUNT = 42;
const RIPPLE_LIFETIME_MS = 1400;

type Particle = {
  x: number;
  y: number;
  speed: number;
  radius: number;
  hue: number;
  drift: number;
};

type Ripple = {
  u: number;
  bornAt: number;
};

/** Smooth pseudo-speech envelope in 0..1: a few incommensurate sines plus bursts. */
function speechEnvelope(t: number) {
  const base =
    0.5 +
    0.24 * Math.sin(t * 1.9) +
    0.16 * Math.sin(t * 4.7 + 1.3) +
    0.1 * Math.sin(t * 9.1 + 2.7);
  // Syllable-rate flutter, so the ribbon never looks like a smooth screensaver.
  const syllables = 0.5 + 0.5 * Math.sin(t * 13.5 + Math.sin(t * 2.2) * 2);

  return Math.min(1, Math.max(0.18, base * (0.7 + 0.42 * syllables)));
}

export function CollegeRainbowWave({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef<{ u: number; v: number; strength: number }>({
    u: 0.5,
    v: 0.5,
    strength: 0,
  });
  const ripplesRef = useRef<Ripple[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let frameId = 0;
    let startedAt = performance.now();

    function seedParticles() {
      particles.length = 0;

      if (calm) {
        return;
      }

      for (let index = 0; index < PARTICLE_COUNT; index += 1) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          speed: 12 + Math.random() * 46,
          radius: 1 + Math.random() * 2.8,
          hue: Math.random() * 360,
          drift: (Math.random() - 0.5) * 18,
        });
      }
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);

      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas!.width = Math.round(width * ratio);
      canvas!.height = Math.round(height * ratio);
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
      seedParticles();
    }

    /** Local lift toward the pointer, and the decaying tap ripples. */
    function interactionOffset(u: number, now: number) {
      const pointer = pointerRef.current;
      const distance = u - pointer.u;
      const pull =
        pointer.strength *
        Math.exp(-(distance * distance) / 0.012) *
        (0.5 - pointer.v) *
        height *
        0.55;

      let ripple = 0;

      for (const entry of ripplesRef.current) {
        const age = (now - entry.bornAt) / RIPPLE_LIFETIME_MS;

        if (age >= 1) {
          continue;
        }

        const spread = Math.abs(u - entry.u);
        const front = age * 1.15;
        const band = Math.exp(-((spread - front) * (spread - front)) / 0.004);

        ripple += band * Math.sin(age * 22 - spread * 26) * (1 - age) * height * 0.3;
      }

      return pull + ripple;
    }

    function draw(now: number) {
      const elapsed = (now - startedAt) / 1000;
      const centerY = height / 2;
      const envelope = calm ? 0.55 : speechEnvelope(elapsed);
      const hueBase = (elapsed * (calm ? 12 : 42)) % 360;

      context!.clearRect(0, 0, width, height);
      context!.globalCompositeOperation = "lighter";

      for (let layer = 0; layer < RIBBON_LAYERS; layer += 1) {
        const depth = layer / RIBBON_LAYERS;
        const phase = elapsed * (0.9 + layer * 0.26) * (calm ? 0.4 : 1);
        const amplitude = height * 0.36 * envelope * (1 - depth * 0.62);
        const gradient = context!.createLinearGradient(0, 0, width, 0);

        for (let stop = 0; stop <= 6; stop += 1) {
          const hue = (hueBase + stop * 52 + layer * 18) % 360;
          gradient.addColorStop(stop / 6, `hsl(${hue} 96% ${58 + depth * 8}%)`);
        }

        const points: Array<[number, number]> = [];
        const step = Math.max(3, width / 220);

        for (let x = 0; x <= width; x += step) {
          const u = x / width;
          // Taper both ends so the ribbon reads as one floating shape.
          const envelopeWindow = Math.sin(Math.PI * u) ** 1.35;
          const shape =
            Math.sin(u * 8.4 + phase * 1.7) * 0.54 +
            Math.sin(u * 3.2 - phase * 1.15 + layer) * 0.34 +
            Math.sin(u * 16.8 + phase * 2.4 + layer * 0.7) * 0.15;

          points.push([
            x,
            envelopeWindow * (shape * amplitude + interactionOffset(u, now) * (1 - depth * 0.5)),
          ]);
        }

        context!.beginPath();
        points.forEach(([x, y], index) => {
          if (index === 0) {
            context!.moveTo(x, centerY + y);
          } else {
            context!.lineTo(x, centerY + y);
          }
        });

        for (let index = points.length - 1; index >= 0; index -= 1) {
          const [x, y] = points[index];
          context!.lineTo(x, centerY - y);
        }

        context!.closePath();
        context!.globalAlpha = 0.1 + (1 - depth) * 0.14;
        context!.fillStyle = gradient;
        context!.fill();

        context!.globalAlpha = 0.5 + (1 - depth) * 0.42;
        context!.lineWidth = 2 + (1 - depth) * 3.2;
        context!.lineJoin = "round";
        context!.strokeStyle = gradient;
        context!.beginPath();
        points.forEach(([x, y], index) => {
          if (index === 0) {
            context!.moveTo(x, centerY + y);
          } else {
            context!.lineTo(x, centerY + y);
          }
        });
        context!.stroke();
        context!.beginPath();
        points.forEach(([x, y], index) => {
          if (index === 0) {
            context!.moveTo(x, centerY - y);
          } else {
            context!.lineTo(x, centerY - y);
          }
        });
        context!.stroke();
      }

      for (const particle of particles) {
        particle.y -= particle.speed / 60;
        particle.x += Math.sin(elapsed * 0.9 + particle.hue) * (particle.drift / 60);

        if (particle.y < -10) {
          particle.y = height + 10;
          particle.x = Math.random() * width;
        }

        const fade = 1 - Math.abs(particle.y - height / 2) / (height * 0.75);
        context!.globalAlpha = Math.max(0.05, fade) * 0.65;
        context!.fillStyle = `hsl(${(particle.hue + hueBase) % 360} 96% 68%)`;
        context!.beginPath();
        context!.arc(particle.x, particle.y, particle.radius * (0.7 + envelope * 0.6), 0, Math.PI * 2);
        context!.fill();
      }

      context!.globalAlpha = 1;
      context!.globalCompositeOperation = "source-over";

      pointerRef.current.strength *= 0.94;
      ripplesRef.current = ripplesRef.current.filter(
        (entry) => now - entry.bornAt < RIPPLE_LIFETIME_MS,
      );

      frameId = window.requestAnimationFrame(draw);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    startedAt = performance.now();
    frameId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, []);

  function updatePointer(event: React.PointerEvent<HTMLCanvasElement>, strength: number) {
    const rect = event.currentTarget.getBoundingClientRect();

    pointerRef.current = {
      u: (event.clientX - rect.left) / Math.max(1, rect.width),
      v: (event.clientY - rect.top) / Math.max(1, rect.height),
      strength,
    };
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      onPointerMove={(event) => updatePointer(event, 0.85)}
      onPointerLeave={() => {
        pointerRef.current = { ...pointerRef.current, strength: 0 };
      }}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();

        updatePointer(event, 1.6);
        ripplesRef.current = [
          ...ripplesRef.current.slice(-4),
          {
            u: (event.clientX - rect.left) / Math.max(1, rect.width),
            bornAt: performance.now(),
          },
        ];
      }}
    />
  );
}
