// ASSUMED-PATH: app/api/invoices/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { dataSource } from "@/lib/data-source";
import { Invoice } from "@/entities/invoice";

export async function GET(req: NextRequest) {
  const invoiceId = req.nextUrl.searchParams.get("invoiceId");
  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId required" }, { status: 400 });
  }
  const repo = dataSource.getRepository(Invoice);
  const invoice = await repo.findOneBy({ id: invoiceId });
  if (!invoice) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(invoice);
}
