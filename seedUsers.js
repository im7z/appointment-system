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

  const users = [
    {
      userName: "Ali",
      phone: "0500000001",
      score: 40,
      attendedCount: 1,
      missedCount: 4,
      attendanceRate: 50,
      category: "At-Risk"
    },
    {
      userName: "Ahmed",
      phone: "0500000002",
      score: 120,
      attendedCount: 6,
      missedCount: 3,
      attendanceRate: 66.6,
      category: "Good"
    },
    {
      userName: "Mohammad",
      phone: "0500000003",
      score: 250,
      attendedCount: 10,
      missedCount: 1,
      attendanceRate: 90.9,
      category: "Very Good"
    }
  ];

  await User.insertMany(users);
  console.log("✅ 3 users inserted successfully!");
  mongoose.connection.close();
}

seedUsers();