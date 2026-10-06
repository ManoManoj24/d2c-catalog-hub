import Link from "next/link";
import { requireHub } from "@/server/context";

export const dynamic = "force-dynamic";

const LINKS = [
  ["/", "Dashboard"],
  ["/products", "Products"],
  ["/imports", "Imports"],
  ["/channels", "Channels"],
  ["/packs", "Pack"],
  ["/settings", "Settings"],
];

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const hub = await requireHub();
  return (
    <div className="shell">
      <aside className="nav">
        <div className="brand">
          <strong>PIM-lite</strong>
          <span>Catalog hub</span>
        </div>
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href}>{label}</Link>
        ))}
        <div className="meta">
          <div>{hub.tenantName}</div>
          <div>{hub.role}</div>
          <form action="/api/auth/logout" method="post"><button className="btn secondary" type="submit">Sign out</button></form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
