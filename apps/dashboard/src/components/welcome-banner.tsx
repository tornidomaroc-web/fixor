"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * One-shot success banner shown when the user lands back from a
 * fresh GitHub install (`?installed=1`). After 5 seconds we strip
 * the query param so a refresh doesn't keep showing the banner.
 */
export function WelcomeBanner() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => {
      router.replace("/", { scroll: false });
    }, 5000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950">
      <p className="font-medium text-emerald-900 dark:text-emerald-100">
        Fixor is installed.
      </p>
      <p className="mt-1 text-emerald-900/80 dark:text-emerald-100/80">
        Open the next pull request on a watched repo — the security
        review lands within ~30 seconds.
      </p>
    </div>
  );
}
