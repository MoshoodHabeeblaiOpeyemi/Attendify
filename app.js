// --- FIREBASE IMPORTS & CONFIGURATION ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  updateDoc,
  deleteDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDUtViZ-mef1dSV-XpSos4-oh1HpQ7jpyw",
  authDomain: "attendify-4c93d.firebaseapp.com",
  projectId: "attendify-4c93d",
  storageBucket: "attendify-4c93d.firebasestorage.app",
  messagingSenderId: "912075322838",
  appId: "1:912075322838:web:c8e5a9a16b1acf7667e077",
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

let isCreatingAccount = false; // 🛡️ Prevents race condition during signup

// --- DATA NORMALIZERS (v0 Fixes) ---
function normalizeMatric(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeCourseCode(value) {
  const raw = String(value || "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, "");
  const match = raw.match(/^([A-Z]{2,5})(\d{3,4})$/);
  return match ? `${match[1]} ${match[2]}` : raw;
}

// --- DEFAULT THEME ICON SYNC ---
document.addEventListener("DOMContentLoaded", () => {
  const themeToggle = document.getElementById("themeToggle");
  const htmlElement = document.documentElement;
  if (themeToggle && htmlElement.getAttribute("data-theme") === "dark") {
    themeToggle.textContent = "☀️";
  }
});

// --- HAMBURGER MENU LOGIC ---
const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const navLinks = document.getElementById("navLinks");

if (mobileMenuBtn && navLinks) {
  mobileMenuBtn.addEventListener("click", () => {
    navLinks.classList.toggle("show-menu");
    mobileMenuBtn.textContent = navLinks.classList.contains("show-menu")
      ? "✖"
      : "☰";
  });

  navLinks.addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") {
      navLinks.classList.remove("show-menu");
      mobileMenuBtn.textContent = "☰";
    }
  });
}

// --- REAL-TIME FIRESTORE SYNC ---
let unsubscribeCourses = null;
// Map of courseId → unsubscribe function for per-course member listeners
const memberListeners = {};

function startMemberListener(courseId) {
  if (memberListeners[courseId]) return; // already listening
  memberListeners[courseId] = onSnapshot(
    collection(db, "courses", courseId, "members"),
    (snap) => {
      const members = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      const idx = courses.findIndex((c) => c.id === courseId);
      if (idx < 0) return;
      courses[idx] = {
        ...courses[idx],
        members,
        enrolled: members
          .filter((m) => m.role === "student")
          .map((m) => normalizeMatric(m.matric)),
        assistants: members
          .filter((m) => m.role === "assistant")
          .map((m) => normalizeMatric(m.matric)),
      };
      if (currentUser) {
        renderCourses();
        if (activeCourse && activeCourse.id === courseId) {
          activeCourse = courses[idx];
          renderPortalState();
        }
      }
    },
    (error) => console.error(`Member listener error (${courseId}):`, error),
  );
}

function stopAllMemberListeners() {
  Object.values(memberListeners).forEach((unsub) => unsub());
  Object.keys(memberListeners).forEach((k) => delete memberListeners[k]);
}

function startCourseListener() {
  if (unsubscribeCourses) return;
  unsubscribeCourses = onSnapshot(
    collection(db, "courses"),
    async (snapshot) => {
      const loadedCourses = await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          const course = { id: docSnap.id, ...docSnap.data() };
          const membersSnap = await getDocs(
            collection(db, "courses", docSnap.id, "members"),
          );
          const members = membersSnap.docs.map((memberSnap) => ({
            uid: memberSnap.id,
            ...memberSnap.data(),
          }));
          // Start a live listener for this course's members subcollection
          startMemberListener(docSnap.id);
          return {
            ...course,
            members,
            enrolled: members
              .filter((member) => member.role === "student")
              .map((member) => normalizeMatric(member.matric)),
            assistants: members
              .filter((member) => member.role === "assistant")
              .map((member) => normalizeMatric(member.matric)),
          };
        }),
      );
      courses = loadedCourses;
      if (currentUser) {
        renderCourses();
        if (activeCourse) {
          const updated = courses.find((c) => c.id === activeCourse.id);
          if (updated) {
            activeCourse = updated;
            renderPortalState();
          }
        }
      }
    },
    (error) => {
      console.error("Course listener error:", error);
      if (courseGrid) {
        courseGrid.innerHTML = `<p style="color: var(--danger);">⚠️ Couldn't load your courses. Check your connection and try refreshing.</p>`;
      }
    },
  );
}

