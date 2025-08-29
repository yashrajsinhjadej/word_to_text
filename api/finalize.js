import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Document, Packer, Paragraph, TextRun } from "docx";

export default async function handler(req, res) {
  try {
    const uploadDir = "/tmp/uploads";
    if (!fs.existsSync(uploadDir)) {
      return res.status(400).send("❌ No files uploaded yet.");
    }

    const files = fs.readdirSync(uploadDir);
    if (!files.length) {
      return res.status(400).send("❌ No files uploaded yet.");
    }

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    let allParagraphs = [];

    for (const file of files) {
      const filePath = path.join(uploadDir, file);
      const imageBase64 = fs.readFileSync(filePath).toString("base64");

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent([
        { inlineData: { data: imageBase64, mimeType: "image/jpeg" } },
        { text: "Extract text from this image and keep formatting." }
      ]);

      const extracted = result.response.text();
      console.log(`[OCR] Extracted from ${file}:`, extracted.slice(0, 80));

      const lines = extracted.split("\n").map(l => l.trim()).filter(Boolean);

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
      allParagraphs.push(new Paragraph(""));
    }

    const doc = new Document({
      sections: [{ children: allParagraphs }],
    });
    const buffer = await Packer.toBuffer(doc);

    res.setHeader("Content-Disposition", "attachment; filename=output.docx");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.send(buffer);

    // cleanup
    files.forEach(f => fs.unlinkSync(path.join(uploadDir, f)));
  } catch (err) {
    console.error("[FINALIZE] Error:", err);
    res.status(500).send("❌ Error finalizing document");
  }
}
