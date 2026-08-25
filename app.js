// --- THEME TOGGLE LOGIC ---
const themeToggle = document.getElementById("themeToggle");
const htmlElement = document.documentElement;

themeToggle.addEventListener("click", () => {
  const currentTheme = htmlElement.getAttribute("data-theme");
  const newTheme = currentTheme === "light" ? "dark" : "light";
  htmlElement.setAttribute("data-theme", newTheme);
  themeToggle.textContent = newTheme === "dark" ? "☀️" : "🌙";
});

// --- AUTH & USER DATABASE MANAGEMENT ---
const authContainer = document.getElementById("authContainer");
const signupCard = document.getElementById("signupCard");
const loginCard = document.getElementById("loginCard");
const dashboardSection = document.getElementById("dashboardSection");
const displayName = document.getElementById("displayName");
const displayMatric = document.getElementById("displayMatric");
const logoutBtn = document.getElementById("logoutBtn");
const deleteAccountBtn = document.getElementById("deleteAccountBtn");

document.getElementById("showLogin").addEventListener("click", (e) => {
  e.preventDefault();
  signupCard.classList.add("hidden");
  loginCard.classList.remove("hidden");
});

document.getElementById("showSignup").addEventListener("click", (e) => {
  e.preventDefault();
  loginCard.classList.add("hidden");
  signupCard.classList.remove("hidden");
});

let users = JSON.parse(localStorage.getItem("attendify_users")) || [];
let currentUser = JSON.parse(localStorage.getItem("attendify_current_user")) || null;

function checkAuth() {
  if (currentUser) {
    authContainer.classList.add("hidden");
    dashboardSection.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    displayName.textContent = currentUser.name;
    displayMatric.textContent = currentUser.matric;

    const openCreateModalBtn = document.getElementById("openCreateModal");
    if (openCreateModalBtn) {
      if (currentUser.isRep) {
        openCreateModalBtn.classList.remove("hidden");
      } else {
        openCreateModalBtn.classList.add("hidden");
      }
    }

    renderCourses();
  } else {
    authContainer.classList.remove("hidden");
    dashboardSection.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    signupCard.classList.remove("hidden");
    loginCard.classList.add("hidden");
  }
}

// SIGN UP SUBMISSION
const signupForm = document.getElementById("signupForm");
if (signupForm) {
  signupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("signupName").value.trim();
    const matric = document.getElementById("signupMatric").value.trim().toUpperCase();
    const email = document.getElementById("signupEmail").value.trim().toLowerCase();
    const password = document.getElementById("signupPassword").value;
    const isRep = document.getElementById("isRepCheckbox").checked;

    const existingUser = users.find(u => u.email === email || u.matric === matric);
    if (existingUser) {
      alert("⚠️ An account with this email or Matric Number already exists!");
      return;
    }

    const newUser = { name, matric, email, password, isRep };
    users.push(newUser);
    localStorage.setItem("attendify_users", JSON.stringify(users));

    currentUser = newUser;
    localStorage.setItem("attendify_current_user", JSON.stringify(currentUser));
    
    signupForm.reset();
    checkAuth();
    alert("Account created successfully! 🎉");
  });
}

// LOG IN SUBMISSION
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;

    const foundUser = users.find(u => u.email === email && u.password === password);
    if (foundUser) {
      currentUser = foundUser;
      localStorage.setItem("attendify_current_user", JSON.stringify(currentUser));
      loginForm.reset();
      checkAuth();
    } else {
      alert("❌ Invalid email or password. Please check your credentials.");
    }
  });
}

// LOGOUT & DELETE ACCOUNT
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    currentUser = null;
    localStorage.removeItem("attendify_current_user");
    
    // Clear portal view state on logout
    if (portalSection) portalSection.classList.add("hidden");
    activeCourse = null;
    if (countdownInterval) clearInterval(countdownInterval);
    
    checkAuth();
  });
}

if (deleteAccountBtn) {
  deleteAccountBtn.addEventListener("click", () => {
    if (confirm("⚠️ Are you sure you want to delete your account?")) {
      users = users.filter(u => u.email !== currentUser.email);
      localStorage.setItem("attendify_users", JSON.stringify(users));
      currentUser = null;
      localStorage.removeItem("attendify_current_user");
      
      if (portalSection) portalSection.classList.add("hidden");
      activeCourse = null;
      if (countdownInterval) clearInterval(countdownInterval);

      checkAuth();
      alert("Account deleted.");
    }
  });
}

// --- MODALS & CLOSE HANDLERS ---
const createModal = document.getElementById("createModal");
const joinModal = document.getElementById("joinModal");
const forgotModal = document.getElementById("forgotModal");