function stopCourseListener() {
  if (unsubscribeCourses) {
    unsubscribeCourses();
    unsubscribeCourses = null;
  }
  stopAllMemberListeners();
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

// --- AUTOCOMPLETE DATA & LOGIC ---
const NIGERIAN_INSTITUTIONS = [
  "University of Ilorin (UNILORIN)",
  "University of Ibadan (UI)",
  "University of Lagos (UNILAG)",
  "Obafemi Awolowo University (OAU)",
  "Ahmadu Bello University (ABU)",
  "University of Nigeria, Nsukka (UNN)",
  "University of Benin (UNIBEN)",
  "University of Port Harcourt (UNIPORT)",
  "Bayero University Kano (BUK)",
  "University of Calabar (UNICAL)",
  "Federal University of Technology, Akure (FUTA)",
  "Federal University of Technology, Minna (FUTMINNA)",
  "Federal University of Technology, Owerri (FUTO)",
  "University of Jos (UNIJOS)",
  "University of Maiduguri (UNIMAID)",
  "Usmanu Danfodiyo University Sokoto (UDUS)",
  "Nnamdi Azikiwe University (UNIZIK)",
  "Ladoke Akintola University of Technology (LAUTECH)",
  "Federal University of Agriculture, Abeokuta (FUNAAB)",
  "University of Uyo (UNIUYO)",
  "Ekiti State University (EKSU)",
  "Lagos State University (LASU)",
  "Rivers State University (RSU)",
  "Delta State University (DELSU)",
  "Ambrose Alli University (AAU)",
  "Enugu State University of Science and Technology (ESUT)",
  "Kaduna State University (KASU)",
  "Kano University of Science and Technology (KUST)",
  "Imo State University (IMSU)",
  "Abia State University (ABSU)",
  "Benue State University (BSU)",
  "Kogi State University (KSU)",
  "Niger State Polytechnic",
  "Ondo State University of Science and Technology (OSUSTECH)",
  "Osun State University (UNIOSUN)",
  "Plateau State University",
  "Taraba State University",
  "Covenant University",
  "Babcock University",
  "Bowen University",
  "Afe Babalola University (ABUAD)",
  "Bells University of Technology",
  "Pan-Atlantic University",
  "Landmark University",
  "Redeemer's University",
  "American University of Nigeria (AUN)",
  "Igbinedion University",
  "Elizade University",
  "Crawford University",
  "Caleb University",
  "Lead City University",
  "Al-Hikmah University",
  "Adeleke University",
  "Chrisland University",
  "Veritas University",
  "Yaba College of Technology (YABATECH)",
  "The Polytechnic, Ibadan",
  "Federal Polytechnic, Nekede",
  "Federal Polytechnic, Ilaro",
  "Kaduna Polytechnic (KADPOLY)",
  "Auchi Polytechnic",
  "Federal Polytechnic, Offa",
  "Rufus Giwa Polytechnic",
  "Moshood Abiola Polytechnic (MAPOLY)",
  "Lagos State Polytechnic (LASPOTECH)",
  "Federal College of Education (Technical)",
  "Federal University Oye-Ekiti (FUOYE)",
  "Federal University Dutse (FUD)",
  "Federal University Lokoja (FULOKOJA)",
  "Federal University Dutsin-Ma (FUDMA)",
  "Michael Okpara University of Agriculture (MOUAU)",
  "University of Agriculture, Makurdi",
  "Modibbo Adama University (MAU)",
  "Abubakar Tafawa Balewa University (ATBU)",
];

const NIGERIAN_DEPARTMENTS = [
  "Computer Science",
  "Geology",
  "Geophysics",
  "Civil Engineering",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Chemical Engineering",
  "Petroleum Engineering",
  "Mining Engineering",
  "Agricultural Engineering",
  "Biomedical Engineering",
  "Architecture",
  "Estate Management",
  "Quantity Surveying",
  "Urban and Regional Planning",
  "Building Technology",
  "Surveying and Geoinformatics",
  "Physics",
  "Chemistry",
  "Biochemistry",
  "Microbiology",
  "Botany",
  "Zoology",
  "Mathematics",
  "Statistics",
  "Industrial Chemistry",
  "Biology",
  "Environmental Science",
  "Accounting",
  "Banking and Finance",
  "Business Administration",
  "Economics",
  "Marketing",
  "Insurance",
  "Actuarial Science",
  "Public Administration",
  "Political Science",
  "Mass Communication",
  "Sociology",
  "Psychology",
  "Criminology",
  "International Relations",
  "Medicine and Surgery",
  "Nursing Science",
  "Pharmacy",
  "Physiology",
  "Anatomy",
  "Medical Laboratory Science",
  "Physiotherapy",
  "Public Health",
  "Dentistry",
  "Radiography",
  "Law",
  "English Language",
  "History and International Studies",
  "Theatre Arts",
  "Linguistics",
  "Philosophy",
  "Religious Studies",
  "French",
  "Library and Information Science",
  "Education",
  "Guidance and Counselling",
  "Human Kinetics and Health Education",
  "Agricultural Economics",
  "Animal Science",
  "Crop Science",
  "Soil Science",
  "Forestry and Wildlife",
  "Fisheries and Aquaculture",
  "Food Science and Technology",
  "Home Science and Management",
];

const ACADEMIC_LEVELS = [
  "ND 1",
  "ND 2",
  "HND 1",
  "HND 2",
  "100 Level",
  "200 Level",
  "300 Level",
  "400 Level",
  "500 Level",
  "600 Level",
];

function setupAutocomplete(inputId, suggestionsId, dataList) {
  const input = document.getElementById(inputId);
  const box = document.getElementById(suggestionsId);
  if (!input || !box) return;

  function renderMatches() {
    const query = input.value.trim().toLowerCase();
    box.innerHTML = "";

    if (!query) {
      box.classList.add("hidden");
      return;
    }

    const matches = dataList
      .filter((item) => item.toLowerCase().includes(query))
      .slice(0, 8);
    if (matches.length === 0) {
      box.classList.add("hidden");
      return;
    }

    matches.forEach((match) => {
      const item = document.createElement("div");
      item.className = "suggestion-item";
      item.textContent = match;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = match;
        box.classList.add("hidden");
        box.innerHTML = "";
      });
      box.appendChild(item);
    });

    box.classList.remove("hidden");
  }

  input.addEventListener("input", renderMatches);
  input.addEventListener("focus", () => {
    if (input.value.trim()) renderMatches();
  });
  input.addEventListener("blur", () => {
    setTimeout(() => box.classList.add("hidden"), 100);
  });
}

setupAutocomplete(
  "signupInstitution",
  "institutionSuggestions",
  NIGERIAN_INSTITUTIONS,
);
setupAutocomplete(
  "signupDepartment",
  "departmentSuggestions",
  NIGERIAN_DEPARTMENTS,
);
setupAutocomplete("signupLevel", "levelSuggestions", ACADEMIC_LEVELS);

// --- INPUT MASKS ---
function maskCourseCodeInput(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", () => {
    const raw = el.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const letters = raw.slice(0, 3).replace(/[0-9]/g, "");
    const numbers = raw
      .slice(letters.length)
      .replace(/[^0-9]/g, "")
      .slice(0, 3);
    el.value = numbers ? `${letters} ${numbers}` : letters;
  });
}

function maskMatricInput(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", () => {
    const cursor = el.selectionStart;
    el.value = el.value.toUpperCase();
    el.setSelectionRange(cursor, cursor);
  });
}

maskCourseCodeInput("courseCodeInput");
maskCourseCodeInput("joinCode");
maskMatricInput("signupMatric");
maskMatricInput("settingsMatric");

