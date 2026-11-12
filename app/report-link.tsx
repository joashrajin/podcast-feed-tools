"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Links to the report form with the current page filled in. */
export default function ReportLink({ children = "Report an issue" }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const href = `/report?page=${encodeURIComponent(pathname || "/")}`;
  return <Link href={href}>{children}</Link>;
}
