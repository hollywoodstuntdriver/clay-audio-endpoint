import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { lyrics, title } = req.body;

  if (!lyrics) {
    return res.status(400).json({ error: "lyrics is required" });
  }

  try {
    // 1. Call ElevenLabs
    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: lyrics,
          model_id: "eleven_multilingual_v2",
        }),
      }
    );

    if (!elevenRes.ok) {
      const errText = await elevenRes.text();
      return res.status(500).json({ error: "ElevenLabs failed", detail: errText });
    }

    // 2. Convert response to buffer
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

    // 5. Build public URL
    const audio_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${filename}`;

    return res.status(200).json({ audio_url });

  } catch (err) {
    return res.status(500).json({ error: "Unexpected error", detail: err.message });
  }
}
