import { fileURLToPath } from "url";
import path from "node:path";
import { writeFile, mkdir } from "fs/promises";
import init from "./index.js"; // Assuming this is your Fastify app initializer

const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="ACM @ UIUC Core API Docs" />
  <title>ACM @ UIUC Core API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
<script>
  window.onload = () => {
    window.ui = SwaggerUIBundle({
      url: '/api/documentation/openapi.json',
      dom_id: '#swagger-ui',
    });
  };
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
    const outputDir = path.resolve(__dirname, "..", "..", "dist_ui", "swagger");
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
