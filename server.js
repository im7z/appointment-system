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

// === High-Demand Schema ===
// Tracks popular appointment hours for each doctor, month, and day of week
const highDemandSchema = new mongoose.Schema({
  doctorName: { type: String, required: true },
  year: { type: Number, required: true },          // e.g. 2025
  month: { type: Number, required: true },         // 1–12
  dayOfWeek: { type: Number, default: null },      // 0 = Sunday ... 6 = Saturday
  hour: { type: Number, required: true },          // 0–23 (hour of day)
  totalAppointments: { type: Number, default: 0 }, // learned by attended visits
  highDemandThreshold: { type: Number, default: 3 }, // when total > threshold => high-demand
  source: { type: String, enum: ["admin", "auto"], default: "auto" },
  lastUpdated: { type: Date, default: Date.now }
});

highDemandSchema.index({ doctorName: 1, year: 1, month: 1, dayOfWeek: 1, hour: 1 }, { unique: true });

const HighDemand = mongoose.model("HighDemand", highDemandSchema);

// === 1. Add a new appointment slot ===
app.post("/appointments/add", async (req, res) => {
  try {
    const {
      doctorName,
      startDate,
      endDate,
      startHour,
      startMinute = 0,
      endHour,
      endMinute = 0,
      intervalMinutes
    } = req.body;

    //  Basic input validation
    if (!doctorName || !startDate || startHour === undefined) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date(startDate);

    // Validate date order
    if (end < start) {
      return res.status(400).json({ error: "End date must be after start date." });
    }

    // === Case 1️: Single Appointment ===
    if (endHour === undefined) {
      const date = new Date(start);
      date.setHours(startHour, startMinute, 0, 0);

      const singleSlot = new Appointment({
        doctorName,
        date,
        status: "available"
      });

      await singleSlot.save();
      return res.json({
        message: "Single appointment added successfully.",
        appointment: singleSlot
      });
    }

    // === Case 2️: Appointment Block ===
    const getDatesInRange = (start, end) => {
      const dates = [];
      const current = new Date(start);
      while (current <= end) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
      return dates;
    };

    const days = getDatesInRange(start, end);
    const slots = [];

    for (const day of days) {
      const startTime = new Date(day);
      startTime.setHours(startHour, startMinute, 0, 0);

      const endTime = new Date(day);
      endTime.setHours(endHour, endMinute, 0, 0);

      //  Validate time order
      if (endTime <= startTime) {
        continue; // skip invalid day
      }

      const step = intervalMinutes || 60;

      //  Flexible slot generation
      for (let t = new Date(startTime); t <= endTime; t.setMinutes(t.getMinutes() + step)) {
        slots.push({
          doctorName,
          date: new Date(t),
          status: "available"
        });
      }
    }

    if (slots.length === 0) {
      return res.status(400).json({ error: "No valid appointment slots generated. Check your time range." });
    }

    await Appointment.insertMany(slots);
    res.json({
      message: ` ${slots.length} appointment slots added successfully.`,
      totalAdded: slots.length,
      doctorName
    });

  } catch (error) {
    console.error("Error adding appointment:", error);
    res.status(500).json({ error: "Failed to add appointment(s)." });
  }
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

  // 1️ Find the appointment
  let appointment = await Appointment.findById(req.params.id);
  if (!appointment) return res.status(404).json({ message: "Appointment not found" });
  if (appointment.status !== "available") return res.status(400).json({ message: "Slot not available" });

  // 2️ Find or create user
  let user = await User.findOne({ userName });
  if (!user) {
    user = new User({ userName, phone });
    await user.save();
  } else if (phone && !user.phone) {
    user.phone = phone;
    await user.save();
  }

  // 3️ Ensure month is initialized
  await initializeMonthIfNeeded(appointment.doctorName, appointment.date);

  // 4️ Check demand for this hour
  const demandSlot = await getEffectiveHighDemand(appointment.doctorName, new Date(appointment.date));
  const isHighDemand = !!demandSlot && (
    demandSlot.source === "admin" ||
    demandSlot.totalAppointments >= demandSlot.highDemandThreshold
  );

  // 5️ Restrict At-Risk users
  if (user.category === "At-Risk" && isHighDemand) {
    return res.status(403).json({
      message: ` Sorry ${user.userName}, this is a high-demand hour for ${appointment.doctorName}. Please choose another time.`
    });
  }

  // 6️ Proceed with normal booking logic
  appointment = await Appointment.findByIdAndUpdate(
    req.params.id,
    { status: "booked", userName },
    { new: true }
  );


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
        const personalizedMsg = randomMsg.text.replace(/name/g, user.userName);
        console.log(` [Instant catch-up ${h}h] Reminder sent to ${user.userName}: ${personalizedMsg}`);

        reminders.push({
          messageType,
          sendTime: now,
          status: "sent"
        });

        // Show first instant message to user
        if (!instantReminder) {
          instantReminder = personalizedMsg;
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
          const personalizedMsg = randomMsg.text.replace(/name/g, user.userName);
          console.log(
            ` [${new Date().toLocaleString()}] Reminder to ${user.userName}: ${personalizedMsg}`
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

  // === Auto-miss detection ===
  const checkTime = new Date(appointmentTime.getTime() + 10 * 60 * 1000);
  const cronTime = `${checkTime.getMinutes()} ${checkTime.getHours()} ${checkTime.getDate()} ${checkTime.getMonth() + 1} *`;

  cron.schedule(
    cronTime,
    async () => {
      const current = await Appointment.findById(appointment._id);
      if (!current) return;

      if (current.status === "booked") {
        const result = await updateAppointmentStatus(current._id, "missed");
        if (result) {
          console.log(` Auto-marked as missed & updated stats → ${result.user.userName} (${result.user.category})`);
        }
      }
    },
    { timezone: "Asia/Riyadh" }
  );

  // --- Step 4: Save reminders to appointment record ---
  appointment.reminders = reminders;
  await appointment.save();

  // --- Step 5: Log for developer debugging ---
  console.log(` ${user.userName}'s reminders scheduled:`);
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

  const result = await updateAppointmentStatus(req.params.id, status);
  if (!result) {
    return res.status(404).json({ message: "Appointment or user not found" });
  }

  res.json({
    message: `✅ Appointment marked as ${status}`,
    appointment: result.appointment,
    user: result.user
  });
});



// === 5. Get user performance summary ===
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


// === Admin: Set baseline busy hours for a doctor/month/year ===
// Example body: { "doctorName": "Dr. Ahmed", "year": 2025, "month": 10, "hours": [9,10,11], "highDemandThreshold": 3 }
app.post("/high-demand/setup", async (req, res) => {
  try {
    const { doctorName, year, month, hours, highDemandThreshold } = req.body;
    if (!doctorName || !year || !month || !Array.isArray(hours) || hours.length === 0) {
      return res.status(400).json({ error: "doctorName, year, month, and hours[] are required." });
    }

    await HighDemand.deleteMany({ doctorName, year, month, source: "admin" });

    const entries = hours.map(h => ({
      doctorName,
      year: Number(year),
      month: Number(month),
      dayOfWeek: null,
      hour: Number(h),
      totalAppointments: 0,
      highDemandThreshold: typeof highDemandThreshold === "number" ? highDemandThreshold : 3,
      source: "admin"
    }));

    await HighDemand.insertMany(entries);
    res.json({ message: ` Baseline saved for ${doctorName} (${month}/${year})`, count: entries.length });
  } catch (e) {
    console.error("Error saving baseline:", e);
    res.status(500).json({ error: "Failed to set baseline." });
  }
});

// === Admin: View high-demand map for doctor/month/year ===
app.get("/high-demand", async (req, res) => {
  try {
    const { doctorName, year, month } = req.query;
    if (!doctorName || !year || !month)
      return res.status(400).json({ error: "doctorName, year, and month are required." });

    const rows = await HighDemand.find({ doctorName, year: Number(year), month: Number(month) })
      .sort({ dayOfWeek: 1, hour: 1 });

    const summary = {
      totalSlots: rows.length,
      highDemandHours: rows.filter(r => r.totalAppointments >= r.highDemandThreshold).length
    };

    res.json({ doctorName, year: Number(year), month: Number(month), summary, rows });
  } catch (e) {
    console.error("Error viewing high demand:", e);
    res.status(500).json({ error: "Failed to view high demand data." });
  }
});

// === Helper: Update appointment and user status ===
async function updateAppointmentStatus(appointmentId, status) {
  const appointment = await Appointment.findByIdAndUpdate(
    appointmentId,
    { status },
    { new: true }
  );

  if (!appointment) return null;

  const user = await User.findOne({ userName: appointment.userName });
  if (!user) return null;

  // Update reward points and counts
  if (status === "attended") {
    user.score += 10;
    user.attendedCount += 1;
  } else if (status === "missed") {
    user.score = Math.max(0, user.score - 5);
    user.missedCount += 1;
  }

  // Calculate attendance %
  const total = user.attendedCount + user.missedCount;
  user.attendanceRate = total > 0 ? (user.attendedCount / total) * 100 : 0;

  // Reclassify if user has enough history
  if (total >= 3) {
    if (user.attendanceRate >= 80) user.category = "Very Good";
    else if (user.attendanceRate >= 60) user.category = "Good";
    else user.category = "At-Risk";
  }

  await user.save();
  // Learn from attended appointments
  if (status === "attended") {
    await initializeMonthIfNeeded(appointment.doctorName, appointment.date);
    await updateHighDemandStats(appointment);
  }
  return { appointment, user };
}

// === High-Demand Helper Functions ===

//  Initialize a month if missing — copy last year’s pattern or start fresh
async function initializeMonthIfNeeded(doctorName, date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  const exists = await HighDemand.findOne({ doctorName, year, month });
  if (exists) return;

  const prevYear = year - 1;
  const lastYear = await HighDemand.find({ doctorName, year: prevYear, month });

  if (lastYear.length > 0) {
    const copies = lastYear.map(r => ({
      doctorName,
      year,
      month,
      dayOfWeek: r.dayOfWeek,
      hour: r.hour,
      totalAppointments: 0,
      highDemandThreshold: r.highDemandThreshold,
      source: "auto",
      lastUpdated: new Date()
    }));
    await HighDemand.insertMany(copies);
    console.log(` Initialized ${doctorName} month ${month}/${year} from ${month}/${prevYear}`);
  } else {
    console.log(` No previous data for ${doctorName} ${month}/${prevYear}, starting fresh.`);
  }
}

//  Update learning — increment when appointment attended
async function updateHighDemandStats(appointment) {
  const date = new Date(appointment.date);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();
  const hour = date.getHours();

  await initializeMonthIfNeeded(appointment.doctorName, date);

  await HighDemand.findOneAndUpdate(
    { doctorName: appointment.doctorName, year, month, dayOfWeek, hour },
    { $inc: { totalAppointments: 1 }, $set: { lastUpdated: new Date() } },
    { upsert: true, new: true }
  );
}

//  Fetch effective demand (current → last year → admin baseline)
async function getEffectiveHighDemand(doctorName, date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();
  const hour = date.getHours();

  let slot =
    (await HighDemand.findOne({ doctorName, year, month, dayOfWeek, hour })) ||
    (await HighDemand.findOne({ doctorName, year: year - 1, month, dayOfWeek, hour })) ||
    (await HighDemand.findOne({ doctorName, year, month, dayOfWeek: null, hour, source: "admin" })) ||
    (await HighDemand.findOne({ doctorName, year: year - 1, month, dayOfWeek: null, hour, source: "admin" }));

  return slot || null;
}

//  Recalculate Dynamic Threshold per Doctor/Month (adaptive for small clinics)
async function recalculateDynamicThreshold(doctorName, year, month) {
  const hours = await HighDemand.find({ doctorName, year, month });
  if (hours.length === 0) {
    console.log(`⚠️ No data for ${doctorName} ${month}/${year}, skipping recalculation.`);
    return;
  }

  // Light-mode for 1–2 hours of data
  if (hours.length < 3) {
    const avg = hours.reduce((s, h) => s + h.totalAppointments, 0) / hours.length;
    const threshold = avg * 1.1; // 10% above small-sample average
    await HighDemand.updateMany({ doctorName, year, month }, { $set: { highDemandThreshold: threshold } });
    console.log(` Light-mode threshold for ${doctorName} ${month}/${year}: ${threshold.toFixed(2)}`);
    return;
  }

  // Full adaptive mode (≥3 hours of data)
  const avg = hours.reduce((sum, h) => sum + h.totalAppointments, 0) / hours.length;
  const threshold = avg * 1.2; // 120% of average attendance

  // Top 25% busiest hours define the real cutoff
  const sorted = [...hours].sort((a, b) => b.totalAppointments - a.totalAppointments);
  const top25Index = Math.floor(hours.length * 0.25);
  const top25Cutoff = sorted[top25Index]?.totalAppointments || threshold;
  const newThreshold = Math.max(threshold, top25Cutoff);

  await HighDemand.updateMany({ doctorName, year, month }, { $set: { highDemandThreshold: newThreshold } });

  console.log(` Adaptive threshold for ${doctorName} ${month}/${year}: ${newThreshold.toFixed(2)} (avg=${avg.toFixed(2)})`);
}

//  Limit how many hours are high-demand (max 50% of total)
async function limitHighDemandHours(doctorName, year, month, maxPercent = 0.5) {
  const hours = await HighDemand.find({ doctorName, year, month });
  const totalHours = hours.length;
  if (totalHours === 0) return;

  const maxHigh = Math.floor(totalHours * maxPercent);
  const sorted = [...hours].sort((a, b) => b.totalAppointments - a.totalAppointments);
  const top = sorted.slice(0, maxHigh);

  for (const h of hours) {
    const isHigh = top.some(t => t.hour === h.hour && t.dayOfWeek === h.dayOfWeek);
    h.highDemandThreshold = isHigh ? h.highDemandThreshold : Number.MAX_SAFE_INTEGER;
    await h.save();
  }
  console.log(` ${doctorName} ${month}/${year}: limited to ${maxHigh}/${totalHours} peak hours.`);
}

//  Month-End Learning — refresh data & recalc
cron.schedule("59 23 28-31 * *", async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  console.log(` Month-end learning for ${month}/${year}...`);

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);
  const attended = await Appointment.find({ status: "attended", date: { $gte: start, $lte: end } });
  if (attended.length === 0) return console.log("No attended appointments.");

  // Group by doctor/hour
  const grouped = {};
  for (const app of attended) {
    const d = new Date(app.date);
    const key = `${app.doctorName}-${d.getHours()}`;
    grouped[key] = (grouped[key] || 0) + 1;
  }

  // Update totals
  for (const key in grouped) {
    const [doctorName, hour] = key.split("-");
    await HighDemand.findOneAndUpdate(
      { doctorName, year, month, hour: Number(hour) },
      { $inc: { totalAppointments: grouped[key] }, $set: { lastUpdated: new Date() } },
      { upsert: true }
    );
  }

  console.log(` Month-end data merged for ${Object.keys(grouped).length} hours.`);
}, { timezone: "Asia/Riyadh" });

//  Monthly recalculation (1st day of month at 2 AM)
cron.schedule("0 2 1 * *", async () => {
  console.log("🔁 Recalculating monthly thresholds...");
  const doctors = await HighDemand.distinct("doctorName");
  const now = new Date();
  const year = now.getFullYear();
  const prevMonth = now.getMonth(); // previous month index

  for (const doctor of doctors) {
    await recalculateDynamicThreshold(doctor, year, prevMonth);
    await limitHighDemandHours(doctor, year, prevMonth);
  }
  console.log(" Monthly recalculation done.");
});

//  Late-Release Rule — every hour, open unbooked high-demand slots 2h before start
cron.schedule("0 * * * *", async () => {
  const now = new Date();
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const soon = await Appointment.find({ status: "available", date: { $gte: now, $lte: twoHoursLater } });
  for (const a of soon) {
    const demand = await getEffectiveHighDemand(a.doctorName, a.date);
    if (demand && demand.totalAppointments >= demand.highDemandThreshold) {
      demand.highDemandThreshold = Number.MAX_SAFE_INTEGER; // unlock
      await demand.save();
      console.log(` Released high-demand slot for ${a.doctorName} at ${a.date.toLocaleString()}`);
    }
  }
});

// === Start the Server ===
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

