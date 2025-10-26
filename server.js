// === Import Required Packages ===
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cron = require("node-cron"); // for scheduling automatic reminders

// === Create Express App ===
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static("public"));

// === Connect to MongoDB ===
mongoose.connect("mongodb://127.0.0.1:27017/appointments");

// Stores user info, attendance stats, behavior classification, and phone number
const userSchema = new mongoose.Schema({
  userName: String,
  phone: String, // phone number used for future SMS reminders
  score: { type: Number, default: 0 }, // loyalty points (rewards only)
  attendedCount: { type: Number, default: 0 }, // total attended
  missedCount: { type: Number, default: 0 }, // total missed
  attendanceRate: { type: Number, default: 0 }, // attendance percentage
  category: { type: String, default: "Good" } // behavior class (Good, Very Good, At-Risk)
});
const User = mongoose.model("User", userSchema);

// === Appointment Schema ===
// Holds each appointment info and who booked it
const appointmentSchema = new mongoose.Schema({
  doctorName: String,
  date: Date,
  status: { type: String, default: "available" }, // available, booked, attended, missed
  userName: String,// username who booked it
  reminders: [
    {
      messageType: String, // e.g. "default nudge"
      sendTime: Date,
      status: { type: String, default: "scheduled" } // "scheduled" | "sent"
    }
  ]
});
const Appointment = mongoose.model("Appointment", appointmentSchema);

// === Message Schema ===
// Stores Arabic nudge messages for different categories
const messageSchema = new mongoose.Schema({
  category: String, // "default nudge", "positive nudge", "re-engagement"
  text: String
});
const Message = mongoose.model("Message", messageSchema);


// === 1. Add a new appointment slot ===
app.post("/appointments/add", async (req, res) => {
  // Input: doctorName, date
  const { doctorName, date } = req.body;

  // Save to database as "available"
  const appointment = new Appointment({ doctorName, date, status: "available" });
  await appointment.save();

  res.json({ message: "Appointment added", appointment });
});



// === 2. Show available appointment slots ===
app.get("/appointments/available", async (req, res) => {
  // Find appointments with status = available
  const slots = await Appointment.find({ status: "available" });
  res.json({ message: "Available slots", slots });
});

// === Show booked appointments (for admin) ===
app.get("/appointments/booked", async (req, res) => {
  const booked = await Appointment.find({ status: "booked" });
  res.json({ message: "Booked appointments", appointments: booked });
});

// === Show all appointments (optional helper) ===
app.get("/appointments/all", async (req, res) => {
  const all = await Appointment.find();
  res.json({ message: "All appointments", appointments: all });
});


