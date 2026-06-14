"use client"
import { supabaseBrowser } from "@/lib/supabase/client"

export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  const sb = supabaseBrowser()

  async function signInEmail() {
    const email = prompt("Email for magic link?")
    if (!email) return
    await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth/callback` } })
    alert("Check your email")
    onClose()
  }

  async function signInGoogle() {
    await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback` } })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--surface)] p-6 rounded-xl w-80">
        <h2 className="font-medium mb-4">Sign in</h2>
        <button onClick={signInEmail} className="w-full py-2 mb-2 border rounded">Magic link</button>
        <button onClick={signInGoogle} className="w-full py-2 mb-2 border rounded">Google</button>
        <button onClick={onClose} className="w-full text-sm text-[var(--text-mut)]">Cancel</button>
      </div>
    </div>
  )
}
