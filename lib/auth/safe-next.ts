// lib/auth/safe-next.ts
// Validate a user-supplied "next" redirect target.
//
// Reject anything that is not a same-origin absolute path. The simple
// "startsWith('/')" check is NOT enough: "//evil.com" and "/\\evil.com"
// are protocol-relative URLs that the browser will follow to a different
// host. Allow only single leading "/" followed by anything except "/" and
// "\".
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/"
  if (raw.length < 2) return "/"
  if (raw[0] !== "/") return "/"
  if (raw[1] === "/" || raw[1] === "\\") return "/"
  return raw
}
