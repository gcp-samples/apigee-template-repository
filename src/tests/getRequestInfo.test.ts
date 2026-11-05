import { describe, it, expect } from "vitest";
const { getRequestInfo } = require("../ai-functions/getRequestInfo.js");

describe("getRequestInfo", () => {
  it("should detect audio-text request from URL and payload", () => {
    const info = getRequestInfo("/v1/audio/speech", { model: "tts-1", input: "Hello" });
    expect(info.requestType).toBe("audio-text");
    expect(info.modelName).toBe("tts-1");
    expect(info.input).toBe("Hello");
  });

  it("should detect audio-data request from URL", () => {
    const info = getRequestInfo("/v1/audio/transcriptions", { model: "whisper-1" });
    expect(info.requestType).toBe("audio-data");
    expect(info.protocol).toBe("openai");
  });

  it("should detect image-generation request from URL", () => {
    const info = getRequestInfo("/v1/images/generations", { model: "dall-e-3", prompt: "Art" });
    expect(info.requestType).toBe("image-generation");
    expect(info.input).toBe("Art");
  });

  it("should detect embeddings request from URL", () => {
    const info = getRequestInfo("/v1/embeddings", { model: "text-embedding-3-small", input: "Test" });
    expect(info.requestType).toBe("embeddings");
    expect(info.input).toBe("Test");
  });

  it("should detect Google protocol from contents payload", () => {
    const googlePayload = {
      contents: [{ role: "user", parts: [{ text: "Gemini prompt" }] }]
    };
    const info = getRequestInfo("/publishers/google/models/gemini-1.5-pro:generateContent", googlePayload);
    expect(info.protocol).toBe("google");
    expect(info.modelName).toBe("gemini-1.5-pro");
    expect(info.input).toBe("Gemini prompt");
  });

  it("should detect Anthropic protocol from system or anthropic_version in messages payload", () => {
    const anthropicPayload = {
      model: "claude-3-5-sonnet",
      system: "System instructions",
      messages: [{ role: "user", content: "Claude prompt" }]
    };
    const info = getRequestInfo("", anthropicPayload);
    expect(info.protocol).toBe("anthropic");
    expect(info.input).toBe("Claude prompt");
  });

  it("should handle stringified JSON content and GCP publisher URL format", () => {
    const info = getRequestInfo("/publishers/anthropic/models/claude-3-opus:rawPredict", JSON.stringify({
      messages: [{ role: "user", content: "Opus prompt" }]
    }));
    expect(info.modelName).toBe("claude-3-opus");
    expect(info.protocol).toBe("anthropic");
    expect(info.input).toBe("Opus prompt");
  });

  it("should process target routing and default target routes with and without config", () => {
    const routingConfig = {
      models: {
        "google/gemini-flash-latest": "googlecloud-oai",
        "anthropic/claude-sonnet-5": "googlecloud"
      },
      mappings: {
        "google/gemini-flash-latest": "google/gemini-3.6-flash"
      }
    };

    const infoWithConfig = getRequestInfo("/v1/chat/completions", {
      model: "google/gemini-flash-latest",
      messages: [{ role: "user", content: "Hi" }]
    }, "application/json", routingConfig);

    expect(infoWithConfig.provider).toBe("google");
    expect(infoWithConfig.cleanModelName).toBe("gemini-3.6-flash");
    expect(infoWithConfig.mappedModelName).toBe("google/gemini-3.6-flash");
    expect(infoWithConfig.targetRoute).toBe("googlecloud-oai");

    const defaultGoogle = getRequestInfo("", { model: "gemini-1.5-pro" });
    expect(defaultGoogle.provider).toBe("google");
    expect(defaultGoogle.targetRoute).toBe("googlecloud");

    const defaultAnthropic = getRequestInfo("", { model: "claude-3-5-sonnet" });
    expect(defaultAnthropic.provider).toBe("anthropic");
    expect(defaultAnthropic.targetRoute).toBe("anthropic");

    const defaultOpenAi = getRequestInfo("", { model: "gpt-4o" });
    expect(defaultOpenAi.provider).toBe("openai");
    expect(defaultOpenAi.targetRoute).toBe("openai");
  });

  it("should support provider prefix routing keys and un-prefixed models", () => {
    const routingConfig = {
      models: {
        "google/": "googlecloud-oai",
        "anthropic/": "googlecloud",
        "openai/": "openai"
      },
      mappings: {
        "google/gemini-flash-latest": "google/gemini-3.6-flash"
      }
    };

    // 1. Prefixed model matching "google/"
    const res1 = getRequestInfo("/v1/chat/completions", { model: "google/gemini-3.6-flash" }, "application/json", routingConfig);
    expect(res1.provider).toBe("google");
    expect(res1.cleanModelName).toBe("gemini-3.6-flash");
    expect(res1.targetRoute).toBe("googlecloud-oai");

    // 2. Un-prefixed google-3.6-flash matching "google/"
    const res2 = getRequestInfo("/v1/chat/completions", { model: "google-3.6-flash" }, "application/json", routingConfig);
    expect(res2.provider).toBe("google");
    expect(res2.cleanModelName).toBe("google-3.6-flash");
    expect(res2.targetRoute).toBe("googlecloud-oai");

    // 3. Un-prefixed gemini-3.6-flash matching "google/"
    const res3 = getRequestInfo("/v1/chat/completions", { model: "gemini-3.6-flash" }, "application/json", routingConfig);
    expect(res3.provider).toBe("google");
    expect(res3.cleanModelName).toBe("gemini-3.6-flash");
    expect(res3.targetRoute).toBe("googlecloud-oai");

    // 4. Anthropic prefixed matching "anthropic/"
    const res4 = getRequestInfo("/v1/chat/completions", { model: "anthropic/claude-sonnet-5" }, "application/json", routingConfig);
    expect(res4.provider).toBe("anthropic");
    expect(res4.cleanModelName).toBe("claude-sonnet-5");
    expect(res4.targetRoute).toBe("googlecloud");

    // 5. Anthropic un-prefixed matching "anthropic/"
    const res5 = getRequestInfo("/v1/chat/completions", { model: "claude-sonnet-5" }, "application/json", routingConfig);
    expect(res5.provider).toBe("anthropic");
    expect(res5.cleanModelName).toBe("claude-sonnet-5");
    expect(res5.targetRoute).toBe("googlecloud");
  });

  it("should extract model from /models/{model} and recognize streamGenerateContent URL path", () => {
    const streamInfo = getRequestInfo("/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse", {
      contents: [{ role: "user", parts: [{ text: "Hello Gemini" }] }]
    });
    expect(streamInfo.modelName).toBe("gemini-3.8-flash");
    expect(streamInfo.rawModelName).toBe("gemini-3.8-flash");
    expect(streamInfo.cleanModelName).toBe("gemini-3.8-flash");
    expect(streamInfo.isStreaming).toBe(true);
    expect(streamInfo.streaming).toBe("streaming");
    expect(streamInfo.protocol).toBe("google");
    expect(streamInfo.provider).toBe("google");
    expect(streamInfo.method).toBe("streamGenerateContent");
    expect(streamInfo.targetRoute).toBe("googlecloud");
    expect(streamInfo.input).toBe("Hello Gemini");

    const nonStreamInfo = getRequestInfo("/v1beta/models/gemini-3.8-flash:generateContent", null);
    expect(nonStreamInfo.modelName).toBe("gemini-3.8-flash");
    expect(nonStreamInfo.cleanModelName).toBe("gemini-3.8-flash");
    expect(nonStreamInfo.isStreaming).toBe(false);
    expect(nonStreamInfo.method).toBe("generateContent");
    expect(nonStreamInfo.provider).toBe("google");
    expect(nonStreamInfo.protocol).toBe("google");

    const plainModelInfo = getRequestInfo("/models/gemini-3.8-flash", null);
    expect(plainModelInfo.modelName).toBe("gemini-3.8-flash");
    expect(plainModelInfo.cleanModelName).toBe("gemini-3.8-flash");
    expect(plainModelInfo.provider).toBe("google");
  });
});
