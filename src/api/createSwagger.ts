import { fileURLToPath } from "url";
import path from "node:path";
import { writeFile, mkdir } from "fs/promises";
import init from "./index.js"; // Assuming this is your Fastify app initializer

export const docsHtml = `
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
    <style>
      :root {
        --scalar-custom-header-height: 50px;
        /* Default colors (Light Mode) */
        --initial-bg-color: #FFFFFF; /* White */
        --initial-text-color: #2A2F45; /* Black */
      }

      @media (prefers-color-scheme: dark) {
        :root {
          /* Dark Mode colors */
          --initial-bg-color: #0F0F0F; /* Dark Gray */
          --initial-text-color: #E7E7E7; /* Light Gray */
        }
      }

      /* Apply initial landing page colors and hide content */
      body {
        background-color: var(--initial-bg-color);
        color: var(--initial-text-color);
        opacity: 0; /* Hidden by default */
        visibility: hidden;
        transition: opacity 0.3s ease-in-out; /* Smooth fade-in */
        min-height: 100vh; /* Ensures the body always takes at least the full viewport height */
        margin: 0; /* Remove default body margin */
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        font-family: sans-serif; /* Basic font for initial load */
      }

      /* Class to show the body content */
      body.loaded {
        opacity: 1;
        visibility: visible;
      }

      /* Styles for the loading indicator (optional) */
      .loading-indicator {
        font-size: 2em;
        text-align: center;
      }

      /* Original Scalar styles (ensure these are applied after initial hide) */
      .custom-header {
        height: var(--scalar-custom-header-height);
        background-color: var(--scalar-background-1);
        box-shadow: inset 0 -1px 0 var(--scalar-border-color);
        color: var(--scalar-color-1);
        font-size: var(--scalar-font-size-2);
        /* Increased padding on left and right for more space */
        padding: 0 36px; /* Increased from 18px */
        position: sticky;
        justify-content: space-between;
        top: 0;
        z-index: 100;
        width: 100%; /* Ensure header spans full width */
        box-sizing: border-box; /* Include padding in the width calculation */
      }
      .custom-header,
      .custom-header nav {
        display: flex;
        align-items: center;
        gap: 18px;
        font-size: var(--scalar-font-size-3);
      }
      .custom-header a:hover {
        color: var(--scalar-color-2);
      }

      /* If the script targets a specific container, give it a min-height */
      /* This is still useful even if hidden, to reserve space when shown */
      #app {
        min-height: 500px; /* Adjust as needed based on expected content height */
        width: 100%; /* Ensure app container spans full width */
      }
    </style>
    <link rel="preload" href="https://cdn.jsdelivr.net/npm/@scalar/api-reference" as="script" />
  </head>

  <body>
    <div class="loading-indicator">
      Loading API Documentation...
    </div>

    <header class="custom-header scalar-app" style="display: none;">
      <b>ACM @ UIUC</b>
      <nav>
        <a href="https://acm.illinois.edu">Home</a>
        <a href="https://core.acm.illinois.edu">Management Portal</a>
      </nav>
    </header>
    <div id="app" style="display: none;"></div>

    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>

    <script>
      function initializeAndShowPage() {
        // Hide the initial loading indicator
        document.querySelector('.loading-indicator').style.display = 'none';

        // Show the actual header and app container
        document.querySelector('.custom-header').style.display = 'flex';
        document.getElementById('app').style.display = 'block';

        Scalar.createApiReference('#app', {
          url: '/docs/openapi.json',
        });

        // Add a class to the body to make it visible and apply full styles
        document.body.classList.add('loaded');
      }

      // Check if Scalar is already defined, or wait for it to load
      if (typeof Scalar !== 'undefined' && typeof Scalar.createApiReference === 'function') {
        initializeAndShowPage();
      } else {
        document.addEventListener('DOMContentLoaded', initializeAndShowPage);
      }
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
    await writeFile(path.join(outputDir, "index.html"), docsHtml);

    console.log(`✅ Swagger files successfully generated in ${outputDir}`);
    await app.close();
  } catch (err) {
    console.error("❌ Failed to generate Swagger files:", err);
    process.exit(1);
  }
}
if (import.meta.url.includes("createSwagger.ts")) {
  createSwaggerFiles();
}