const authContainer = document.getElementById("authContainer");
const signupCard = document.getElementById("signupCard");
const loginCard = document.getElementById("loginCard");
const dashboardSection = document.getElementById("dashboardSection");
const displayName = document.getElementById("displayName");
const displayMatric = document.getElementById("displayMatric");
const logoutBtn = document.getElementById("logoutBtn");
const openSettingsBtn = document.getElementById("openSettingsBtn");
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
    if (openSettingsBtn) openSettingsBtn.classList.remove("hidden");

    displayName.textContent = currentUser.name;
    displayMatric.textContent = currentUser.matric;

    const displaySchoolInfo = document.getElementById("displaySchoolInfo");
    if (displaySchoolInfo) {
      displaySchoolInfo.textContent = `${currentUser.institution || "GEN"} • ${currentUser.department || "GEN"} • ${currentUser.level || "GEN"}`;
    }

    const openCreateModalBtn = document.getElementById("openCreateModal");
    if (openCreateModalBtn) {
      const userMatric = normalizeMatric(currentUser.matric);
      const isAnywhereAssistant = courses.some((c) =>
        (c.assistants || []).map(normalizeMatric).includes(userMatric),
      );

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
    if (openSettingsBtn) openSettingsBtn.classList.add("hidden");
    signupCard.classList.add("hidden");
    loginCard.classList.remove("hidden"); // Sets login as default!
  }
}

// --- FIREBASE AUTHENTICATION LOGIC ---
const signupForm = document.getElementById("signupForm");
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = signupForm.querySelector("button[type='submit']");
    const name = document.getElementById("signupName").value.trim();
    const matric = normalizeMatric(
      document.getElementById("signupMatric").value,
    );
    const email = document
      .getElementById("signupEmail")
      .value.trim()
      .toLowerCase();
    const password = document.getElementById("signupPassword").value;
    const isRep = document.getElementById("isRepCheckbox").checked;

    const institutionInput = document.getElementById("signupInstitution");
    const departmentInput = document.getElementById("signupDepartment");
    const levelInput = document.getElementById("signupLevel");

    const institution = institutionInput
      ? institutionInput.value.trim().toUpperCase()
      : "GENERAL";
    const department = departmentInput
      ? departmentInput.value.trim()
      : "GENERAL";
    const level = levelInput
      ? levelInput.value.trim().toUpperCase()
      : "GENERAL";

    isCreatingAccount = true; // 🔒 LOCK THE BLOCKER

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Creating Account... ⏳";
      }

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      const uid = userCredential.user.uid;

      if (isRep) {
        const cleanInst = institution.replace(/[^a-zA-Z0-9]/g, "_");
        const cleanDept = department
          .replace(/[^a-zA-Z0-9]/g, "_")
          .toLowerCase();
        const cleanLevel = level.replace(/[^a-zA-Z0-9]/g, "_");
        const repSlotId = `rep_${cleanInst}_${cleanDept}_${cleanLevel}`;
        const repSlotRef = doc(db, "departmentReps", repSlotId);
        const repSlotSnap = await getDoc(repSlotRef);

        if (repSlotSnap.exists()) {
          await userCredential.user.delete();
          throw new Error(
            `A department representative already exists for ${institution} - ${department} (${level}).`,
          );
        }

        await setDoc(repSlotRef, { repUid: uid, registeredAt: Date.now() });
      }

      await setDoc(doc(db, "users", uid), {
        uid,
        name,
        matric,
        email,
        isRep,
        institution,
        department,
        level,
      });

      signupForm.reset();
      alert("Account created successfully in the cloud! 🎉✨");
    } catch (error) {
      console.error("Signup error:", error);
      alert("⚠️ Error: " + error.message);
    } finally {
      isCreatingAccount = false; // 🔓 UNLOCK THE BLOCKER NO MATTER WHAT
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign Up 📝";
      }
    }
  });
}

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = loginForm.querySelector("button[type='submit']");
    const email = document
      .getElementById("loginEmail")
      .value.trim()
      .toLowerCase();
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

// 🛡️ v0 Logout Fix: Let onAuthStateChanged handle UI updates cleanly
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
      alert("Unable to log out. Please try again.");
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (isCreatingAccount) return; // 🛑 Ignore during active registration sequence!

  if (user) {
    const userDoc = await getDoc(doc(db, "users", user.uid));

    if (userDoc.exists()) {
      currentUser = userDoc.data();
      startCourseListener();
      checkAuth();
    } else {
      console.warn("Ghost user blocked: No Firestore profile found.");
      alert(
        "⚠️ Access Denied: Your account data could not be found. It may have been deleted.",
      );
      await signOut(auth);
      currentUser = null;
      checkAuth();
    }
  } else {
    currentUser = null;
    if (portalSection) portalSection.classList.add("hidden");
    const repArchiveSection = document.getElementById("repArchiveSection");
    if (repArchiveSection) repArchiveSection.classList.add("hidden");
    const assistantManagementSection = document.getElementById(
      "assistantManagementSection",
    );
    if (assistantManagementSection)
      assistantManagementSection.classList.add("hidden");

    activeCourse = null;
    if (countdownInterval) clearInterval(countdownInterval);

    stopCourseListener();
    checkAuth();
  }
});

if (deleteAccountBtn) {
  deleteAccountBtn.addEventListener("click", async () => {
    if (
      confirm(
        "⚠️ Are you sure you want to completely delete your account? This cannot be undone.",
      )
    ) {
      try {
        const uid = auth.currentUser.uid;
        const idToken = await auth.currentUser.getIdToken();

        // Clean up membership + enrolled[]/assistants[] via the same
        // trusted backend endpoint leaveCourse uses — one course at a
        // time, each cleaned atomically instead of leaving stale matric
        // entries behind.
        for (const course of courses) {
          try {
            const response = await fetch("/api/leaveCourse", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({ courseId: course.id }),
            });
            if (!response.ok) {
              const result = await response.json().catch(() => ({}));
              console.warn(
                `Could not leave course ${course.id}:`,
                result.error,
              );
            }
          } catch (courseError) {
            console.warn(`Could not leave course ${course.id}:`, courseError);
          }
        }

        // Delete the actual database document
        await deleteDoc(doc(db, "users", uid));

        // Attempt to delete the Firebase Auth user (if recent login), otherwise force sign out
        try {
          await auth.currentUser.delete();
        } catch (error) {
          console.warn(
            "Requires recent login to delete auth object. Signing out instead.",
          );
          await signOut(auth);
        }

        alert("Account successfully deleted and data cleared. 👋");
      } catch (error) {
        console.error("Delete account error:", error);
        alert(
          "⚠️ Something went wrong while deleting your account. Please check your connection and try again.",
        );
      }
    }
  });
}

