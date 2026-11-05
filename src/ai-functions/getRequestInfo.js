if (typeof require !== "undefined") {
  var utilities = require("./utilities");
  if (typeof getBodyString === "undefined") getBodyString = utilities.getBodyString;
  if (typeof extractGoogleInput === "undefined") extractGoogleInput = utilities.extractGoogleInput;
  if (typeof extractMessagesInput === "undefined") extractMessagesInput = utilities.extractMessagesInput;
  if (typeof parseMultipartFormData === "undefined") parseMultipartFormData = require("./parseMultipartFormData").parseMultipartFormData;
}

function getRequestInfo(urlString, content, contentType, routingConfig) {
  var info = {
    input: "",
    rawModelName: "",
    modelName: "unknown",
    cleanModelName: "",
    protocol: "unknown",
    provider: "unknown",
    targetRoute: "",
    region: "global",
    requestType: "text",
    isStreaming: false,
    streaming: "non-streaming"
  };

  var url = urlString || "";
  var lowerUrl = url.toLowerCase();

  // 1. Detect requestType and streaming from URL
  if (lowerUrl.indexOf("/audio/speech") !== -1 || lowerUrl.indexOf("/speech/audio") !== -1) {
    info.requestType = "audio-text";
  } else if (lowerUrl.indexOf("/audio/transcription") !== -1 || lowerUrl.indexOf("/audio/translation") !== -1) {
    info.requestType = "audio-data";
  } else if (lowerUrl.indexOf("/images/generations") !== -1 || lowerUrl.indexOf("/images/edits") !== -1 || lowerUrl.indexOf("/images/variations") !== -1) {
    info.requestType = "image-generation";
  } else if (lowerUrl.indexOf("/embeddings") !== -1) {
    info.requestType = "embeddings";
  }

  if (lowerUrl.indexOf("stream") !== -1) {
    info.isStreaming = true;
    info.streaming = "streaming";
  }

  // 2. Parse request payload
  var contentData = null;
  if (typeof content === "object" && content !== null && !content.asJSON && !content.asString) {
    if (
      content.model !== undefined ||
      content.modelVersion !== undefined ||
      content.contents !== undefined ||
      content.messages !== undefined ||
      content.input !== undefined ||
      content.prompt !== undefined ||
      content.stream !== undefined
    ) {
      contentData = content;
    }
  }

  if (!contentData) {
    var bodyStr = typeof getBodyString === "function" ? getBodyString(content) : (typeof content === "string" ? content : "");
    var isMultipart = (info.requestType === "audio-data") ||
                      (contentType && contentType.toLowerCase().indexOf("multipart") !== -1) ||
                      (bodyStr && bodyStr.indexOf("--") === 0);

    if (bodyStr && isMultipart) {
      contentData = typeof parseMultipartFormData === "function" ? parseMultipartFormData(bodyStr, contentType) : null;
    } else if (content) {
      if (typeof content === "object" && content.asJSON) {
        contentData = content.asJSON;
      } else if (typeof content === "string") {
        try {
          contentData = JSON.parse(content);
        } catch (e) {}
      } else if (bodyStr && bodyStr !== "[object Object]") {
        try {
          contentData = JSON.parse(bodyStr);
        } catch (e) {}
      } else if (typeof content === "object") {
        contentData = content;
      }
    }
  }

  // 3. Extract model, streaming, and fallback requestType from contentData
  if (contentData && typeof contentData === "object") {
    if (contentData.stream === true || contentData.stream === "true") {
      info.isStreaming = true;
      info.streaming = "streaming";
    }

    if (info.requestType === "text" && contentData["voice"] !== undefined && contentData["input"] !== undefined) {
      info.requestType = "audio-text";
    }

    if (contentData["model"] && typeof contentData["model"] === "string") {
      info.rawModelName = contentData["model"];
      var modelParts = info.rawModelName.split("/");
      info.modelName = modelParts[modelParts.length - 1];
    } else if (contentData["modelVersion"] && typeof contentData["modelVersion"] === "string") {
      info.rawModelName = contentData["modelVersion"];
      info.modelName = contentData["modelVersion"];
    }
  }

  if (info.requestType === "audio-data" && info.protocol === "unknown") {
    info.protocol = "openai";
  }

  // 4. Extract modelName from GCP publisher or /models/{model} URL format if not yet determined
  if (info.modelName === "unknown" && url) {
    if (url.indexOf("/publishers/anthropic/models/") !== -1) {
      var aParts = url.split("/publishers/anthropic/models/");
      if (aParts.length > 1) {
        info.modelName = aParts[1].split(":")[0].split("?")[0];
      }
    } else if (url.indexOf("/publishers/google/models/") !== -1) {
      var gParts = url.split("/publishers/google/models/");
      if (gParts.length > 1) {
        info.modelName = gParts[1].split(":")[0].split("?")[0];
      }
    } else if (url.indexOf("/models/") !== -1) {
      var mParts = url.split("/models/");
      if (mParts.length > 1) {
        var m = mParts[mParts.length - 1].split(":")[0].split("?")[0].split("/")[0].split("#")[0].trim();
        if (m) {
          info.modelName = m;
        }
      }
    } else if (url.indexOf(":streamGenerate") !== -1) {
      var sgenParts = url.split(":streamGenerate");
      if (sgenParts.length > 1) {
        var suParts = sgenParts[0].split("/");
        info.modelName = suParts[suParts.length - 1];
      }
    } else if (url.indexOf(":generate") !== -1) {
      var genParts = url.split(":generate");
      if (genParts.length > 1) {
        var uParts = genParts[0].split("/");
        info.modelName = uParts[uParts.length - 1];
      }
    }
    if (!info.rawModelName && info.modelName !== "unknown") {
      info.rawModelName = info.modelName;
    }
  }

  // 5. Detect API protocol and extract user input / prompt
  if (contentData && typeof contentData === "object") {
    if (contentData["contents"] && Array.isArray(contentData["contents"])) {
      info.protocol = "google";
      info.input = typeof extractGoogleInput === "function" ? extractGoogleInput(contentData["contents"]) : "";
    } else if (contentData["messages"] && Array.isArray(contentData["messages"])) {
      if (
        contentData["system"] !== undefined ||
        contentData["anthropic_version"] !== undefined ||
        contentData["top_k"] !== undefined ||
        lowerUrl.indexOf("/publishers/anthropic/") !== -1 ||
        info.modelName.toLowerCase().indexOf("claude") !== -1
      ) {
        info.protocol = "anthropic";
      } else {
        info.protocol = "openai";
      }
      info.input = typeof extractMessagesInput === "function" ? extractMessagesInput(contentData["messages"]) : "";
    } else if (contentData["prompt"] !== undefined) {
      info.protocol = "openai";
      if (typeof contentData["prompt"] === "string") {
        info.input = contentData["prompt"];
      } else if (Array.isArray(contentData["prompt"])) {
        info.input = contentData["prompt"].join(" ");
      }
    } else if (contentData["input"] !== undefined) {
      info.protocol = "openai";
      if (typeof contentData["input"] === "string") {
        info.input = contentData["input"];
      } else if (Array.isArray(contentData["input"])) {
        info.input = contentData["input"].join(" ");
      }
    }
  }

  if (info.protocol === "unknown" && url) {
    if (
      url.indexOf("/publishers/google/") !== -1 ||
      url.indexOf(":generate") !== -1 ||
      url.indexOf(":streamGenerate") !== -1
    ) {
      info.protocol = "google";
    } else if (url.indexOf("/publishers/anthropic/") !== -1) {
      info.protocol = "anthropic";
    }
  }

  // 6. Process Target Routing and Provider / Model Normalization
  var currentModel = info.rawModelName || (info.modelName !== "unknown" ? info.modelName : "");
  info.cleanModelName = info.modelName !== "unknown" ? info.modelName : "";

  if (currentModel) {
    var parsedConfig = null;
    if (routingConfig) {
      if (typeof routingConfig === "string") {
        try {
          parsedConfig = JSON.parse(routingConfig);
        } catch (e) {}
      } else if (typeof routingConfig === "object") {
        parsedConfig = routingConfig;
      }
    }

    // A. Check config mappings
    if (parsedConfig && parsedConfig.mappings) {
      if (parsedConfig.mappings[currentModel]) {
        currentModel = parsedConfig.mappings[currentModel];
        info.mappedModelName = currentModel;
      } else {
        var rawProv = "";
        var clean = currentModel;
        if (currentModel.indexOf("/") !== -1) {
          var p = currentModel.split("/");
          rawProv = p[0];
          clean = p.slice(1).join("/");
        }
        var provModelKey = rawProv ? (rawProv + "/" + clean) : clean;
        if (parsedConfig.mappings[provModelKey]) {
          currentModel = parsedConfig.mappings[provModelKey];
          info.mappedModelName = currentModel;
        } else if (parsedConfig.mappings[clean]) {
          currentModel = parsedConfig.mappings[clean];
          info.mappedModelName = currentModel;
        }
      }
    }

    // B. Detect provider and clean model name
    var rawProvider = "";
    var cleanModel = currentModel;

    if (currentModel.indexOf("/") !== -1) {
      var parts = currentModel.split("/");
      rawProvider = parts[0];
      cleanModel = parts.slice(1).join("/");
    }

    if (rawProvider) {
      info.provider = rawProvider;
      info.cleanModelName = cleanModel;
    } else {
      var lower = currentModel.toLowerCase();
      if (lower.indexOf("gemini") !== -1 || lower.indexOf("google") !== -1 || lower.indexOf("embedding") !== -1 || lower.indexOf("imagen") !== -1) {
        info.provider = "google";
        info.targetRoute = "googlecloud";
      } else if (lower.indexOf("claude") !== -1 || lower.indexOf("anthropic") !== -1) {
        info.provider = "anthropic";
        info.targetRoute = "anthropic";
      } else if (lower.indexOf("gpt") !== -1 || lower.indexOf("dall-e") !== -1 || lower.indexOf("o1") !== -1 || lower.indexOf("o3") !== -1 || lower.indexOf("whisper") !== -1 || lower.indexOf("tts") !== -1) {
        info.provider = "openai";
        info.targetRoute = "openai";
      } else {
        info.provider = "unknown";
      }
      info.cleanModelName = cleanModel;
    }

    // C. Check config models for explicit targetRoute mapping or provider prefix mapping
    if (parsedConfig && parsedConfig.models) {
      if (parsedConfig.models[currentModel]) {
        info.targetRoute = parsedConfig.models[currentModel];
      } else if (parsedConfig.models[info.rawModelName]) {
        info.targetRoute = parsedConfig.models[info.rawModelName];
      } else if (parsedConfig.models[cleanModel]) {
        info.targetRoute = parsedConfig.models[cleanModel];
      } else if (info.provider && parsedConfig.models[info.provider + "/" + cleanModel]) {
        info.targetRoute = parsedConfig.models[info.provider + "/" + cleanModel];
      } else if (info.provider && parsedConfig.models[info.provider + "/"]) {
        info.targetRoute = parsedConfig.models[info.provider + "/"];
      } else if (info.provider && parsedConfig.models[info.provider]) {
        info.targetRoute = parsedConfig.models[info.provider];
      } else {
        for (var mKey in parsedConfig.models) {
          if (mKey.charAt(mKey.length - 1) === "/" && (currentModel.indexOf(mKey) === 0 || (info.provider + "/").indexOf(mKey) === 0)) {
            info.targetRoute = parsedConfig.models[mKey];
            break;
          }
        }
      }
    }

    if (info.mappedModelName) {
      info.modelName = cleanModel;
    }
  }

  if (info.protocol === "unknown" && info.provider && info.provider !== "unknown") {
    info.protocol = info.provider;
  }

  // 7. Method resolution based on provider and streaming
  if (info.provider === "anthropic") {
    info.method = info.isStreaming ? "streamRawPredict" : "rawPredict";
  } else if (info.provider === "google") {
    if (info.requestType === "embeddings") {
      info.method = "embedContent";
    } else if (info.isStreaming) {
      info.method = "streamGenerateContent";
    } else {
      info.method = "generateContent";
    }
  }

  return info;
}

function getTargetRoute(modelName, routingConfig) {
  var info = getRequestInfo("", { model: modelName }, "", routingConfig);
  var result = {
    provider: info.provider,
    region: info.region,
    cleanModelName: info.cleanModelName,
    targetRoute: info.targetRoute
  };
  if (info.mappedModelName) {
    result.mappedModelName = info.mappedModelName;
  }
  return result;
}

if (typeof exports !== "undefined") {
  exports.getRequestInfo = getRequestInfo;
  exports.getTargetRoute = getTargetRoute;
}
