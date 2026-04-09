import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL.trim(),
  process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { photo_url } = req.body;

  if (!photo_url) {
    return res.status(400).json({ error: "photo_url is required" });
  }

  try {
    const photoRes = await fetch(photo_url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.linkedin.com/",
      },
    });

    if (!photoRes.ok) {
      return res.status(500).json({ error: "Failed to fetch photo", detail: photoRes.statusText });
    }

    const contentType = photoRes.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const photoBuffer = Buffer.from(await photoRes.arrayBuffer());
    const filename = `photo-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("photos")
      .upload(filename, photoBuffer, { contentType, upsert: false });

    if (uploadError) {
      return res.status(500).json({ error: "Upload failed", detail: uploadError.message });
    }

    const supabase_photo_url = `${process.env.SUPABASE_URL.trim()}/storage/v1/object/public/photos/${filename}`;
    return res.status(200).json({ supabase_photo_url });

  } catch (err) {
    return res.status(500).json({ error: "Unexpected error", detail: err.message });
  }
}
