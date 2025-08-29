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
const uploadDir = process.env.VERCEL ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer setup
const upload = multer({ dest: uploadDir });


// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Gemini init
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Health check route (for Vercel: /api/health)
app.get('/api/health', (req, res) => {
  res.json({
    message: 'Word-to-Text API Server is running!',
    status: 'Active',
    timestamp: new Date().toISOString()
  });
});


// Health check route
app.get('/health', (req, res) => {
  res.json({
    message: 'Word-to-Text API Server is running!',
    status: 'Active',
    timestamp: new Date().toISOString()
  });
});

// Upload endpoint
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  console.log(`[UPLOAD] ${req.file.originalname}`);
  res.json({ message: "✅ Uploaded", file: req.file.filename });
});

// Finalize endpoint
app.get("/finalize", async (req, res, next) => {
  try {
    const files = fs.readdirSync(uploadDir);
    if (!files.length) return res.status(400).send("❌ No files uploaded yet.");

    let allParagraphs = [];

    for (const file of files) {
      const filePath = path.join(uploadDir, file);
      const imageBase64 = fs.readFileSync(filePath).toString("base64");

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent([
        {
          inlineData: { data: imageBase64, mimeType: "image/jpeg" },
        },
        {
          text: "Extract text from this image and keep formatting/line breaks.",
        },
      ]);

      let extracted = result.response.text();
      console.log(`[OCR] Extracted: ${extracted.slice(0, 50)}...`);

      // Format extracted text
      const lines = extracted
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      for (const line of lines) {
        if (line.includes(":")) {
          const [key, ...rest] = line.split(":");
          allParagraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: key + ":", bold: true }),
                new TextRun(" " + rest.join(":").trim()),
              ],
            })
          );
        } else {
          allParagraphs.push(new Paragraph(line));
        }
      }
      allParagraphs.push(new Paragraph("")); // spacing
    }

    // Create Word doc
    const doc = new Document({ sections: [{ children: allParagraphs }] });
    const buffer = await Packer.toBuffer(doc);

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=output.docx"
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.send(buffer);

    // Cleanup
    files.forEach((f) => fs.unlinkSync(path.join(uploadDir, f)));
  } catch (err) {
    console.error("[FINALIZE] Error:", err);
    next(err);
  }
});


// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

app.listen(port, () => {
  console.log(`🚀 Word-to-Text server running on port ${port}`);
  console.log(`📍 Server URL: http://localhost:${port}`);
});
