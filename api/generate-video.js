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

  let { audio_url, photo_url, title } =
    req.method === "GET" ? req.query : req.body;

  if (req.method === "GET") {
    console.log("raw audio_url:", audio_url);
    if (audio_url) {
      audio_url = decodeURIComponent(audio_url).replace(/^\{\{|\}\}$/g, "").trim();
      console.log("decoded audio_url:", audio_url);
    }
  }

  if (!audio_url || !photo_url) {
    return res.status(400).json({ error: "audio_url and photo_url are required" });
  }

  try {
    // 1. Fetch the photo and re-host it in Supabase so fal.ai can access it
    const photoRes = await fetch(photo_url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/*",
      },
    });
    if (!photoRes.ok) {
      return res.status(500).json({ error: "Failed to fetch photo_url", detail: photoRes.statusText });
    }
    const photoBuffer = Buffer.from(await photoRes.arrayBuffer());
    const contentType = photoRes.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const photoFilename = `photo-${Date.now()}.${ext}`;

    const { error: photoUploadError } = await supabase.storage
      .from("photos")
      .upload(photoFilename, photoBuffer, { contentType, upsert: false });

    if (photoUploadError) {
      return res.status(500).json({ error: "Photo upload failed", detail: photoUploadError.message });
    }

    const hosted_photo_url = `${process.env.SUPABASE_URL.trim()}/storage/v1/object/public/photos/${photoFilename}`;

    // 2. Submit to fal.ai queue and return request_id immediately
    const { request_id } = await fal.queue.submit("fal-ai/bytedance/omnihuman/v1.5", {
      input: {
        image_url: hosted_photo_url,
        audio_url: audio_url,
      },
    });

    return res.status(200).json({ request_id, title: title || "video" });

  } catch (err) {
    return res.status(500).json({ error: "Unexpected error", detail: err.message, body: err.body ?? null });
  }
}
