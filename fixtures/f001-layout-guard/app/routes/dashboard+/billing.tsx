import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { db } from "~/db.server";

export async function loader() {
  const invoices = await db.invoice.findMany({
    orderBy: { createdAt: "desc" },
  });
  return json({ invoices });
}

export default function BillingPage() {
  const { invoices } = useLoaderData<typeof loader>();
  return (
    <ul>
      {invoices.map((inv) => (
        <li key={inv.id}>
          {inv.customerEmail} — {inv.amountCents}
        </li>
      ))}
    </ul>
  );
}
