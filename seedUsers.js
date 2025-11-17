// seedUsers.js
const mongoose = require("mongoose");

mongoose.connect("mongodb://127.0.0.1:27017/appointments");

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