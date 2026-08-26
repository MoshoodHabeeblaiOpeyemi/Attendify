// --- FIREBASE IMPORTS & CONFIGURATION ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc 
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDUtViZ-mef1dSV-XpSos4-oh1HpQ7jpyw",
  authDomain: "attendify-4c93d.firebaseapp.com",
  projectId: "attendify-4c93d",
  storageBucket: "attendify-4c93d.firebasestorage.app",
  messagingSenderId: "912075322838",
  appId: "1:912075322838:web:c8e5a9a16b1acf7667e077"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// --- GLOBAL APP STATES ---
let courses = [];
let users = [];
let currentUser = null;
let activeCourse = null;
let countdownInterval = null;

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

function checkAuth() {
  if (currentUser) {
    authContainer.classList.add("hidden");
    dashboardSection.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    displayName.textContent = currentUser.name;
    displayMatric.textContent = currentUser.matric;

    const openCreateModalBtn = document.getElementById("openCreateModal");
    if (openCreateModalBtn) {
      const isAnywhereAssistant = courses.some(c => c.assistants && c.assistants.includes(currentUser.matric));
      
      if (currentUser.isRep || isAnywhereAssistant) {
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

// --- FIREBASE AUTHENTICATION LOGIC ---

// SIGN UP SUBMISSION
const signupForm = document.getElementById("signupForm");
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("signupName").value.trim();
    const matric = document.getElementById("signupMatric").value.trim().toUpperCase();
    const email = document.getElementById("signupEmail").value.trim().toLowerCase();
    const password = document.getElementById("signupPassword").value;
    const isRep = document.getElementById("isRepCheckbox").checked;

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      await setDoc(doc(db, "users", uid), {
        uid: uid,
        name: name,
        matric: matric,
        email: email,
        isRep: isRep
      });

      signupForm.reset();
      alert("Account created successfully in the cloud! 🎉");
    } catch (error) {
      console.error("Signup error:", error);
      alert("⚠️ Error: " + error.message);
    }
  });
}

// LOG IN SUBMISSION
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;

    try {
      await signInWithEmailAndPassword(auth, email, password);
      loginForm.reset();
      alert("Logged in successfully! 🚀");
    } catch (error) {
      console.error("Login error:", error);
      alert("❌ Invalid email or password. Please check your credentials.");
    }
  });
}

// LOGOUT & SESSION CLEANUP
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      currentUser = null;
      
      if (portalSection) portalSection.classList.add("hidden");
      const repArchiveSection = document.getElementById("repArchiveSection");
      if (repArchiveSection) repArchiveSection.classList.add("hidden");
      const assistantManagementSection = document.getElementById("assistantManagementSection");
      if (assistantManagementSection) assistantManagementSection.classList.add("hidden");

      activeCourse = null;
      if (countdownInterval) clearInterval(countdownInterval);
      
      checkAuth();
      alert("Logged out successfully! 👋");
    } catch (error) {
      console.error("Logout error:", error);
    }
  });
}

// PERSISTENT AUTH STATE LISTENER
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      currentUser = userDoc.data();
    } else {
      currentUser = { name: "User", matric: "---", email: user.email, isRep: false };
    }
    checkAuth();
  } else {
    currentUser = null;
    checkAuth();
  }
});

