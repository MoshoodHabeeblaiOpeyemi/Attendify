// --- FIREBASE IMPORTS & CONFIGURATION ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  sendPasswordResetEmail 
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  onSnapshot 
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
let currentUser = null;
let activeCourse = null;
let countdownInterval = null;

// --- DEFAULT THEME ICON SYNC ---
document.addEventListener("DOMContentLoaded", () => {
  const themeToggle = document.getElementById("themeToggle");
  const htmlElement = document.documentElement;
  if (themeToggle && htmlElement.getAttribute("data-theme") === "dark") {
    themeToggle.textContent = "☀️";
  }
});

// --- REAL-TIME FIRESTORE SYNC ---
let unsubscribeCourses = null;

function startCourseListener() {
  if (unsubscribeCourses) return; // Don't start if already running
  unsubscribeCourses = onSnapshot(collection(db, "courses"), (snapshot) => {
    courses = [];
    snapshot.forEach((docSnap) => {
      courses.push({ id: docSnap.id, ...docSnap.data() });
    });
    if (currentUser) {
      renderCourses();
      if (activeCourse) {
        const updated = courses.find(c => c.id === activeCourse.id);
        if (updated) {
          activeCourse = updated;
          renderPortalState();
        }
      }
    }
  });
}

function stopCourseListener() {
  if (unsubscribeCourses) {
    unsubscribeCourses();
    unsubscribeCourses = null;
  }
}

// --- THEME TOGGLE LOGIC ---
const themeToggle = document.getElementById("themeToggle");
const htmlElement = document.documentElement;

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const currentTheme = htmlElement.getAttribute("data-theme");
    const newTheme = currentTheme === "light" ? "dark" : "light";
    htmlElement.setAttribute("data-theme", newTheme);
    themeToggle.textContent = newTheme === "dark" ? "☀️" : "🌙";
  });
}

// --- AUTH & USER DATABASE MANAGEMENT ---
const authContainer = document.getElementById("authContainer");
const signupCard = document.getElementById("signupCard");
const loginCard = document.getElementById("loginCard");
const dashboardSection = document.getElementById("dashboardSection");
const displayName = document.getElementById("displayName");
const displayMatric = document.getElementById("displayMatric");
const logoutBtn = document.getElementById("logoutBtn");
const deleteAccountBtn = document.getElementById("deleteAccountBtn");

const showLoginBtn = document.getElementById("showLogin");
if (showLoginBtn) {
  showLoginBtn.addEventListener("click", (e) => {
    e.preventDefault();
    signupCard.classList.add("hidden");
    loginCard.classList.remove("hidden");
  });
}

const showSignupBtn = document.getElementById("showSignup");
if (showSignupBtn) {
  showSignupBtn.addEventListener("click", (e) => {
    e.preventDefault();
    loginCard.classList.add("hidden");
    signupCard.classList.remove("hidden");
  });
}

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

