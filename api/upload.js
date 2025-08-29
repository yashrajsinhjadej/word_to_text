import fs from "fs";
import path from "path";
import formidable from "formidable";

export const config = {
  api: {
    bodyParser: false, // required for formidable
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const uploadDir = "/tmp/uploads";
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const form = formidable({ multiples: false, uploadDir, keepExtensions: true });

  form.parse(req, (err, fields, files) => {
    if (err) {
      console.error("❌ Upload error:", err);
      return res.status(500).json({ error: "Upload failed" });
    }

    const file = files.file;
    console.log("✅ Uploaded file:", file.originalFilename);

    return res.json({ message: "Uploaded", file: path.basename(file.filepath) });
  });
}
