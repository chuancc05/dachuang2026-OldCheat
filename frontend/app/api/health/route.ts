import { NextResponse } from "next/server"
import { getRuntimeStatus } from "@/lib/runtime-status"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(getRuntimeStatus(), {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  })
}