// SIGN UP SUBMISSION (With Level, Dept, School Scoping & Rep Locking)
const signupForm = document.getElementById("signupForm");
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = signupForm.querySelector("button[type='submit']");
    const name = document.getElementById("signupName").value.trim();
    const matric = document.getElementById("signupMatric").value.trim().toUpperCase();
    const email = document.getElementById("signupEmail").value.trim().toLowerCase();
    const password = document.getElementById("signupPassword").value;
    const isRep = document.getElementById("isRepCheckbox").checked;
    
    const institutionInput = document.getElementById("signupInstitution");
    const departmentInput = document.getElementById("signupDepartment");
    const levelInput = document.getElementById("signupLevel");

    const institution = institutionInput ? institutionInput.value.trim().toUpperCase() : "GENERAL";
    const department = departmentInput ? departmentInput.value.trim() : "GENERAL";
    const level = levelInput ? levelInput.value.trim().toUpperCase() : "GENERAL";

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Validating... ⏳";
      }

      // 🛡️ REPQ CHECK: Enforce single rep per department/level at the database level
      if (isRep) {
        const cleanInst = institution.replace(/[^a-zA-Z0-9]/g, "_");
        const cleanDept = department.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        const cleanLevel = level.replace(/[^a-zA-Z0-9]/g, "_");
        const repSlotId = `rep_${cleanInst}_${cleanDept}_${cleanLevel}`;

        const repSlotRef = doc(db, "departmentReps", repSlotId);
        const repSlotSnap = await getDoc(repSlotRef);

        if (repSlotSnap.exists()) {
          alert(`⚠️ Registration Blocked: A Department Rep is already registered for ${institution} - ${department} (${level}). Only one main rep is allowed per level/department!`);
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Sign Up 📝";
          }
          return;
        }

        window._pendingRepSlotRef = repSlotRef;
      }

      if (submitBtn) {
        submitBtn.textContent = "Creating Account... ⏳";
      }

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      await setDoc(doc(db, "users", uid), {
        uid: uid,
        name: name,
        matric: matric,
        email: email,
        isRep: isRep,
        institution: institution,
        department: department,
        level: level
      });

      if (isRep && window._pendingRepSlotRef) {
        await setDoc(window._pendingRepSlotRef, { repUid: uid, registeredAt: Date.now() });
      }

      signupForm.reset();
      alert("Account created successfully in the cloud! 🎉");
    } catch (error) {
      console.error("Signup error:", error);
      alert("⚠️ Error: " + error.message);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign Up 📝";
      }
    }
  });
}

// LOG IN SUBMISSION
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = loginForm.querySelector("button[type='submit']");
    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Logging in... ⏳";
      }

      await signInWithEmailAndPassword(auth, email, password);
      loginForm.reset();
    } catch (error) {
      console.error("Login error:", error);
      alert("❌ Invalid email or password. Please check your credentials.");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Log In 🔓";
      }
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
      currentUser = { name: "User", matric: "---", email: user.email, isRep: false, institution: "GENERAL", department: "GENERAL" };
    }
    
    startCourseListener(); // ✅ Start listening for courses NOW
    checkAuth();
  } else {
    currentUser = null;
    
    stopCourseListener(); // ✅ Stop listening when logged out
    checkAuth();
  }
});

if (deleteAccountBtn) {
  deleteAccountBtn.addEventListener("click", async () => {
    if (confirm("⚠️ Are you sure you want to delete your account? This cannot be undone.")) {
      const userMatric = currentUser.matric;

      for (let course of courses) {
        let updated = false;
        let newEnrolled = course.enrolled || [];
        let newAssistants = course.assistants || [];

        if (newEnrolled.includes(userMatric)) {
          newEnrolled = newEnrolled.filter(m => m !== userMatric);
          updated = true;
        }
        if (newAssistants.includes(userMatric)) {
          newAssistants = newAssistants.filter(m => m !== userMatric);
          updated = true;
        }

        if (updated) {
          await updateDoc(doc(db, "courses", course.id), {
            enrolled: newEnrolled,
            assistants: newAssistants
          });
        }
      }

      currentUser = null;
      if (portalSection) portalSection.classList.add("hidden");
      const repArchiveSection = document.getElementById("repArchiveSection");
      if (repArchiveSection) repArchiveSection.classList.add("hidden");
      const assistantManagementSection = document.getElementById("assistantManagementSection");
      if (assistantManagementSection) assistantManagementSection.classList.add("hidden");

      activeCourse = null;
      if (countdownInterval) clearInterval(countdownInterval);

      checkAuth();
      alert("Account references cleaned successfully.");
    }
  });
}

// --- MODALS & CLOSE HANDLERS ---
const createModal = document.getElementById("createModal");
const joinModal = document.getElementById("joinModal");
const forgotModal = document.getElementById("forgotModal");
const guideModal = document.getElementById("guideModal");
const openGuideBtn = document.getElementById("openGuideBtn");

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
    if (guideModal) guideModal.classList.remove("show");
  });
});

if (openGuideBtn && guideModal) {
  openGuideBtn.addEventListener("click", () => {
    guideModal.classList.add("show");
  });
}

