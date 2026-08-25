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

// Toggle between Sign Up and Log In forms
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

    const existingUser = users.find(u => u.email === email || u.matric === matric);
    if (existingUser) {
      alert("⚠️ An account with this email or Matric Number already exists!");
      return;
    }

    const newUser = { name, matric, email, password };
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
      checkAuth();
      alert("Account deleted.");
    }
  });
}

// --- MODALS ---
const createModal = document.getElementById("createModal");
const joinModal = document.getElementById("joinModal");

const openCreateModalBtn = document.getElementById("openCreateModal");
if (openCreateModalBtn) {
  openCreateModalBtn.addEventListener("click", () => {
    const confirmRep = confirm("👑 Are you registering as the Official Course Rep for this class?");
    if (confirmRep && createModal) {
      createModal.classList.add("show");
    }
  });
}

const openJoinModalBtn = document.getElementById("openJoinModal");
if (openJoinModalBtn) {
  openJoinModalBtn.addEventListener("click", () => {
    if (joinModal) joinModal.classList.add("show");
  });
}

document.querySelectorAll(".close-modal").forEach(btn => {
  btn.addEventListener("click", () => {
    if (createModal) createModal.classList.remove("show");
    if (joinModal) joinModal.classList.remove("show");
  });
});

// --- COURSES & PORTAL MANAGEMENT ---
let courses = JSON.parse(localStorage.getItem("attendify_courses")) || [];
const courseGrid = document.getElementById("courseGrid");
const portalSection = document.getElementById("portalSection");

let activeCourse = null; // Tracks which course portal we are currently viewing

function renderCourses() {
  if (!courseGrid) return;
  courseGrid.innerHTML = "";
  if (courses.length === 0) {
    courseGrid.innerHTML = `<p style="color: var(--muted);">No courses joined yet. Create or join one above! 🚀</p>`;
    return;
  }

  courses.forEach((course, index) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.maxHeight = "none";
    card.style.position = "relative";
    
    const enrolledCount = course.enrolled ? course.enrolled.length : 1;

    card.innerHTML = `
      <button onclick="deleteCourse(${index})" style="position: absolute; top: 15px; right: 15px; background: transparent; border: none; cursor: pointer; font-size: 1.2rem;" title="Leave Course">🗑️</button>
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
  if (confirm(`⚠️ Remove course "${courses[index].name}"?`)) {
    courses.splice(index, 1);
    localStorage.setItem("attendify_courses", JSON.stringify(courses));
    renderCourses();
  }
};

// Open Portal Function (Handles Security & Role Check)
window.openPortal = function(index) {
  const selectedCourse = courses[index];
  
  // 1. Check if current user is the Rep or is enrolled in the course
  const isRep = currentUser && selectedCourse.rep.toLowerCase() === currentUser.name.toLowerCase();
  const isEnrolled = currentUser && selectedCourse.enrolled && selectedCourse.enrolled.includes(currentUser.matric);

  // 2. If they are neither, block them!
  if (!isRep && !isEnrolled) {
    alert(`⚠️ Access Denied! You are not enrolled in "${selectedCourse.name}". Please join the course using code [${selectedCourse.code}] first.`);
    return; // Stop right here
  }

  // 3. If they passed the check, open the portal workspace
  activeCourse = selectedCourse;
  
  if (dashboardSection) dashboardSection.classList.add("hidden");
  if (portalSection) portalSection.classList.remove("hidden");

  // Populate portal header details
  document.getElementById("portalCourseTitle").textContent = activeCourse.name;
  document.getElementById("portalCourseCode").textContent = activeCourse.code;
  document.getElementById("portalCourseRep").textContent = activeCourse.rep;

  // Show/Hide controls based on whether they are the Rep or a Student
  const repControls = document.getElementById("repControls");
  const studentControls = document.getElementById("studentControls");

  if (isRep) {
    if (repControls) repControls.classList.remove("hidden");
    if (studentControls) studentControls.classList.add("hidden");
  } else {
    if (repControls) repControls.classList.add("hidden");
    if (studentControls) studentControls.classList.remove("hidden");
  }
};

// Back to Dashboard button logic
const backToDashboardBtn = document.getElementById("backToDashboard");
if (backToDashboardBtn) {
  backToDashboardBtn.addEventListener("click", () => {
    portalSection.classList.add("hidden");
    dashboardSection.classList.remove("hidden");
    activeCourse = null;
  });
}

// Create Course Form
const createCourseForm = document.getElementById("createCourseForm");
if (createCourseForm) {
  createCourseForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("courseName").value.trim();
    const randomCode = name.substring(0, 3).toUpperCase() + "-" + Math.floor(1000 + Math.random() * 9000);

    const newCourse = { 
      name, 
      code: randomCode, 
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

// Initial check on load
checkAuth();