// 3. Book an Appointment
// When a user books → mark as 'booked'
// → create user if not exists
// → schedule reminders automatically based on user category
app.post("/appointments/book/:id", async (req, res) => {
  const { userName, phone } = req.body;

  // --- Step 1: Update appointment as booked ---
  const appointment = await Appointment.findByIdAndUpdate(
    req.params.id,
    { status: "booked", userName },
    { new: true }
  );

  // --- Step 2: Find or create user ---
  let user = await User.findOne({ userName });
  if (!user) {
    user = new User({ userName, phone });
    await user.save();
  } else if (phone && !user.phone) {
    // update phone if missing
    user.phone = phone;
    await user.save();
  }

  // --- Step 3: Reminder Scheduling Logic ---
  const appointmentTime = new Date(appointment.date);
  const now = new Date();

  // Choose message type based on behavior classification
  let messageType;
  if (user.category === "Very Good") messageType = "positive nudge";
  else if (user.category === "Good") messageType = "default nudge";
  else messageType = "re-engagement";

  let instantReminder = null;

  // Define reminder schedule based on category
  let reminderHours = [24, 2]; // Default for "Good"
  if (user.category === "Very Good") reminderHours = [24];
  else if (user.category === "At-Risk") reminderHours = [48, 6, 1];

  // Prepare reminder list for DB + scheduling
  const reminders = [];

  for (const h of reminderHours) {
    const reminderTime = new Date(appointmentTime - h * 60 * 60 * 1000);

    // === Case 1: Reminder time already passed ===
    if (reminderTime <= now) {
      const messages = await Message.find({ category: messageType });
      if (messages.length > 0) {
        const randomMsg = messages[Math.floor(Math.random() * messages.length)];

        console.log(`📱 [Instant catch-up ${h}h] Reminder sent to ${user.userName}: ${randomMsg.text}`);

        reminders.push({
          messageType,
          sendTime: now,
          status: "sent"
        });

        // Show first instant message to user
        if (!instantReminder) {
          instantReminder = randomMsg.text;
        }
      }
      continue;
    }

    // === Case 2: Schedule future reminder ===
    reminders.push({
      messageType,
      sendTime: reminderTime,
      status: "scheduled"
    });

    const cronTime = `${reminderTime.getMinutes()} ${reminderTime.getHours()} ${reminderTime.getDate()} ${reminderTime.getMonth() + 1} *`;

    cron.schedule(
      cronTime,
      async () => {
        const messages = await Message.find({ category: messageType });
        if (messages.length > 0) {
          const randomMsg = messages[Math.floor(Math.random() * messages.length)];

          console.log(
            `📲 [${new Date().toLocaleString()}] Reminder to ${user.userName}: ${randomMsg.text}`
          );

          // Update reminder as sent in DB
          await Appointment.updateOne(
            { _id: appointment._id, "reminders.sendTime": reminderTime },
            { $set: { "reminders.$.status": "sent" } }
          );
        }
      },
      { timezone: "Asia/Riyadh" }
    );
  }

  // --- Step 4: Save reminders to appointment record ---
  appointment.reminders = reminders;
  await appointment.save();

  // --- Step 5: Log for developer debugging ---
  console.log(`📅 ${user.userName}'s reminders scheduled:`);
  reminders.forEach((r) =>
    console.log(`- ${r.messageType} at ${r.sendTime.toLocaleString()} [${r.status}]`)
  );

  // --- Step 6: Send response back to frontend ---
  res.json({
    message: "✅ Appointment booked and reminders scheduled automatically.",
    appointment,
    instantReminder // shown as alert in user interface
  });
});



// 4. Mark attendance or no-show
// When the appointment is completed, admin marks as 'attended' or 'missed'
// → updates attendance % and reclassifies user
app.post("/appointments/status/:id", async (req, res) => {
  const { status } = req.body;

  const appointment = await Appointment.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true }
  );

  const user = await User.findOne({ userName: appointment.userName });
  if (!user) return res.status(404).json({ message: "User not found" });

  // update reward points
  if (status === "attended") {
    user.score += 10;
    user.attendedCount += 1;
  } else if (status === "missed") {
    user.score = Math.max(0, user.score - 5);
    user.missedCount += 1;
  }

  // calculate attendance percentage
  const total = user.attendedCount + user.missedCount;
  user.attendanceRate = total > 0 ? (user.attendedCount / total) * 100 : 0;

  // classify only if user has 3+ appointments
  if (total >= 3) {
    if (user.attendanceRate >= 80) user.category = "Very Good";
    else if (user.attendanceRate >= 60) user.category = "Good";
    else user.category = "At-Risk";
  }

  await user.save();

  res.json({
    message: `✅ Appointment marked as ${status}`,
    appointment,
    user
  });
});



// === Get user performance summary ===
// Supports two views: ?view=admin or default (user)
app.get("/users/:userName", async (req, res) => {
  const user = await User.findOne({ userName: req.params.userName });
  if (!user) return res.status(404).json({ message: "User not found" });

  // if admin view requested, send full data
  if (req.query.view === "admin") {
    return res.json({
      userName: user.userName,
      phone: user.phone,
      score: user.score,
      attended: user.attendedCount,
      missed: user.missedCount,
      attendanceRate: user.attendanceRate?.toFixed(2) || 0,
      category: user.category || "Good"
    });
  }

  // user view (only loyalty points)
  return res.json({
    userName: user.userName,
    score: user.score
  });
});


// === Start the Server ===
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

