import { env } from "cloudflare:workers";
import { z } from "zod";
import { formatRussianPlate } from "../../../lib/license-plate";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

const providerResponse = z.object({
  success: z.number(),
  status: z.string().optional(),
  testMode: z.boolean().optional(),
  licensePlate: z.string().optional(),
  brand: z.string().nullish(),
  model: z.string().nullish(),
  vin: z.string().nullish(),
  year: z.coerce.number().int().nullish(),
});

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return reply({ available: false }, 401);
  return reply({ available: Boolean(env.AVTO_VIN_COD_TOKEN) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ status: "sign_in" }, 401);
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ status: "unavailable" }, 403);
  const token = env.AVTO_VIN_COD_TOKEN;
  if (!token) return reply({ status: "not_enabled" });
  const input = await request.json().catch(() => null) as { plate?: unknown } | null;
  const plate = typeof input?.plate === "string" && input.plate.length <= 24 ? formatRussianPlate(input.plate) : null;
  if (!plate) return reply({ status: "unsupported" });

  try {
    const url = new URL("https://api.avtovincod.ru/gos2vin");
    url.searchParams.set("plate", plate);
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(55_000),
      redirect: "error",
    });
    if (response.status === 402) return reply({ status: "balance" });
    if (!response.ok) return reply({ status: "unavailable" }, 502);
    const parsed = providerResponse.safeParse(await response.json());
    if (!parsed.success || parsed.data.testMode) return reply({ status: "unavailable" }, 502);
    const data = parsed.data;
    if (data.success === 0 && data.status === "not_found") return reply({ status: "not_found" });
    if (data.success !== 1 || (data.licensePlate && formatRussianPlate(data.licensePlate) !== plate)) {
      return reply({ status: "unavailable" }, 502);
    }
    const model = data.model?.trim();
    const brand = data.brand?.trim();
    const fullName = model && brand && !model.toLocaleLowerCase("ru").startsWith(brand.toLocaleLowerCase("ru") + " ")
      ? brand + " " + model : model || brand;
    const name = model ? fullName?.slice(0, 90) : undefined;
    const vin = data.vin?.trim().toUpperCase();
    const details = {
      name,
      vin: vin && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : undefined,
      year: data.year && data.year >= 1880 && data.year <= 2100 ? data.year : undefined,
    };
    return reply(Object.values(details).some(Boolean) ? { status: "found", details } : { status: "not_found" });
  } catch {
    return reply({ status: "unavailable" }, 502);
  }
}
