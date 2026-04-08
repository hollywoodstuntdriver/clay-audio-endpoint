import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Poll ElevenLabs until the music job is done
async function pollForAudio(generationId, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 10000)); // wait 10s between polls

    const res = await fetch(
      `https://api.elevenlabs.io/v1/music/generations/${generationId}`,
      {
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
        },
      }
    );

    const data = await res.json();

    if (data.status === "completed") {
      return data.audio_url; // ElevenLabs hosted URL
    }

    if (data.status === "error") {
      throw new Error(data.error || "ElevenLabs music generation failed");
    }
    // status is "queued" or "generating" — keep polling
  }
  throw new Error("Timed out waiting for music generation");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { lyrics, title, style } = req.body;

  if (!lyrics) {
    return res.status(400).json({ error: "lyrics is required" });
  }

  try {
    // 1. Submit music generation job to ElevenLabs
    const submitRes = await fetch("https://api.elevenlabs.io/v1/music/generate", {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: `${style || "pop song"}, lyrics: ${lyrics}`,
      }),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      return res.status(500).json({ error: "ElevenLabs submit failed", detail: errText });
    }

    const { generation_id } = await submitRes.json();

    // 2. Poll until done and get the ElevenLabs audio URL
    const elevenAudioUrl = await pollForAudio(generation_id);

    // 3. Fetch the audio file so we can upload it to Supabase
    const audioRes = await fetch(elevenAudioUrl);
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    // 4. Build a unique filename
    const slug = (title || "song")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .slice(0, 40);
    const filename = `${slug}-${Date.now()}.mp3`;

    // 5. Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .upload(filename, audioBuffer, {
        contentType: "audio/mpeg",
        upsert: false,
      });

    if (uploadError) {
      return res.status(500).json({ error: "Supabase upload failed", detail: uploadError.message });
    }

    // 6. Return public URL
    const audio_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${filename}`;
    return res.status(200).json({ audio_url });

  } catch (err) {
    return res.status(500).json({ error: "Unexpected error", detail: err.message });
  }
}
