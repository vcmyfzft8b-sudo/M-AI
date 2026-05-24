"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

type StorySlide = {
  kind: string;
  title: string;
  caption: string;
  label: string;
  image: string;
};

type StoryLabels = {
  aria: string;
  choose: string;
  show: string;
  previous: string;
  next: string;
  navigation: string;
};

const DEFAULT_STORY_SLIDES = [
  {
    kind: "notes",
    title: "Clean zapiski",
    caption: "Predavanje postane urejen povzetek.",
    label: "Zapiski",
    image: "/IMG_6651.png",
  },
  {
    kind: "flashcards",
    title: "Flashcardi",
    caption: "Ključni pojmi za hitro ponavljanje.",
    label: "Flashcardi",
    image: "/IMG_6653.png",
  },
  {
    kind: "quiz",
    title: "Kvizi",
    caption: "Vprašanja iz tvojega gradiva.",
    label: "Kvizi",
    image: "/IMG_6654.png",
  },
  {
    kind: "test",
    title: "Testi",
    caption: "Vaja za daljše odgovore in izpite.",
    label: "Testi",
    image: "/IMG_6655.png",
  },
  {
    kind: "chat",
    title: "AI chat",
    caption: "Vprašaj zapisek in dobi odgovor.",
    label: "AI chat",
    image: "/IMG_6656.png",
  },
  {
    kind: "reading",
    title: "Branje zapiskov",
    caption: "Poslušaj in beri zapiske na telefonu.",
    label: "Branje zapiskov",
    image: "/IMG_6657.png",
  },
] as const;

const STORY_AUTOPLAY_MS = 3200;

export function LandingStoryPreview({
  labels = {
    aria: "Primeri učnega gradiva",
    choose: "Izberi primer",
    show: "Pokaži",
    previous: "Prejšnji primer",
    next: "Naslednji primer",
    navigation: "Story navigacija",
  },
  slides = DEFAULT_STORY_SLIDES,
}: {
  labels?: StoryLabels;
  slides?: readonly StorySlide[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeSlide = (slides[activeIndex] ?? slides[0]) as StorySlide;
  const storyStyle = { "--story-duration": `${STORY_AUTOPLAY_MS}ms` } as CSSProperties;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current === slides.length - 1 ? 0 : current + 1));
    }, STORY_AUTOPLAY_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [slides.length]);

  function showPrevious() {
    setActiveIndex((current) => (current === 0 ? slides.length - 1 : current - 1));
  }

  function showNext() {
    setActiveIndex((current) => (current === slides.length - 1 ? 0 : current + 1));
  }

  return (
    <div className="landing-study-visual" aria-label={labels.aria}>
      <div className={`landing-study-story landing-study-story-${activeSlide.kind}`} style={storyStyle}>
        <div key={`${activeSlide.kind}-media`} className="landing-study-story-media">
          <Image
            src={activeSlide.image}
            alt=""
            fill
            priority={activeIndex === 0}
            quality={92}
            sizes="(max-width: 639px) min(72vw, 16.5rem), (max-width: 1199px) 16.75rem, 17.5rem"
            className="landing-study-story-image"
          />
        </div>
        <div className="landing-study-story-overlay" aria-hidden="true" />

        <div className="landing-study-story-bars" aria-label={labels.choose}>
          {slides.map((slide, index) => (
            <button
              type="button"
              key={slide.kind}
              className={index === activeIndex ? "active" : ""}
              aria-label={`${labels.show} ${slide.label}`}
              aria-current={index === activeIndex ? "step" : undefined}
              onClick={() => {
                setActiveIndex(index);
              }}
            >
              <span />
            </button>
          ))}
        </div>

        <span className="landing-study-story-floating-logo" aria-hidden="true">
          <Image src="/memo-logo.png" alt="" width={3651} height={3285} sizes="3.6rem" />
        </span>

        <div className="landing-study-story-controls" aria-label={labels.navigation}>
          <button type="button" aria-label={labels.previous} onClick={showPrevious}>
            ←
          </button>
          <button type="button" aria-label={labels.next} onClick={showNext}>
            →
          </button>
        </div>
      </div>
    </div>
  );
}
