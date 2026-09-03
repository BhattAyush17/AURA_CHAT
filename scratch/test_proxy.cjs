const { chromium } = require("playwright");

(async () => {
  console.log("Launching Playwright...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("Navigating to https://aura-chat-ml.onrender.com/health to bypass Cloudflare...");
  const response = await page.goto("https://aura-chat-ml.onrender.com/health", {
    waitUntil: "networkidle",
  });
  console.log("Health page status:", response.status());

  console.log("Fetching /api/ytmusic/search...");
  const searchStartTime = Date.now();
  const searchResult = await page.evaluate(async () => {
    const res = await fetch("/api/ytmusic/search?query=Counting%20Stars%20OneRepublic");
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return { error: true, message: text };
    }
  });

  console.log(`Search took ${Date.now() - searchStartTime}ms`);
  console.log(
    "SEARCH RESULT:",
    JSON.stringify(
      {
        ...searchResult,
        audio_stream_url: searchResult.audio_stream_url
          ? searchResult.audio_stream_url.substring(0, 80) + "..."
          : null,
      },
      null,
      2,
    ),
  );

  if (searchResult.error || !searchResult.audio_stream_url) {
    console.error("Extraction failed or no audio stream URL returned.");
    await browser.close();
    process.exit(1);
  }

  const streamUrl = searchResult.audio_stream_url;
  const headers = searchResult.http_headers || {};

  // Build proxy URL matching the frontend logic
  const b64Headers = Buffer.from(JSON.stringify(headers)).toString("base64");
  const proxyUrl = `/api/ytmusic/proxy?url=${encodeURIComponent(streamUrl)}&h=${encodeURIComponent(b64Headers)}`;

  console.log("Testing Proxy Endpoint...");
  const proxyStartTime = Date.now();
  const proxyResult = await page.evaluate(async (url) => {
    const res = await fetch(url, { headers: { Range: "bytes=0-65535" } });
    const contentType = res.headers.get("content-type");
    const contentLength = res.headers.get("content-length");
    const status = res.status;
    // read stream
    const buffer = await res.arrayBuffer();
    return {
      status,
      contentType,
      contentLength,
      byteLength: buffer.byteLength,
    };
  }, proxyUrl);

  console.log(`Proxy request took ${Date.now() - proxyStartTime}ms`);
  console.log("PROXY RESULT:", proxyResult);

  await browser.close();
})();
