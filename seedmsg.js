// seedMessages.js
const mongoose = require("mongoose");
const fs = require("fs");
const csv = require("csv-parser");

mongoose.connect("mongodb://127.0.0.1:27017/appointments")
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ Connection error:", err));

const messageSchema = new mongoose.Schema({
  category: String,
  text: String
});
const Message = mongoose.model("Message", messageSchema);

async function importMessages() {
  const results = [];

  // 👇 Read the CSV as raw text, remove BOM if exists, then re-save temporarily
  const raw = fs.readFileSync("messages.csv", "utf8").replace(/^\uFEFF/, "");
  fs.writeFileSync("messages_clean.csv", raw, "utf8");

  // Now read the cleaned file
  fs.createReadStream("messages_clean.csv")
    .pipe(csv())
    .on("data", (data) => {
      const categoryKey = Object.keys(data).find(k => k.toLowerCase().includes("category"));
      const textKey = Object.keys(data).find(k => k.toLowerCase().includes("text"));

      results.push({
        category: data[categoryKey]?.trim(),
        text: data[textKey]?.trim()
      });
    })
    .on("end", async () => {
      try {
        await Message.deleteMany({});
        console.log("🧹 Old messages deleted.");

        await Message.insertMany(results);
        console.log(`✅ ${results.length} messages imported successfully!`);

        const sample = await Message.findOne();
        console.log("🔍 Example from database:", sample);

        mongoose.connection.close();
      } catch (err) {
        console.error("❌ Error importing messages:", err);
      }
    });
}

importMessages();
