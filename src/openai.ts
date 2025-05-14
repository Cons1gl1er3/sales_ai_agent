import axios from "axios";
import { apiKeys } from "./config";
import { createLogger } from "./utils";

const logger = createLogger("OpenAI");

class OpenAIClient {
  async transcribe(audio: Buffer): Promise<string> {
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          file: audio, // Adjust format as needed (e.g., convert to WAV)
          model: "gpt-4o-mini-transcribe",
        },
        {
          headers: {
            Authorization: `Bearer ${apiKeys.openai}`,
            "Content-Type": "multipart/form-data",
          },
        }
      );
      logger.info(`Transcription: ${response.data.text}`);
      return response.data.text;
    } catch (error) {
      logger.error("OpenAI transcription error:", error);
      throw error;
    }
  }
}

export { OpenAIClient };