const openCreateModalBtn = document.getElementById("openCreateModal");
if (openCreateModalBtn) {
  openCreateModalBtn.addEventListener("click", () => {
    if (createModal) createModal.classList.add("show");
  });
}

const openJoinModalBtn = document.getElementById("openJoinModal");
if (openJoinModalBtn) {
  openJoinModalBtn.addEventListener("click", () => {
    if (joinModal) joinModal.classList.add("show");
  });
}

const openForgotModalBtn = document.getElementById("openForgotModal");
if (openForgotModalBtn) {
  openForgotModalBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (forgotModal) forgotModal.classList.add("show");
  });
}

document.querySelectorAll(".close-modal").forEach(btn => {
  btn.addEventListener("click", () => {
    if (createModal) createModal.classList.remove("show");
    if (joinModal) joinModal.classList.remove("show");
    if (forgotModal) forgotModal.classList.remove("show");
  });
});

// --- COURSES & PORTAL MANAGEMENT ---
let courses = JSON.parse(localStorage.getItem("attendify_courses")) || [];
const courseGrid = document.getElementById("courseGrid");
const portalSection = document.getElementById("portalSection");

let activeCourse = null;

function renderCourses() {
  if (!courseGrid) return;
  courseGrid.innerHTML = "";

  const myCourses = courses.filter(course => {
    if (!currentUser) return false;
    const isRep = course.rep.toLowerCase() === currentUser.name.toLowerCase();
    const isEnrolled = course.enrolled && course.enrolled.includes(currentUser.matric);
    return isRep || isEnrolled;
  });

  if (myCourses.length === 0) {
    courseGrid.innerHTML = `<p style="color: var(--muted);">No courses joined yet. Create or join one above! 🚀</p>`;
    return;
  }

  myCourses.forEach((course) => {
    const index = courses.findIndex(c => c.code === course.code);

    const card = document.createElement("div");
    card.className = "card";
    card.style.maxHeight = "none";
    card.style.position = "relative";
    
    const enrolledCount = course.enrolled ? course.enrolled.length : 1;
    const isThisUserRep = currentUser && course.rep.toLowerCase() === currentUser.name.toLowerCase();

    const actionIcon = isThisUserRep 
      ? `<button onclick="deleteCourse(${index})" style="position: absolute; top: 15px; right: 15px; background: transparent; border: none; cursor: pointer; font-size: 1.2rem;" title="Delete Course (Rep Only)">🗑️</button>`
      : `<button onclick="leaveCourse(${index})" style="position: absolute; top: 15px; right: 15px; background: transparent; border: none; cursor: pointer; font-size: 1.2rem;" title="Leave Course">🚪</button>`;

    card.innerHTML = `
      ${actionIcon}
      <h3 style="color: var(--navy); margin-bottom: 5px;">${course.name}</h3>
      <p style="font-size: 0.85rem; margin-bottom: 15px;">Code: <strong>${course.code}</strong> | Rep: ${course.rep}</p>
      
      <div style="background: var(--bg); padding: 10px; border-radius: 8px; margin-bottom: 15px; font-size: 0.85rem; display: flex; justify-content: space-between;">
        <span>👥 Enrolled Students:</span>
        <strong>${enrolledCount}</strong>
      </div>

      <button class="btn" style="padding: 10px; font-size: 0.9rem;" onclick="openPortal(${index})">Open Portal 🚀</button>
    `;
    courseGrid.appendChild(card);
  });
}

window.deleteCourse = function(index) {
  if (confirm(`⚠️ WARNING: As the Course Rep, deleting "${courses[index].name}" removes it entirely. Are you sure?`)) {
    courses.splice(index, 1);
    localStorage.setItem("attendify_courses", JSON.stringify(courses));
    renderCourses();
  }
};

window.leaveCourse = function(index) {
  const course = courses[index];
  if (confirm(`⚠️ Do you want to leave "${course.name}"? You can rejoin anytime using code [${course.code}].`)) {
    if (course.enrolled) {
      course.enrolled = course.enrolled.filter(m => m !== currentUser.matric);
    }
    localStorage.setItem("attendify_courses", JSON.stringify(courses));
    renderCourses();
    alert(`You have left ${course.name}. 👋`);
  }
};

