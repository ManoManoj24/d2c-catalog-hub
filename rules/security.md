# Security baseline

- Parameterized SQL only. No string-concatenated queries.
- Session cookie is HTTP-only, `SameSite=Lax`, and signed with `SESSION_SECRET`.
- Passwords are bcrypt hashes. The app role cannot `SELECT` the users table; lookup goes through security-definer functions.
- Upload allow-list: CSV, XLSX, JPEG, PNG, WebP. Size limits live in the kidswear pack.
- Export cells that start with `=`, `+`, `-`, `@`, or a tab are prefixed so a spreadsheet does not treat them as formulas.
- Image URL checks reject link-local and private hosts. `ALLOW_LOCAL_MEDIA_URLS=true` is only for the local demo.
- Audit rows are insert-only for the app role. Corrections are new events.
- Do not log passwords, session tokens, or storage credentials.