if (deleteAccountBtn) {
  deleteAccountBtn.addEventListener("click", () => {
    if (confirm("⚠️ Are you sure you want to delete your account? This cannot be undone.")) {
      const userMatric = currentUser.matric;

      courses.forEach(course => {
        if (course.enrolled) {
          course.enrolled = course.enrolled.filter(m => m !== userMatric);
        }
        if (course.assistants) {
          course.assistants = course.assistants.filter(m => m !== userMatric);
        }
      });
      localStorage.setItem("attendify_courses", JSON.stringify(courses));

      users = users.filter(u => u.email !== currentUser.email);
      localStorage.setItem("attendify_users", JSON.stringify(users));
      
      currentUser = null;
      
      if (portalSection) portalSection.classList.add("hidden");
      const repArchiveSection = document.getElementById("repArchiveSection");
      if (repArchiveSection) repArchiveSection.classList.add("hidden");
      const assistantManagementSection = document.getElementById("assistantManagementSection");
      if (assistantManagementSection) assistantManagementSection.classList.add("hidden");

      activeCourse = null;
      if (countdownInterval) clearInterval(countdownInterval);

      checkAuth();
      alert("Account deleted and course records updated successfully.");
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
const courseGrid = document.getElementById("courseGrid");
const portalSection = document.getElementById("portalSection");

function renderCourses() {
  if (!courseGrid) return;
  courseGrid.innerHTML = "";

  const myCourses = courses.filter(course => {
    if (!currentUser) return false;
    const isRep = course.rep.toLowerCase() === currentUser.name.toLowerCase();
    const isAssistant = course.assistants && course.assistants.includes(currentUser.matric);
    const isEnrolled = course.enrolled && course.enrolled.includes(currentUser.matric);
    return isRep || isAssistant || isEnrolled;
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
    checkAuth();
  }
};

window.leaveCourse = function(index) {
  const course = courses[index];
  if (confirm(`⚠️ Do you want to leave "${course.name}"? You can rejoin anytime using code [${course.code}].`)) {
    if (course.enrolled) {
      course.enrolled = course.enrolled.filter(m => m !== currentUser.matric);
    }
    if (course.assistants) {
      course.assistants = course.assistants.filter(m => m !== currentUser.matric);
    }
    localStorage.setItem("attendify_courses", JSON.stringify(courses));
    checkAuth();
    alert(`You have left ${course.name}. 👋`);
  }
};

window.openPortal = function(index) {
  const selectedCourse = courses[index];
  
  const isRep = currentUser && selectedCourse.rep.toLowerCase() === currentUser.name.toLowerCase();
  const isAssistant = currentUser && selectedCourse.assistants && selectedCourse.assistants.includes(currentUser.matric);
  const isEnrolled = currentUser && selectedCourse.enrolled && selectedCourse.enrolled.includes(currentUser.matric);

  if (!isRep && !isAssistant && !isEnrolled) {
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
  const repArchiveSection = document.getElementById("repArchiveSection");
  const assistantManagementSection = document.getElementById("assistantManagementSection");

  if (isRep || isAssistant) {
    if (repControls) repControls.classList.remove("hidden");
    if (studentControls) studentControls.classList.add("hidden");
    
    if (isRep) {
      if (repArchiveSection) repArchiveSection.classList.remove("hidden");
      if (assistantManagementSection) assistantManagementSection.classList.remove("hidden");
      renderAssistantDropdownAndList();
    } else {
      if (repArchiveSection) repArchiveSection.classList.add("hidden");
      if (assistantManagementSection) assistantManagementSection.classList.add("hidden");
    }
  } else {
    if (repControls) repControls.classList.add("hidden");
    if (studentControls) studentControls.classList.remove("hidden");
    if (repArchiveSection) repArchiveSection.classList.add("hidden");
    if (assistantManagementSection) assistantManagementSection.classList.add("hidden");
  }

  renderPortalState();
};

const backToDashboardBtn = document.getElementById("backToDashboard");
if (backToDashboardBtn) {
  backToDashboardBtn.addEventListener("click", () => {
    if (portalSection) portalSection.classList.add("hidden");
    if (dashboardSection) dashboardSection.classList.remove("hidden");
    
    const repArchiveSection = document.getElementById("repArchiveSection");
    if (repArchiveSection) repArchiveSection.classList.add("hidden");
    const assistantManagementSection = document.getElementById("assistantManagementSection");
    if (assistantManagementSection) assistantManagementSection.classList.add("hidden");

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
      enrolled: currentUser ? [currentUser.matric] : [],
      assistants: [],
      attendanceHistory: []
    };
    courses.push(newCourse);
    localStorage.setItem("attendify_courses", JSON.stringify(courses));

    if (createModal) createModal.classList.remove("show");
    createCourseForm.reset();
    checkAuth();
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
      checkAuth();
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

// --- ASSISTANT REPS MANAGEMENT LOGIC ---
const appointAssistantBtn = document.getElementById("appointAssistantBtn");
if (appointAssistantBtn) {
  appointAssistantBtn.addEventListener("click", () => {
    if (!activeCourse) return;

    const selectEl = document.getElementById("courseStudentSelect");
    const selectedMatric = selectEl ? selectEl.value : "";

    if (!selectedMatric) {
      alert("⚠️ Please select an enrolled student to appoint.");
      return;
    }

    if (!activeCourse.assistants) {
      activeCourse.assistants = [];
    }

    if (activeCourse.assistants.includes(selectedMatric)) {
      alert("⚠️ This student is already an appointed assistant!");
      return;
    }

    activeCourse.assistants.push(selectedMatric);
    updateCourseInStorage();
    
    renderPortalState();
    renderAssistantDropdownAndList();
    
    alert("🎉 Assistant badge assigned successfully! 👑 ASST");
  });
}

window.revokeAssistant = function(matric) {
  if (!activeCourse || !activeCourse.assistants) return;

  if (confirm("⚠️ Do you want to remove this assistant's badge?")) {
    activeCourse.assistants = activeCourse.assistants.filter(m => m !== matric);
    updateCourseInStorage();
    
    renderPortalState();
    renderAssistantDropdownAndList();
    
    alert("Assistant badge removed.");
  }
};

function renderAssistantDropdownAndList() {
  if (!activeCourse) return;

  const selectEl = document.getElementById("courseStudentSelect");
  const listEl = document.getElementById("assistantsList");
  if (!selectEl || !listEl) return;

  selectEl.innerHTML = `<option value="">-- Choose student to appoint --</option>`;
  const enrolled = activeCourse.enrolled || [];

  enrolled.forEach(matric => {
    const userObj = users.find(u => u.matric === matric);
    const name = userObj ? userObj.name : "Student";
    const isMainRep = activeCourse.rep.toLowerCase() === name.toLowerCase();
    const isAlreadyAssistant = activeCourse.assistants && activeCourse.assistants.includes(matric);

    if (!isMainRep && !isAlreadyAssistant) {
      const opt = document.createElement("option");
      opt.value = matric;
      opt.textContent = `${name} (${matric})`;
      selectEl.appendChild(opt);
    }
  });

  const assistants = activeCourse.assistants || [];
  if (assistants.length === 0) {
    listEl.innerHTML = `<li style="color: var(--muted); font-size: 0.85rem; padding: 5px;">No assistants appointed yet. ⏳</li>`;
  } else {
    listEl.innerHTML = "";
    assistants.forEach(matric => {
      const userObj = users.find(u => u.matric === matric);
      const name = userObj ? userObj.name : "Student";

      const li = document.createElement("li");
      li.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--card-bg); border-radius: 6px; margin-bottom: 6px; font-size: 0.85rem;";
      li.innerHTML = `<span>👑 <strong>${name}</strong> (${matric}) <span style="background: var(--teal); color: white; padding: 2px 4px; border-radius: 3px; font-size: 0.65rem;">ASST</span></span> <button onclick="revokeAssistant('${matric}')" style="background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 0.8rem;">Remove ❌</button>`;
      listEl.appendChild(li);
    });
  }
}

// Helper: Calculate distance in meters between two lat/lng points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// --- 60-SECOND ATTENDANCE ENGINE & TIMER LOGIC ---
const generatePinBtn = document.getElementById("generatePinBtn");
const activePinDisplay = document.getElementById("activePinDisplay");
const pinCodeText = document.getElementById("pinCodeText");
const sessionBanner = document.getElementById("sessionBanner");
const checkInForm = document.getElementById("checkInForm");
const rosterList = document.getElementById("rosterList");
const rosterCount = document.getElementById("rosterCount");

if (generatePinBtn) {
  generatePinBtn.addEventListener("click", () => {
    if (!activeCourse) return;

    const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
    const managerMatric = currentUser ? currentUser.matric : "REP-001";

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          createSession(randomPin, managerMatric, position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          console.warn("Could not capture Rep GPS, using default campus coordinates.");
          createSession(randomPin, managerMatric, 6.5244, 3.3792);
        },
        { enableHighAccuracy: true }
      );
    } else {
      createSession(randomPin, managerMatric, 6.5244, 3.3792);
    }
  });
}

function createSession(pin, managerMatric, lat, lon) {
  activeCourse.activeSession = {
    pin: pin,
    expiresAt: Date.now() + 60000,
    expired: false,
    attendees: [managerMatric],
    lat: lat,
    lon: lon
  };

  updateCourseInStorage();
  startSessionTimer();
  renderPortalState();
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

    if (!navigator.geolocation) {
      alert("⚠️ Geolocation is not supported by your browser.");
      return;
    }

    alert("📍 Verifying your location... Please allow location access.");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const studentLat = position.coords.latitude;
        const studentLon = position.coords.longitude;
        const repLat = session.lat || 6.5244;
        const repLon = session.lon || 3.3792;

        const distanceMeters = calculateDistance(studentLat, studentLon, repLat, repLon);
        const ALLOWED_RADIUS = 150;

        if (distanceMeters > ALLOWED_RADIUS) {
          alert(`🚨 Geofencing Block: You are too far from the lecture hall (~${Math.round(distanceMeters)}m away). You must be within ${ALLOWED_RADIUS}m to check in!`);
          return;
        }

        session.attendees.push(currentUser.matric);
        updateCourseInStorage();
        renderPortalState();
        checkInForm.reset();
        alert("🎉 Attendance marked successfully with GPS Verification! ✅📍");
      },
      (error) => {
        alert("❌ GPS Error: Unable to retrieve your location. Please ensure location services are enabled on your device.");
        console.error(error);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

const closeClassBtn = document.getElementById("closeClassBtn");

if (closeClassBtn) {
  closeClassBtn.addEventListener("click", () => {
    if (!activeCourse) return;

    if (confirm("⚠️ Are you sure you want to close this attendance session and save the records?")) {
      if (!activeCourse.attendanceHistory) {
        activeCourse.attendanceHistory = [];
      }

      if (activeCourse.activeSession && activeCourse.activeSession.attendees.length > 0) {
        const sessionRecord = {
          date: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          attendees: [...activeCourse.activeSession.attendees]
        };
        activeCourse.attendanceHistory.push(sessionRecord);
      }

      activeCourse.activeSession = null;
      if (countdownInterval) clearInterval(countdownInterval);

      updateCourseInStorage();
      renderPortalState();
      alert("📁 Class closed successfully! Attendance has been archived.");
    }
  });
}

const endSemesterBtn = document.getElementById("endSemesterBtn");

if (endSemesterBtn) {
  endSemesterBtn.addEventListener("click", () => {
    if (!activeCourse) return;

    if (confirm(`⚠️ WARNING: Are you sure you want to END THE SEMESTER for "${activeCourse.name}"? This will clear all class history and reset the total class count to 0. Enrolled students will remain.`)) {
      activeCourse.attendanceHistory = [];
      activeCourse.activeSession = null;
      if (countdownInterval) clearInterval(countdownInterval);

      updateCourseInStorage();
      renderPortalState();
      alert("🎓 Semester ended successfully! All records have been reset for the new semester. 🚀");
    }
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
  const isAssistant = currentUser && activeCourse.assistants && activeCourse.assistants.includes(currentUser.matric);
  const session = activeCourse.activeSession;
  const isSessionActive = session && !session.expired && Date.now() < session.expiresAt;

  const bannerTitle = document.getElementById("bannerTitle");
  const bannerText = document.getElementById("bannerText");
  const closeClassWrapper = document.getElementById("closeClassWrapper");

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
    if (isRep || isAssistant) {
      if (activePinDisplay) activePinDisplay.classList.remove("hidden");
      if (pinCodeText) pinCodeText.textContent = session.pin;
      if (generatePinBtn) generatePinBtn.textContent = "🔄 Regenerate PIN";
      if (closeClassWrapper) closeClassWrapper.classList.remove("hidden");
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
          if (isRep || isAssistant) {
            bannerText.textContent = "The 60-second window has expired. PIN is no longer valid, but you can review and close class.";
          } else {
            bannerText.textContent = "The attendance window for this session has closed. PIN is no longer valid.";
          }
        }
      } else {
        sessionBanner.classList.add("hidden");
      }
    }
    if (isRep || isAssistant) {
      if (activePinDisplay) activePinDisplay.classList.add("hidden");
      if (generatePinBtn) generatePinBtn.textContent = "Generate Attendance PIN ⏱️";
      
      if (session && session.attendees && session.attendees.length > 0) {
        if (closeClassWrapper) closeClassWrapper.classList.remove("hidden");
      } else {
        if (closeClassWrapper) closeClassWrapper.classList.add("hidden");
      }
    }
  }

  if (!rosterList) return;
  rosterList.innerHTML = "";

  const attendees = session && session.attendees ? session.attendees : [];
  if (rosterCount) rosterCount.textContent = attendees.length;

  if (attendees.length === 0) {
    rosterList.innerHTML = `<li style="color: var(--muted); font-size: 0.9rem; text-align: center; padding: 10px;">No check-ins recorded yet. ⏳</li>`;
  } else {
    attendees.forEach(matric => {
      const foundUser = users.find(u => u.matric === matric);
      const displayName = foundUser ? foundUser.name : "Student";
      
      const isMainRepUser = foundUser && activeCourse.rep.toLowerCase() === foundUser.name.toLowerCase();
      const isAssistantUser = activeCourse.assistants && activeCourse.assistants.includes(matric);
      
      let badgeHTML = "";
      if (isMainRepUser) {
        badgeHTML = `<span style="background: var(--teal); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 6px;">👑 REP</span>`;
      } else if (isAssistantUser) {
        badgeHTML = `<span style="background: var(--teal); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 6px;">👑 ASST</span>`;
      }

      const li = document.createElement("li");
      li.style.cssText = "display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 0.9rem;";
      li.innerHTML = `<span>🎓 <strong>${displayName}</strong> (${matric}) ${badgeHTML}</span> <span style="color: #28a745; font-weight: bold;">Present ✅</span>`;
      rosterList.appendChild(li);
    });
  }

  const repArchiveSection = document.getElementById("repArchiveSection");
  if (isRep && repArchiveSection) {
    const totalClassesCount = document.getElementById("totalClassesCount");
    const archiveListContainer = document.getElementById("archiveListContainer");

    const history = activeCourse.attendanceHistory || [];
    if (totalClassesCount) totalClassesCount.textContent = history.length;

    if (history.length === 0) {
      archiveListContainer.innerHTML = `<p style="font-size: 0.9rem; color: var(--muted); text-align: center; padding: 10px;">No archived classes yet. Close a live class to save records here! 🗂️</p>`;
    } else {
      archiveListContainer.innerHTML = "";
      history.forEach((sessionRecord) => {
        const archiveCard = document.createElement("div");
        archiveCard.style.cssText = "background: var(--card-bg); padding: 12px; border-radius: 8px; margin-bottom: 10px; border: 1px solid var(--border);";
        
        const attendeesListHTML = sessionRecord.attendees.map(m => {
          const u = users.find(user => user.matric === m);
          return `<li style="font-size: 0.85rem; padding: 2px 0;">🎓 ${u ? u.name : "Student"} (${m})</li>`;
        }).join("");

        archiveCard.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
            <strong>📅 Session on ${sessionRecord.date}</strong>
            <span style="font-size: 0.8rem; background: var(--teal); color: white; padding: 2px 6px; border-radius: 4px;">${sessionRecord.attendees.length} Present</span>
          </div>
          <details style="font-size: 0.85rem; color: var(--muted); cursor: pointer; margin-top: 5px;">
            <summary>View Attendees List 👀</summary>
            <ul style="list-style: none; padding-left: 10px; margin-top: 5px;">${attendeesListHTML}</ul>
          </details>
        `;
        archiveListContainer.appendChild(archiveCard);
      });
    }
  }

  const studentAnalyticsSection = document.getElementById("studentAnalyticsSection");
  const isEnrolled = currentUser && activeCourse.enrolled && activeCourse.enrolled.includes(currentUser.matric);

  if (isEnrolled && studentAnalyticsSection) {
    studentAnalyticsSection.classList.remove("hidden");

    const history = activeCourse.attendanceHistory || [];
    const totalClasses = history.length;
    
    let attendedCount = 0;
    history.forEach(sessionRecord => {
      if (sessionRecord.attendees && sessionRecord.attendees.includes(currentUser.matric)) {
        attendedCount++;
      }
    });

    const percentage = totalClasses > 0 ? Math.round((attendedCount / totalClasses) * 100) : 100;

    document.getElementById("statAttendedCount").textContent = attendedCount;
    document.getElementById("statTotalClasses").textContent = totalClasses;
    document.getElementById("statPercentage").textContent = `${percentage}%`;

    const eligibilityBanner = document.getElementById("eligibilityBanner");
    if (totalClasses === 0) {
      eligibilityBanner.style.background = "rgba(108, 117, 125, 0.1)";
      eligibilityBanner.style.color = "var(--muted)";
      eligibilityBanner.textContent = "⏳ No archived classes yet. Analytics will update as classes are held.";
    } else if (percentage >= 70) {
      eligibilityBanner.style.background = "rgba(40, 167, 69, 0.1)";
      eligibilityBanner.style.color = "#28a745";
      eligibilityBanner.textContent = `✅ ELIGIBLE: You meet the 70% attendance threshold (${percentage}%).`;
    } else {
      eligibilityBanner.style.background = "rgba(220, 53, 69, 0.1)";
      eligibilityBanner.style.color = "#dc3545";
      eligibilityBanner.textContent = `⚠️ WARNING: Your attendance is at ${percentage}%. You are below the 70% exam eligibility requirement!`;
    }
  } else if (studentAnalyticsSection) {
    studentAnalyticsSection.classList.add("hidden");
  }
}