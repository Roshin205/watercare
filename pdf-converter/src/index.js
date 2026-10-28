// The watercare-pdf Worker: forwards certificate files to the LibreOffice container and returns the PDF.
// It has no public URL (workers_dev: false); only the WaterCare Worker reaches it, through its PDF service binding.
import { Container } from "@cloudflare/containers";

export class PdfConverter extends Container {
  defaultPort = 8080;
  // Stay warm for a few minutes after a conversion, then sleep so idle time is not billed.
  sleepAfter = "3m";
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/convert") {
      return new Response("Not found", { status: 404 });
    }
    return env.PDF_CONVERTER.getByName("converter").fetch(request);
  },
};