// Open Portal Function with Security Guard
window.openPortal = function(index) {
  const selectedCourse = courses[index];
  
  const isRep = currentUser && selectedCourse.rep.toLowerCase() === currentUser.name.toLowerCase();
  const isEnrolled = currentUser && selectedCourse.enrolled && selectedCourse.enrolled.includes(currentUser.matric);

  if (!isRep && !isEnrolled) {
    alert(`⚠️ Access Denied! You are not enrolled in "${selectedCourse.name}". Please join using code [${selectedCourse.code}] first.`);
    return;
  }

  activeCourse = selectedCourse;
  
  if (dashboardSection) dashboardSection.classList.add("hidden");
  if (portalSection) portalSection.classList.remove("hidden");

  document.getElementById("portalCourseTitle").textContent = activeCourse.name;
  document.getElementById("portalCourseCode").textContent = activeCourse.code;
  document.getElementById("portalCourseRep").textContent = activeCourse.rep;

  const repControls = document.getElementById("repControls");
  const studentControls = document.getElementById("studentControls");

  if (isRep) {
    if (repControls) repControls.classList.remove("hidden");
    if (studentControls) studentControls.classList.add("hidden");
  } else {
    if (repControls) repControls.classList.add("hidden");
    if (studentControls) studentControls.classList.remove("hidden");
  }

  renderPortalState();
};

const backToDashboardBtn = document.getElementById("backToDashboard");
if (backToDashboardBtn) {
  backToDashboardBtn.addEventListener("click", () => {
    if (portalSection) portalSection.classList.add("hidden");
    if (dashboardSection) dashboardSection.classList.remove("hidden");
    activeCourse = null;
    if (countdownInterval) clearInterval(countdownInterval);
  });
}

// Create Course Form
const createCourseForm = document.getElementById("createCourseForm");
if (createCourseForm) {
  createCourseForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("courseTitle").value.trim();
    const code = document.getElementById("courseCodeInput").value.trim().toUpperCase();

    const codeExists = courses.find(c => c.code === code);
    if (codeExists) {
      alert(`⚠️ Course code "${code}" already exists in the system!`);
      return;
    }

    const newCourse = { 
      name, 
      code, 
      rep: currentUser ? currentUser.name : "Unknown",
      enrolled: currentUser ? [currentUser.matric] : []
    };
    courses.push(newCourse);
    localStorage.setItem("attendify_courses", JSON.stringify(courses));

    if (createModal) createModal.classList.remove("show");
    createCourseForm.reset();
    renderCourses();
  });
}

// Join Course Form
const joinCourseForm = document.getElementById("joinCourseForm");
if (joinCourseForm) {
  joinCourseForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = document.getElementById("joinCode").value.trim().toUpperCase();

    const found = courses.find(c => c.code === code);
    if (found) {
      if (!found.enrolled) found.enrolled = [];
      if (currentUser && !found.enrolled.includes(currentUser.matric)) {
        found.enrolled.push(currentUser.matric);
        localStorage.setItem("attendify_courses", JSON.stringify(courses));
      }
      alert(`Successfully joined ${found.name}! 🎉`);
      renderCourses();
    } else {
      alert(`⚠️ Course code "${code}" not found.`);
    }

    if (joinModal) joinModal.classList.remove("show");
    joinCourseForm.reset();
  });
}

// Forgot Password Form Submission
const forgotPasswordForm = document.getElementById("forgotPasswordForm");
if (forgotPasswordForm) {
  forgotPasswordForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("forgotEmail").value.trim().toLowerCase();
    const matric = document.getElementById("forgotMatric").value.trim().toUpperCase();
    const newPassword = document.getElementById("newPassword").value;

    const userIndex = users.findIndex(u => u.email === email && u.matric === matric);

    if (userIndex !== -1) {
      users[userIndex].password = newPassword;
      localStorage.setItem("attendify_users", JSON.stringify(users));

      alert("🎉 Password updated successfully! You can now log in with your new password.");
      if (forgotModal) forgotModal.classList.remove("show");
      forgotPasswordForm.reset();
    } else {
      alert("❌ No account found matching this Email and Matric Number combination.");
    }
  });
}

// --- 60-SECOND ATTENDANCE ENGINE & TIMER LOGIC ---
let countdownInterval = null;

const generatePinBtn = document.getElementById("generatePinBtn");
const activePinDisplay = document.getElementById("activePinDisplay");
const pinCodeText = document.getElementById("pinCodeText");
const sessionBanner = document.getElementById("sessionBanner");
const countdownTimer = document.getElementById("countdownTimer");
const checkInForm = document.getElementById("checkInForm");
const rosterList = document.getElementById("rosterList");
const rosterCount = document.getElementById("rosterCount");

if (generatePinBtn) {
  generatePinBtn.addEventListener("click", () => {
    if (!activeCourse) return;

    const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
    
    activeCourse.activeSession = {
      pin: randomPin,
      expiresAt: Date.now() + 60000, // 60 seconds
      expired: false,
      attendees: []
    };

    updateCourseInStorage();
    startSessionTimer();
    renderPortalState();
  });
}

