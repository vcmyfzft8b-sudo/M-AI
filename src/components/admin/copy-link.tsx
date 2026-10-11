"use client";

import { useState } from "react";

/** A link with a button that copies it, for handing a signing link to a creator. */
export function CopyLink({ href }: { href: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="admin-copy-link">
      <a className="admin-link" href={href} target="_blank" rel="noreferrer">
        {href}
      </a>
      <button
        type="button"
        className="admin-button"
        data-size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(href).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </span>
  );
}