// --- MODALS & CLOSE HANDLERS ---
const createModal = document.getElementById("createModal");
const joinModal = document.getElementById("joinModal");
const forgotModal = document.getElementById("forgotModal");
const guideModal = document.getElementById("guideModal");
const settingsModal = document.getElementById("settingsModal");
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

document.querySelectorAll(".close-modal").forEach((btn) => {
  btn.addEventListener("click", () => {
    const parentModal = btn.closest(".modal");
    if (parentModal) parentModal.classList.remove("show");
  });
});

document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("show");
  });
});

if (openGuideBtn && guideModal) {
  openGuideBtn.addEventListener("click", () => {
    guideModal.classList.add("show");
  });
}

// --- ACCOUNT SETTINGS MODAL ---
const settingsForm = document.getElementById("settingsForm");

if (openSettingsBtn && settingsModal) {
  openSettingsBtn.addEventListener("click", () => {
    if (!currentUser) return;
    const settingsNameInput = document.getElementById("settingsName");
    const settingsMatricInput = document.getElementById("settingsMatric");
    const settingsLevelInput = document.getElementById("settingsLevel"); // NEW

    if (settingsNameInput) settingsNameInput.value = currentUser.name || "";
    if (settingsMatricInput)
      settingsMatricInput.value = currentUser.matric || "";
    if (settingsLevelInput) settingsLevelInput.value = currentUser.level || ""; // NEW

    settingsModal.classList.add("show");
  });
}

if (settingsForm) {
  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = settingsForm.querySelector("button[type='submit']");
    const newName = document.getElementById("settingsName").value.trim();
    const newMatric = normalizeMatric(
      document.getElementById("settingsMatric").value,
    );
    const newLevel = document.getElementById("settingsLevel")
      ? document.getElementById("settingsLevel").value
      : currentUser.level || "GENERAL"; // NEW

    if (!newName || !newMatric || !currentUser || !auth.currentUser) return;

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Saving... ⏳";
      }

      const oldMatric = normalizeMatric(currentUser.matric);
      const uid = auth.currentUser.uid;

      // Update name, matric, and level in database
      await updateDoc(doc(db, "users", uid), {
        name: newName,
        matric: newMatric,
        level: newLevel,
      });

      // Note: matric changes no longer propagate into courses' enrolled[]/
      // assistants[] arrays here. Tonight's rules rewrite restricts course
      // document writes to course staff only, so a plain student can't
      // legally make this write anymore — attempting it threw a permission
      // error right after the profile itself had already saved, which was
      // more confusing than useful. If matric-change propagation matters
      // (e.g. attendance history keyed by old matric), that needs a small
      // backend endpoint using Admin credentials — worth doing later, not
      // tonight.

      // Update local UI state
      currentUser.name = newName;
      currentUser.matric = newMatric;
      currentUser.level = newLevel; // NEW

      if (displayName) displayName.textContent = newName;
      if (displayMatric) displayMatric.textContent = newMatric;

      const displaySchoolInfo = document.getElementById("displaySchoolInfo");
      if (displaySchoolInfo) {
        displaySchoolInfo.textContent = `${currentUser.institution || "GEN"} • ${currentUser.department || "GEN"} • ${currentUser.level || "GEN"}`;
      }

      settingsModal.classList.remove("show");
      alert("Profile updated successfully! ✅");
    } catch (error) {
      console.error("Settings update error:", error);
      alert("⚠️ Error: " + error.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Save Changes 💾";
      }
    }
  });
}

const forgotPasswordForm = document.getElementById("forgotPasswordForm");
if (forgotPasswordForm) {
  forgotPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = forgotPasswordForm.querySelector("button[type='submit']");
    const email = document
      .getElementById("forgotEmail")
      .value.trim()
      .toLowerCase();

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

  const userMatric = normalizeMatric(currentUser ? currentUser.matric : "");

  const myCourses = courses.filter((course) => {
    if (!currentUser) return false;
    const isRep = course.repUid === currentUser.uid; // Strict UID check
    const isAssistant = (course.assistants || [])
      .map(normalizeMatric)
      .includes(userMatric);
    const isEnrolled = (course.enrolled || [])
      .map(normalizeMatric)
      .includes(userMatric);
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

    const enrolledCount = Array.isArray(course.enrolled) ? course.enrolled.length : 0;
    const isThisUserRep = currentUser && course.repUid === currentUser.uid;

    const actionIcon = isThisUserRep
      ? `<button onclick="deleteCourse('${course.id}')" style="position: absolute; top: 15px; right: 15px; background: transparent; border: none; cursor: pointer; font-size: 1.2rem;" title="Delete Course (Rep Only)">🗑️</button>`
      : `<button onclick="leaveCourse('${course.id}')" style="position: absolute; top: 15px; right: 15px; background: transparent; border: none; cursor: pointer; font-size: 1.2rem;" title="Leave Course">🚪</button>`;

    card.innerHTML = `
      ${actionIcon}
      <h3 style="color: var(--navy); margin-bottom: 5px;">${course.name}</h3>
      <p style="font-size: 0.85rem; margin-bottom: 5px;">Code: <strong>${course.code}</strong> | Rep: ${course.rep}</p>
      <p style="font-size: 0.75rem; color: var(--muted); margin-bottom: 15px;">🏛️ ${course.institution || "GEN"} • 📚 ${course.department || "GEN"}</p>
      
      <div style="background: var(--bg); padding: 10px; border-radius: 8px; margin-bottom: 15px; font-size: 0.85rem; display: flex; justify-content: space-between;">
        <span>👥 Enrolled Students:</span>
        <strong>${enrolledCount}</strong>
      </div>

      <button class="btn" style="padding: 10px; font-size: 0.9rem;" onclick="openPortal('${course.id}')">Open Portal 🚀</button>
    `;
    courseGrid.appendChild(card);
  });
}

