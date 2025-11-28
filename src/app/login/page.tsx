"use client";

import { useState, useMemo, useRef } from "react";
import { signIn } from "next-auth/react";

// format "(123) 456-7890" as the user types (US-style)
function formatPhone(input: string) {
  const d = input.replace(/\D/g, "").slice(0, 10);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (d.length <= 3) return a;
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");

  // shared
  const [username, setUsername] = useState("");

  // login
  const [password, setPassword] = useState("");

  // signup extras
  const [preferredName, setPreferredName] = useState("");
  const [phone, setPhone] = useState(""); // formatted for display
  const [confirm, setConfirm] = useState("");
  const [devPassword, setDevPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const preferredRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const devPasswordRef = useRef<HTMLInputElement>(null);

  const signupDisabled = useMemo(() => {
    if (!username.trim() || !password || !confirm) return true;
    if (password.length < 6) return true;
    if (password !== confirm) return true;
    if (!devPassword.trim()) return true;
    return false;
  }, [username, password, confirm, devPassword]);

  async function doLogin() {
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) {
      setMsg("Enter your username.");
      return;
    }
    setLoading(true);
    setMsg(null);
    const res = await signIn("credentials", {
      redirect: false,
      username: normalizedUsername,
      password,
    });
    setLoading(false);
    if (!res?.error) {
      window.location.href = "/";
    }
    else setMsg("Invalid username or password");
  }

  async function doSignup() {
    if (signupDisabled) return;
    const normalizedUsername = username.trim().toLowerCase();
    setLoading(true);
    setMsg(null);
    try {
      const digitsOnly = phone.replace(/\D/g, "");
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: normalizedUsername,
          preferredName: preferredName || undefined,
          phone: digitsOnly || undefined,
          password,
          confirm,
          devPassword,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(j?.error || "Registration failed");
        setLoading(false);
        return;
      }
      // Auto-login
      const res = await signIn("credentials", {
        redirect: false,
        username: normalizedUsername,
        password,
      });
      setLoading(false);
      if (!res?.error) {
        window.location.href = "/";
      }
      else setMsg("Signed up, but login failed. Try signing in.");
    } catch {
      setLoading(false);
      setMsg("Registration failed");
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, field: string) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (mode === "login") {
      if (field === "username") {
        passwordRef.current?.focus();
      } else if (field === "password") {
        void doLogin();
      }
      return;
    }
    // signup flow sequence
    if (field === "username") {
      if (preferredRef.current) return preferredRef.current.focus();
      if (phoneRef.current) return phoneRef.current.focus();
      return passwordRef.current?.focus();
    }
    if (field === "preferred") {
      if (phoneRef.current) return phoneRef.current.focus();
      return passwordRef.current?.focus();
    }
    if (field === "phone") {
      return passwordRef.current?.focus();
    }
    if (field === "password") {
      if (confirmRef.current) return confirmRef.current.focus();
      return void doSignup();
    }
    if (field === "confirm") {
      if (devPasswordRef.current) return devPasswordRef.current.focus();
      return void doSignup();
    }
    if (field === "devPassword") {
      return void doSignup();
    }
  };

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-10 flex items-center justify-center">
      <div className="w-full max-w-md bg-neutral-800 rounded-2xl border border-neutral-700 p-6 shadow">
        <div className="flex justify-center mb-6">
          <div className="inline-flex rounded-lg bg-black/60 border border-neutral-700 p-1">
            <button
              onClick={() => setMode("login")}
              className={`px-4 py-2 rounded-md text-sm ${mode === "login" ? "bg-neutral-700" : ""}`}
            >
              Login
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`px-4 py-2 rounded-md text-sm ${mode === "signup" ? "bg-neutral-700" : ""}`}
            >
              Sign up
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {/* Username */}
          <div>
            <label className="block text-sm text-neutral-300 mb-1">Username</label>
            <input
              className="w-full px-3 py-2 rounded-lg bg-black/80 border border-neutral-700"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              onKeyDown={(e) => handleKeyDown(e, "username")}
              placeholder="yourname"
              autoComplete={mode === "login" ? "username" : "new-username"}
              ref={usernameRef}
            />
          </div>

          {mode === "signup" && (
            <>
              {/* Preferred name */}
              <div>
                <label className="block text-sm text-neutral-300 mb-1">Preferred name</label>
                <input
                  className="w-full px-3 py-2 rounded-lg bg-black/80 border border-neutral-700"
                  value={preferredName}
                  onChange={(e) => setPreferredName(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, "preferred")}
                  placeholder="(optional)"
                  ref={preferredRef}
                />
              </div>

              {/* Phone (auto-formatted) */}
              <div>
                <label className="block text-sm text-neutral-300 mb-1">Phone number</label>
                <input
                  className="w-full px-3 py-2 rounded-lg bg-black/80 border border-neutral-700"
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  onKeyDown={(e) => handleKeyDown(e, "phone")}
                  placeholder="(123) 456-7890"
                  inputMode="tel"
                  autoComplete="tel"
                  ref={phoneRef}
                />
              </div>
            </>
          )}

          {/* Password */}
          <div>
            <label className="block text-sm text-neutral-300 mb-1">Password</label>
            <input
              className="w-full px-3 py-2 rounded-lg bg-black/80 border border-neutral-700"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, "password")}
              type="password"
              placeholder="********"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              ref={passwordRef}
            />
            {mode === "signup" && password && password.length < 6 && (
              <div className="text-xs text-yellow-400 mt-1">At least 6 characters</div>
            )}
          </div>

          {/* Confirm (signup only) */}
          {mode === "signup" && (
            <div>
              <label className="block text-sm text-neutral-300 mb-1">Confirm password</label>
                <input
                  className="w-full px-3 py-2 rounded-lg bg-black/80 border border-neutral-700"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, "confirm")}
                  type="password"
                  placeholder="********"
                  autoComplete="new-password"
                  ref={confirmRef}
                />
              {confirm && confirm !== password && (
                <div className="text-xs text-red-400 mt-1">Passwords do not match</div>
              )}
            </div>
          )}

          {mode === "signup" && (
            <div>
              <label className="block text-sm text-neutral-300 mb-1">Dev password</label>
              <input
                className="w-full px-3 py-2 rounded-lg bg-black/80 border border-neutral-700"
                value={devPassword}
                onChange={(e) => setDevPassword(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, "devPassword")}
                type="password"
                placeholder="Required"
                ref={devPasswordRef}
              />
            </div>
          )}

        {msg && <div className="text-sm text-red-400">{msg}</div>}

          <button
            onClick={mode === "login" ? doLogin : doSignup}
            disabled={loading || (mode === "signup" && signupDisabled)}
            className={`w-full px-4 py-2 rounded-lg ${
              mode === "signup"
                ? signupDisabled
                  ? "bg-neutral-700"
                  : "bg-green-600 hover:bg-green-500"
                : "bg-green-600 hover:bg-green-500"
            } border border-green-500`}
          >
            {loading ? "Please wait…" : mode === "login" ? "Login" : "Create account"}
          </button>
        </div>
      </div>
    </main>
  );
}
