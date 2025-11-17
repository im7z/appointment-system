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

  mongoose.connection.close();
}

seedAppointments();