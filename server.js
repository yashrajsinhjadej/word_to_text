require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Document, Packer, Paragraph, TextRun } = require("docx");

const app = express();
const port = process.env.PORT || 3000;

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer setup
const upload = multer({ dest: uploadDir });

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

// Gemini init
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Upload endpoint
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  console.log(`[UPLOAD] ${req.file.originalname}`);
  res.json({ message: "✅ Uploaded", file: req.file.filename });
});

// Finalize endpoint
app.get("/finalize", async (req, res) => {
  try {
    const files = fs.readdirSync(uploadDir);
    if (!files.length) return res.status(400).send("❌ No files uploaded yet.");

    let allParagraphs = [];
    for (const file of files) {
      const filePath = path.join(uploadDir, file);
      const imageBase64 = fs.readFileSync(filePath).toString("base64");

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent([
        { inlineData: { data: imageBase64, mimeType: "image/jpeg" } },
        { text: "Extract text from this image and keep formatting/line breaks." }
      ]);

      let extracted = result.response.text();
      console.log(`[OCR] Extracted: ${extracted.slice(0, 50)}...`);

      // Formatting
      const lines = extracted.split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.includes(":")) {
          const [key, ...rest] = line.split(":");
          allParagraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: key + ":", bold: true }),
                new TextRun(" " + rest.join(":").trim())
              ]
            })
          );
        } else {
          allParagraphs.push(new Paragraph(line));
        }
      }
      allParagraphs.push(new Paragraph("")); // spacing
    }

    // Build Word doc
    const doc = new Document({
      sections: [{ children: allParagraphs }]
    });
    const buffer = await Packer.toBuffer(doc);

    res.setHeader("Content-Disposition", "attachment; filename=output.docx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.send(buffer);

    // Cleanup
    files.forEach(f => fs.unlinkSync(path.join(uploadDir, f)));
  } catch (err) {
    console.error("[FINALIZE] Error:", err);
    res.status(500).send("❌ Error finalizing document");
  }
});

// Start server
app.listen(port, () => console.log(`🚀 Server running at http://localhost:${port}`));