// FORGOT PASSWORD SUBMISSION
const forgotPasswordForm = document.getElementById("forgotPasswordForm");
if (forgotPasswordForm) {
  forgotPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = forgotPasswordForm.querySelector("button[type='submit']");
    const email = document.getElementById("forgotEmail").value.trim().toLowerCase();

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending Link... ⏳";
      }

      await sendPasswordResetEmail(auth, email);
      
      alert("Password reset email sent! Check your inbox or spam folder. 📧✨");
      forgotPasswordForm.reset();
      
      if (forgotModal) forgotModal.classList.remove("show");
    } catch (error) {
      console.error("Password reset error:", error);
      alert("⚠️ Error: " + error.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Update Password 🔄";
      }
    }
  });
}

// --- COURSES & PORTAL MANAGEMENT ---
const courseGrid = document.getElementById("courseGrid");
const portalSection = document.getElementById("portalSection");

function renderCourses() {
  if (!courseGrid) return;
  courseGrid.innerHTML = "";

  const myCourses = courses.filter(course => {
    if (!currentUser) return false;
    const isRep = course.repUid === currentUser.uid || course.rep.toLowerCase() === currentUser.name.toLowerCase();
    const isAssistant = course.assistants && course.assistants.includes(currentUser.matric);
    const isEnrolled = course.enrolled && course.enrolled.includes(currentUser.matric);
    return isRep || isAssistant || isEnrolled;
  });

  if (myCourses.length === 0) {
    courseGrid.innerHTML = `<p style="color: var(--muted);">No courses joined yet. Create or join one above! 🚀</p>`;
    return;
  }

  myCourses.forEach((course) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.maxHeight = "none";
    card.style.position = "relative";
    
    const enrolledCount = course.enrolled ? course.enrolled.length : 1;
    const isThisUserRep = currentUser && (course.repUid === currentUser.uid || course.rep.toLowerCase() === currentUser.name.toLowerCase());

    const actionIcon = isThisUserRep 
      ? `<button onclick="deleteCourse('${course.id}')" style="position: absolute; top: 15px; right: 15px; background: transparent; border: none; cursor: pointer; font-size: 1.2rem;" title="Delete Course (Rep Only)">🗑️</button>`
      : `<button onclick="leaveCourse('${course.id}')" style="position: absolute; top: 15px; right: 15px; background: transparent; border: none; cursor: pointer; font-size: 1.2rem;" title="Leave Course">🚪</button>`;

    card.innerHTML = `
      ${actionIcon}
      <h3 style="color: var(--navy); margin-bottom: 5px;">${course.name}</h3>
      <p style="font-size: 0.85rem; margin-bottom: 5px;">Code: <strong>${course.code}</strong> | Rep: ${course.rep}</p>
      <p style="font-size: 0.75rem; color: var(--muted); margin-bottom: 15px;">🏛️ ${course.institution || 'GEN'} • 📚 ${course.department || 'GEN'}</p>
      
      <div style="background: var(--bg); padding: 10px; border-radius: 8px; margin-bottom: 15px; font-size: 0.85rem; display: flex; justify-content: space-between;">
        <span>👥 Enrolled Students:</span>
        <strong>${enrolledCount}</strong>
      </div>

      <button class="btn" style="padding: 10px; font-size: 0.9rem;" onclick="openPortal('${course.id}')">Open Portal 🚀</button>
    `;
    courseGrid.appendChild(card);
  });
}

window.deleteCourse = async function(courseId) {
  const course = courses.find(c => c.id === courseId);
  if (confirm(`⚠️ WARNING: As the Course Rep, deleting "${course ? course.name : 'this course'}" removes it entirely. Are you sure?`)) {
    await deleteDoc(doc(db, "courses", courseId));
    checkAuth();
  }
};

