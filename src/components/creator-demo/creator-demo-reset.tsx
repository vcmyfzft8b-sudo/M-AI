"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { EmojiIcon } from "@/components/emoji-icon";
import { resetCreatorDemo } from "@/lib/creator-demo/store";

/** Puts the demo library back to its starting state between takes. */
export function CreatorDemoReset() {
  const router = useRouter();
  const [isResetting, setIsResetting] = useState(false);

  return (
    <button
      type="button"
      className="settings-inline-action"
      disabled={isResetting}
      onClick={() => {
        setIsResetting(true);
        resetCreatorDemo();
        router.push("/creator");
        window.setTimeout(() => setIsResetting(false), 400);
      }}
    >
      <EmojiIcon symbol="♻️" size="0.95rem" />
      Ponastavi demo
    </button>
  );
}
