import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

/**
 * Shown when GitHub answers 401 for the user's App token (lib/github.ts):
 * the token expired and was not refreshed, or the user revoked the App.
 * Nothing on the page can be trusted from a token GitHub refuses, so the
 * whole page is replaced, never a partial list.
 */
export function SessionExpiredNotice() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-6">
      <p className="font-medium">GitHub no longer accepts your sign-in</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Your GitHub session for Fixor expired or was revoked, so Fixor cannot
        tell which repositories you can see. Sign out and back in with GitHub
        to continue; nothing here is lost.
      </p>
    </div>
  );
}

export function SessionExpiredPage() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Fixor
        </Link>
        <UserButton />
      </header>
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
        <SessionExpiredNotice />
      </section>
    </main>
  );
}
