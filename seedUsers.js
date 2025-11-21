// seedUsers.js
const mongoose = require("mongoose");

const MONGO_URL = process.env.MONGO_URL;
mongoose.connect(MONGO_URL)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ Connection error:", err));

const userSchema = new mongoose.Schema({
  userName: String,
  phone: String,
  score: Number,
  attendedCount: Number,
  missedCount: Number,
  attendanceRate: Number,
  category: String
});
const User = mongoose.model("User", userSchema);

async function seedUsers() {
  await User.deleteMany(); // optional: clean old test data

  mongoose.connection.close();
}

seedUsers();