window.deleteCourse = async function (courseId) {
  const course = courses.find((c) => c.id === courseId);
  if (
    confirm(
      `⚠️ WARNING: As the Course Rep, deleting "${course ? course.name : "this course"}" removes it entirely including all records. Are you sure?`,
    )
  ) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/deleteCourse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ courseId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to delete course.");
      // Remove from local state immediately
      courses = courses.filter((c) => c.id !== courseId);
      renderCourses();
    } catch (error) {
      console.error("Delete course error:", error);
      alert("⚠️ Error: Unable to delete course. Please try again.");
    }
  }
};

window.leaveCourse = async function (courseId) {
  const course = courses.find((c) => c.id === courseId);
  if (!course || !auth.currentUser) return;

  if (
    confirm(
      `⚠️ Do you want to leave "${course.name}"? You can rejoin anytime using code [${course.code}].`,
    )
  ) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/leaveCourse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ courseId }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to leave course.");

      alert(`You have left ${course.name}. 👋`);
    } catch (error) {
      console.error("Leave course error:", error);
      alert(
        "⚠️ Error: Unable to leave course. Please check your connection and try again.",
      );
    }
  }
};

window.openPortal = function (courseId) {
  const selectedCourse = courses.find((c) => c.id === courseId);
  if (!selectedCourse) return;

  const userMatric = normalizeMatric(currentUser ? currentUser.matric : "");
  const isRep = currentUser && selectedCourse.repUid === currentUser.uid;
  const isAssistant =
    currentUser &&
    (selectedCourse.assistants || []).map(normalizeMatric).includes(userMatric);
  const isEnrolled =
    currentUser &&
    (selectedCourse.enrolled || []).map(normalizeMatric).includes(userMatric);

  if (!isRep && !isAssistant && !isEnrolled) {
    alert(
      `⚠️ Access Denied! You are not enrolled in "${selectedCourse.name}". Please join using code [${selectedCourse.code}] first.`,
    );
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
  const assistantManagementSection = document.getElementById(
    "assistantManagementSection",
  );

  if (isRep || isAssistant) {
    if (repControls) repControls.classList.remove("hidden");
    if (studentControls) studentControls.classList.add("hidden");

    if (isRep) {
      if (repArchiveSection) repArchiveSection.classList.remove("hidden");
      if (assistantManagementSection)
        assistantManagementSection.classList.remove("hidden");
      renderAssistantDropdownAndList();
    } else {
      if (repArchiveSection) repArchiveSection.classList.add("hidden");
      if (assistantManagementSection)
        assistantManagementSection.classList.add("hidden");
    }
  } else {
    if (repControls) repControls.classList.add("hidden");
    if (studentControls) studentControls.classList.remove("hidden");
    if (repArchiveSection) repArchiveSection.classList.add("hidden");
    if (assistantManagementSection)
      assistantManagementSection.classList.add("hidden");
  }

  renderPortalState();
  // Load attendance history from the subcollection now that we know the courseId
  loadAttendanceHistory().then(() => renderPortalState());
};

const backToDashboardBtn = document.getElementById("backToDashboard");
if (backToDashboardBtn) {
  backToDashboardBtn.addEventListener("click", () => {
    if (portalSection) portalSection.classList.add("hidden");
    if (dashboardSection) dashboardSection.classList.remove("hidden");

    const repArchiveSection = document.getElementById("repArchiveSection");
    if (repArchiveSection) repArchiveSection.classList.add("hidden");
    const assistantManagementSection = document.getElementById(
      "assistantManagementSection",
    );
    if (assistantManagementSection)
      assistantManagementSection.classList.add("hidden");

    activeCourse = null;
    if (countdownInterval) clearInterval(countdownInterval);
  });
}

// --- CREATE COURSE FORM ---
const createCourseForm = document.getElementById("createCourseForm");
if (createCourseForm) {
  createCourseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = createCourseForm.querySelector("button[type='submit']");
    const originalBtnText = submitBtn ? submitBtn.textContent : "";

    const name = document.getElementById("courseTitle").value.trim();
    const code = normalizeCourseCode(
      document.getElementById("courseCodeInput").value,
    );

    const repInstitution = currentUser
      ? currentUser.institution || "GENERAL"
      : "GENERAL";
    const repDepartment = currentUser
      ? currentUser.department || "GENERAL"
      : "GENERAL";
    const repLevel = currentUser ? currentUser.level || "GENERAL" : "GENERAL";
    const studentMatric = normalizeMatric(
      currentUser ? currentUser.matric : "",
    );

    if (!studentMatric) {
      alert(
        "⚠️ Your profile isn't fully loaded yet. Please wait a moment and try again.",
      );
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Creating... ⏳";
      }

      // Query Firestore directly for the duplicate check instead of the
      // in-memory `courses` array — that array may not have finished
      // loading yet on a fresh page, the exact same race that used to make
      // "Join Course" say a real code wasn't found.
      const dupSnap = await getDocs(
        query(
          collection(db, "courses"),
          where("code", "==", code),
          where("institution", "==", repInstitution),
          where("level", "==", repLevel),
        ),
      );
      const duplicateExists = dupSnap.docs.some(
        (d) =>
          (d.data().department || "").toLowerCase() ===
          repDepartment.toLowerCase(),
      );

      if (duplicateExists) {
        alert(
          `⚠️ Course Creation Blocked: Course code "${code}" already exists in your department (${repDepartment} - ${repLevel}). Each course code must be unique per level!`,
        );
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
        enrolled: [studentMatric],
        assistants: [],
        attendanceHistory: [],
        activeSession: null,
      };

      const newDocRef = doc(collection(db, "courses"));
      await setDoc(newDocRef, newCourse);

      // Add the Rep to the secure members subcollection instantly
      await setDoc(
        doc(db, "courses", newDocRef.id, "members", currentUser.uid),
        {
          uid: currentUser.uid,
          matric: studentMatric,
          name: currentUser.name,
          role: "rep",
          joinedAt: Date.now(),
        },
      );

      // Update local state immediately rather than waiting on the
      // background listener's next snapshot round-trip.
      courses.push({ id: newDocRef.id, ...newCourse });

      if (createModal) createModal.classList.remove("show");
      createCourseForm.reset();
      checkAuth();
      alert(`Course "${name}" created successfully! 🚀`);
    } catch (error) {
      console.error("Create course error:", error);
      alert(
        "⚠️ Something went wrong while creating the course. Please check your connection and try again.",
      );
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
    }
  });
}

