# Local Admin authentication and mode verification

The Admin listener is **loopback-only** (usually `http://127.0.0.1:3001/ui/`).
It is separate from the public MCP listener and its token. Do not expose port
3001 through Tailscale Funnel.

## Pair once without typing or storing the Admin token

1. In the operator's **own private interactive terminal**, run
   `bridge-dev access`.
2. Open the **One-click local Admin pairing** link within 60 seconds.
   The link includes a short-lived, signed, one-use capability. Treat it as
   sensitive during its brief lifetime.
3. The browser consumes the fragment, removes it from the address bar and
   receives an `HttpOnly; SameSite=Strict` session cookie. Admin API requests
   use the cookie; the long-lived Admin bearer is never returned to browser JS.
4. Reloading the dashboard or restarting the gateway preserves the signed
   browser session until its seven-day expiration. No persistent JS credential
   storage is used.
5. **Access & Security** contains the session status, optional manual fallback
   and Disconnect. Disconnect clears the cookie. Re-pair to sign in again.

A bare request to `/api/auth/pair` cannot authenticate: it requires the exact
operator-signed capability, an application/json same-origin request and a
single-use nonexpired code. `/api/auth/bootstrap` **must never** return the
raw Admin bearer token to unauthenticated localhost callers.

**Trust limitation:** A loopback HTTP listener cannot establish the Unix UID
of a browser client. Local malware running as the same operator can access
browser sessions and/or operator files; HTTP cookies do not sandbox a compromised
local account. Avoid calling this OS-level authentication.

## Credential rotation and private backup

`bridge-dev token rotate admin [--restart]` and
`bridge-dev token rotate mcp [--restart]` require a private interactive
terminal and operator confirmation. The private configuration must be a
single-link, regular file owned by the operator with mode 0600 in a directory
that is not group/world writable. Duplicate/missing token definitions fail
closed. The command saves a protected 0600 sibling backup first, writes a
new 64-character hex secret to a private temporary file and atomically renames
it into place, preserving all other env values. Tokens are not printed.

`--restart` restarts only the installed user service (disconnecting existing
sessions). Without it, running service credentials drift until intentionally
restarted. An Admin rotation invalidates HttpOnly browser sessions; use
`bridge-dev access` to re-pair. An MCP rotation invalidates existing clients'
URL tokens. Previous secrets persist in the backup and must be protected or
removed after successful verification.

## Credentials and rotation

`ADMIN_TOKEN` and `MCP_TOKEN` are distinct. Only the Admin token is involved
in the Admin browser session. The signed-cookie key is derived from the live
Admin token; rotating that token invalidates outstanding cookies.

Rotate the Admin credential **through a reviewed local operator maintenance
procedure**, not a public API or a remote MCP command. Verify the on-disk
protected environment, coordinate process restart, re-pair with
`bridge-dev access`, and check the authenticated Admin health endpoint.
Preserve the independent MCP token and Funnel mapping. Never print the new
Admin secret in logs or GitHub. An env file changed while the service is running
can cause `SERVICE_ADMIN_CREDENTIAL_DRIFT`; inspect the current state before
any retries or release cutover.

## Signed YOLO mode versus API mode

`bridge-dev mode status` (local CLI) and MCP `agent_status` must agree
after a verified operator activation. The gateway validates the root-owned
activation record against the **operator public key's ownership**, not the
user-owned portable policy configuration. This prevents a legitimate signed
until-off lease being rejected by a mismatched UID check.

If they disagree, preserve STANDARD restrictions until the protected lease,
public-key ownership, mode and root controller are inspected. Never forge or
copy lease records, grant remote self-activation or bypass operator approval.
An operator can activate indefinitely with `bridge-dev mode yolo` and revoke
with `bridge-dev mode standard` only from the required independent local
terminal. Activation and deployment are separate operations.
