// Generate a server-only env snapshot for Lambda runtime fallback.
// It whitelists the secrets we need and writes server.env.json at the repo root.
const fs = require("fs");
const path = require("path");

const KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
  "NEXTAUTH_URL",
  "FMP_API_KEY",
  "OPENAI_API_KEY",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
];

const out = {};
for (const k of KEYS) {
  const v = process.env[k];
  if (v && String(v).length) {
    out[k] = v;
  }
}

const target = path.join(process.cwd(), "server.env.json");
fs.writeFileSync(target, JSON.stringify(out, null, 2));

// Log only lengths for sanity, never values
console.log(
  "[write-server-env] captured keys:",
  Object.keys(out).map((k) => `${k}:len=${out[k].length}`).join(", ")
);
