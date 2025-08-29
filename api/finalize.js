const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const uploadDir = '/tmp/uploads';
    
    if (!fs.existsSync(uploadDir)) {
      return res.status(400).json({ error: "❌ No files uploaded yet." });
    }

    const files = fs.readdirSync(uploadDir);
    if (!files.length) {
      return res.status(400).json({ error: "❌ No files uploaded yet." });
    }

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    let allParagraphs = [];

    // Import docx dynamically to avoid module resolution issues
    const docx = require('docx');
    const { Document, Packer, Paragraph, TextRun } = docx;

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
      
      // Format extracted text into Word paragraphs
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

    // Create Word document
    const doc = new Document({ sections: [{ children: allParagraphs }] });
    const buffer = await Packer.toBuffer(doc);
    
    // Return Word document
    res.setHeader('Content-Disposition', 'attachment; filename=extracted_document.docx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(buffer);

    // Cleanup uploaded files
    files.forEach((f) => {
      const filePath = path.join(uploadDir, f);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    
  } catch (err) {
    console.error("[FINALIZE] Error:", err);
    res.status(500).json({ 
      error: "❌ Error processing images",
      details: err.message 
    });
  }
}