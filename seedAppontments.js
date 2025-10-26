// seedAppointments.js
const mongoose = require("mongoose");

mongoose.connect("mongodb://127.0.0.1:27017/appointments");

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

  const now = new Date();

  // 🩺 Create a variety of appointment times
  const appointmentDates = [
    new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days later
    new Date(now.getTime() + 36 * 60 * 60 * 1000),     // 1.5 days later (36h)
    new Date(now.getTime() + 14 * 60 * 60 * 1000),     // 14 hours later
    new Date(now.getTime() + 6 * 60 * 60 * 1000),      // 6 hours later
    new Date(now.getTime() + 60 * 60 * 1000),          // 1 hour later
  ];

  const appointments = [
    { doctorName: "Dr. Sara", date: appointmentDates[0], status: "available" },
    { doctorName: "Dr. Khalid", date: appointmentDates[0], status: "available" },
    { doctorName: "Dr. Noura", date: appointmentDates[0], status: "available" },
    { doctorName: "Dr. Fahad", date: appointmentDates[1], status: "available" },
    { doctorName: "Dr. Amal", date: appointmentDates[2], status: "available" },
    { doctorName: "Dr. Huda", date: appointmentDates[3], status: "available" },
    { doctorName: "Dr. Yasser", date: appointmentDates[4], status: "available" },
  ];

  await Appointment.insertMany(appointments);

  console.log("✅ Multiple test appointments inserted with varied timings:\n");
  appointments.forEach((a, i) => {
    console.log(
      `${i + 1}. ${a.doctorName} → ${a.date.toLocaleString()} [${a.status}]`
    );
  });

  mongoose.connection.close();
}

seedAppointments();