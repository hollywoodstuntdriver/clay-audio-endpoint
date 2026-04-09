import { fal } from "@fal-ai/client";
import { createClient } from "@supabase/supabase-js";

fal.config({ credentials: process.env.FAL_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL.trim(),
  process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
);

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
    // 1. Check status
    const status = await fal.queue.status("fal-ai/bytedance/omnihuman/v1.5", {
      requestId: request_id,
    });

    if (status.status === "IN_QUEUE" || status.status === "IN_PROGRESS") {
      return res.status(200).json({ status: "processing" });
    }

    if (status.status === "FAILED") {
      return res.status(500).json({ error: "fal.ai job failed", detail: status });
    }

    // 2. Fetch result
    const result = await fal.queue.result("fal-ai/bytedance/omnihuman/v1.5", {
      requestId: request_id,
    });

    const videoUrl = result.data?.video?.url;

    if (!videoUrl) {
      return res.status(500).json({ error: "No video URL in result", detail: result.data });
    }

    // 3. Download video
    const videoRes = await fetch(videoUrl);
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

    // 4. Upload to Supabase
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

    // 5. Return public URL
    const video_url = `${process.env.SUPABASE_URL.trim()}/storage/v1/object/public/video/${filename}`;
    return res.status(200).json({ status: "completed", video_url });

  } catch (err) {
    return res.status(500).json({ error: "Unexpected error", detail: err.message, body: err.body ?? null });
  }
}
