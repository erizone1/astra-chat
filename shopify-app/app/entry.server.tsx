import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { validateRequiredConfig } from "./utils/config.server";

import {
  enableRequestIdRuntimePatches,
  getOrCreateRequestId,
  runWithRequestId,
  setRequestIdHeader,
} from "./utils/request-id.server";
import { buildErrorMetadata, logger } from "./utils/logger.server";

export const streamTimeout = 5000;

validateRequiredConfig();

let runtimePatched = false;
function ensureRuntimePatched() {
  if (!runtimePatched) {
    enableRequestIdRuntimePatches();
    runtimePatched = true;
  }
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  ensureRuntimePatched();

  const requestId = getOrCreateRequestId(request.headers);

  return runWithRequestId(requestId, async () => {
    try {
      // Shopify headers first, then request-id header so it can’t be overwritten
      addDocumentResponseHeaders(request, responseHeaders);
      setRequestIdHeader(responseHeaders, requestId);

      const userAgent = request.headers.get("user-agent");
      const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

      return await new Promise<Response>((resolve) => {
        const { pipe, abort } = renderToPipeableStream(
          <ServerRouter context={reactRouterContext} url={request.url} />,
          {
            [callbackName]: () => {
              try {
                const body = new PassThrough();
                const stream = createReadableStreamFromReadable(body);

                responseHeaders.set("Content-Type", "text/html");
                setRequestIdHeader(responseHeaders, requestId);

                resolve(
                  new Response(stream, {
                    headers: responseHeaders,
                    status: responseStatusCode,
                  })
                );

                pipe(body);
              } catch (err) {
                logger.error("SSR callback failed", {
                  eventType: "ssr_render",
                  url: request.url,
                  ...(process.env.NODE_ENV === "production"
                    ? buildErrorMetadata(err)
                    : {
                        ...buildErrorMetadata(err),
                        stack: err instanceof Error ? err.stack : undefined,
                      }),
                });

                responseHeaders.set("Content-Type", "text/plain");
                setRequestIdHeader(responseHeaders, requestId);

                resolve(
                  new Response("Internal Server Error", {
                    status: 500,
                    headers: responseHeaders,
                  })
                );
              }
            },

            onShellError(error) {
              // Don’t reject; always resolve a response with X-Request-Id
              logger.error("SSR shell error", {
                eventType: "ssr_render",
                url: request.url,
                ...(process.env.NODE_ENV === "production"
                  ? buildErrorMetadata(error)
                  : {
                      ...buildErrorMetadata(error),
                      stack: error instanceof Error ? error.stack : undefined,
                    }),
              });

              responseHeaders.set("Content-Type", "text/plain");
              setRequestIdHeader(responseHeaders, requestId);

              resolve(
                new Response("Internal Server Error", {
                  status: 500,
                  headers: responseHeaders,
                })
              );
            },

            onError(error) {
              // React keeps going; mark status 500 and log
              responseStatusCode = 500;
              logger.error("SSR render error", {
                eventType: "ssr_render",
                url: request.url,
                ...(process.env.NODE_ENV === "production"
                  ? buildErrorMetadata(error)
                  : {
                      ...buildErrorMetadata(error),
                      stack: error instanceof Error ? error.stack : undefined,
                    }),
              });
            },
          }
        );

        setTimeout(abort, streamTimeout + 1000);
      });
    } catch (err) {
      // Synchronous failures initiating SSR
      logger.error("Failed to initiate SSR", {
        eventType: "ssr_render",
        url: request.url,
        ...(process.env.NODE_ENV === "production"
          ? buildErrorMetadata(err)
          : {
              ...buildErrorMetadata(err),
              stack: err instanceof Error ? err.stack : undefined,
            }),
      });

      responseHeaders.set("Content-Type", "text/plain");
      setRequestIdHeader(responseHeaders, requestId);

      return new Response("Internal Server Error", {
        status: 500,
        headers: responseHeaders,
      });
    }
  });
}
