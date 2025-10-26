const API = "http://localhost:3000";

// === Add Appointment ===
document.getElementById("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const doctorName = document.getElementById("doctorName").value;
  const date = document.getElementById("date").value;

  const res = await fetch(`${API}/appointments/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doctorName, date })
  });
  const data = await res.json();
  alert(data.message);
  loadBooked();
});

// === Load Booked Appointments ===
async function loadBooked() {
  const res = await fetch(`${API}/appointments/booked`);
  const json = await res.json();
  const tbody = document.querySelector("#bookedTable tbody");
  tbody.innerHTML = "";

  json.appointments.forEach((a) => {
    const date = new Date(a.date).toLocaleString();
    const reminderInfo = a.reminders && a.reminders.length
      ? a.reminders.map(r => `
          <div>
            <small>${r.messageType}</small><br>
            <span class="text-muted">${new Date(r.sendTime).toLocaleString()}</span>
            <span class="badge bg-${r.status === 'sent' ? 'success' : 'warning'}">${r.status}</span>
          </div>
        `).join("")
      : "<em>No reminders</em>";

    tbody.innerHTML += `
      <tr>
        <td>${a.doctorName}</td>
        <td>${a.userName || "-"}</td>
        <td>${date}</td>
        <td>${a.status}</td>
        <td>${reminderInfo}</td>
      </tr>`;
  });
}

// === 🔹 Search User History ===
document.getElementById("historyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const userName = document.getElementById("historyUser").value;

  // Fetch performance details
  const res = await fetch(`${API}/users/${userName}?view=admin`);
  const user = await res.json();

  const res2 = await fetch(`${API}/appointments/all`);
  const json = await res2.json();
  const userAppointments = json.appointments.filter((a) => a.userName === userName);

  const container = document.getElementById("userHistory");
  container.innerHTML = `
    <div class="p-3 border rounded bg-light mb-3">
      <h6>📊 User Performance</h6>
      <p><strong>User:</strong> ${user.userName}</p>
      <p><strong>Category:</strong> ${user.category}</p>
      <p><strong>Attendance %:</strong> ${user.attendanceRate}%</p>
      <p><strong>Points:</strong> ${user.score}</p>
      <p><strong>Attended:</strong> ${user.attended}</p>
      <p><strong>Missed:</strong> ${user.missed}</p>
    </div>
    <h6>📅 Appointment History</h6>
  `;

  if (userAppointments.length === 0) {
    container.innerHTML += "<p>No appointments found for this user.</p>";
    return;
  }

  userAppointments.forEach((a) => {
    const date = new Date(a.date).toLocaleString();
    container.innerHTML += `
      <div class="border rounded p-2 mb-2">
        <strong>${a.doctorName}</strong> — ${date}
        <span class="badge bg-${a.status === 'attended' ? 'success' : a.status === 'missed' ? 'danger' : 'secondary'}">${a.status}</span>
      </div>`;
  });
});

// === 🔹 Load User Appointments for Attendance ===
document.getElementById("attendanceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const userName = document.getElementById("attendanceUser").value;
  const res = await fetch(`${API}/appointments/all`);
  const json = await res.json();

  const userAppointments = json.appointments.filter(
    (a) => a.userName === userName && a.status === "booked"
  );

  const container = document.getElementById("attendanceList");
  container.innerHTML = "";

  if (userAppointments.length === 0) {
    container.innerHTML = "<p>No booked appointments found for this user.</p>";
    return;
  }

  userAppointments.forEach((a) => {
    const date = new Date(a.date).toLocaleString();
    container.innerHTML += `
      <div class="border rounded p-2 mb-2">
        <strong>${a.doctorName}</strong> — ${date}
        <br>
        <button class="btn btn-success btn-sm me-2" onclick="markStatus('${a._id}', 'attended', '${userName}')">Mark Attended</button>
        <button class="btn btn-danger btn-sm" onclick="markStatus('${a._id}', 'missed', '${userName}')">Mark Missed</button>
      </div>`;
  });
});

// === Mark Attendance ===
async function markStatus(id, status, userName) {
  const res = await fetch(`${API}/appointments/status/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  const data = await res.json();
  alert(data.message);
  loadBooked();
}

loadBooked();

