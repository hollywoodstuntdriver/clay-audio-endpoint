export const maxDuration = 300;

import { fal } from "@fal-ai/client";
import { createClient } from "@supabase/supabase-js";

fal.config({ credentials: process.env.FAL_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL.trim(),
  process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
);

const MODEL = "fal-ai/bytedance/omnihuman/v1.5";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { request_id, title } =
    req.method === "GET" ? req.query : req.body;

  if (!request_id) {
    return res.status(400).json({ error: "request_id is required" });
  }

  try {
    // Poll internally until done (max ~4 minutes, 5s between polls)
    const maxAttempts = 48;
    const pollInterval = 5000;
    let result = null;

    for (let i = 0; i < maxAttempts; i++) {
      const status = await fal.queue.status(MODEL, { requestId: request_id });
      console.log(`poll ${i + 1}: status=${status.status}`);

      if (status.status === "COMPLETED") {
        result = await fal.queue.result(MODEL, { requestId: request_id });
        break;
      }

      if (status.status === "FAILED") {
        return res.status(500).json({ error: "fal.ai job failed", detail: status });
      }

      // IN_QUEUE or IN_PROGRESS — wait and retry
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    if (!result) {
      return res.status(200).json({ status: "processing" });
    }

    const videoUrl = result?.data?.video?.url ?? result?.video?.url;
    console.log("fal result videoUrl:", videoUrl);

    if (!videoUrl) {
      return res.status(500).json({ error: "No video URL in result", detail: result });
    }

    // Download video
    const videoRes = await fetch(videoUrl);
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

    // Upload to Supabase
    const slug = (title || "video")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .slice(0, 40);
    const filename = `${slug}-${Date.now()}.mp4`;

    const { error: uploadError } = await supabase.storage
      .from("video")
      .upload(filename, videoBuffer, { contentType: "video/mp4", upsert: false });

    if (uploadError) {
      return res.status(500).json({ error: "Supabase upload failed", detail: uploadError.message });
    }

    const video_url = `${process.env.SUPABASE_URL.trim()}/storage/v1/object/public/video/${filename}`;
    return res.status(200).json({ status: "completed", video_url });

  } catch (err) {
    return res.status(500).json({ error: "Unexpected error", detail: err.message, body: err.body ?? null });
  }
}
