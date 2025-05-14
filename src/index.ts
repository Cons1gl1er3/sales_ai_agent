import { TranscriptionProxy } from "./proxy";
import { createLogger } from "./utils";

const logger = createLogger("Main");

// Keep reference to the proxy for cleanup
let proxy: TranscriptionProxy | null = null;

// Graceful shutdown handler
function setupGracefulShutdown() {
  process.on("SIGINT", async () => {
    logger.info("Shutting down gracefully...");

    // Close the proxy server
    if (proxy) {
      logger.info("Closing proxy server...");
      await proxy.shutdown();
    }

    logger.info("Cleanup complete, exiting...");
    process.exit(0);
  });
}

async function main() {
  try {
    logger.info("Starting transcription system...");

    // Create the proxy instance
    proxy = new TranscriptionProxy();

    // Setup graceful shutdown
    setupGracefulShutdown();

    logger.info("System initialized successfully");
  } catch (error) {
    logger.error("Error initializing system:", error);
    process.exit(1);
  }
}

main();