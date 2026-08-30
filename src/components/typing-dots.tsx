import Image from "next/image";

/**
 * The three dots that stand in for Memo AI while it is thinking.
 *
 * It covers the gap between sending a question and the first token of the
 * answer — the model reads the notes before it writes anything, and that pause
 * is long enough that a still panel reads as a broken one. Once prose starts
 * arriving this is replaced by the answer itself, so the two never show at
 * once.
 *
 * `withAvatar` for the library chat, whose answers sit beside the mascot; the
 * note chat's answers are plain bubbles, so the dots are one too.
 */
export function TypingDots({ withAvatar = false }: { withAvatar?: boolean }) {
  return (
    <div className="memo-typing" role="status" aria-label="Memo AI piše">
      {withAvatar ? (
        <span className="memo-avatar">
          <Image src="/memo-mascot.png" alt="" width={320} height={288} />
        </span>
      ) : null}
      <span className="memo-typing-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
