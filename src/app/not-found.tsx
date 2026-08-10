import type { Metadata } from "next";
import Link from "next/link";

import { ErrorScreen } from "@/components/error-screen";

export const metadata: Metadata = {
  title: "Strani ni mogoče najti",
};

export default function NotFound() {
  return (
    <ErrorScreen
      code="404"
      title="Te strani ni."
      description="Povezava je morda zastarela ali napačno vnesena. Preveri naslov ali se vrni na začetek."
      actions={
        <Link href="/" className="error-screen-primary">
          Nazaj na domačo stran
        </Link>
      }
    />
  );
}
