"use client"
// app/auth/signin/page.tsx
// Single Google sign-in button. ?next=/safe/path is forwarded to /auth/callback
// which validates it and redirects there after the session is exchanged.
//
// "next" is also sanitized on the client so a malicious link pasted into
// the URL bar can't display a deceptive destination before the user clicks.
import { useSearchParams, useRouter } from "next/navigation"
import { supabaseBrowser } from "@/lib/supabase/client"
import { safeNextPath } from "@/lib/auth/safe-next"

export default function SignInPage() {
  const sp = useSearchParams()
  const router = useRouter()
  const next = safeNextPath(sp.get("next")) || "/admin"

  async function signInGoogle() {
    const sb = supabaseBrowser()
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
    // The browser will navigate to Google; no further client action needed.
    // If you want a cancel button, wire it to router.back().
    void router
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm border rounded-xl p-6 bg-[var(--surface)]">
        <h1 className="text-lg font-medium mb-1">Sign in</h1>
        <p className="text-sm text-[var(--text-mut)] mb-4">
          Use the Google account that has admin access.
        </p>
        <button
          onClick={signInGoogle}
          className="w-full py-2 mb-2 border rounded font-medium"
        >
          Continue with Google
        </button>
        <p className="text-xs text-[var(--text-mut)] mt-3">
          Redirect target: <code className="text-[var(--text-mut)]">{next}</code>
        </p>
      </div>
    </main>
  )
}
