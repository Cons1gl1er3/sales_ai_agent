import * as dotenv from "dotenv";
import { resolve } from "path";

// Load environment variables from .env file
dotenv.config({ path: resolve(__dirname, "../.env") });

export const proxyConfig = {
  host: process.env.PROXY_HOST || "localhost",
  port: parseInt(process.env.PROXY_PORT || "8765"),
  audioParams: {
    sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE || "24000"),
    channels: parseInt(process.env.AUDIO_CHANNELS || "1"),
    bitDepth: parseInt(process.env.AUDIO_BIT_DEPTH || "16"),
  },
};

// API keys
export const apiKeys = {
  openai: process.env.OPENAI_API_KEY || "",
};

if (!apiKeys.openai) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}