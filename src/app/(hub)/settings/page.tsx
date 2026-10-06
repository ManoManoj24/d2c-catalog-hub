import { can } from "@/domain/authz";
import { requireHub } from "@/server/context";
import { withTenant } from "@/server/db";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const hub = await requireHub();
  const params = await searchParams;
  const members = await withTenant(hub.tenantId, hub.user.id, async (client) => {
    const result = await client.query<{ email: string; name: string; role: string }>(
      `SELECT u.email, u.name, m.role
       FROM memberships m
       CROSS JOIN LATERAL app_user_by_id(m.user_id) u
       WHERE m.tenant_id = $1
       ORDER BY u.email`,
      [hub.tenantId],
    );
    return result.rows;
  });
  const usedMb = (hub.storageUsedBytes / (1024 * 1024)).toFixed(1);
  const capMb = (hub.storageCapBytes / (1024 * 1024)).toFixed(0);
  return (
    <>
      <div className="top">
        <div>
          <h1>Settings</h1>
          <p className="lede">Membership is the only way into a brand. Client-supplied tenant ids are checked against it.</p>
        </div>
      </div>
      {params.error ? <p className="banner error">{params.error}</p> : null}
      {params.saved ? <p className="banner ok">Member added.</p> : null}
      <section className="card">
        <h2>Storage</h2>
        <p>{usedMb} MB of {capMb} MB used. Image URL checks do not consume this cap. Uploads do.</p>
      </section>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.email}><td>{member.name}</td><td>{member.email}</td><td>{member.role}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {can(hub.role, "member.manage") ? (
        <form className="card stack" action="/api/members" method="post">
          <h2>Invite a teammate</h2>
          <label>Name<input name="name" required /></label>
          <label>Email<input name="email" type="email" required /></label>
          <label>Temporary password<input name="password" type="text" minLength={8} required /></label>
          <label>Role
            <select name="role" defaultValue="editor">
              <option value="admin">Admin</option>
              <option value="editor">Editor</option>
              <option value="reviewer">Reviewer</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <button className="btn" type="submit">Add member</button>
        </form>
      ) : null}
    </>
  );
}
