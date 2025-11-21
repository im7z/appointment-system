// === Import Required Packages ===
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cron = require("node-cron"); // for scheduling automatic reminders
const TelegramBot = require("node-telegram-bot-api");
const moment = require("moment");
require("moment/locale/ar"); // Arabic locale
moment.locale("ar");
const PORT = process.env.PORT || 3000;
process.env.TZ = "Asia/Riyadh";
// === Create Express App ===
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static("public"));

// === Connect to MongoDB ===
const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/appointments";
mongoose.connect(MONGO_URL);


// Stores user info, attendance stats, behavior classification, and phone number
const userSchema = new mongoose.Schema({
  userName: String, // username used for login + booking + telegram linking

  displayName: { type: String, default: null },// new: friendly name shown to the user

  phone: String, // phone number used for future SMS reminders

  // New: Telegram chat id for reminders
  telegramChatId: { type: String, default: null },

  score: { type: Number, default: 0 }, // loyalty points (rewards only)
  attendedCount: { type: Number, default: 0 }, // total attended
  missedCount: { type: Number, default: 0 }, // total missed
  attendanceRate: { type: Number, default: 0 }, // attendance percentage
  category: { type: String, default: "Good" } // behavior class (Good, Very Good, At-Risk)
});
const User = mongoose.model("User", userSchema);



const axios = require("axios");
// === Telegram Bot Setup ===
const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
const PUBLIC_BASE_URL = "https://appointment-system-iw83.onrender.com"; // your Render URL
const WEBHOOK_URL = `${PUBLIC_BASE_URL}/webhook`;

let bot = null;

