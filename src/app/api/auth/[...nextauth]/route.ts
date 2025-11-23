import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// Force Node.js runtime (not edge) so env secrets are available at runtime
export const runtime = "nodejs";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