window.leaveCourse = async function(courseId) {
  const course = courses.find(c => c.id === courseId);
  if (!course) return;

  if (confirm(`⚠️ Do you want to leave "${course.name}"? You can rejoin anytime using code [${course.code}].`)) {
    let newEnrolled = course.enrolled ? course.enrolled.filter(m => m !== currentUser.matric) : [];
    let newAssistants = course.assistants ? course.assistants.filter(m => m !== currentUser.matric) : [];

    await updateDoc(doc(db, "courses", courseId), {
      enrolled: newEnrolled,
      assistants: newAssistants
    });

    checkAuth();
    alert(`You have left ${course.name}. 👋`);
  }
};

window.openPortal = function(courseId) {
  const selectedCourse = courses.find(c => c.id === courseId);
  if (!selectedCourse) return;
  
  const isRep = currentUser && (selectedCourse.repUid === currentUser.uid || selectedCourse.rep.toLowerCase() === currentUser.name.toLowerCase());
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
  createCourseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("courseTitle").value.trim();
    const code = document.getElementById("courseCodeInput").value.trim().toUpperCase();

    const repInstitution = currentUser ? (currentUser.institution || "GENERAL") : "GENERAL";
    const repDepartment = currentUser ? (currentUser.department || "GENERAL") : "GENERAL";
    const repLevel = currentUser ? (currentUser.level || "GENERAL") : "GENERAL";

    const duplicateExists = courses.some(c => 
      c.code === code && 
      c.institution === repInstitution && 
      c.department.toLowerCase() === repDepartment.toLowerCase() && 
      c.level === repLevel
    );

    if (duplicateExists) {
      alert(`⚠️ Course Creation Blocked: Course code "${code}" already exists in your department (${repDepartment} - ${repLevel}). Each course code must be unique per level!`);
      return;
    }

    const newCourse = { 
      name, 
      code, 
      rep: currentUser ? currentUser.name : "Unknown",
      repUid: currentUser ? currentUser.uid : "unknown-uid",
      institution: repInstitution,
      department: repDepartment,
      level: repLevel,
      enrolled: currentUser ? [currentUser.matric] : [],
      assistants: [],
      attendanceHistory: [],
      activeSession: null
    };

    const newDocRef = doc(collection(db, "courses"));
    await setDoc(newDocRef, newCourse);

    if (createModal) createModal.classList.remove("show");
    createCourseForm.reset();
    checkAuth();
    alert(`Course "${name}" created successfully! 🚀`);
  });
}

