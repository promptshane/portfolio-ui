export function validateDevPassword(provided: string | undefined | null) {
  const expected = process.env.DEV_SIGNUP_PASSWORD || process.env.FTV_DEV_PASSWORD;
  if (!expected) {
    return { ok: false, error: "Dev password is not configured on the server." };
  }
  if (!provided || provided !== expected) {
    return { ok: false, error: "Invalid dev password." };
  }
  return { ok: true as const };
}
