import fp from "fastify-plugin";

const locationPlugin = fp(async (fastify, opts) => {
  const processHeader = (headerValue: string | string[] | undefined) => {
    if (Array.isArray(headerValue)) {
      return headerValue.join(",");
    }
    return headerValue;
  };

  fastify.decorateRequest("location", {
    getter() {
      return {
        country: processHeader(this.headers["cloudfront-viewer-country"]),
        city: processHeader(this.headers["cloudfront-viewer-city"]),
        region: processHeader(this.headers["cloudfront-viewer-country-region"]),
        latitude: processHeader(this.headers["cloudfront-viewer-latitude"]),
        longitude: processHeader(this.headers["cloudfront-viewer-longitude"]),
        postalCode: processHeader(
          this.headers["cloudfront-viewer-postal-code"],
        ),
      };
    },
  });
});

export default locationPlugin;