// Join Course Form
const joinCourseForm = document.getElementById("joinCourseForm");
if (joinCourseForm) {
  joinCourseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("joinCode").value.trim().toUpperCase();

    const found = courses.find(c => c.code === code);
    if (found) {
      let enrolled = found.enrolled || [];
      if (currentUser && !enrolled.includes(currentUser.matric)) {
        enrolled.push(currentUser.matric);
        await updateDoc(doc(db, "courses", found.id), { enrolled: enrolled });
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

// --- ASSISTANT REPS MANAGEMENT LOGIC ---
const appointAssistantBtn = document.getElementById("appointAssistantBtn");
if (appointAssistantBtn) {
  appointAssistantBtn.addEventListener("click", async () => {
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
    await updateCourseInFirestore();
    
    renderPortalState();
    renderAssistantDropdownAndList();
    
    alert("🎉 Assistant badge assigned successfully! 👑 ASST");
  });
}

window.revokeAssistant = async function(matric) {
  if (!activeCourse || !activeCourse.assistants) return;

  if (confirm("⚠️ Do you want to remove this assistant's badge?")) {
    activeCourse.assistants = activeCourse.assistants.filter(m => m !== matric);
    await updateCourseInFirestore();
    
    renderPortalState();
    renderAssistantDropdownAndList();
    
    alert("Assistant badge removed.");
  }
};

window.removeStudentFromCourse = async function(matric) {
  if (!activeCourse) return;

  if (confirm(`⚠️ Are you sure you want to remove student [${matric}] from ${activeCourse.name}?`)) {
    if (activeCourse.enrolled) {
      activeCourse.enrolled = activeCourse.enrolled.filter(m => m !== matric);
    }
    if (activeCourse.assistants) {
      activeCourse.assistants = activeCourse.assistants.filter(m => m !== matric);
    }

    await updateCourseInFirestore();
    renderPortalState();
    renderAssistantDropdownAndList();
    alert(`Student [${matric}] has been removed from the course.`);
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
    const isMainRep = currentUser && (activeCourse.repUid === currentUser.uid || activeCourse.rep.toLowerCase() === currentUser.name.toLowerCase());
    const isAlreadyAssistant = activeCourse.assistants && activeCourse.assistants.includes(matric);

    if (!isMainRep && !isAlreadyAssistant) {
      const opt = document.createElement("option");
      opt.value = matric;
      opt.textContent = `Student (${matric})`;
      selectEl.appendChild(opt);
    }
  });

  const assistants = activeCourse.assistants || [];
  if (assistants.length === 0) {
    listEl.innerHTML = `<li style="color: var(--muted); font-size: 0.85rem; padding: 5px;">No assistants appointed yet. ⏳</li>`;
  } else {
    listEl.innerHTML = "";
    assistants.forEach(matric => {
      const li = document.createElement("li");
      li.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--card-bg); border-radius: 6px; margin-bottom: 6px; font-size: 0.85rem;";
      li.innerHTML = `<span>👑 (${matric}) <span style="background: var(--teal); color: white; padding: 2px 4px; border-radius: 3px; font-size: 0.65rem;">ASST</span></span> <button onclick="revokeAssistant('${matric}')" style="background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 0.8rem;">Remove ❌</button>`;
      listEl.appendChild(li);
    });
  }
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

async function createSession(pin, managerMatric, lat, lon) {
  if (!activeCourse || !activeCourse.id) return;

  const expiresAt = Date.now() + 60000;

  await setDoc(doc(db, "courses", activeCourse.id, "session", "live"), {
    active: true,
    expiresAt: expiresAt
  });

  await setDoc(doc(db, "courses", activeCourse.id, "session", "secret"), {
    pin: pin,
    lat: lat,
    lon: lon,
    attendees: [managerMatric]
  });

  activeCourse.activeSession = {
    pin: pin,
    expiresAt: expiresAt,
    expired: false,
    attendees: [managerMatric],
    lat: lat,
    lon: lon
  };

  startSessionTimer();
  renderPortalState();
}

function startSessionTimer() {
  if (countdownInterval) clearInterval(countdownInterval);

  if (!activeCourse || !activeCourse.activeSession) return;

  countdownInterval = setInterval(async () => {
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
      await updateCourseInFirestore();
      renderPortalState();
    } else {
      if (liveTimerElement) {
        liveTimerElement.textContent = `${timeLeft}s`;
      }
    }
  }, 1000);
}

// 🛡️ UPDATED SECURE CHECK-IN FUNCTION
if (checkInForm) {
  checkInForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const enteredPin = document.getElementById("studentPinInput").value.trim();

    if (!navigator.geolocation) {
      alert("⚠️ Geolocation is not supported by your browser.");
      return;
    }

    alert("📍 Verifying secure location with server... Please allow GPS access.");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const studentLat = position.coords.latitude;
        const studentLon = position.coords.longitude;
        const accuracy = position.coords.accuracy || 999;

        if (accuracy > 50) {
          alert(`⚠️ GPS Accuracy Warning: Your location accuracy is ±${Math.round(accuracy)}m. Move closer to a window!`);
          return;
        }

        try {
          // 🔑 Get current user's encrypted Firebase Auth Token
          const idToken = await auth.currentUser.getIdToken();

          // Send data securely to the Vercel backend using the Bearer Token
          const response = await fetch("/api/submitAttendance", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({
              courseId: activeCourse.id,
              pin: enteredPin,
              lat: studentLat,
              lon: studentLon,
              accuracy: accuracy
            })
          });

          const result = await response.json();

          if (!response.ok) {
            throw new Error(result.error || "Check-in failed.");
          }

          alert("🎉 Attendance marked successfully via secure token & GPS verification! ✅📍");
          checkInForm.reset();
        } catch (error) {
          alert("❌ " + error.message);
          console.error(error);
        }
      },
      (error) => {
        alert("❌ GPS Error: Unable to retrieve your precise location.");
        console.error(error);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

const closeClassBtn = document.getElementById("closeClassBtn");

if (closeClassBtn) {
  closeClassBtn.addEventListener("click", async () => {
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

      await updateCourseInFirestore();
      renderPortalState();
      alert("📁 Class closed successfully! Attendance has been archived.");
    }
  });
}

