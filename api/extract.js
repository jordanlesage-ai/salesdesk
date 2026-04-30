export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    // Forward every rate-limit-related header so the client can pace itself.
    // Anthropic uses `anthropic-ratelimit-*` naming; we also pass through
    // any `x-ratelimit-*` and `retry-after` for forward compat.
    const forwarded = [];
    for (const [key, val] of response.headers.entries()) {
      const k = key.toLowerCase();
      if (k.startsWith("anthropic-ratelimit") || k.startsWith("x-ratelimit") || k === "retry-after") {
        res.setHeader(key, val);
        forwarded.push(key);
      }
    }
    console.log("[extract] forwarded headers:", forwarded.join(",") || "(none)");

    if (!response.ok) {
      console.error("Anthropic error:", JSON.stringify(data));
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Handler error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
