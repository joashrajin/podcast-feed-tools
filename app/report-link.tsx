"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function ReportLink() {
  const pathname = usePathname();
  const href = `/report?page=${encodeURIComponent(pathname || "/")}`;
  return <Link href={href}>Report an issue</Link>;
}
