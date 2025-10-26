const API = "http://localhost:3000";
let userName = null;

// When user clicks confirm
document.getElementById("setUserBtn").addEventListener("click", () => {
  const input = document.getElementById("userNameInput").value.trim();
  if (!input) return alert("Please enter your name first.");
  userName = input;
  alert(`Welcome, ${userName}!`);
  document.getElementById("currentUser").textContent = `Logged in as: ${userName}`;
  loadAvailable();
  loadMyAppointments();
  loadUserStats();

});

// === Load Available Appointments ===
async function loadAvailable(filter = "") {
  const res = await fetch(`${API}/appointments/available`);
  const data = await res.json();
  const tbody = document.querySelector("#availableTable tbody");
  tbody.innerHTML = "";

  data.slots
    .filter((a) => a.doctorName.toLowerCase().includes(filter.toLowerCase()))
    .forEach((a) => {
      const date = new Date(a.date).toLocaleString();
      tbody.innerHTML += `
        <tr>
          <td>${a.doctorName}</td>
          <td>${date}</td>
          <td><button class="btn btn-primary btn-sm" onclick="book('${a._id}')">Book</button></td>
        </tr>`;
    });
}

// === Book Appointment ===
async function book(id) {
  if (!userName) {
    alert("Please enter your name before booking an appointment.");
    return;
  }

  const res = await fetch(`${API}/appointments/book/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName, phone: "0500000000" })
  });
  const data = await res.json();

  alert(data.message);

  if (data.instantReminder) {
    alert(`📱 Reminder for you:\n${data.instantReminder}`);
  }

  loadAvailable();
  loadMyAppointments();
  loadUserStats();
}

// === My Booked Appointments ===
async function loadMyAppointments() {
  const res = await fetch(`${API}/appointments/all`);
  const json = await res.json();
  const booked = json.appointments.filter(
    (a) => a.userName === userName && a.status === "booked"
  );

  const container = document.getElementById("myAppointments");
  container.innerHTML = "";

  if (booked.length === 0) {
    container.innerHTML = "<p>No upcoming appointments.</p>";
    return;
  }

  booked.forEach((a) => {
    const date = new Date(a.date).toLocaleString();
    container.innerHTML += `
      <div class="border rounded p-2 mb-2">
        <strong>${a.doctorName}</strong> — ${date}
        <span class="badge bg-primary">${a.status}</span>
      </div>`;
  });
}

// === Loyalty Points ===
async function loadUserStats() {
  const res = await fetch(`${API}/users/${userName}`);
  const user = await res.json();
  document.getElementById("loyalty").innerHTML = `
    <p><strong>Loyalty Points:</strong> ${user.score || 0}</p>
  `;
}

// === Search Filter ===
document.getElementById("searchDoctor").addEventListener("input", (e) => {
  loadAvailable(e.target.value);
});



// === Initial Load ===
loadAvailable();
loadMyAppointments();
loadUserStats();

