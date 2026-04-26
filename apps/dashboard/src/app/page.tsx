import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-24 bg-background text-foreground">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Fixor Dashboard
      </h1>
      <p className="text-muted-foreground max-w-md text-center">
        Coming soon — sign in with GitHub to manage your orgs, view scan
        history, and tune detector settings.
      </p>
      <a
        className={cn(buttonVariants({ variant: "default", size: "lg" }))}
        href="https://github.com/tornidomaroc-web/fixor"
        target="_blank"
        rel="noopener noreferrer"
      >
        View on GitHub
      </a>
    </main>
  );
}
