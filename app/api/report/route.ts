import { NextRequest } from "next/server";
import { handleReport } from "@/lib/report";

export async function POST(req: NextRequest) {
  return handleReport(req);
}
