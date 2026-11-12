import { NextRequest } from "next/server";
import { handleDbCheck } from "@/lib/dbcheck";

export async function GET(req: NextRequest) {
  return handleDbCheck(req);
}
