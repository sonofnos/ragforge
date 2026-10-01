"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/useAuth";

export function Nav() {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <nav className="nav">
      <Link href="/" className={pathname === "/" ? "active" : ""}>
        Chat
      </Link>
      <Link href="/documents" className={pathname === "/documents" ? "active" : ""}>
        Documents
      </Link>
      <div className="spacer" />
      {user ? (
        <>
          <span className="muted">{user.email}</span>
          <button onClick={() => signOut(auth)}>Sign out</button>
        </>
      ) : null}
    </nav>
  );
}