// --- JOIN COURSE FORM ---
const joinCourseForm = document.getElementById("joinCourseForm");
if (joinCourseForm) {
  joinCourseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = joinCourseForm.querySelector("button[type='submit']");
    const code = normalizeCourseCode(document.getElementById("joinCode").value);
    const studentMatric = normalizeMatric(
      currentUser ? currentUser.matric : "",
    );

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Checking... ⏳";
      }

      const codeQuery = query(
        collection(db, "courses"),
        where("code", "==", code),
      );
      const querySnap = await getDocs(codeQuery);

      if (querySnap.empty) {
        alert(`⚠️ Course code "${code}" not found.`);
        return;
      }

      const foundDoc = querySnap.docs[0];
      const found = { id: foundDoc.id, ...foundDoc.data() };

      if (!auth.currentUser || !studentMatric) {
        throw new Error("Your account is missing a valid matric number.");
      }

      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/enrollCourse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ courseCode: code }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to join course.");

      // The onSnapshot listener watches the courses collection, NOT subcollections.
      // It won't fire when members/ changes. Manually refresh this course's member
      // list so the card appears immediately without waiting for a page reload.
      const membersSnap = await getDocs(
        collection(db, "courses", result.courseId, "members"),
      );
      const freshMembers = membersSnap.docs.map((m) => ({
        uid: m.id,
        ...m.data(),
      }));
      const freshEnrolled = freshMembers
        .filter((m) => m.role === "student")
        .map((m) => normalizeMatric(m.matric));
      const freshAssistants = freshMembers
        .filter((m) => m.role === "assistant")
        .map((m) => normalizeMatric(m.matric));

      // Update or insert the course in local state
      const existingIdx = courses.findIndex((c) => c.id === result.courseId);
      if (existingIdx >= 0) {
        courses[existingIdx] = {
          ...courses[existingIdx],
          members: freshMembers,
          enrolled: freshEnrolled,
          assistants: freshAssistants,
        };
      } else {
        // Course wasn't in local array yet — fetch the full doc and add it
        const courseDocSnap = await getDoc(doc(db, "courses", result.courseId));
        if (courseDocSnap.exists()) {
          courses.push({
            id: courseDocSnap.id,
            ...courseDocSnap.data(),
            members: freshMembers,
            enrolled: freshEnrolled,
            assistants: freshAssistants,
          });
        }
      }

      renderCourses();
      alert(`Successfully joined ${found.name}! 🎉`);
    } catch (error) {
      console.error("Join course error:", error);
      alert(
        "⚠️ Something went wrong while joining. Please check your connection and try again.",
      );
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Join Class 🏃‍♂️";
      }
      if (joinModal) joinModal.classList.remove("show");
      joinCourseForm.reset();
    }
  });
}

