// app/routes/healthz.ts
import { healthcheck } from "../../src/lib/healthcheck";

export const loader = async () => {
  return new Response(JSON.stringify(healthcheck()), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};

export default function Healthz() {
  return null;
}

