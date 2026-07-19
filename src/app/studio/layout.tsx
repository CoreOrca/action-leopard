import { redirect } from "next/navigation";
import { getEntitlement } from "@/lib/entitlements";

/** Paywall gate: the studio requires an allowlisted email or an active
 *  subscription. Auth itself is handled by the proxy. */
export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let entitled: boolean;
  try {
    entitled = (await getEntitlement()).entitled;
  } catch {
    redirect("/login");
  }
  if (!entitled) redirect("/pricing");
  return <>{children}</>;
}