function startSessionTimer() {
  if (countdownInterval) clearInterval(countdownInterval);

  if (!activeCourse || !activeCourse.activeSession) return;

  countdownInterval = setInterval(() => {
    const session = activeCourse.activeSession;
    if (!session) {
      clearInterval(countdownInterval);
      return;
    }

    const timeLeft = Math.floor((session.expiresAt - Date.now()) / 1000);

    // Grab the timer element dynamically inside the loop so it never misses it
    const liveTimerElement = document.getElementById("countdownTimer");

    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      session.expired = true;
      updateCourseInStorage();
      renderPortalState();
    } else {
      if (liveTimerElement) {
        liveTimerElement.textContent = `${timeLeft}s`;
      }
    }
  }, 1000);
}


if (checkInForm) {
  checkInForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const session = activeCourse ? activeCourse.activeSession : null;

    if (!session || session.expired || Date.now() > session.expiresAt) {
      alert("⏰ Time is up! The attendance session has expired.");
      return;
    }

    const enteredPin = document.getElementById("studentPinInput").value.trim();

    if (enteredPin !== session.pin) {
      alert("❌ Incorrect PIN! Check with your Course Rep.");
      return;
    }

    if (session.attendees.includes(currentUser.matric)) {
      alert("⚠️ You have already checked in for this session!");
      return;
    }

    session.attendees.push(currentUser.matric);
    updateCourseInStorage();
    renderPortalState();
    checkInForm.reset();
    alert("🎉 Attendance marked successfully!");
  });
}

function updateCourseInStorage() {
  const index = courses.findIndex(c => c.code === activeCourse.code);
  if (index !== -1) {
    courses[index] = activeCourse;
    localStorage.setItem("attendify_courses", JSON.stringify(courses));
  }
}

function renderPortalState() {
  if (!activeCourse) return;

  const isRep = currentUser && activeCourse.rep.toLowerCase() === currentUser.name.toLowerCase();
  const session = activeCourse.activeSession;
  const isSessionActive = session && !session.expired && Date.now() < session.expiresAt;

  const bannerTitle = document.getElementById("bannerTitle");
  const bannerText = document.getElementById("bannerText");

  if (isSessionActive) {
    if (sessionBanner) {
      sessionBanner.classList.remove("hidden");
      sessionBanner.style.borderColor = "#28a745";
      sessionBanner.style.background = "rgba(40, 167, 69, 0.1)";
      if (bannerTitle) {
        bannerTitle.textContent = "🔴 ATTENDANCE SESSION LIVE";
        bannerTitle.style.color = "#28a745";
      }
      if (bannerText) {
        bannerText.innerHTML = `Time Remaining: <strong id="countdownTimer" style="font-size: 1.2rem;">60s</strong>`;
      }
    }
    if (isRep) {
      if (activePinDisplay) activePinDisplay.classList.remove("hidden");
      if (pinCodeText) pinCodeText.textContent = session.pin;
      if (generatePinBtn) generatePinBtn.textContent = "🔄 Regenerate PIN";
    }
    startSessionTimer();
  } else {
    if (sessionBanner) {
      if (session && session.expired) {
        sessionBanner.classList.remove("hidden");
        sessionBanner.style.borderColor = "#dc3545";
        sessionBanner.style.background = "rgba(220, 53, 69, 0.1)";
        if (bannerTitle) {
          bannerTitle.textContent = "⏹️ ATTENDANCE SESSION CLOSED";
          bannerTitle.style.color = "#dc3545";
        }
        if (bannerText) {
          bannerText.textContent = "The 60-second window has expired. PIN is no longer valid.";
        }
      } else {
        sessionBanner.classList.add("hidden");
      }
    }
    if (isRep) {
      if (activePinDisplay) activePinDisplay.classList.add("hidden");
      if (generatePinBtn) generatePinBtn.textContent = "Generate Attendance PIN ⏱️";
    }
  }

  if (!rosterList) return;
  rosterList.innerHTML = "";

  const attendees = session && session.attendees ? session.attendees : [];
  if (rosterCount) rosterCount.textContent = attendees.length;

  if (attendees.length === 0) {
    rosterList.innerHTML = `<li style="color: var(--muted); font-size: 0.9rem; text-align: center; padding: 10px;">No check-ins recorded yet. ⏳</li>`;
    return;
  }

  attendees.forEach(matric => {
    const li = document.createElement("li");
    li.style.cssText = "display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 0.9rem;";
    li.innerHTML = `<span>🎓 <strong>${matric}</strong></span> <span style="color: #28a745; font-weight: bold;">Present ✅</span>`;
    rosterList.appendChild(li);
  });
}
checkAuth();