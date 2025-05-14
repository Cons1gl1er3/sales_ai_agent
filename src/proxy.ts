import WebSocket from "ws";
import axios from "axios";
import FormData from "form-data";
import { PassThrough } from "stream";
import wav from "wav";
import { proxyConfig, apiKeys } from "./config";
import { createLogger } from "./utils"

const logger = createLogger("Proxy");

interface SpeakerInfo {
  name: string;
  id: number;
  timestamp: number;
  isSpeaking: boolean;
}

// Helper function to safely inspect message content
function inspectMessage(message: Buffer | string | unknown): string {
  try {
    // If it's a buffer, convert to string for inspection
    if (Buffer.isBuffer(message)) {
      // Try to parse as JSON first
      try {
        const jsonStr = message.toString("utf8");
        const json = JSON.parse(jsonStr);
        return `[Buffer as JSON] ${JSON.stringify(json, null, 2)}`;
      } catch {
        // If not JSON, show as hex if it's binary-looking, or as string if not
        const str = message.toString("utf8");
        if (/[\x00-\x08\x0E-\x1F\x80-\xFF]/.test(str)) {
          // Likely binary data, show first 100 bytes as hex
          return `[Binary Buffer] ${message.slice(0, 100).toString("hex")}${
            message.length > 100 ? "..." : ""
          }`;
        } else {
          // Printable string
          return `[String Buffer] ${str.slice(0, 500)}${
            str.length > 500 ? "..." : ""
          }`;
        }
      }
    }

    // If it's already a string
    if (typeof message === "string") {
      // Try to parse as JSON
      try {
        const json = JSON.parse(message);
        return `[String as JSON] ${JSON.stringify(json, null, 2)}`;
      } catch {
        // Plain string
        return `[String] ${message.slice(0, 500)}${
          message.length > 500 ? "..." : ""
        }`;
      }
    }

    // For any other type
    return `[${typeof message}] ${JSON.stringify(message, null, 2)}`;
  } catch (error) {
    return `[Inspection Error] Failed to inspect message: ${error}`;
  }
}

class TranscriptionProxy {
  private server: WebSocket.Server;
  private audioBuffer: Buffer[] = []; // Stores audio chunks
  private totalBytes: number = 0;
  private lastSpeaker: string | null = null;
  private readonly chunkDuration: number = 5; // 5-second chunks
  private readonly sampleRate: number = proxyConfig.audioParams.sampleRate;
  private readonly channels: number = proxyConfig.audioParams.channels;
  private readonly bitDepth: number = proxyConfig.audioParams.bitDepth;
  private readonly bytesPerSecond: number = (this.sampleRate * this.bitDepth) / 8 * this.channels;

  constructor() {
    // Single WebSocket server
    this.server = new WebSocket.Server({
      host: proxyConfig.host,
      port: proxyConfig.port,
    });

    logger.info(`WebSocket server started on ${proxyConfig.host}:${proxyConfig.port}`);

    
    // Handle incoming connections from n8n's streaming.input
    this.server.on("connection", (ws) => {
      logger.info("New connection established");

      this.setupAudioStreamClient(ws);
    });
  }

  // private setupAudioStreamClient(ws: WebSocket) {
  //     // Determine if this is a bot or MeetingBaas client
  //     ws.once("message", (message) => {
  //       try {
  //         const msg = JSON.parse(message.toString());
  //         if (msg.type === "register" && msg.client === "bot") {
  //           this.setupBotClient(ws);
  //         } else {
  //           this.setupMeetingBaasClient(ws);
  //         }
  //       } catch (error) {
  //         // If message is not valid JSON, assume it's a MeetingBaas client
  //         this.setupMeetingBaasClient(ws);
  //       }
  //     });
  //   });
  // }

  // private setupBotClient(ws: WebSocket) {
  //   logger.info("Bot client connected");
  //   this.botClient = ws;

  //   ws.on("message", (message) => {
  //     // Log all messages from bot
  //     logger.info(`Message from bot: ${inspectMessage(message)}`);

  //     // Forward bot messages to all MeetingBaas clients
  //     this.meetingBaasClients.forEach((client) => {
  //       if (client.readyState === WebSocket.OPEN) {
  //         client.send(message.toString());
  //       }
  //     });
  //   });

  //   ws.on("close", () => {
  //     logger.info("Bot client disconnected");
  //     this.botClient = null;
  //   });

  //   ws.on("error", (error) => {
  //     logger.error("Bot client error:", error);
  //   });
  // }