// --- ASSISTANT REPS MANAGEMENT LOGIC ---
const appointAssistantBtn = document.getElementById("appointAssistantBtn");
if (appointAssistantBtn) {
  appointAssistantBtn.addEventListener("click", async () => {
    if (!activeCourse) return;

    const selectEl = document.getElementById("courseStudentSelect");
    const selectedMatric = normalizeMatric(selectEl ? selectEl.value : "");

    if (!selectedMatric) {
      alert("⚠️ Please select an enrolled student to appoint.");
      return;
    }

    if (!activeCourse.assistants) {
      activeCourse.assistants = [];
    }

    const currentAssistants = activeCourse.assistants.map(normalizeMatric);
    if (currentAssistants.includes(selectedMatric)) {
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

window.revokeAssistant = async function (matric) {
  if (!activeCourse || !activeCourse.assistants) return;

  if (confirm("⚠️ Do you want to remove this assistant's badge?")) {
    const targetMatric = normalizeMatric(matric);
    activeCourse.assistants = (activeCourse.assistants || [])
      .map(normalizeMatric)
      .filter((m) => m !== targetMatric);
    await updateCourseInFirestore();

    renderPortalState();
    renderAssistantDropdownAndList();

    alert("Assistant badge removed.");
  }
};

window.removeStudentFromCourse = async function (matric) {
  if (!activeCourse) return;

  if (
    confirm(
      `⚠️ Are you sure you want to remove student [${matric}] from ${activeCourse.name}?`,
    )
  ) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/removeStudent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ courseId: activeCourse.id, targetMatric: matric }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to remove student.");

      // Update local state to reflect the removal immediately
      const targetMatric = normalizeMatric(matric);
      if (activeCourse.enrolled) {
        activeCourse.enrolled = activeCourse.enrolled
          .map(normalizeMatric)
          .filter((m) => m !== targetMatric);
      }
      if (activeCourse.assistants) {
        activeCourse.assistants = activeCourse.assistants
          .map(normalizeMatric)
          .filter((m) => m !== targetMatric);
      }

      renderPortalState();
      renderAssistantDropdownAndList();
      alert(`Student [${targetMatric}] has been removed from the course.`);
    } catch (error) {
      console.error("Remove student error:", error);
      alert("⚠️ Error: Unable to remove student. Please try again.");
    }
  }
};

function renderAssistantDropdownAndList() {
  if (!activeCourse) return;

  const selectEl = document.getElementById("courseStudentSelect");
  const listEl = document.getElementById("assistantsList");
  if (!selectEl || !listEl) return;

  selectEl.innerHTML = `<option value="">-- Choose student to appoint --</option>`;
  const enrolled = (activeCourse.enrolled || []).map(normalizeMatric);
  const assistants = (activeCourse.assistants || []).map(normalizeMatric);

  enrolled.forEach((matric) => {
    const isMainRep = currentUser && activeCourse.repUid === currentUser.uid;
    const isAlreadyAssistant = assistants.includes(matric);

    if (!isMainRep && !isAlreadyAssistant) {
      const opt = document.createElement("option");
      opt.value = matric;
      opt.textContent = `Student (${matric})`;
      selectEl.appendChild(opt);
    }
  });

  if (assistants.length === 0) {
    listEl.innerHTML = `<li style="color: var(--muted); font-size: 0.85rem; padding: 5px;">No assistants appointed yet. ⏳</li>`;
  } else {
    listEl.innerHTML = "";
    assistants.forEach((matric) => {
      const li = document.createElement("li");
      li.style.cssText =
        "display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--card-bg); border-radius: 6px; margin-bottom: 6px; font-size: 0.85rem;";
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
    const managerMatric = normalizeMatric(
      currentUser ? currentUser.matric : "REP-001",
    );

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          createSession(
            randomPin,
            managerMatric,
            position.coords.latitude,
            position.coords.longitude,
          );
        },
        (error) => {
          console.warn(
            "Could not capture Rep GPS, using default campus coordinates.",
          );
          createSession(randomPin, managerMatric, 6.5244, 3.3792);
        },
        { enableHighAccuracy: true },
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
    expiresAt: expiresAt,
  });

  await setDoc(doc(db, "courses", activeCourse.id, "session", "secret"), {
    pin: pin,
    lat: lat,
    lon: lon,
    attendees: [managerMatric],
  });

  activeCourse.activeSession = {
    pin: pin,
    expiresAt: expiresAt,
    expired: false,
    attendees: [managerMatric],
    lat: lat,
    lon: lon,
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

if (checkInForm) {
  checkInForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const enteredPin = document.getElementById("studentPinInput").value.trim();

    if (!navigator.geolocation) {
      alert("⚠️ Geolocation is not supported by your browser.");
      return;
    }

    alert(
      "📍 Verifying secure location with server... Please allow GPS access.",
    );

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const studentLat = position.coords.latitude;
        const studentLon = position.coords.longitude;
        const accuracy = position.coords.accuracy || 999;

        if (accuracy > 50) {
          alert(
            `⚠️ GPS Accuracy Warning: Your location accuracy is ±${Math.round(accuracy)}m. Move closer to a window!`,
          );
          return;
        }

        try {
          const idToken = await auth.currentUser.getIdToken();

          const response = await fetch("/api/submitAttendance", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              courseId: activeCourse.id,
              pin: enteredPin,
              lat: studentLat,
              lon: studentLon,
              accuracy: accuracy,
            }),
          });

          const result = await response.json();

          if (!response.ok) {
            throw new Error(result.error || "Check-in failed.");
          }

          alert(
            "🎉 Attendance marked successfully via secure token & GPS verification! ✅📍",
          );
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
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

const closeClassBtn = document.getElementById("closeClassBtn");

if (closeClassBtn) {
  closeClassBtn.addEventListener("click", async () => {
    if (!activeCourse) return;

    if (
      confirm(
        "⚠️ Are you sure you want to close this attendance session and save the records?",
      )
    ) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch("/api/closeSession", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ courseId: activeCourse.id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to close session.");

        // Clear local session state
        activeCourse.activeSession = null;
        if (countdownInterval) clearInterval(countdownInterval);

        // Reload attendance history from the subcollection
        await loadAttendanceHistory();

        renderPortalState();
        alert("📁 Class closed successfully! Attendance has been archived.");
      } catch (error) {
        console.error("Close session error:", error);
        alert("⚠️ Error: Unable to close session. Please try again.");
      }
    }
  });
}

const endSemesterBtn = document.getElementById("endSemesterBtn");

if (endSemesterBtn) {
  endSemesterBtn.addEventListener("click", async () => {
    if (!activeCourse) return;

    if (
      confirm(
        `⚠️ WARNING: Are you sure you want to END THE SEMESTER for "${activeCourse.name}"? This will clear all class history and reset the total class count to 0.`,
      )
    ) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch("/api/endSemester", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ courseId: activeCourse.id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to end semester.");

        activeCourse.attendanceHistory = [];
        activeCourse.activeSession = null;
        if (countdownInterval) clearInterval(countdownInterval);

        renderPortalState();
        alert("🎓 Semester ended successfully! All records have been reset.");
      } catch (error) {
        console.error("End semester error:", error);
        alert("⚠️ Error: Unable to end semester. Please try again.");
      }
    }
  });
}

// Load attendance history from the attendance/ subcollection (source of truth)
async function loadAttendanceHistory() {
  if (!activeCourse || !activeCourse.id) return;
  try {
    const snap = await getDocs(
      query(
        collection(db, "courses", activeCourse.id, "attendance"),
        orderBy("closedAt", "asc"),
      ),
    );
    activeCourse.attendanceHistory = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
  } catch (error) {
    console.error("Failed to load attendance history:", error);
    activeCourse.attendanceHistory = [];
  }
}

async function updateCourseInFirestore() {
  if (!activeCourse || !activeCourse.id) return;
  const courseRef = doc(db, "courses", activeCourse.id);
  // Never overwrite enrolled[] from client state — enrollment is managed
  // exclusively by the trusted backend (enrollCourse / removeStudent APIs)
  // to prevent race conditions. Only safe non-enrollment fields go here.
  await updateDoc(courseRef, {
    activeSession: activeCourse.activeSession || null,
    assistants: activeCourse.assistants || [],
  });
}

