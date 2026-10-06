export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return (
    <div className="auth">
      <section className="auth-card">
        <h1>Open a catalog</h1>
        <p className="lede">Creates your brand, a primary catalog, and installs Kidswear Pack v1.</p>
        {params.error ? <p className="banner error">{params.error}</p> : null}
        <form action="/api/auth/register" method="post">
          <label>Your name<input name="name" required /></label>
          <label>Work email<input name="email" type="email" required /></label>
          <label>Password<input name="password" type="password" minLength={8} required /></label>
          <label>Brand name<input name="brand" required placeholder="Tiny Nest" /></label>
          <button className="btn" type="submit">Create workspace</button>
        </form>
        <p className="help">Already registered? <a href="/login">Sign in</a></p>
      </section>
    </div>
  );
}
