/**
 * Shown in place of settings or billing to a user who can see the org
 * but does not own its GitHub installation (lib/org-access.ts).
 */
export function OwnerOnlyNotice({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-6">
      <p className="font-medium">Only the installation&apos;s owner can see {what}</p>
      <p className="text-muted-foreground mt-1 text-sm">
        For a personal account that is the account itself; for an
        organization, an organization owner. You can still see scan history
        for the repositories you can access.
      </p>
    </div>
  );
}
