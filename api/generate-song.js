export const maxDuration = 300;

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { lyrics, title, style } = req.body;

  if (!lyrics) {
    return res.status(400).json({ error: "lyrics is required" });
  }

  try {
    // 1. Call ElevenLabs music API — returns audio directly as binary
    const elevenRes = await fetch("https://api.elevenlabs.io/v1/music/generate", {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: `${style || "pop song"}, lyrics: ${lyrics}`,
      }),
    });

    if (!elevenRes.ok) {
      const errText = await elevenRes.text();
      return res.status(500).json({ error: "ElevenLabs failed", detail: errText });
    }

    // 2. Read audio buffer directly from response
    const audioBuffer = Buffer.from(await elevenRes.arrayBuffer());

    // 3. Build a unique filename
    const slug = (title || "song")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .slice(0, 40);
    const filename = `${slug}-${Date.now()}.mp3`;

    // 4. Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .upload(filename, audioBuffer, {
        contentType: "audio/mpeg",
        upsert: false,
      });

    if (uploadError) {
      return res.status(500).json({ error: "Supabase upload failed", detail: uploadError.message });
    }

    // 5. Return public URL
    const supabaseUrl = process.env.SUPABASE_URL.trim();
    const bucket = process.env.SUPABASE_BUCKET.trim();
    const audio_url = `${supabaseUrl}/storage/v1/object/public/${bucket}/${filename}`;
    return res.status(200).json({ audio_url });

  } catch (err) {
    return res.status(500).json({ error: "Unexpected error", detail: err.message });
  }
}