window.downloadAttendance = function (index) {
  if (
    !activeCourse ||
    !activeCourse.attendanceHistory ||
    !activeCourse.attendanceHistory[index]
  )
    return;

  const sessionRecord = activeCourse.attendanceHistory[index];
  let csvContent = "data:text/csv;charset=utf-8,Matric Number,Status\n";

  sessionRecord.attendees.forEach((matric) => {
    csvContent += `"${matric}","Present"\r\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute(
    "download",
    `${activeCourse.code}_Attendance_${sessionRecord.date.replace(/[/:\s]/g, "_")}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

function renderPortalState() {
  if (!activeCourse) return;

  const userMatric = normalizeMatric(currentUser ? currentUser.matric : "");
  const isRep = currentUser && activeCourse.repUid === currentUser.uid;
  const isAssistant =
    currentUser &&
    (activeCourse.assistants || []).map(normalizeMatric).includes(userMatric);
  const session = activeCourse.activeSession;
  const isSessionActive =
    session && !session.expired && Date.now() < session.expiresAt;

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
            bannerText.textContent =
              "The 60-second window has expired. PIN is no longer valid, but you can review and close class.";
          } else {
            bannerText.textContent =
              "The attendance window for this session has closed. PIN is no longer valid.";
          }
        }
      } else {
        sessionBanner.classList.add("hidden");
      }
    }
    if (isRep || isAssistant) {
      if (activePinDisplay) activePinDisplay.classList.add("hidden");
      if (generatePinBtn)
        generatePinBtn.textContent = "Generate Attendance PIN ⏱️";

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
    attendees.forEach((matric) => {
      const isMainRepUser = activeCourse.repUid === currentUser.uid;
      const isAssistantUser = (activeCourse.assistants || [])
        .map(normalizeMatric)
        .includes(normalizeMatric(matric));

      let badgeHTML = "";
      if (isMainRepUser) {
        badgeHTML = `<span style="background: var(--teal); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 6px;">👑 REP</span>`;
      } else if (isAssistantUser) {
        badgeHTML = `<span style="background: var(--teal); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 6px;">👑 ASST</span>`;
      }

      const li = document.createElement("li");
      li.style.cssText =
        "display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 0.9rem;";
      li.innerHTML = `<span>🎓 <strong>Student</strong> (${matric}) ${badgeHTML}</span> <span style="color: #28a745; font-weight: bold;">Present ✅</span>`;
      rosterList.appendChild(li);
    });
  }

  if (isRep) {
    let enrolledListDiv = document.getElementById("repEnrolledStudentsSection");

    if (!enrolledListDiv && portalSection) {
      enrolledListDiv = document.createElement("div");
      enrolledListDiv.id = "repEnrolledStudentsSection";
      enrolledListDiv.style.cssText =
        "background: var(--card-bg); padding: 15px; border-radius: 12px; margin-top: 20px; border: 1px solid var(--border);";

      const targetParent =
        document.getElementById("repControls") || portalSection;
      targetParent.appendChild(enrolledListDiv);
    }

    if (enrolledListDiv) {
      const enrolledMatrics = activeCourse.enrolled || [];
      let studentRowsHTML = "";

      if (enrolledMatrics.length === 0) {
        studentRowsHTML = `<p style="color: var(--muted); font-size: 0.85rem;">No students enrolled yet.</p>`;
      } else {
        enrolledMatrics.forEach((matric) => {
          const isRepMatric = userMatric === normalizeMatric(matric);
          studentRowsHTML += `
            <li style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--bg); border-radius: 6px; margin-bottom: 6px; font-size: 0.85rem;">
              <span>🎓 <strong>${matric}</strong> ${isRepMatric ? "(You - Rep)" : ""}</span>
              ${!isRepMatric ? `<button onclick="removeStudentFromCourse('${matric}')" style="background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 0.8rem; font-weight: bold;">Remove 🚪❌</button>` : ""}
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
    const archiveListContainer = document.getElementById(
      "archiveListContainer",
    );

    const history = activeCourse.attendanceHistory || [];
    if (totalClassesCount) totalClassesCount.textContent = history.length;

    if (history.length === 0) {
      archiveListContainer.innerHTML = `<p style="font-size: 0.9rem; color: var(--muted); text-align: center; padding: 10px;">No archived classes yet. Close a live class to save records here! 🗂️</p>`;
    } else {
      archiveListContainer.innerHTML = "";
      history.forEach((sessionRecord, archiveIndex) => {
        const archiveCard = document.createElement("div");
        archiveCard.style.cssText =
          "background: var(--card-bg); padding: 12px; border-radius: 8px; margin-bottom: 10px; border: 1px solid var(--border);";

        const attendeesListHTML = sessionRecord.attendees
          .map((m) => {
            return `<li style="font-size: 0.85rem; padding: 2px 0;">🎓 Student (${m})</li>`;
          })
          .join("");

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

  const studentAnalyticsSection = document.getElementById(
    "studentAnalyticsSection",
  );
  const isEnrolled = (activeCourse.enrolled || [])
    .map(normalizeMatric)
    .includes(userMatric);

  if (isEnrolled && studentAnalyticsSection) {
    studentAnalyticsSection.classList.remove("hidden");

    const history = activeCourse.attendanceHistory || [];
    const totalClasses = history.length;

    let attendedCount = 0;
    let historyListHTML = "";

    history.forEach((sessionRecord) => {
      const normalizedAttendees = (sessionRecord.attendees || []).map(
        normalizeMatric,
      );
      const wasPresent = normalizedAttendees.includes(userMatric);
      if (wasPresent) attendedCount++;

      historyListHTML += `
        <li style="display: flex; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 0.85rem;">
          <span>📅 ${sessionRecord.date}</span>
          <span style="font-weight: bold; color: ${wasPresent ? "#28a745" : "#dc3545"};">
            ${wasPresent ? "Present ✅" : "Absent ❌"}
          </span>
        </li>
      `;
    });

    const percentage =
      totalClasses > 0 ? Math.round((attendedCount / totalClasses) * 100) : 100;

    document.getElementById("statAttendedCount").textContent = attendedCount;
    document.getElementById("statTotalClasses").textContent = totalClasses;
    document.getElementById("statPercentage").textContent = `${percentage}%`;

    let personalLogContainer = document.getElementById("personalLogContainer");
    if (!personalLogContainer) {
      personalLogContainer = document.createElement("div");
      personalLogContainer.id = "personalLogContainer";
      personalLogContainer.style.cssText =
        "margin-top: 15px; background: var(--card-bg); padding: 10px; border-radius: 8px; border: 1px solid var(--border);";
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
      eligibilityBanner.textContent =
        "⏳ No archived classes yet. Analytics will update as classes are held.";
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