if (!TELEGRAM_TOKEN) {
  console.warn("⚠️ TELEGRAM_BOT_TOKEN is not set. Telegram reminders are disabled.");
} else {
  bot = new TelegramBot(TELEGRAM_TOKEN); // no polling
  console.log("✅ Telegram bot instance created");

  // === Auto-set webhook on startup ===
  (async () => {
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`;
      const res = await axios.get(url, {
        params: {
          url: WEBHOOK_URL,
          drop_pending_updates: true, // clears old stuck updates
        },
      });

      console.log("✅ setWebhook response:", res.data);
    } catch (err) {
      console.error("❌ Failed to set Telegram webhook automatically:", err.response?.data || err.message);
    }
  })();

  // Tracks link steps per chat
  const linkSteps = new Map();

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();

    console.log("📩 Incoming Telegram message:", {
      chatId,
      text,
    });

    // Check if this chat is already linked
    const alreadyLinked = await User.findOne({
      telegramChatId: String(chatId),
    });

    // === 1) /start ===
    if (text === "/start") {
      if (alreadyLinked) {
        return bot.sendMessage(
          chatId,
          "✅ Your Telegram is already linked. You will keep receiving reminders."
        );
      }

      linkSteps.set(chatId, "await_username");

      return bot.sendMessage(
        chatId,
        "👋 Welcome to the QU Clinic bot!\n\n" +
        "Please type your *clinic username* so I can connect your account.\n\n" +
        "Example:  `omar - omar12`",
        { parse_mode: "Markdown" }
      );
    }

    // If not expecting a username → ignore
    if (!linkSteps.has(chatId)) {
      return bot.sendMessage(chatId, "💡 Send /start to link your account.");
    }

    // === 2) User must type their username ===
    if (linkSteps.get(chatId) === "await_username") {
      // Prevent duplicate linking
      if (linkSteps.get(chatId) === "completed") return;

      const typedUsername = text.trim().toLowerCase();

      try {
        // Username must NOT contain spaces
        if (/\s/.test(typedUsername)) {
          return bot.sendMessage(chatId, "❌ Username cannot contain spaces. Try again.");
        }

        // Look for exact match
        let user = await User.findOneAndUpdate(
          { userName: typedUsername },
          { telegramChatId: String(chatId) },
          { new: true }
        );

        if (!user) {
          return bot.sendMessage(
            chatId,
            "❌ Username not found.\nPlease sign up in the clinic app first, then try again."
          );
        }
        // Send success message
        await bot.sendMessage(
          chatId,
          `✅ Great, *${user.userName}*! Your Telegram is now linked.\n\n` +
          "You will receive appointment reminders here. 🎉",
          { parse_mode: "Markdown" }
        );

        // Mark linking as completed = important
        linkSteps.set(chatId, "completed");
      } catch (err) {
        console.error("❌ Error linking Telegram:", err);
        bot.sendMessage(chatId, "❌ Something went wrong. Please try again later.");
      }
    }
  });
}

// Helper function to send a reminder (safe)
async function sendTelegramReminder(user, text) {
  if (!bot) return; // bot not configured
  if (!user || !user.telegramChatId) return; // user not linked

  try {
    await bot.sendMessage(user.telegramChatId, text);
    console.log(`✅ Telegram reminder sent to ${user.userName}`);
  } catch (err) {
    console.error("❌ Failed to send Telegram message:", err.message);
  }
}

// === Webhook endpoint ===
app.post("/webhook", (req, res) => {
  const msg = req.body; // Telegram message object
  console.log("📥 Received webhook update:", msg);

  if (bot) {
    bot.processUpdate(msg); // Process the incoming update
  } else {
    console.error("❌ bot is not initialized, cannot process update.");
  }

  res.sendStatus(200); // Respond to Telegram that the message was received successfully
});



// =======================================================
//   USER SYNC (from Clinic) 
// =======================================================
app.post("/users/register", async (req, res) => {
  try {
    const { userName, displayName, phone } = req.body;

    if (!userName) {
      return res.status(400).json({ error: "Missing username" });
    }

    let user = await User.findOne({ userName });

    // If user does NOT exist → create it
    if (!user) {
      user = await User.create({
        userName,
        displayName,
        phone,
        score: 0,
        attendedCount: 0,
        missedCount: 0,
        attendanceRate: 0,
        category: "Good",
      });

      console.log(" API User created:", userName);
    }
    else {
      // Update displayName/phone if changed
      user.displayName = displayName || user.displayName;
      user.phone = phone || user.phone;
      await user.save();

      console.log(" API User synced:", userName);
    }

    res.json({
      message: "User synced successfully",
      user
    });

  } catch (err) {
    console.error(" API /users/register error:", err);
    res.status(500).json({ error: "Failed to sync user" });
  }
});


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

    // === Case 1️: Single or Daily Single Appointment ===
    if (endHour === undefined) {

      // ⬅️ Case A: Only startDate OR startDate == endDate → add ONE slot
      if (!endDate || endDate === startDate) {
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

      // ⬅️ Case B: A date range (start → end) → add ONE slot per day
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
        const daily = new Date(day);
        daily.setHours(startHour, startMinute, 0, 0);

        slots.push({
          doctorName,
          date: daily,
          status: "available"
        });
      }

      await Appointment.insertMany(slots);

      return res.json({
        message: `${slots.length} appointments added (one per day).`,
        totalAdded: slots.length,
        doctorName
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
    console.log(` ${slots.length} appointment slots added successfully.`);
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

app.delete("/appointments/delete/:id", async (req, res) => {
  try {
    const deleted = await Appointment.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "Appointment not found" });
    }
    res.json({ message: "Appointment deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
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

  // 2️ Find user (case-insensitive)
  let user = await User.findOne({
    userName: new RegExp(`^${userName}$`, "i")
  });

  if (!user) {
    return res.status(400).json({
      message: "User not found in system. Please re-login."
    });
  }


  if (phone && !user.phone) {
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
      message: `عذرًا يا ${user.userName}، هذا الموعد عالي الطلب للدكتور/ة ${appointment.doctorName}. بسبب غيابك السابق تم تقييد هذا الوقت مؤقتًا، والالتزام القادم يعيد فتح هذه الأوقات لك. الرجاء اختيار وقت آخر.`
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
  const usedMessages = [];


  for (const h of reminderHours) {
    const reminderTime = new Date(appointmentTime - h * 60 * 60 * 1000);

    // === Case 1: Reminder time already passed ===
    if (reminderTime <= now) {

      // Mark reminder as SENT in DB list (we will save after this)
      reminders.push({
        messageType,
        sendTime: now,
        status: "sent"
      });

      // If already sent an instant reminder → DO NOT send again
      if (instantReminder) continue;

      // --- Send ONLY ONE instant message ---
      const messages = await Message.find({ category: messageType });
      if (messages.length > 0) {

        const randomMsg = pickUniqueMessage(messages, usedMessages);

        const nameToShow = user.displayName || user.userName;
        const personalizedMsg = randomMsg.text.replace(/name/g, nameToShow);

        console.log(` [Instant catch-up] Reminder for ${user.userName}: ${personalizedMsg}`);

        const dateStr = moment(appointment.date).format("dddd، DD MMMM YYYY");
        const timeStr = moment(appointment.date).format("hh:mm A");

        // Clinic name (you can change it)
        const clinicName = " QU Clinic";

        // Final formatted message
        const finalMessage =
          `${clinicName}\n\n` +                // Title added
          `${personalizedMsg}\n\n` +           // Nudge message
          ` موعدك مع الدكتور/ه ${appointment.doctorName} — ${dateStr} — ${timeStr}`;   //  One-line details

        await sendTelegramReminder(user, finalMessage);

        // Only ONE instant reminder
        instantReminder = true;
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
    console.log("Scheduling cron job with time:", cronTime);

    cron.schedule(
      cronTime,
      async () => {
        console.log(`[Cron Job Triggered] Reminder for ${user.userName} at: ${new Date().toLocaleString()}`);
        const messages = await Message.find({ category: messageType });
        if (messages.length > 0) {

          const randomMsg = pickUniqueMessage(messages, usedMessages);

          const nameToShow = user.displayName || user.userName;
          const personalizedMsg = randomMsg.text.replace(/name/g, nameToShow);


          console.log(
            ` [${new Date().toLocaleString()}] Reminder to ${user.userName}: ${personalizedMsg}`
          );

          // Format date + time Arabic using moment
          const dateStr = moment(appointment.date).format("dddd، DD MMMM YYYY");
          const timeStr = moment(appointment.date).format("hh:mm A");

          // Clinic name (you can change it)
          const clinicName = " QU Clinic";

          // Final formatted message
          const finalMessage =
            `${clinicName}\n\n` +                // Title added
            `${personalizedMsg}\n\n` +           // Nudge message
            ` موعدك مع الدكتور/ه ${appointment.doctorName} — ${dateStr} — ${timeStr}`;   //  One-line details

          console.log(`Sending reminder: ${finalMessage}`);

          await sendTelegramReminder(user, finalMessage);

          console.log("Updating reminder for appointment:", appointment._id);
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
          // --- SEND GOOGLE FORM FEEDBACK ---
          const formLink = "https://docs.google.com/forms/d/e/1FAIpQLSfodMr2Jprl32tI8jQ9qgE1--2NSFQR6o2DOEiNki23H0RQ8w/viewform?usp=header"; // replace with your form
          await sendTelegramReminder(
            result.user,
            ` نود معرفة تجربتك اليوم، هل تذكّرت موعدك أم لا؟\n\n` +
            ` الرجاء تعبئة النموذج:\n${formLink}`
          );
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

  const telegramLinked = !!user.telegramChatId;

  // if admin view requested, send full data
  if (req.query.view === "admin") {
    return res.json({
      userName: user.userName,
      phone: user.phone,
      score: user.score,
      attended: user.attendedCount,
      missed: user.missedCount,
      attendanceRate: user.attendanceRate?.toFixed(2) || 0,
      category: user.category || "Good",
      telegramChatId: user.telegramChatId,
      telegramLinked
    });
  }

  // user view
  return res.json({
    userName: user.userName,
    score: user.score,
    telegramLinked
  });
});

// Get all users (Admin purpose)
app.get("/users", async (req, res) => {
  try {
    const users = await User.find().lean();
    res.json(users);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// === Admin override user category (for testing) ===
app.post("/admin/set-category", async (req, res) => {
  try {
    const { userName, category } = req.body;

    if (!userName || !category) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const allowed = ["Good", "Very Good", "At-Risk"];
    if (!allowed.includes(category)) {
      return res.status(400).json({ error: "Invalid category" });
    }

    const user = await User.findOneAndUpdate(
      { userName },
      { category },      // Temporary override
      { new: true }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    console.log(`Category for ${userName} changed to ${category}`);
    return res.json({
      message: `Category for ${userName} changed to ${category}`,
      user
    });

  } catch (err) {
    console.error("Error updating category:", err);
    return res.status(500).json({ error: "Server error" });
  }
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
    console.log(` Baseline saved for ${doctorName} (${month}/${year})`);
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

//  Late-Release Rule + Cleanup of past available appointments
cron.schedule("0 * * * *", async () => {
  const now = new Date();

  // === Cleanup past available appointments ===
  try {
    const removed = await Appointment.deleteMany({
      date: { $lt: now },
      status: "available"
    });

    if (removed.deletedCount > 0) {
      console.log(` Cleanup: removed ${removed.deletedCount} expired unbooked appointments.`);
    }
  } catch (err) {
    console.error(" Error during cleanup:", err);
  }

  // === Late-release high-demand slots ===
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const soon = await Appointment.find({
    status: "available",
    date: { $gte: now, $lte: twoHoursLater }
  });

  for (const a of soon) {
    const demand = await getEffectiveHighDemand(a.doctorName, a.date);
    if (demand && demand.totalAppointments >= demand.highDemandThreshold) {
      demand.highDemandThreshold = Number.MAX_SAFE_INTEGER; // unlock
      await demand.save();
      console.log(
        ` Released high-demand slot for ${a.doctorName} at ${a.date.toLocaleString()}`
      );
    }
  }
}, { timezone: "Asia/Riyadh" });

/**
 * Pick a unique message for THIS appointment only.
 * - messages: array of all messages from DB
 * - usedMessages: array where we store which were already used
 */
function pickUniqueMessage(messages, usedMessages) {
  // Filter out messages already used
  const available = messages.filter(m => !usedMessages.includes(m.text));

  // Randomly select one of the unused messages
  const chosen = available[Math.floor(Math.random() * available.length)];

  // Mark this message as used
  usedMessages.push(chosen.text);

  return chosen;
}




// === Start the Server ===
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

