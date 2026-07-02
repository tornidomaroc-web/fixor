import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { getUserFromSession } from "~/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromSession(request);
  if (!user) {
    throw redirect("/login");
  }
  return null;
}

export default function DashboardLayout() {
  return <Outlet />;
}
