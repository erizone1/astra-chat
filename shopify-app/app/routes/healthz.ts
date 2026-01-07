// app/routes/healthz.ts
import type { LoaderFunctionArgs } from "react-router";
import { healthcheck } from "../../src/lib/healthcheck";
import { withRequestId, withRequestIdHeader } from "../utils/request-id.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestId(request, async (requestId) => {
    const body = JSON.stringify(healthcheck());

    return withRequestIdHeader(
      new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      }),
      requestId
    );
  });
};
