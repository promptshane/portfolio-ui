import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Developer Notes",
};

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