const endSemesterBtn = document.getElementById("endSemesterBtn");

if (endSemesterBtn) {
  endSemesterBtn.addEventListener("click", async () => {
    if (!activeCourse) return;

    if (confirm(`⚠️ WARNING: Are you sure you want to END THE SEMESTER for "${activeCourse.name}"? This will clear all class history and reset the total class count to 0.`)) {
      activeCourse.attendanceHistory = [];
      activeCourse.activeSession = null;
      if (countdownInterval) clearInterval(countdownInterval);

      await updateCourseInFirestore();
      renderPortalState();
      alert("🎓 Semester ended successfully! All records have been reset.");
    }
  });
}

async function updateCourseInFirestore() {
  if (!activeCourse || !activeCourse.id) return;
  const courseRef = doc(db, "courses", activeCourse.id);
  await updateDoc(courseRef, {
    activeSession: activeCourse.activeSession || null,
    attendanceHistory: activeCourse.attendanceHistory || [],
    assistants: activeCourse.assistants || [],
    enrolled: activeCourse.enrolled || []
  });
}

window.downloadAttendance = function(index) {
  if (!activeCourse || !activeCourse.attendanceHistory || !activeCourse.attendanceHistory[index]) return;

  const sessionRecord = activeCourse.attendanceHistory[index];
  let csvContent = "data:text/csv;charset=utf-8,Matric Number,Status\n";
  
  sessionRecord.attendees.forEach(matric => {
    csvContent += `"${matric}","Present"\r\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `${activeCourse.code}_Attendance_${sessionRecord.date.replace(/[/:\s]/g, "_")}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

function renderPortalState() {
  if (!activeCourse) return;

  const isRep = currentUser && (activeCourse.repUid === currentUser.uid || activeCourse.rep.toLowerCase() === currentUser.name.toLowerCase());
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
      const isMainRepUser = activeCourse.rep.toLowerCase() === (currentUser && currentUser.matric === matric ? currentUser.name.toLowerCase() : "");
      const isAssistantUser = activeCourse.assistants && activeCourse.assistants.includes(matric);
      
      let badgeHTML = "";
      if (isMainRepUser) {
        badgeHTML = `<span style="background: var(--teal); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 6px;">👑 REP</span>`;
      } else if (isAssistantUser) {
        badgeHTML = `<span style="background: var(--teal); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 6px;">👑 ASST</span>`;
      }

      const li = document.createElement("li");
      li.style.cssText = "display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 0.9rem;";
      li.innerHTML = `<span>🎓 <strong>Student</strong> (${matric}) ${badgeHTML}</span> <span style="color: #28a745; font-weight: bold;">Present ✅</span>`;
      rosterList.appendChild(li);
    });
  }

  if (isRep) {
    let enrolledListDiv = document.getElementById("repEnrolledStudentsSection");
    
    if (!enrolledListDiv && portalSection) {
      enrolledListDiv = document.createElement("div");
      enrolledListDiv.id = "repEnrolledStudentsSection";
      enrolledListDiv.style.cssText = "background: var(--card-bg); padding: 15px; border-radius: 12px; margin-top: 20px; border: 1px solid var(--border);";
      
      const targetParent = document.getElementById("repControls") || portalSection;
      targetParent.appendChild(enrolledListDiv);
    }

    if (enrolledListDiv) {
      const enrolledMatrics = activeCourse.enrolled || [];
      let studentRowsHTML = "";

      if (enrolledMatrics.length === 0) {
        studentRowsHTML = `<p style="color: var(--muted); font-size: 0.85rem;">No students enrolled yet.</p>`;
      } else {
        enrolledMatrics.forEach(matric => {
          const isRepMatric = currentUser && currentUser.matric === matric;
          studentRowsHTML += `
            <li style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--bg); border-radius: 6px; margin-bottom: 6px; font-size: 0.85rem;">
              <span>🎓 <strong>${matric}</strong> ${isRepMatric ? '(You - Rep)' : ''}</span>
              ${!isRepMatric ? `<button onclick="removeStudentFromCourse('${matric}')" style="background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 0.8rem; font-weight: bold;">Remove 🚪❌</button>` : ''}
            </li>
          `;
        });
      }

      enrolledListDiv.innerHTML = `
        <h4 style="color: var(--navy); margin-bottom: 10px; font-size: 1rem;">👥 Manage Enrolled Students (${enrolledMatrics.length})</h4>
        <p style="font-size: 0.8rem; color: var(--muted); margin-bottom: 10px;">Remove any unauthorized student who joined your course code.</p>
        <ul style="list-style: none; padding: 0; max-height: 180px; overflow-y: auto;">
          ${studentRowsHTML}
        </ul>
      `;
    }
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
      history.forEach((sessionRecord, archiveIndex) => {
        const archiveCard = document.createElement("div");
        archiveCard.style.cssText = "background: var(--card-bg); padding: 12px; border-radius: 8px; margin-bottom: 10px; border: 1px solid var(--border);";
        
        const attendeesListHTML = sessionRecord.attendees.map(m => {
          return `<li style="font-size: 0.85rem; padding: 2px 0;">🎓 Student (${m})</li>`;
        }).join("");

        archiveCard.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
            <strong>📅 Session on ${sessionRecord.date}</strong>
            <div style="display: flex; gap: 8px; align-items: center;">
              <span style="font-size: 0.8rem; background: var(--teal); color: white; padding: 2px 6px; border-radius: 4px;">${sessionRecord.attendees.length} Present</span>
              <button onclick="downloadAttendance(${archiveIndex})" class="btn" style="padding: 4px 10px; font-size: 0.75rem; width: auto;" title="Download CSV">📥 CSV</button>
            </div>
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
    let historyListHTML = "";

    history.forEach(sessionRecord => {
      const wasPresent = sessionRecord.attendees && sessionRecord.attendees.includes(currentUser.matric);
      if (wasPresent) attendedCount++;

      historyListHTML += `
        <li style="display: flex; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 0.85rem;">
          <span>📅 ${sessionRecord.date}</span>
          <span style="font-weight: bold; color: ${wasPresent ? '#28a745' : '#dc3545'};">
            ${wasPresent ? 'Present ✅' : 'Absent ❌'}
          </span>
        </li>
      `;
    });

    const percentage = totalClasses > 0 ? Math.round((attendedCount / totalClasses) * 100) : 100;

    document.getElementById("statAttendedCount").textContent = attendedCount;
    document.getElementById("statTotalClasses").textContent = totalClasses;
    document.getElementById("statPercentage").textContent = `${percentage}%`;

    let personalLogContainer = document.getElementById("personalLogContainer");
    if (!personalLogContainer) {
      personalLogContainer = document.createElement("div");
      personalLogContainer.id = "personalLogContainer";
      personalLogContainer.style.cssText = "margin-top: 15px; background: var(--card-bg); padding: 10px; border-radius: 8px; border: 1px solid var(--border);";
      studentAnalyticsSection.appendChild(personalLogContainer);
    }

    personalLogContainer.innerHTML = `
      <p style="font-weight: bold; font-size: 0.9rem; margin-bottom: 8px;">📋 Your Class-by-Class Record:</p>
      <ul style="list-style: none; padding: 0; max-height: 150px; overflow-y: auto;">
        ${totalClasses === 0 ? '<li style="color: var(--muted); font-size: 0.85rem;">No classes held yet.</li>' : historyListHTML}
      </ul>
    `;

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