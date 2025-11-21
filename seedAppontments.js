// seedAppointments.js
const mongoose = require("mongoose");

const MONGO_URL = process.env.MONGO_URL;
mongoose.connect(MONGO_URL)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ Connection error:", err));

const appointmentSchema = new mongoose.Schema({
  doctorName: String,
  date: Date,
  status: String,
  userName: String,
  reminders: [
    {
      messageType: String,
      sendTime: Date,
      status: String
    }
  ]
});

const Appointment = mongoose.model("Appointment", appointmentSchema);

async function seedAppointments() {
  await Appointment.deleteMany(); // clear old test appointments

  mongoose.connection.close();
}

seedAppointments();