  private setupAudioStreamClient(ws: WebSocket) {
    ws.on("message", async (message) => {
      if (Buffer.isBuffer(message)) {
        // Handle raw audio bytes
        this.audioBuffer.push(message);
        this.totalBytes += message.length;
        const bufferDuration = this.totalBytes / this.bytesPerSecond;

        if (bufferDuration >= this.chunkDuration) {
          const combinedAudio = Buffer.concat(this.audioBuffer);
          try {
            const wavBuffer = await this.createWavBuffer(combinedAudio, this.sampleRate);
            const transcription = await this.transcribeWithOpenAI(wavBuffer);
            logger.info(`Transcription: ${transcription}`);
          } catch (error) {
            logger.error("Failed to transcribe audio chunk:", error);
          }
          // Reset the buffer after transcription
          this.audioBuffer = [];
          this.totalBytes = 0;
        }
      } else if (typeof message === "string") {
        // Handle speaker diarization JSON
        try {
          const speakerData = JSON.parse(message);
          if (
            Array.isArray(speakerData) &&
            speakerData.length > 0 &&
            "name" in speakerData[0] &&
            "id" in speakerData[0] &&
            "timestamp" in speakerData[0] &&
            "isSpeaking" in speakerData[0]
          ) {
            const speakerInfo = speakerData[0] as SpeakerInfo;
            if (
              speakerInfo.isSpeaking &&
              (this.lastSpeaker === null || this.lastSpeaker !== speakerInfo.name)
            ) {
              this.lastSpeaker = speakerInfo.name;
              logger.info(`New speaker detected: ${speakerInfo.name} (ID: ${speakerInfo.id})`);
            }
          } else {
            logger.info(`Received non-speaker JSON: ${message}`);
          }
        } catch (error) {
          logger.warn(`Invalid JSON received: ${message}`);
        }
      }
    });

    ws.on("close", async () => {
      logger.info("WebSocket connection closed");
      // Process any remaining audio in the buffer
      if (this.audioBuffer.length > 0) {
        const combinedAudio = Buffer.concat(this.audioBuffer);
        try {
          const wavBuffer = await this.createWavBuffer(combinedAudio, this.sampleRate);
          const transcription = await this.transcribeWithOpenAI(wavBuffer);
          logger.info(`Final transcription: ${transcription}`);
        } catch (error) {
          logger.error("Failed to transcribe remaining audio:", error);
        }
        this.audioBuffer = [];
        this.totalBytes = 0;
      }
      this.lastSpeaker = null;
    });

    ws.on("error", (error) => {
      logger.error("WebSocket error:", error);
    });
  }

  //   ws.on("message", (message) => {
  //     // Skip logging binary buffers and try to transcribe them
  //     if (Buffer.isBuffer(message)) {
  //       // Try to identify if it's audio data
  //       try {
  //         const jsonStr = message.toString("utf8");
  //         const jsonData = JSON.parse(jsonStr);

  //         // If it's speaker information
  //         if (
  //           Array.isArray(jsonData) &&
  //           jsonData.length > 0 &&
  //           "name" in jsonData[0] &&
  //           "isSpeaking" in jsonData[0]
  //         ) {
  //           const speakerInfo = jsonData[0] as SpeakerInfo;

  //           // Only log when a new speaker starts talking (different from the last one)
  //           // or when we haven't seen any speaker yet
  //           if (
  //             speakerInfo.isSpeaking &&
  //             (this.lastSpeaker === null ||
  //               this.lastSpeaker !== speakerInfo.name)
  //           ) {
  //             // Update our last speaker tracking
  //             this.lastSpeaker = speakerInfo.name;

  //             // Log the new speaker
  //             logger.info(
  //               `New speaker: ${speakerInfo.name} (id: ${speakerInfo.id})`
  //             );
  //           }

  //           // For other JSON messages, log as usual without speaker tracking
  //         } else {
  //           logger.info(`Message from MeetingBaas: ${inspectMessage(message)}`);
  //         }
  //       } catch {
  //         // Likely audio data, send to Gladia for transcription
  //         if (this.isGladiaSessionActive) {
  //           this.gladiaClient.sendAudioChunk(message);
  //         }
  //       }
  //     } else {
  //       // For non-binary messages, log as usual
  //       logger.info(`Message from MeetingBaas: ${inspectMessage(message)}`);
  //     }

  //     // Forward MeetingBaas messages to bot client
  //     if (this.botClient && this.botClient.readyState === WebSocket.OPEN) {
  //       this.botClient.send(message.toString());
  //     }
  //   });

  //   ws.on("close", () => {
  //     logger.info("MeetingBaas client disconnected");
  //     this.meetingBaasClients.delete(ws);

  //     // End Gladia session if last client disconnects
  //     if (this.meetingBaasClients.size === 0 && this.isGladiaSessionActive) {
  //       this.gladiaClient.endSession();
  //       this.isGladiaSessionActive = false;
  //     }
  //   });

  //   ws.on("error", (error) => {
  //     logger.error("MeetingBaas client error:", error);
  //   });
  // }

  private async createWavBuffer(pcmData: Buffer, sampleRate: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const writer = new wav.Writer({
        channels: this.channels,
        sampleRate: sampleRate,
        bitDepth: this.bitDepth,
      });
      const passThrough = new PassThrough();
      const chunks: Buffer[] = [];

      passThrough.on("data", (chunk) => chunks.push(chunk));
      passThrough.on("end", () => resolve(Buffer.concat(chunks)));
      passThrough.on("error", reject);

      writer.pipe(passThrough);
      writer.write(pcmData);
      writer.end();
    });
  }

  private async transcribeWithOpenAI(wavBuffer: Buffer): Promise<string> {
    const form = new FormData();
    form.append("file", wavBuffer, {
      filename: "audio.wav",
      contentType: "audio/wav",
    });
    form.append("model", "whisper-1");

    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${apiKeys.openai}`,
        },
      }
    );

    if (!response.data.text) {
      throw new Error("No transcription returned from OpenAI");
    }
    return response.data.text;
  }

  public async shutdown(): Promise<void> {
    logger.info("Shutting down proxy server");
    this.server.close();
  }
}

// Start the proxy
const proxy = new TranscriptionProxy();

// Handle graceful shutdown
process.on("SIGINT", async () => {
  await proxy.shutdown();
  process.exit(0);
});

export { TranscriptionProxy };