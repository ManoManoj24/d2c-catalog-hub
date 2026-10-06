export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return (
    <div className="auth">
      <section className="auth-card">
        <h1>Sign in</h1>
        <p className="lede">Turn a messy kidswear file into a governed, channel-ready catalog.</p>
        {params.error ? <p className="banner error">{params.error}</p> : null}
        <form action="/api/auth/login" method="post">
          <label>Email<input name="email" type="email" required autoComplete="username" /></label>
          <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
          <button className="btn" type="submit">Sign in</button>
        </form>
        <p className="help">New brand? <a href="/register">Create a workspace</a></p>
      </section>
    </div>
  );
}
