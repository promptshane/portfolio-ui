import { withAuth } from "next-auth/middleware";

const middlewareSecret =
  process.env.NEXTAUTH_SECRET ??
  process.env.AUTH_SECRET ??
  "insecure-default-nextauth-secret-change-me";

export default withAuth({
  secret: middlewareSecret,
  callbacks: {
    authorized: ({ token }) => !!token,
  },
});

export const config = {
  // Match all routes except for those that start with:
  // - /api (API routes)
  // - /_next/static (static files)
  // - /_next/image (image optimization files)
  // - /favicon.ico (favicon file)
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"],
}
