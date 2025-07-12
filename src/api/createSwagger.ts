import { fileURLToPath } from "url";
import path from "node:path";
import { writeFile, mkdir } from "fs/promises";
import init from "./index.js"; // Assuming this is your Fastify app initializer

const html = `
<!doctype html>
<html>
  <head>
    <title>Core API Documentation | ACM @ UIUC</title>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1" />
    <meta property="og:title" content="Core API Documentation | ACM @ UIUC" />
    <meta property="og:description" content="The ACM @ UIUC Core API provides services for managing chapter operations." />
    <meta property="description" content="The ACM @ UIUC Core API provides services for managing chapter operations." />
    <meta property="og:image" content="https://static.acm.illinois.edu/square-blue.png" />
    <meta property="og:url" content="https://core.acm.illinois.edu/docs" />
  </head>

  <body>
    <div id="app"></div>

    <!-- Load the Script -->
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>

    <!-- Initialize the Scalar API Reference -->
    <script>
      Scalar.createApiReference('#app', {
        // The URL of the OpenAPI/Swagger document
        url: '/docs/openapi.json',
        // Avoid CORS issues
        proxyUrl: 'https://proxy.scalar.com',
      })
    </script>
  </body>
</html>
`;
/**
 * Generates and saves Swagger/OpenAPI specification files.
 */
async function createSwaggerFiles() {
  try {
    const app = await init(false, false);
    await app.ready();
    console.log("App is ready. Generating specs...");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const outputDir = path.resolve(__dirname, "..", "..", "dist_ui", "docs");
    await mkdir(outputDir, { recursive: true });
    const jsonSpec = JSON.stringify(app.swagger(), null, 2);
    const yamlSpec = app.swagger({ yaml: true });
    await writeFile(path.join(outputDir, "openapi.json"), jsonSpec);
    await writeFile(path.join(outputDir, "openapi.yaml"), yamlSpec);
    await writeFile(path.join(outputDir, "index.html"), html);

    console.log(`✅ Swagger files successfully generated in ${outputDir}`);
    await app.close();
  } catch (err) {
    console.error("❌ Failed to generate Swagger files:", err);
    process.exit(1);
  }
}

createSwaggerFiles();
